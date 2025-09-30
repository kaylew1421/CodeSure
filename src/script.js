// ----------------------------
// CodeSure - popup script.js (corrected & optimized)
// ----------------------------

let cptData = [];
let rulesData = {};
let dataLoaded = false;

const CODE_RE = /^\d{5}$/;
// generous timeouts for cold-start model downloads
const PROMPT_AI_DEADLINE_MS = 25000; // was 20000
const SUMMARIZE_TIMEOUT_MS   = 90000; // was 45000
const SUMMARIZE_FAST_THRESHOLD = 10000; // treat pages under 10k chars as fast path
const DIAG_TIMEOUT           = 30000;

let suggestWorker = null;
let summarizerSingleton = null; // prewarmed, reused summarizer instance

// ---------- helpers ----------
function setHTML(el, html) { if (el) el.innerHTML = html; }
function ts() { return new Date().toLocaleTimeString(); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function withTimeout(promise, ms, label = 'timeout') {
  let t; const gate = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); });
  return Promise.race([promise.finally(() => clearTimeout(t)), gate]);
}
function normalizeRuleText(s) {
  if (!s || typeof s !== 'string') return '';
  let cleaned = s.replace(/\s+/g, ' ').trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const out = [];
  for (const sent of sentences) {
    const prev = out[out.length - 1];
    if (!prev || prev.toLowerCase() !== sent.toLowerCase()) out.push(sent);
  }
  return out.join(' ');
}
function sanitizeAI(text) {
  if (!text) return text;
  let out = String(text);
  const hard = [
    /\(?\s*no\s+changes\s+needed[^)]*\)?\.?/gi,
    /\b(already\s+grammatically\s+correct(?:\s+and)?\s+concise)\b/gi,
    /\b(no\s+edits\s+required)\b/gi,
    /\b(text\s+is\s+already\s+clear\s+and\s+concise)\b/gi,
    /\(i['']?(ve| have)\s+(just\s+)?(added|made|fixed|corrected|updated)[^)]+?\)/gi,
    /\(edited\s+for\s+clarity[^)]*\)/gi,
  ];
  for (const re of hard) out = out.replace(re, '');
  out = out.replace(/^\s*(?:note|editor|proofreader)\s*:\s.*$/gim, '');
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!out.trim()) out = String(text).replace(/\([^)]*\)/g, '').trim();
  return out;
}

// ---------- tabs ----------
function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  const byId = (id) => document.getElementById(id);

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('is-active'));
      tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
      panels.forEach(p => p.hidden = true);

      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      byId(id).hidden = false;

      if (id === 'tab-note') syncNoteFromHome();
    });
  });
}

// ---------- JSON + History (persistent) ----------
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function saveHistoryItem(html) {
  try {
    const key = 'codesure_history';
    const store = await chrome.storage.local.get(key);
    const arr = Array.isArray(store[key]) ? store[key] : [];
    arr.unshift({ ts: Date.now(), html });
    await chrome.storage.local.set({ [key]: arr.slice(0, 20) });
  } catch (e) {
    // storage may be unavailable in some contexts—gracefully ignore
  }
}
async function loadHistory() {
  try {
    const key = 'codesure_history';
    const store = await chrome.storage.local.get(key);
    const arr = Array.isArray(store[key]) ? store[key] : [];
    const h = document.getElementById('history');
    if (!h) return;
    h.innerHTML = arr.map(x => `<div class="mono tiny muted">${new Date(x.ts).toLocaleTimeString()}</div>${x.html}<hr/>`).join('');
  } catch {}
}
function addHistory(html) {
  const h = document.getElementById('history');
  if (h) {
    const entry = `<div class="mono tiny muted">${ts()}</div>${html}<hr/>`;
    h.insertAdjacentHTML('afterbegin', entry);
  }
  // persist
  saveHistoryItem(html);
}

// ---------- language pickers ----------
function getPopupLang() {
  const sel = document.getElementById('popupLang');
  const v = (sel?.value || '').toLowerCase();
  const allowed = ['en','es','ja'];
  if (allowed.includes(v)) return v;
  const guess = (navigator.language || 'en').slice(0,2).toLowerCase();
  return allowed.includes(guess) ? guess : 'en';
}
function getSummLang() {
  const v = (document.getElementById('sumLang')?.value || 'en').toLowerCase();
  return ['en','es','ja'].includes(v) ? v : 'en';
}
function getNoteLang() {
  const v = (document.getElementById('noteLang')?.value || 'en').toLowerCase();
  return ['en','es','ja'].includes(v) ? v : 'en';
}
function LM_OPTS(lang) {
  return { expectedInputs: [{type:'text',languages:['en']}], expectedOutputs: [{type:'text',languages:[lang]}] };
}

// ---------- Summarizer & Translator helpers ----------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  return tab;
}
async function getActiveTabUrl() {
  const tab = await getActiveTab();
  return tab.url || 'about:blank';
}

// UPDATED: prefer selection -> main -> body; trim & normalize
async function getActiveTabText() {
  const tab = await getActiveTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const mainish = document.querySelector('main, article, .article, .post, .entry-content');
      let text = mainish ? mainish.innerText : document.body.innerText;
      text = text.replace(/\s+/g, ' ').trim();
      return text.slice(0, 600); // Reduced from 4000 → much faster
    }
  });
  return result || '';
}

// Fallback summarization via Prompt API (chunking)
function chunkText(t, size = 6000) {
  const out = [];
  for (let i = 0; i < t.length; i += size) out.push(t.slice(i, i + size)); // fixed slicing
  return out;
}

// NEW: chunking for Summarizer path too
function chunkTextByChars(t, size = 7000, maxChunks = 4) {
  const out = [];
  for (let i = 0; i < t.length && out.length < maxChunks; i += size) {
    out.push(t.slice(i, i + size));
  }
  return out;
}

async function summarizeWithSummarizerChunked(summarizer, text, lang, statusEl) {
  const chunks = chunkTextByChars(text, 7000, 4);
  if (chunks.length === 1) {
    return await withTimeout(
      summarizer.summarize(chunks[0], {
        context: 'Summarize payer coverage criteria and documentation requirements. Use bullet points.',
        outputLanguage: lang
      }),
      Math.max(45000, SUMMARIZE_TIMEOUT_MS),
      'summarize timeout'
    );
  }

  // Run two chunks at a time for speed
  const partials = new Array(chunks.length);
  let idx = 0;
  const worker = async () => {
    const myIndex = idx++;
    if (myIndex >= chunks.length) return;
    statusEl && (statusEl.textContent = `Summarizing chunk ${myIndex + 1}/${chunks.length}…`);
    try {
      partials[myIndex] = await withTimeout(
        summarizer.summarize(chunks[myIndex], {
          context: `Summarize this section as tight bullet points in ${lang.toUpperCase()}.`,
          outputLanguage: lang
        }),
        30000,
        `chunk ${myIndex + 1} timeout`
      );
    } catch {
      partials[myIndex] = '';
    }
    await worker();
  };
  await Promise.all([worker(), worker()]); // 2-way concurrency

  // Merge pass is short
  statusEl && (statusEl.textContent = 'Merging…');
  const mergedInput = partials.filter(Boolean).join('\n\n');
  return await withTimeout(
    summarizer.summarize(mergedInput, {
      context: `Merge & deduplicate into one concise list (~8 bullets) in ${lang.toUpperCase()}, focused on coverage criteria & documentation.`,
      outputLanguage: lang
    }),
    20000,
    'merge timeout'
  );
}

async function summarizeWithLanguageModel(text, lang) {
  if (!('LanguageModel' in self)) throw new Error('Prompt API unavailable');
  const session = await withTimeout(LanguageModel.create(LM_OPTS(lang)), PROMPT_AI_DEADLINE_MS, 'create timeout');

  const chunks = chunkText(text, 6000).slice(0, 6);
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    const prompt =
`Summarize this policy text as concise bullet points in ${lang.toUpperCase()} (coverage criteria, prior auth, documentation, indications/contraindications, modifiers/site-of-service). Keep 5–8 bullets max.

[Chunk ${i+1}/${chunks.length}]
---
${chunks[i]}
---`;
    const out = await withTimeout(session.prompt(prompt), PROMPT_AI_DEADLINE_MS, 'prompt timeout');
    partials.push(typeof out === 'string' ? out : String(out || ''));
  }

  const mergePrompt =
`Merge and deduplicate these bullet lists into one clean list in ${lang.toUpperCase()} (max ~10 bullets):
${partials.join('\n\n')}`;
  const merged = await withTimeout(session.prompt(mergePrompt), PROMPT_AI_DEADLINE_MS, 'merge timeout');
  return typeof merged === 'string' ? merged : String(merged || partials.join('\n'));
}

const translatorCache = new Map();
async function getTranslator(targetLang, sourceLang = 'en', onProgress = null) {
  if (targetLang === 'en' || !('Translator' in self)) return null;
  const key = `${sourceLang}->${targetLang}`;
  if (translatorCache.has(key)) return translatorCache.get(key);
  try {
    const t = await Translator.create({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      monitor(m) {
        if (!onProgress) return;
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round((e.loaded || 0) * 100);
          if (typeof onProgress === 'function') onProgress(pct);
        });
      }
    });
    translatorCache.set(key, t);
    return t;
  } catch { return null; }
}
async function lmTranslateText(s, targetLang) {
  if (!('LanguageModel' in self)) return s;
  try {
    if (!(navigator.userActivation && navigator.userActivation.isActive)) throw new Error('User activation required');
    const session = await withTimeout(LanguageModel.create(LM_OPTS(targetLang)), PROMPT_AI_DEADLINE_MS, 'create timeout');
    const prompt = `Translate to ${targetLang.toUpperCase()}:\n\n${s}\n\nOnly output the translation.`;
    const out = await withTimeout(session.prompt(prompt), PROMPT_AI_DEADLINE_MS, 'prompt timeout');
    return typeof out === 'string' ? out : String(out || s);
  } catch { return s; }
}
async function tText(s, lang, tx = null) {
  if (!s || lang === 'en') return s;
  const outTx = tx || await getTranslator(lang, 'en');
  if (outTx) { try { return await outTx.translate(s); } catch {} }
  return await lmTranslateText(s, lang);
}
async function tLines(lines, lang, tx = null) {
  if (!Array.isArray(lines) || !lines.length || lang === 'en') return lines;
  const outTx = tx || await getTranslator(lang, 'en');
  const out = [];
  if (outTx) {
    for (const l of lines) { try { out.push(await outTx.translate(l)); } catch { out.push(await lmTranslateText(l, lang)); } }
    return out;
  }
  for (const l of lines) out.push(await lmTranslateText(l, lang));
  return out;
}

// ---------- data ----------
async function initData() {
  try {
    const [codes, rules] = await Promise.all([
      loadJSON("src/cpt-codes.json"),
      loadJSON("src/rules.json"),
    ]);
    cptData = Array.isArray(codes) ? codes : [];
    rulesData = rules && typeof rules === "object" ? rules : {};
    dataLoaded = true;

    try {
      suggestWorker = new Worker(chrome.runtime.getURL('src/suggest-worker.js'), { type: 'classic' });
    } catch {
      suggestWorker = null;
    }
  } catch (e) {
    setHTML(document.getElementById("result"),
      `<div class="warn">⚠️ Failed to load data files: ${e.message}</div>`);
  }
}

// ---------- validate ----------
async function doValidate() {
  const cptInputVal = (document.getElementById("cptInput")?.value || "").trim();
  const payerInputVal = (document.getElementById("payerInput")?.value || "").trim();
  const resultEl = document.getElementById("result");
  const lang = getPopupLang();
  const tx = await getTranslator(lang, 'en', (pct) => {
    resultEl.innerHTML = `<div class="mono small">Downloading language pack… ${pct}%</div>`;
  });

  if (!cptInputVal || !payerInputVal) {
    const msg = await tText("❌ Please enter CPT code(s) and select a payer.", lang, tx);
    setHTML(resultEl, `<div class="warn">${msg}</div>`);
    document.getElementById('snapshotBar').style.display = 'none';
    document.getElementById('snapshotOut').style.display = 'none';
    return;
  }
  if (!dataLoaded) {
    const msg = await tText("⏳ Data still loading—try again in a moment.", lang, tx);
    setHTML(resultEl, `<div class="warn">${msg}</div>`);
    return;
  }

  const tokens = cptInputVal.split(/[,\s]+/).filter(Boolean);
  let out = "";

  for (const token of tokens) {
    const code = token.trim();
    const found = cptData.find(r => r.code === code);

    if (found) {
      const rules = rulesData[code];
      const rawRule = (rules && rules[payerInputVal])
        ? rules[payerInputVal]
        : "No specific rules found for this payer.";
      const rule = normalizeRuleText(rawRule);

      const isOk =
        rule.toLowerCase().includes("not required") ||
        rule.toLowerCase().includes("no pa") ||
        rule.toLowerCase().includes("no prior");

      const descT = await tText(found.description, lang, tx);
      const ruleT = await tText(rule, lang, tx);
      const payerT = await tText(payerInputVal, lang, tx);

      out += `
        <div>
          ✅ <strong>${found.code}</strong>: ${descT}<br/>
          <em>${payerT}</em> → <span class="${isOk ? "ok" : "warn"}">${ruleT}</span>
        </div>
      `;
    } else {
      const shapeHint = CODE_RE.test(code) ? "" : " (must be 5 digits)";
      const notFound = await tText("❌ Code", lang, tx);
      const hintT = shapeHint ? await tText(" (must be 5 digits)", lang, tx) : "";
      out += `<div class="warn">${notFound} <strong>${code}</strong> ${await tText("not found", lang, tx)}${hintT}.</div>`;
    }
  }

  setHTML(resultEl, out);
  addHistory(out);

  // show snapshot controls (will use first valid code by default)
  const snapshotBar = document.getElementById('snapshotBar');
  if (snapshotBar) snapshotBar.style.display = 'flex';
  const snapshotOut = document.getElementById('snapshotOut');
  if (snapshotOut) { snapshotOut.textContent = ''; snapshotOut.style.display = 'none'; }
}

// ---------- suggestions (AI Assist) ----------
function setupSuggestions() {
  const input = document.getElementById("cptInput");
  const box   = document.getElementById("suggestions");
  if (!input || !box) return;

  input.addEventListener("input", () => {
    const term = input.value.trim().split(/[,\s]+/).pop() || "";
    if (!term || term.length < 2 || !dataLoaded) { box.innerHTML = ""; return; }

    const list = cptData.filter(r => r.code.startsWith(term)).slice(0, 5);
    if (!list.length) { box.innerHTML = ""; return; }

    box.innerHTML = list.map(r =>
      `<button type="button" class="mono small" data-code="${r.code}" style="margin:0 6px 6px 0;">${r.code}</button>`
    ).join("");

    box.querySelectorAll("button[data-code]").forEach(btn => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-code");
        const parts = input.value.split(/,/).map(s => s.trim()).filter(Boolean);
        if (parts.length) parts[parts.length - 1] = code; else parts.push(code);
        input.value = parts.join(", ");
        box.innerHTML = "";
      });
    });
  });
}

// attachments UI
function setupAttachmentsList() {
  const input = document.getElementById("attachInput");
  const list  = document.getElementById("attachList");
  if (!input || !list) return;

  input.addEventListener("change", () => {
    list.innerHTML = "";
    const files = Array.from(input.files || []);
    files.forEach(f => {
      const row = document.createElement("div");
      row.className = "mono small";
      row.textContent = `• ${f.name} (${f.type || "unknown"})`;
      list.appendChild(row);
    });
  });
}
async function readAttachments() {
  const input = document.getElementById("attachInput");
  if (!input) return { text: "", hints: [] };

  const files = Array.from(input.files || []);
  if (!files.length) return { text: "", hints: [] };

  let text = "";
  const hints = [];
  for (const f of files) {
    const isTexty = f.type.startsWith("text/") || /\.md$/i.test(f.name) || /\.json$/i.test(f.name);
    if (isTexty) {
      const t = await f.text();
      text += "\n" + (t || "");
      if (text.length > 20000) text = text.slice(0, 20000);
    } else {
      hints.push(f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[_-]+/g, ' '));
    }
  }
  return { text, hints };
}

// domain token expansion
function expandTokens(text) {
  const synonyms = {
    ct: ['ct','computed tomography','ct scan','cat scan','tomography'],
    mri: ['mri','magnetic resonance','mr imaging'],
    xray: ['xray','x-ray','radiograph','plain film'],
    ultrasound: ['ultrasound','sonogram','sonography','doppler'],
    nuclear: ['nuclear','pet','pet-ct','nuclear medicine'],
    echo: ['echo','echocardiogram','echocardiography','stress echo'],
    views: ['single view','2 views','3 views','ap','lateral'],
    surgery: ['surgery','operative','procedure','arthroscopy','endoscopy','colonoscopy','egd','ercp','stent','cath','reconstruction','release','repair'],
    em: ['e/m','evaluation & management','visit','office','outpatient','telehealth','telemedicine','ed','er','inpatient','observation','preventive','annual'],
    therapy: ['therapy','pt','ot','slp','physical therapy','occupational therapy','speech therapy','eval','re-eval','group'],
    lab: ['lab','laboratory','panel','assay','pcr','cbc','cmp','lipid','a1c','tsh','hiv'],
    path: ['pathology','biopsy','cytology','frozen section','ihc','molecular'],
    anesthesia: ['anesthesia','sedation','mac','regional','general'],
    cardio: ['ecg','ekg','holter','stress','treadmill','cardiology'],
    vax: ['vaccine','immunization','mmr','dtap','influenza','hpv','pneumococcal','hep b'],
    vision: ['ophthalmology','eye exam','refraction','oct','retina','visual field','contacts','glasses','frames','lenses'],
    dme: ['dme','equipment','supply','wheelchair','walker','cane','crutches','cpap','oxygen','nebulizer','brace','splint','prosthetic','orthotic','rr','nu','ue','kx','ga','lt','rt']
  };

  const base = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(t => t.length > 1);
  const expanded = new Set(base);
  for (const list of Object.values(synonyms)) {
    if (base.some(t => list.includes(t))) list.forEach(w => expanded.add(w));
  }
  return [...expanded];
}

// Prompt API attribute extraction
async function tryPromptAttributes(line) {
  if (!('LanguageModel' in self)) return { error: 'Prompt API unavailable' };
  const lang = getPopupLang();
  try {
    const session = await withTimeout(LanguageModel.create(LM_OPTS(lang)), PROMPT_AI_DEADLINE_MS, 'create timeout');
    const schema = {
      type: "object",
      properties: {
        candidateCode: { type: "string" },
        modifiers: { type: "array", items: { type: "string" } },
        modality: { type: "string" },
        bodyPart: { type: "string" },
        contrast: { type: "string" },
        laterality: { type: "string" },
        setting: { type: "string" },
        reason: { type: "string" }
      },
      required: []
    };
    const prompt =
      `Extract possible coding attributes from this description. ` +
      `Return strict JSON ONLY (no prose) matching this schema: ${JSON.stringify(schema)}. ` +
      `Write strings in ${lang.toUpperCase()}. If a 5-digit candidateCode is present, include it.\n\n` +
      `Service: "${line}"`;

    const result = await withTimeout(session.prompt(prompt, { responseConstraint: schema }), PROMPT_AI_DEADLINE_MS, 'prompt timeout');
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;

    if (!parsed || typeof parsed !== 'object') return { error: 'No structured output' };
    if (parsed.candidateCode && !CODE_RE.test(parsed.candidateCode)) delete parsed.candidateCode;
    if (!Array.isArray(parsed.modifiers)) parsed.modifiers = [];
    for (const k of ['modality','bodyPart','contrast','laterality','setting','reason']) {
      if (parsed[k] && typeof parsed[k] !== 'string') parsed[k] = String(parsed[k]);
    }
    return parsed;
  } catch (e) {
    return { error: e.message || String(e) };
  }
}
function renderAttrChips(attrs) {
  const el = document.getElementById('attrChips');
  if (!el) return;
  const chips = [];
  const order = ['modality','bodyPart','contrast','laterality','setting'];
  for (const k of order) {
    const v = attrs[k];
    if (v && String(v).trim()) chips.push(`<span class="chip">${k}: ${v}</span>`);
  }
  if (attrs.modifiers && attrs.modifiers.length) chips.push(`<span class="chip">modifiers: ${attrs.modifiers.join(', ')}</span>`);
  el.innerHTML = chips.join(' ');
}

// ---------- payer comparison ----------
function exportComparisonCSV(code, rules) {
  const payers = ['Medicare','BlueCross','UnitedHealth','Cigna','Aetna','Humana'];
  const rows = [['Code','Payer','Rule']];
  payers.forEach(p => rows.push([code, p, (rules[p] || '').replace(/\s+/g,' ').trim()]));
  const csv = rows.map(r => r.map(x => `"${(x||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `codesure_${code}_payer_comparison.csv`;
  a.click();
}

// NEW: one-line explanation via Prompt API
async function explainRuleOneLiner(ruleTextEn, lang) {
  if (!('LanguageModel' in self)) return '';
  try {
    const s = await withTimeout(LanguageModel.create(LM_OPTS(lang)), PROMPT_AI_DEADLINE_MS, 'create timeout');
    const prompt =
`In ${lang.toUpperCase()}, explain briefly (one sentence, <= 28 words) the likely clinical rationale behind this payer coverage rule. Avoid restating the rule; focus on why it exists.

Rule:
"${ruleTextEn}"

Output only the sentence.`;
    const out = await withTimeout(s.prompt(prompt), PROMPT_AI_DEADLINE_MS, 'prompt timeout');
    let text = sanitizeAI(typeof out === 'string' ? out : String(out || ''));
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > 220) text = text.slice(0, 217) + '…';
    return text;
  } catch {
    return '';
  }
}

async function renderPayerCompare(code) {
  document.querySelector('.tab[data-tab="tab-home"]')?.click();

  const mount = document.getElementById('payerCompare');
  if (!mount) return;
  const lang = getPopupLang();
  const tx = await getTranslator(lang, 'en', (pct) => {
    mount.innerHTML = `<div class="mono small">Downloading language pack… ${pct}%</div>`;
  });

  const rules = rulesData[code] || {};
  const payers = ['Medicare','BlueCross','UnitedHealth','Cigna','Aetna','Humana'];

  // build rows with Explain button + output placeholder
  const rows = [];
  for (const p of payers) {
    const txtEn = normalizeRuleText(rules[p] || '—');  // keep EN for LM prompt
    const pT    = await tText(p, lang, tx);
    const rT    = await tText(txtEn, lang, tx);
    const explainLbl = await tText('Explain rule', lang, tx);

    rows.push(
      `<tr>
        <th scope="row">${pT}</th>
        <td>
          <div class="rule-line">${rT}</div>
          <div class="row gap" style="align-items:center; margin-top:4px;">
            <button class="btn tiny ghost explain-btn" data-code="${code}" data-payer="${p}" data-rule="${encodeURIComponent(txtEn)}">${explainLbl}</button>
            <div class="explain-out tiny muted" aria-live="polite"></div>
          </div>
        </td>
      </tr>`
    );
  }

  const head = await tText('Payer Comparison for', lang, tx);
  const thPayer = await tText('Payer', lang, tx);
  const thRule  = await tText('Rule', lang, tx);
  const exportLbl = await tText('Export CSV', lang, tx);

  const exportId = `exportCsvBtn-${code}`;
  mount.innerHTML = `
    <div class="row" style="align-items:center; gap:8px; margin-top:8px;">
      <h3 style="margin:0;">${head} <code>${code}</code></h3>
      <button id="${exportId}" class="btn slim ghost">${exportLbl}</button>
    </div>
    <table class="table" role="table" aria-label="Payer comparison">
      <thead><tr><th>${thPayer}</th><th>${thRule}</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;

  // bind export
  const btn = document.getElementById(exportId);
  if (btn) btn.addEventListener('click', () => exportComparisonCSV(code, rules));

  // bind "Explain rule" buttons
  mount.querySelectorAll('.explain-btn').forEach((b) => {
    b.addEventListener('click', async () => {
      const out = b.parentElement.querySelector('.explain-out');
      if (out) out.textContent = await tText('Explaining…', lang, tx);
      b.disabled = true;

      const ruleEn = decodeURIComponent(b.dataset.rule || '');
      let rationale = await explainRuleOneLiner(ruleEn, lang);
      if (!rationale) rationale = await tText('Not available on this device.', lang, tx);

      if (out) out.textContent = rationale;
      b.disabled = false;
    });
  });

  try { mount.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch {}
}

// ---------- AI Assist run ----------
async function runSuggest() {
  const btn  = document.getElementById("aiExtractBtn");
  const out  = document.getElementById("aiExtractOut");
  const line = (document.getElementById("aiLine")?.value || "").trim();
  const lang = getPopupLang();
  const tx = await getTranslator(lang, 'en', (pct) => {
    out.textContent = `Downloading language pack… ${pct}%`;
  });

  if (!out) return;
  out.textContent = await tText("Thinking…", lang, tx);

  if (!dataLoaded) { out.textContent = await tText("⏳ Data still loading—try again in a moment.", lang, tx); return; }

  btn && (btn.disabled = true);
  const chips = document.getElementById('attrChips'); if (chips) chips.innerHTML = '';

  try {
    await sleep(0);

    const { text: aText, hints: aHints } = await readAttachments();
    const corpus = ((line || '') + '\n' + aText + '\n' + aHints.join(' ')).toLowerCase();

    let attrs = {};
    if (line) {
      const lm = await tryPromptAttributes(line);
      if (lm && !lm.error) { attrs = lm; renderAttrChips(attrs); }
    }

    const tokens = expandTokens(corpus);
    let suggestions = [];
    if (suggestWorker) {
      suggestions = await new Promise((resolve) => {
        const onMsg = (ev) => { suggestWorker.removeEventListener('message', onMsg); resolve(ev.data && ev.data.ok ? ev.data.results : []); };
        suggestWorker.addEventListener('message', onMsg);
        suggestWorker.postMessage({ cptData, tokens });
        setTimeout(() => { try { suggestWorker.removeEventListener('message', onMsg); } catch {} resolve([]); }, 800);
      });
    } else {
      suggestions = cptData.map(row => {
        const d = (row.description || "").toLowerCase();
        const c = (row.category || "").toLowerCase();
        let s = 0;
        for (const t of tokens) { if (d.includes(t)) s += 2; if (c.includes(t)) s += 1; }
        if (corpus.includes(row.code)) s += 3;
        return { code: row.code, description: row.description, category: row.category, score: s };
      }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0,5);
    }

    if (suggestions.length < 3 && /ct|mri|x[- ]?ray|ultrasound|sonogram|fluoro|nuclear|pet/i.test(line)) {
      const extra = cptData
        .filter(r => /imaging/i.test(r.category) || /(ct|mri|x[- ]?ray|ultrasound|sonogram|fluoro|nuclear|pet)/i.test(r.description))
        .slice(0, 5 - suggestions.length)
        .map(r => ({ code: r.code, description: r.description, category: r.category, score: 1 }));
      const seen = new Set(suggestions.map(s => s.code));
      for (const e of extra) if (!seen.has(e.code)) suggestions.push(e);
    }

    const pieces = [];
    if (line) pieces.push(`${await tText('Service:', lang, tx)} ${await tText(line, lang, tx)}`);

    if (attrs && Object.keys(attrs).length) {
      for (const k of ['modality','bodyPart','contrast','laterality','setting','reason']) {
        if (attrs[k]) attrs[k] = await tText(String(attrs[k]), lang, tx);
      }
      if (Array.isArray(attrs.modifiers) && attrs.modifiers.length) {
        attrs.modifiers = await tLines(attrs.modifiers, lang, tx);
      }
      pieces.push(`${await tText('AI Extraction:', lang, tx)}\n${JSON.stringify(attrs, null, 2)}`);
    }

    if (aHints.length || aText) {
      const attLabel = await tText('Attachments considered:', lang, tx);
      pieces.push(`${attLabel} ${aHints.join(", ") || await tText("text file(s)", lang, tx)}`);
    }

    if (suggestions.length) {
      const header = await tText('Suggestions from mock data:', lang, tx);
      const txd = [];
      for (const s of suggestions) {
        const descT = await tText(s.description, lang, tx);
        const catT  = await tText(s.category, lang, tx);
        txd.push(`${s.code} — ${descT} [${catT}]`);
      }
      pieces.push(header + "\n" + txd.join("\n"));
    } else {
      pieces.push(await tText("Suggestions from mock data:\n(no strong matches)", lang, tx));
    }

    out.textContent = pieces.join("\n\n");

    // attach Use / Compare buttons
    if (suggestions.length) {
      const wrap = document.createElement("div");
      wrap.style.marginTop = "8px";

      for (const s of suggestions) {
        const rowWrap = document.createElement('div');
        rowWrap.style.display = 'flex';
        rowWrap.style.gap = '6px';
        rowWrap.style.marginBottom = '6px';

        const useBtn = document.createElement("button");
        useBtn.className = 'btn slim';
        useBtn.textContent = `${await tText('Use', lang, tx)} ${s.code}`;
        useBtn.addEventListener("click", () => {
          const cptInput = document.getElementById("cptInput");
          if (!cptInput) return;
          const parts = cptInput.value.split(/,/).map(t => t.trim()).filter(Boolean);
          parts.push(s.code);
          cptInput.value = parts.join(", ");
          document.querySelector('.tab[data-tab="tab-home"]')?.click();
        });

        const cmpBtn = document.createElement('button');
        cmpBtn.className = 'btn slim';
        cmpBtn.textContent = `${await tText('Compare', lang, tx)} ${s.code}`;
        cmpBtn.addEventListener('click', () => { renderPayerCompare(s.code); });

        rowWrap.appendChild(useBtn);
        rowWrap.appendChild(cmpBtn);
        wrap.appendChild(rowWrap);
      }
      out.appendChild(wrap);
    }

  } catch (err) {
    out.textContent = `⚠️ ${await tText('Error:', lang, tx)} ${err.message || String(err)}`;
  } finally {
    const btn2 = document.getElementById("aiExtractBtn");
    if (btn2) btn2.disabled = false;
  }
}

// ---------- Coverage Snapshot ----------
function pickFirstValidCodeFromInput() {
  const val = (document.getElementById('cptInput')?.value || '').trim();
  const codes = val.split(/[,\s]+/).filter(Boolean);
  for (const c of codes) {
    if (CODE_RE.test(c) && cptData.find(r => r.code === c)) return c;
  }
  return null;
}
function extractTopDocsFromSummary(max = 3) {
  const raw = (document.getElementById('summaryPopup')?.textContent || '').trim();
  if (!raw) return [];
  const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[-*•]/.test(l)).map(l => l.replace(/^[-*•]\s*/, ''));
  return bullets.slice(0, max);
}
async function generateCoverageSnapshot() {
  const snapOut = document.getElementById('snapshotOut');
  if (!snapOut) return;
  const lang = getPopupLang();
  const tx = await getTranslator(lang, 'en');

  snapOut.style.display = 'block';
  snapOut.textContent = await tText('Assembling snapshot…', lang, tx);

  // choose code: prefer first valid from input
  const code = pickFirstValidCodeFromInput();
  if (!code) {
    snapOut.textContent = await tText('No valid code available. Validate first or pick a code.', lang, tx);
    return;
  }
  const rec = cptData.find(r => r.code === code);
  const desc = rec ? rec.description : '';
  const rules = rulesData[code] || {};
  const payers = ['Medicare','BlueCross','UnitedHealth','Cigna','Aetna','Humana'];

  const parts = [];
  parts.push(`${await tText('Coverage Snapshot', lang, tx)} — ${code} — ${await tText(desc, lang, tx)}`);
  parts.push('');

  parts.push(await tText('Payer rules:', lang, tx));
  for (const p of payers) {
    const r = normalizeRuleText(rules[p] || '—');
    parts.push(`- ${await tText(p, lang, tx)}: ${await tText(r, lang, tx)}`);
  }

  const docs = extractTopDocsFromSummary(3);
  if (docs.length) {
    parts.push('');
    parts.push(await tText('Required docs (from policy summary):', lang, tx));
    for (const d of docs) parts.push(`• ${await tText(d, lang, tx)}`);
  }

  snapOut.textContent = parts.join('\n');
}

// ---------- Summarizer tab ----------
function simpleHash(s) {
  let h = 0; for (let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i))|0; } return (h>>>0).toString(36);
}

// CORRECTED: Single getSummarizer function with proper monitoring
async function getSummarizer(lang, statusEl) {
  if (summarizerSingleton) return summarizerSingleton;
  
  statusEl && (statusEl.textContent = 'Preparing model…');
  
  summarizerSingleton = await withTimeout(
    Summarizer.create({
      type: 'key-points',
      format: 'markdown',
      length: 'short',
      outputLanguage: lang,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round((e.loaded || 0) * 100);
          statusEl && (statusEl.textContent = `Downloading model… ${pct}%`);
        });
      }
    }),
    60000, // allow up to 60s for first model load
    'summarizer init timeout'
  );
  
  return summarizerSingleton;
}

async function runSummarizePopup() {
  const btn = document.getElementById('summarizeBtnPopup');
  const statusEl = document.getElementById('modelStatusPopup');
  const out = document.getElementById('summaryPopup');
  const lang = getSummLang();

  btn.disabled = true;
  statusEl.textContent = 'Reading page...';
  out.textContent = '';

  try {
    let text = await getActiveTabText();
    if (!text) { 
      statusEl.textContent = 'No readable text on this page.'; 
      return; 
    }

    text = text.slice(0, 400);  // Keep it short

    if ('Summarizer' in self) {
      try {
        const summarizer = await getSummarizer(lang, statusEl);
        statusEl.textContent = 'Summarizing (15-30 sec)...';

        const summary = await withTimeout(
          summarizer.summarize(text, {
            context: 'List key points.',  // Simple prompt
            outputLanguage: lang
          }),
          30000,
          'summarize timeout'
        );

        out.textContent = summary || '(no output)';
        statusEl.textContent = 'Done (Summarizer API).';
        return;
      } catch (err) {
        console.warn('Summarizer failed, falling back:', err.message);
        statusEl.textContent = 'Trying Prompt API (15-30 sec)...';
      }
    }

    if ('LanguageModel' in self) {
      const session = await LanguageModel.create(LM_OPTS(lang));
      const prompt = `List 5 key points:\n\n${text}`;
      const summary = await withTimeout(session.prompt(prompt), 30000, 'prompt timeout');
      out.textContent = typeof summary === 'string' ? summary : String(summary || '');
      statusEl.textContent = 'Done (Prompt API).';
      return;
    }

    statusEl.textContent = 'AI not available on this device.';
  } catch (e) {
    statusEl.textContent = `Error: ${e.message || String(e)}`;
    console.error('Summarize error:', e);
  } finally {
    btn.disabled = false;
  }
}

async function translateSummaryPopup() {
  const btn = document.getElementById('translateBtnPopup');
  const statusEl = document.getElementById('modelStatusPopup');
  const out = document.getElementById('summaryPopup');
  const target = getSummLang();
  const text = (out?.textContent || '').trim();

  btn.disabled = true;
  try {
    if (!text) { statusEl.textContent = 'Nothing to translate yet. Summarize first.'; return; }

    if ('Translator' in self) {
      statusEl.textContent = 'Translating…';
      const tx = await getTranslator(target, 'en', (pct) => statusEl.textContent = `Downloading language pack… ${pct}%`);
      if (tx) {
        out.textContent = await tx.translate(text);
        statusEl.textContent = 'Done.';
      } else {
        out.textContent = await lmTranslateText(text, target);
        statusEl.textContent = 'Done (Prompt API).';
      }
    } else {
      statusEl.textContent = 'Translator unavailable; using Prompt API…';
      out.textContent = await lmTranslateText(text, target);
      statusEl.textContent = 'Done (Prompt API).';
    }
  } catch (e) {
    statusEl.textContent = `Translate error: ${e.message || String(e)}`;
  } finally {
    btn.disabled = false;
  }
}

async function toggleHighlightsPopup() {
  const tab = await getActiveTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const KEYWORDS = [
        'prior authorization', 'medical necessity', 'documentation',
        'modifier -26', '-26', 'tc', 'site of service', 'coverage',
        'criteria', 'exclusion', 'indication', 'contraindication'
      ];
      const MARK_CLASS = 'codesure-mark';

      document.querySelectorAll('.' + MARK_CLASS).forEach(el => {
        const t = document.createTextNode(el.textContent);
        el.replaceWith(t);
      });

      if (!document.getElementById('codesure-style')) {
        const style = document.createElement('style');
        style.id = 'codesure-style';
        style.textContent = `.codesure-mark{background:#fff8a6;padding:0 2px;border-radius:3px}`;
        document.head.appendChild(style);
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || node.nodeValue.trim().length < 4) return NodeFilter.FILTER_REJECT;
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement.tagName;
          if (['SCRIPT','STYLE','NOSCRIPT','IFRAME'].includes(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      const ranges = [];
      let n;
      while ((n = walker.nextNode())) {
        const text = n.nodeValue;
        KEYWORDS.forEach(k => {
          const idx = text.toLowerCase().indexOf(k.toLowerCase());
          if (idx >= 0) {
            const range = document.createRange();
            range.setStart(n, idx);
            range.setEnd(n, idx + k.length);
            ranges.push(range);
          }
        });
      }
      ranges.forEach(r => {
        const m = document.createElement('mark');
        m.className = MARK_CLASS;
        r.surroundContents(m);
      });
    }
  });
}

// ---------- PA Note (structured fields) ----------
function noteStatusEl(){ return document.getElementById('noteStatus'); }
function setNoteStatus(s){ const el = noteStatusEl(); if (el) el.textContent = s || ''; }

function noteFields() {
  return {
    service: document.getElementById('noteService'),
    codes: document.getElementById('noteCodes'),
    payer: document.getElementById('notePayer'),
    rationale: document.getElementById('noteRationale'),
    history: document.getElementById('noteHistory'),
    site: document.getElementById('noteSite'),
    final: document.getElementById('noteFinal'),
  };
}

function syncNoteFromHome() {
  setNoteStatus('Syncing from Home…');
  const svc = (document.getElementById('aiLine')?.value || '').trim();
  const codes = (document.getElementById('cptInput')?.value || '').trim();
  const payer = (document.getElementById('payerInput')?.value || '').trim();
  const f = noteFields();
  if (svc)   f.service.value = svc;
  if (codes) f.codes.value   = codes;
  if (payer) f.payer.value   = payer;
  setTimeout(()=>setNoteStatus('Synced.'), 200);
}

async function generateNoteFields() {
  const lang = getNoteLang();
  const f = noteFields();
  setNoteStatus('Generating field drafts…');
  const ctx = {
    service: f.service.value.trim() || '(describe)',
    codes: f.codes.value.trim() || '(codes)',
    payer: f.payer.value.trim() || '(payer)',
  };

  let out = null;
  if ('LanguageModel' in self) {
    try {
      const session = await withTimeout(LanguageModel.create(LM_OPTS(lang)), PROMPT_AI_DEADLINE_MS, 'create timeout');
      const schema = {
        type: "object",
        properties: {
          medicalNecessity: { type: "string" },
          historyImaging: { type: "string" },
          siteModifiers: { type: "string" }
        },
        required: ["medicalNecessity","historyImaging","siteModifiers"]
      };
      const prompt =
`Given this context, draft concise content for each field (2–4 sentences each) in ${lang.toUpperCase()}.
Context:
- Service: ${ctx.service}
- Codes: ${ctx.codes}
- Payer: ${ctx.payer}

Return ONLY JSON with keys: medicalNecessity, historyImaging, siteModifiers.`;
      const res = await withTimeout(session.prompt(prompt, { responseConstraint: schema }), PROMPT_AI_DEADLINE_MS, 'prompt timeout');
      out = typeof res === 'string' ? JSON.parse(res) : res;
    } catch {}
  }
  if (!out) {
    out = {
      medicalNecessity: 'Describe clinical need, symptoms, and failed conservative care.',
      historyImaging: 'List relevant prior visits, imaging reports, and dates.',
      siteModifiers: 'Specify site of service and applicable modifiers (e.g., -26/-TC).'
    };
  }

  f.rationale.value = sanitizeAI(out.medicalNecessity) || f.rationale.value;
  f.history.value   = sanitizeAI(out.historyImaging)  || f.history.value;
  f.site.value      = sanitizeAI(out.siteModifiers)   || f.site.value;

  setNoteStatus('Fields filled.');
}

async function polishNoteFields() {
  const lang = getNoteLang();
  const f = noteFields();
  const fields = [f.rationale, f.history, f.site];
  setNoteStatus('Polishing fields…');

  for (const el of fields) {
    const text = el.value.trim();
    if (!text) continue;

    let polished = text;
    try {
      if ('LanguageModel' in self) {
        const s = await LanguageModel.create({ expectedInputs:[{type:'text',languages:[lang]}], expectedOutputs:[{type:'text',languages:[lang]}] });
        polished = await s.prompt(`Proofread minimally in ${lang.toUpperCase()}:\n${text}`) || text;
      }
    } catch {}

    el.value = sanitizeAI(polished);
  }
  setNoteStatus('Polished.');
}

function assembleNote() {
  const f = noteFields();
  setNoteStatus('Assembling note…');

  const svc   = sanitizeAI(f.service.value.trim())   || '(describe)';
  const codes = sanitizeAI(f.codes.value.trim())     || '(codes)';
  const payer = sanitizeAI(f.payer.value.trim())     || '(payer)';
  const r     = sanitizeAI(f.rationale.value.trim()) || '';
  const h     = sanitizeAI(f.history.value.trim())   || '';
  const s     = sanitizeAI(f.site.value.trim())      || '';

  const assembled =
`Prior Authorization Request

Requested service: ${svc}
Codes: ${codes}
Payer: ${payer}

Medical Necessity Rationale:
${r || '(add rationale)'}

Relevant History/Imaging:
${h || '(add details)'}

Site of Service/Modifiers:
${s || '(add details)'}
`;
  f.final.value = assembled;
  setTimeout(()=>setNoteStatus('Assembled.'), 200);
}

function copyAssembled() {
  const f = noteFields();
  const txt = f.final.value || '';
  navigator.clipboard.writeText(txt).catch(()=>{});
  setNoteStatus('Copied to clipboard.');
}

// ---------- Diagnostics ----------
function diagSet(name, status, msg='') {
  const dot = document.getElementById(`diag-${name}-dot`);
  const m   = document.getElementById(`diag-${name}-msg`);
  if (dot) { dot.classList.remove('ok','warn','fail'); dot.classList.add(status); }
  if (m) m.textContent = msg;
}
function diagLog(line) {
  const log = document.getElementById('diagLog');
  if (!log) return;
  const time = new Date().toLocaleTimeString();
  log.textContent = `[${time}] ${line}\n` + log.textContent;
}
async function withDiagTimeout(promise, label) {
  let t; const gate = new Promise((_, rej) => { t = setTimeout(()=>rej(new Error(`${label} timeout`)), DIAG_TIMEOUT); });
  const out = await Promise.race([promise, gate]).finally(()=>clearTimeout(t));
  return out;
}

async function testData() {
  if (!dataLoaded) return { status: 'fail', msg: 'Not loaded' };
  const nCodes = cptData.length;
  const nRules = Object.keys(rulesData || {}).length;
  return (nCodes > 0) ? { status: 'ok', msg: `${nCodes} codes, ${nRules} rules` } : { status: 'fail', msg: '0 codes' };
}
async function testWorker() {
  if (!suggestWorker) return { status: 'warn', msg: 'No worker (inline fallback)' };
  try {
    const res = await withDiagTimeout(new Promise((resolve, reject) => {
      const handle = (ev) => { suggestWorker.removeEventListener('message', handle); resolve(ev.data); };
      suggestWorker.addEventListener('message', handle);
      suggestWorker.postMessage({ cptData: cptData.slice(0,10), tokens: ['test'] });
      setTimeout(() => { try{ suggestWorker.removeEventListener('message', handle);}catch{}; reject(new Error('no response')); }, 1200);
    }), 'worker');
    return (res && ('results' in res)) ? { status: 'ok', msg: 'Responded' } : { status: 'warn', msg: 'Unexpected response' };
  } catch (e) { return { status: 'fail', msg: e.message }; }
}
async function testLM() {
  if (!('LanguageModel' in self)) return { status: 'warn', msg: 'Not exposed' };
  try {
    const session = await withDiagTimeout(
      LanguageModel.create({ expectedInputs:[{type:'text',languages:['en']}], expectedOutputs:[{type:'text',languages:['en']}] }),
      'LM.create'
    );
    const out = await withDiagTimeout(session.prompt('Reply with only: OK'), 'LM.prompt');
    return (String(out).trim().toUpperCase().startsWith('OK'))
      ? { status: 'ok', msg: 'Created & prompted' }
      : { status: 'warn', msg: 'Unexpected output' };
  } catch (e) {
    return { status: 'fail', msg: e.message };
  }
}
async function testTranslator() {
  if (!('Translator' in self)) return { status: 'warn', msg: 'Not exposed' };
  try {
    const t = await withDiagTimeout(Translator.create({ sourceLanguage: 'en', targetLanguage: 'es' }), 'Translator.create');
    const out = await withDiagTimeout(t.translate('hello'), 'Translator.translate');
    return (out && out.toLowerCase() !== 'hello') ? { status: 'ok', msg: `en→es ok (${out})` } : { status: 'warn', msg: 'No change' };
  } catch (e) { return { status: 'warn', msg: e.message }; }
}
async function testSummarizer() {
  if (!('Summarizer' in self)) return { status: 'warn', msg: 'Not exposed' };
  try {
    const s = await withDiagTimeout(Summarizer.create({
      type: 'key-points',
      format: 'markdown',
      length: 'short',
      outputLanguage: 'en',
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round(((e.loaded || 0)) * 100);
          diagLog(`Summarizer downloading… ${pct}%`);
        });
      }
    }), 'Summarizer.create');

    const out = await withDiagTimeout(
      s.summarize('Short paragraph about prior authorization and coverage criteria.'),
      'Summarizer.summarize'
    );
    return (out && out.length > 0) ? { status: 'ok', msg: 'Summarized' } : { status: 'warn', msg: 'Empty output' };
  } catch (e) {
    return { status: 'fail', msg: e.message };
  }
}

// run diagnostics
async function runDiagnostics() {
  const start = Date.now();
  diagLog('Running diagnostics…');

  const data = await testData();
  diagSet('Data', data.status, data.msg);
  diagLog(`Data: ${data.status.toUpperCase()} — ${data.msg}`);

  const worker = await testWorker();
  diagSet('Worker', worker.status, worker.msg);
  diagLog(`Worker: ${worker.status.toUpperCase()} — ${worker.msg}`);

  const lm = await testLM();
  diagSet('LM', lm.status, lm.msg);
  diagLog(`LM: ${lm.status.toUpperCase()} — ${lm.msg}`);

  const tx = await testTranslator();
  diagSet('Translator', tx.status, tx.msg);
  diagLog(`Translator: ${tx.status.toUpperCase()} — ${tx.msg}`);

  const sum = await testSummarizer();
  diagSet('Summarizer', sum.status, sum.msg);
  diagLog(`Summarizer: ${sum.status.toUpperCase()} — ${sum.msg}`);

  diagLog(`Diagnostics complete.`);
  return Date.now() - start;
}

// ---------- boot ----------
// ---------- boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  await initData();
  setupSuggestions();
  setupAttachmentsList();
  loadHistory();

  // Home actions
  document.getElementById("validateBtn")?.addEventListener("click", () => { doValidate(); });
  const form = document.getElementById("ai-extract-form");
  if (form) form.addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("aiExtractBtn")?.addEventListener("click", () => { runSuggest(); });

  // ENTER submit (Validate & Suggest)
  const cptInput = document.getElementById("cptInput");
  const validateBtn = document.getElementById("validateBtn");
  if (cptInput && validateBtn) {
    cptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); validateBtn.click(); }
    });
  }
  
  const aiLine = document.getElementById("aiLine");
  const aiBtn = document.getElementById("aiExtractBtn");
  if (aiLine && aiBtn) {
    aiLine.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); aiBtn.click(); }
    });
  }

  // Snapshot controls
  document.getElementById('snapshotBtn')?.addEventListener('click', generateCoverageSnapshot);
  document.getElementById('snapshotCopyBtn')?.addEventListener('click', () => {
    const txt = (document.getElementById('snapshotOut')?.textContent || '');
    if (txt.trim()) navigator.clipboard.writeText(txt).catch(()=>{});
  });

  // Summarizer tab
  document.getElementById('summarizeBtnPopup')?.addEventListener('click', runSummarizePopup);
  document.getElementById('translateBtnPopup')?.addEventListener('click', translateSummaryPopup);
  document.getElementById('highlightBtnPopup')?.addEventListener('click', toggleHighlightsPopup);

  // PA Note tab
  document.getElementById('syncNoteBtn')?.addEventListener('click', syncNoteFromHome);
  document.getElementById('genNoteFieldsBtn')?.addEventListener('click', generateNoteFields);
  document.getElementById('polishNoteFieldsBtn')?.addEventListener('click', polishNoteFields);
  document.getElementById('assembleNoteBtn')?.addEventListener('click', assembleNote);
  document.getElementById('copyAssembledBtn')?.addEventListener('click', copyAssembled);

  // Diagnostics
  document.getElementById('runDiagBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('runDiagBtn');
    btn.disabled = true;
    await Promise.resolve().then(() => runDiagnostics());
    btn.disabled = false;
  });

  // Detach persistent window
  document.getElementById('detachBtn')?.addEventListener('click', async () => {
    const url = chrome.runtime.getURL('popup.html');
    await chrome.windows.create({ url, type: 'popup', focused: true, width: 820, height: 900 });
    window.close();
  });
});