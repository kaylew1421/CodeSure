let cptData = [];
let rulesData = {};
let dataLoaded = false;

const CODE_RE = /^\d{5}$/;
const PROMPT_AI_DEADLINE_MS = 25000;
const DIAG_TIMEOUT = 30000;

let suggestWorker = null;

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

// ---- Busy indicator ----
function setBusy(opts) {
  const {
    btnIds = [],
    panelId = null,
    busy = false,
    labelWhenBusy = 'Working…',
    htmlWhenBusy = null
  } = opts || {};

  if (panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.style.display = 'block';
      if (busy) {
        const msg = htmlWhenBusy || `<span class="spinner" aria-hidden="true"></span>${labelWhenBusy}`;
        panel.innerHTML = `<div class="row gap">${msg}</div>`;
      }
    }
  }
  btnIds.forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    if (!b.dataset.label) b.dataset.label = b.textContent || labelWhenBusy;
    b.disabled = !!busy;
    b.textContent = busy ? labelWhenBusy : b.dataset.label;
  });
}

// --- progress bar helper for Check Auth Risk ---
function createProgress(mountId, label = 'Checking…') {
  const el = document.getElementById(mountId);
  if (!el) return null;

  el.style.display = 'block';
  el.innerHTML = `
    <div class="tiny muted" id="riskProgLabel">${label} <span id="riskProgPct">0%</span></div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="bar" id="riskProgBar"></div>
    </div>
  `;

  const bar = el.querySelector('#riskProgBar');
  const pctEl = el.querySelector('#riskProgPct');
  const progEl = el.querySelector('.progress');

  let pct = 0;
  const timer = setInterval(() => {
    pct = Math.min(pct + 3, 90);
    update(pct);
  }, 150);

  function update(nextPct, text) {
    pct = Math.max(0, Math.min(100, Math.floor(nextPct)));
    if (bar) bar.style.width = pct + '%';
    if (progEl) progEl.setAttribute('aria-valuenow', String(pct));
    if (pctEl) pctEl.textContent = pct + '%';
    if (typeof text === 'string') {
      const lbl = el.querySelector('#riskProgLabel');
      if (lbl) lbl.firstChild.nodeValue = text + ' ';
    }
  }
  function done() { clearInterval(timer); update(100, 'Done'); }
  return { update, done };
}

/* ============================
   AUTOSAVE / RESTORE (popup)
   ============================ */
const DRAFT_KEY = 'codesure_state_v3';

function getActiveTabId() {
  const btn = document.querySelector('.tab.is-active');
  return btn ? btn.getAttribute('data-tab') : 'tab-home';
}
function showTabById(id) {
  const btn = document.querySelector(`.tab[data-tab="${id}"]`);
  if (btn) btn.click();
}
function gatherDraft() {
  const val = id => (document.getElementById(id)?.value ?? '');
  const html = id => (document.getElementById(id)?.innerHTML ?? '');
  const text = id => (document.getElementById(id)?.textContent ?? '');

  return {
    v: 1,
    activeTab: getActiveTabId(),
    popupLang: val('popupLang'),
    cptInput: val('cptInput'),
    payerInput: val('payerInput'),
    payerPolicy: val('payerPolicy'),
    clinicalNotes: val('clinicalNotes'),
    aiLine: val('aiLine'),
    noteLang: val('noteLang'),
    noteService: val('noteService'),
    noteCodes: val('noteCodes'),
    notePayer: val('notePayer'),
    noteRationale: val('noteRationale'),
    noteHistory: val('noteHistory'),
    noteSite: val('noteSite'),
    noteFinal: val('noteFinal'),
    resultHTML: html('result'),
    payerCompareHTML: html('payerCompare'),
    riskHTML: html('riskOut'),
    snapshotText: text('snapshotOut'),
    policySummaryText: text('policySummaryOut'),
    snapshotBarVisible: (document.getElementById('snapshotBar')?.style.display || '') !== 'none',
    scroll: { x: window.scrollX, y: window.scrollY }
  };
}
function applyDraft(s) {
  if (!s || typeof s !== 'object') return;
  const setVal = (id, v) => { const el = document.getElementById(id); if (el && typeof v === 'string') el.value = v; };
  const setHTML2 = (id, v) => { const el = document.getElementById(id); if (el && typeof v === 'string') el.innerHTML = v; };
  const setText = (id, v) => { const el = document.getElementById(id); if (el && typeof v === 'string') { el.textContent = v; if (v) el.style.display = 'block'; } };

  setVal('popupLang', s.popupLang);
  setVal('cptInput', s.cptInput);
  setVal('payerInput', s.payerInput);
  setVal('payerPolicy', s.payerPolicy);
  setVal('clinicalNotes', s.clinicalNotes);
  setVal('aiLine', s.aiLine);
  setVal('noteLang', s.noteLang);
  setVal('noteService', s.noteService);
  setVal('noteCodes', s.noteCodes);
  setVal('notePayer', s.notePayer);
  setVal('noteRationale', s.noteRationale);
  setVal('noteHistory', s.noteHistory);
  setVal('noteSite', s.noteSite);
  setVal('noteFinal', s.noteFinal);

  setHTML2('result', s.resultHTML);
  setHTML2('payerCompare', s.payerCompareHTML);
  if (s.riskHTML) { const r = document.getElementById('riskOut'); if (r) { r.innerHTML = s.riskHTML; r.style.display = 'block'; } }
  setText('snapshotOut', s.snapshotText);
  setText('policySummaryOut', s.policySummaryText);

  if (typeof s.snapshotBarVisible === 'boolean') {
    const bar = document.getElementById('snapshotBar');
    if (bar) bar.style.display = s.snapshotBarVisible ? 'flex' : 'none';
  }

  if (s.activeTab) showTabById(s.activeTab);
  if (s.scroll) requestAnimationFrame(() => window.scrollTo(s.scroll.x || 0, s.scroll.y || 0));
}
const saveDraft = (() => {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try { await chrome.storage.local.set({ [DRAFT_KEY]: gatherDraft() }); } catch {}
    }, 250);
  };
})();
async function autoRestore() {
  try {
    const { [DRAFT_KEY]: draft } = await chrome.storage.local.get(DRAFT_KEY);
    if (draft) applyDraft(draft);
  } catch {}
}
function wireAutosave() {
  document.addEventListener('input', saveDraft, true);
  document.addEventListener('change', saveDraft, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') chrome.storage.local.set({ [DRAFT_KEY]: gatherDraft() }).catch(()=>{});
  });
  window.addEventListener('beforeunload', () => {
    chrome.storage.local.set({ [DRAFT_KEY]: gatherDraft() }).catch(()=>{});
  });
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

      if (typeof saveDraft === 'function') saveDraft();
    });
  });
}

// ---------- JSON + History ----------
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
  } catch {}
}
async function loadHistory() {
  try {
    const key = 'codesure_history';
    const store = await chrome.storage.local.get(key);
    const arr = Array.isArray(store[key]) ? store[key] : [];
    const h = document.getElementById('history');
    if (!h) return;
    if (!arr.length) {
      h.innerHTML = '<div class="tiny muted">No history yet.</div>';
      return;
    }
    h.innerHTML = arr
      .map(x => `<div class="mono tiny muted">${new Date(x.ts).toLocaleTimeString()}</div>${x.html}<hr/>`)
      .join('');
  } catch {}
}
function addHistory(html) {
  const h = document.getElementById('history');
  if (h) {
    const entry = `<div class="mono tiny muted">${ts()}</div>${html}<hr/>`;
    h.insertAdjacentHTML('afterbegin', entry);
  }
  saveHistoryItem(html);
}
async function clearHistory() {
  const key = 'codesure_history';
  try {
    await chrome.storage.local.set({ [key]: [] });
  } catch {}
  const h = document.getElementById('history');
  if (h) h.innerHTML = '<div class="tiny muted">History cleared.</div>';
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
function getNoteLang() {
  const v = (document.getElementById('noteLang')?.value || 'en').toLowerCase();
  return ['en','es','ja'].includes(v) ? v : 'en';
}
function LM_OPTS(lang) {
  return { expectedInputs: [{type:'text',languages:['en']}], expectedOutputs: [{type:'text',languages:[lang]}] };
}

// ---------- Translator helpers ----------
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
  if (typeof saveDraft === 'function') saveDraft();

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

// token expansion
function expandTokens(text) {
  const synonyms = {
    ct: ['ct','computed tomography','ct scan','cat scan','tomography'],
    mri: ['mri','magnetic resonance','mr imaging'],
    xray: ['xray','x-ray','radiograph','plain film'],
    ultrasound: ['ultrasound','sonogram','sonography','doppler'],
    nuclear: ['nuclear','pet','pet-ct','nuclear medicine'],
    echo: ['echo','echocardiogram','echocardiography','stress echo'],
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

  const rows = [];
  for (const p of payers) {
    const txtEn = normalizeRuleText(rules[p] || '—');
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

  const btn = document.getElementById(exportId);
  if (btn) btn.addEventListener('click', () => exportComparisonCSV(code, rules));

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

    const pieces = [];
    if (line) pieces.push(`${await tText('Service:', lang, tx)} ${await tText(line, lang, tx)}`);

    if (attrs && Object.keys(attrs).length) {
      for (const k of ['modality','bodyPart','contrast','laterality','setting','reason']) {
        if (attrs[k]) attrs[k] = await tText(String(attrs[k]), lang, tx);
      }
      if (Array.isArray(attrs.modifiers) && attrs.modifiers.length) {
        attrs.modifiers = await tLines(attrs.modifiers, lang, tx);
      }
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
          if (typeof saveDraft === 'function') saveDraft();
        });

        const cmpBtn = document.createElement('button');
        cmpBtn.className = 'btn slim';
        cmpBtn.textContent = `${await tText('Compare', lang, tx)} ${s.code}`;
        cmpBtn.addEventListener('click', () => { renderPayerCompare(s.code); if (typeof saveDraft === 'function') saveDraft(); });

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
async function generateCoverageSnapshot() {
  const snapOut = document.getElementById('snapshotOut');
  if (!snapOut) return;
  const lang = getPopupLang();
  const tx = await getTranslator(lang, 'en');

  snapOut.style.display = 'block';
  snapOut.textContent = await tText('Assembling snapshot…', lang, tx);

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

  snapOut.textContent = parts.join('\n');
  if (typeof saveDraft === 'function') saveDraft();
}

// ---------- Additional Context tools ----------
async function summarizePolicy(){
  const out = document.getElementById('policySummaryOut');
  const lang = getPopupLang();
  const tx = await getTranslator(lang, 'en');

  setBusy({
    btnIds:['summarizePolicyBtn'],
    panelId:'policySummaryOut',
    busy:true,
    labelWhenBusy:'Summarizing…',
    htmlWhenBusy:'<span class="spinner"></span>Summarizing policy…'
  });
  try{
    const raw=(document.getElementById('payerPolicy')?.value||'').trim();
    if(!raw){ if(out){out.style.display='none'; out.textContent='';} return; }
    let summary='';
    if('LanguageModel' in self){
      try{
        const sess=await withTimeout(LanguageModel.create(LM_OPTS('en')), PROMPT_AI_DEADLINE_MS,'create');
        summary=await withTimeout(
          sess.prompt(`Summarize the payer authorization policy into 5-7 bullet points focusing on when PA is required, criteria, exclusions, and documentation needed. Output plain text bullets.\n\n${raw}`),
          PROMPT_AI_DEADLINE_MS,'prompt'
        );
      }catch(e){}
    }
    if(!summary){
      summary = raw.replace(/\s*\n\s*/g,' ').split(/(?<=\.)\s+/).slice(0,6).map(s=>'• '+s).join('\n');
    }
    summary = await tText(String(summary), lang, tx);

    if(out){out.textContent=String(summary); out.style.display='block';}
  } finally {
    setBusy({ btnIds:['summarizePolicyBtn'], panelId:'policySummaryOut', busy:false });
    if (typeof saveDraft === 'function') saveDraft();
  }
}

// Paste From Capture (storage first, then clipboard)
async function pasteFromCapture(){
  const el = document.getElementById('payerPolicy');
  if (!el) return;

  try {
    const v = await chrome.storage?.local.get(['payerPolicyCaptured']);
    const stored = (v && v.payerPolicyCaptured) ? String(v.payerPolicyCaptured).trim() : '';
    if (stored) {
      const was = el.value.trim();
      el.value = was ? (was + '\n\n' + stored) : stored;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof saveDraft === 'function') saveDraft();
      return;
    }
  } catch {}

  try {
    const clip = await navigator.clipboard.readText();
    const txt = (clip || '').trim();
    if (txt) {
      const was = el.value.trim();
      el.value = was ? (was + '\n\n' + txt) : txt;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof saveDraft === 'function') saveDraft();
      return;
    }
  } catch {}

  const out = document.getElementById('policySummaryOut');
  if (out) {
    out.style.display = 'block';
    out.textContent = 'Nothing captured yet. Highlight text on a payer page first or copy text to clipboard, then click “Paste From Capture.”';
    setTimeout(()=>{ out.style.display='none'; }, 3000);
  }
}

function loadDemoData(){
  setBusy({ btnIds:['loadDemoBtn'], busy:true, labelWhenBusy:'Loading…' });
  try{
    const cpt = document.getElementById('cptInput');
    const payer = document.getElementById('payerInput');
    const policy = document.getElementById('payerPolicy');
    const notes = document.getElementById('clinicalNotes');
    if (cpt) cpt.value = '53193';
    if (payer) payer.value = 'BlueCross';
    if (policy) policy.value =
      'Knee CT and arthroplasty preauthorization criteria include: documented osteoarthritis refractory to conservative care; imaging demonstrating joint-space narrowing; prior trials of PT and NSAIDs; surgeon attestation; and pre-op medical clearance. Authorization required for outpatient; inpatient exempt.';
    if (notes) notes.value =
      '72-year-old with severe OA, failed PT/NSAIDs; antalgic gait; imaging shows severe tricompartmental OA; candidate for TKA. Creatinine WNL. No contrast allergy.';
    const mock = document.getElementById('mockBanner');
    if (mock) mock.textContent = 'Demo Mode: Demo case loaded.';
  } finally {
    setBusy({ btnIds:['loadDemoBtn'], busy:false });
    if (typeof saveDraft === 'function') saveDraft();
  }
}

// ---------- Auth Risk ----------
function riskMeter(score) {
  const s = Math.max(0, Math.min(100, parseInt(score||0)));
  return `<div style="height:10px; border-radius:6px; background:linear-gradient(90deg,#4caf50,#ffeb3b,#f44336); position:relative;">
    <div style="position:absolute; left:${s}%; top:-4px;">▲</div>
  </div>`;
}
async function checkAuthRisk() {
  setBusy({ btnIds:['riskBtn','riskBtn2'], busy:true, labelWhenBusy:'Checking…' });

  const out = document.getElementById('riskOut');
  if (out) out.style.display = 'block';

  const lang = getPopupLang();
  const tx = await getTranslator(lang, 'en');

  const prog = createProgress('riskOut', await tText('Checking…', lang, tx));

  try {
    prog?.update(10, await tText('Gathering inputs…', lang, tx));
    const codes = (document.getElementById('cptInput')?.value || '').trim();
    const payer = (document.getElementById('payerInput')?.value || '').trim();
    const policy = (document.getElementById('payerPolicy')?.value || '').trim();
    const notes  = (document.getElementById('clinicalNotes')?.value || '').trim();
    if (!codes || !payer) {
      out.textContent = await tText('Enter codes and a payer first.', lang, tx);
      return;
    }

    prog?.update(30, await tText('Preparing analysis…', lang, tx));

    let payload = null;
    if ('LanguageModel' in self) {
      try {
        const s = await withTimeout(LanguageModel.create(LM_OPTS(lang)), 2500, 'create timeout');
        prog?.update(45, await tText('Analyzing policy with on-device model…', lang, tx));

        const prompt = `You are a medical-necessity reviewer. Using the data below, predict prior auth requirements and denial risk. Respond ONLY as compact JSON with keys: prior_auth_required (true/false), denial_risk (0-100 integer), docs_required (array of strings), gaps (array of strings), summary (string).
CODES: ${codes}
PAYER: ${payer}
POLICY: ${policy}
CLINICAL_NOTES: ${notes}`;
        const txt = await withTimeout(s.prompt(prompt), 2500, 'prompt timeout');
        try { payload = JSON.parse(String(txt)); } catch {}
      } catch {}
    }

    if (!payload) {
      prog?.update(65, await tText('Using heuristic fallback…', lang, tx));
      const low = /not required|no pa|exempt/i.test(policy);
      const high = /authorization required|precert|advanced imaging/i.test(policy);
      const denial = high ? 72 : (low ? 18 : 45);
      payload = {
        prior_auth_required: !!high,
        denial_risk: denial,
        docs_required: ['Clinical indication', 'Imaging report', 'Provider note', 'Renal function if contrast'],
        gaps: [],
        summary: 'Heuristic estimate'
      };
    }

    prog?.update(85, await tText('Formatting results…', lang, tx));

    const score = Math.max(0, Math.min(100, parseInt(payload.denial_risk || 0)));
    const priorLbl = await tText('Prior Auth likely:', lang, tx);
    const yesLbl   = await tText('Yes', lang, tx);
    const maybeLbl = await tText('Maybe/No', lang, tx);
    const denialLbl= await tText('Denial risk:', lang, tx);
    const docsLbl  = await tText('Docs:', lang, tx);
    const gapsLbl  = await tText('Gaps:', lang, tx);
    const sumLbl   = await tText(payload.summary || '', lang, tx);
    const docsList = await tLines(payload.docs_required||[], lang, tx);
    const gapsList = await tLines(payload.gaps||[], lang, tx);

    const resultHTML = `<div class="surface">
      <strong>${priorLbl}</strong> ${payload.prior_auth_required ? yesLbl : maybeLbl}<br/>
      <strong>${denialLbl}</strong> ${score}/100 ${riskMeter(score)}
      <div class="small"><strong>${docsLbl}</strong> ${docsList.join(' · ')}</div>
      <div class="small"><strong>${gapsLbl}</strong> ${gapsList.join(' · ') || '—'}</div>
      <div class="tiny muted">${sumLbl}</div>
    </div>`;

    prog?.done();
    setTimeout(() => { out.innerHTML = resultHTML; if (typeof saveDraft === 'function') saveDraft(); }, 200);

  } finally {
    setBusy({ btnIds:['riskBtn','riskBtn2'], busy:false });
  }
}

// ---------- PA Note ----------
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

// Cache English originals so switching languages is reversible
async function cacheNoteEnglishIfMissing() {
  const f = noteFields();
  const cache = {
    rationale: f.rationale.value,
    history: f.history.value,
    site: f.site.value,
    final: f.final.value
  };
  const key = 'note_cache_en';
  try {
    const got = await chrome.storage.local.get(key);
    if (!got[key] || (!got[key].rationale && !got[key].history && !got[key].site && !got[key].final)) {
      await chrome.storage.local.set({ [key]: cache });
    }
  } catch {}
}
async function restoreNoteEnglish() {
  const key = 'note_cache_en';
  try {
    const got = await chrome.storage.local.get(key);
    const c = got[key];
    if (!c) return false;
    const f = noteFields();
    if (c.rationale) f.rationale.value = c.rationale;
    if (c.history)   f.history.value   = c.history;
    if (c.site)      f.site.value      = c.site;
    if (c.final)     f.final.value     = c.final;
    return true;
  } catch { return false; }
}

function getHomeContext() {
  const svc   = (document.getElementById('aiLine')?.value || '').trim();
  const codes = (document.getElementById('cptInput')?.value || '').trim();
  const payer = (document.getElementById('payerInput')?.value || '').trim();
  const policy= (document.getElementById('payerPolicy')?.value || '').trim();
  const notes = (document.getElementById('clinicalNotes')?.value || '').trim();

  const firstCode = pickFirstValidCodeFromInput();
  let ruleText = '';
  if (firstCode && rulesData && rulesData[firstCode] && payer) {
    ruleText = normalizeRuleText(rulesData[firstCode][payer] || '');
  }
  return { svc, codes, payer, policy, notes, firstCode, ruleText };
}

async function syncNoteFromHome() {
  const f = noteFields();
  const ctx = getHomeContext();
  const lang = getNoteLang();
  const tx = await getTranslator(lang, 'en');

  if (ctx.svc)   f.service.value = ctx.svc;
  if (ctx.codes) f.codes.value   = ctx.codes;
  if (ctx.payer) f.payer.value   = ctx.payer;

  if (!f.rationale.value && (ctx.notes || ctx.ruleText)) {
    const chunks = [];
    if (ctx.notes)   chunks.push(ctx.notes);
    if (ctx.ruleText) chunks.push(`Meets payer rule: ${ctx.ruleText}`);
    f.rationale.value = sanitizeAI(chunks.join('\n\n'));
  }
  if (!f.history.value && ctx.notes) {
    const lines = ctx.notes.split(/\n+/).filter(Boolean);
    const keep  = lines.filter(l => /imaging|x-?ray|ct|mri|ultra|echo|prior|previous|visit|report|date/i.test(l));
    f.history.value = sanitizeAI((keep.join('\n')) || ctx.notes);
  }
  if (!f.site.value) {
    const siteHints = [];
    if (/outpatient/i.test(ctx.policy)) siteHints.push('Outpatient');
    if (/inpatient/i.test(ctx.policy))  siteHints.push('Inpatient');
    if (/office|clinic/i.test(ctx.policy)) siteHints.push('Office/Clinic');
    const modHints = ctx.codes && /(?:26|TC)(?:\D|$)/.test(ctx.codes) ? ' (modifiers present)' : '';
    f.site.value = (siteHints.join(' / ') || 'Specify site of service and modifiers') + modHints;
  }

  f.rationale.value = await tText(f.rationale.value, lang, tx);
  f.history.value   = await tText(f.history.value,   lang, tx);
  f.site.value      = await tText(f.site.value,      lang, tx);

  setNoteStatus('Synced.');
  if (typeof saveDraft === 'function') saveDraft();
}

async function generateNoteFields() {
  const lang = getNoteLang();
  const f = noteFields();
  const ctx = getHomeContext();

  if (!f.service.value && ctx.svc) f.service.value = ctx.svc;
  if (!f.codes.value   && ctx.codes) f.codes.value = ctx.codes;
  if (!f.payer.value   && ctx.payer) f.payer.value = ctx.payer;

  setNoteStatus('Generating field drafts…');

  const schema = {
    type: "object",
    properties: {
      medicalNecessity: { type: "string" },
      historyImaging:   { type: "string" },
      siteModifiers:    { type: "string" }
    },
    required: ["medicalNecessity","historyImaging","siteModifiers"]
  };

  let out = null;

  if ('LanguageModel' in self) {
    try {
      const s = await withTimeout(LanguageModel.create(LM_OPTS(lang)), PROMPT_AI_DEADLINE_MS, 'create timeout');
      const prompt = `
You are helping draft a concise, payer-ready prior authorization note in ${lang.toUpperCase()}.
Use ONLY the facts provided. Be specific but brief (2–4 sentences per field). Avoid hallucinations.

CONTEXT
Service: ${ctx.svc || f.service.value || '(describe)'}
Codes: ${ctx.codes || f.codes.value || '(codes)'}
Payer: ${ctx.payer || f.payer.value || '(payer)'}
First code: ${ctx.firstCode || '(n/a)'}
Payer rule (if any): ${ctx.ruleText || '(n/a)'}
Payer policy (paste): ${ctx.policy || '(n/a)'}
Clinical notes: ${ctx.notes || '(n/a)'}

Return strict JSON with keys:
- medicalNecessity
- historyImaging
- siteModifiers
`;
      const res = await withTimeout(s.prompt(prompt, { responseConstraint: schema }), PROMPT_AI_DEADLINE_MS, 'prompt timeout');
      out = typeof res === 'string' ? JSON.parse(res) : res;
    } catch (e) {}
  }

  if (!out) {
    const bulletsFromPolicy = (ctx.policy || '')
      .split(/[\.\n]/).map(s=>s.trim()).filter(Boolean).slice(0,3)
      .map(s=>'• ' + s).join('\n');

    const hx = (ctx.notes || '')
      .split(/\n+/).filter(Boolean).slice(0,4).join('\n');

    let site = 'Specify site of service; include relevant modifiers';
    if (/outpatient/i.test(ctx.policy)) site = 'Outpatient setting; include applicable modifiers';
    if (/inpatient/i.test(ctx.policy))  site = 'Inpatient setting; include applicable modifiers';
    if (/office|clinic/i.test(ctx.policy)) site = 'Office/Clinic setting; include applicable modifiers';

    out = {
      medicalNecessity: sanitizeAI(
        [
          'Symptoms and functional impact documented; failed conservative therapy as indicated.',
          ctx.ruleText ? `Meets payer rule: ${ctx.ruleText}` : ''
        ].filter(Boolean).join(' ')
      ),
      historyImaging: sanitizeAI(hx || (bulletsFromPolicy || 'Summarize prior visits, imaging, and dates.')),
      siteModifiers: sanitizeAI(site)
    };
  }

  const tx = await getTranslator(lang, 'en');
  f.rationale.value = await tText(out.medicalNecessity || f.rationale.value, lang, tx);
  f.history.value   = await tText(out.historyImaging   || f.history.value,   lang, tx);
  f.site.value      = await tText(out.siteModifiers    || f.site.value,      lang, tx);

  setNoteStatus('Fields filled.');
  if (typeof saveDraft === 'function') saveDraft();
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
  if (typeof saveDraft === 'function') saveDraft();
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
  if (typeof saveDraft === 'function') saveDraft();
}

function copyAssembled() {
  const f = noteFields();
  const txt = f.final.value || '';
  navigator.clipboard.writeText(txt).catch(()=>{});
  setNoteStatus('Copied to clipboard.');
}

// Translate existing PA Note fields when language changes
async function onNoteLangChanged() {
  const lang = getNoteLang();
  const f = noteFields();

  if (lang === 'en') {
    const restored = await restoreNoteEnglish();
    if (restored) setNoteStatus('Restored English.');
    if (typeof saveDraft === 'function') saveDraft();
    return;
  }

  await cacheNoteEnglishIfMissing();
  const tx = await getTranslator(lang, 'en');
  f.rationale.value = await tText(f.rationale.value, lang, tx);
  f.history.value   = await tText(f.history.value,   lang, tx);
  f.site.value      = await tText(f.site.value,      lang, tx);
  if ((f.final.value || '').trim()) f.final.value = await tText(f.final.value, lang, tx);

  setNoteStatus(`Translated to ${lang.toUpperCase()}.`);
  if (typeof saveDraft === 'function') saveDraft();
}

// ---------- CLEAR buttons ----------
function clearHomeFields() {
  const ids = [
    'cptInput','payerInput','payerPolicy','clinicalNotes','aiLine'
  ];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  const clearHTML = (id) => { const el = document.getElementById(id); if (el) el.innerHTML = ''; };
  const hideText  = (id) => { const el = document.getElementById(id); if (el){ el.textContent=''; el.style.display='none'; } };

  clearHTML('suggestions');
  clearHTML('result');
  clearHTML('payerCompare');
  hideText('snapshotOut');
  hideText('policySummaryOut');
  const risk = document.getElementById('riskOut'); if (risk){ risk.innerHTML=''; risk.style.display='none'; }
  const bar = document.getElementById('snapshotBar'); if (bar) bar.style.display='none';
  const chips = document.getElementById('attrChips'); if (chips) chips.innerHTML='';
  const aiOut = document.getElementById('aiExtractOut'); if (aiOut) aiOut.textContent='';
  const attach = document.getElementById('attachInput'); if (attach) attach.value='';
  const attachList = document.getElementById('attachList'); if (attachList) attachList.innerHTML='';

  if (typeof saveDraft === 'function') saveDraft();
}
async function clearNoteFields() {
  const f = noteFields();
  f.service.value=''; f.codes.value=''; f.payer.value='';
  f.rationale.value=''; f.history.value=''; f.site.value=''; f.final.value='';
  setNoteStatus('');
  try { await chrome.storage.local.remove('note_cache_en'); } catch {}
  if (typeof saveDraft === 'function') saveDraft();
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
  diagLog(`Diagnostics complete in ${Date.now() - start}ms`);
  return Date.now() - start;
}

// ---------- Re-translate on language changes ----------
async function onPopupLangChanged() {
  if ((document.getElementById('result')?.innerHTML || '').trim())    await doValidate();
  if ((document.getElementById('snapshotOut')?.textContent || '').trim()) await generateCoverageSnapshot();
  if ((document.getElementById('policySummaryOut')?.textContent || '').trim()) await summarizePolicy();
  if ((document.getElementById('riskOut')?.innerHTML || '').trim())   await checkAuthRisk();
  if ((document.getElementById('payerCompare')?.innerHTML || '').trim()) {
    const code = pickFirstValidCodeFromInput();
    if (code) await renderPayerCompare(code);
  }
  if (typeof saveDraft === 'function') saveDraft();
}

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  await initData();
  setupSuggestions();
  setupAttachmentsList();
  loadHistory();

  // persistent popup state
  wireAutosave();
  await autoRestore();

  document.getElementById("validateBtn")?.addEventListener("click", () => { doValidate(); });
  const form = document.getElementById("ai-extract-form");
  if (form) form.addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("aiExtractBtn")?.addEventListener("click", () => { runSuggest(); });

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

  document.getElementById('snapshotBtn')?.addEventListener('click', generateCoverageSnapshot);
  document.getElementById('snapshotCopyBtn')?.addEventListener('click', () => {
    const txt = (document.getElementById('snapshotOut')?.textContent || '');
    if (txt.trim()) navigator.clipboard.writeText(txt).catch(()=>{});
  });

  document.getElementById('riskBtn')?.addEventListener('click', checkAuthRisk);
  document.getElementById('riskBtn2')?.addEventListener('click', checkAuthRisk);
  document.getElementById('summarizePolicyBtn')?.addEventListener('click', summarizePolicy);
  document.getElementById('loadDemoBtn')?.addEventListener('click', loadDemoData);
  document.getElementById('pasteCapturedBtn')?.addEventListener('click', pasteFromCapture);

  document.getElementById('syncNoteBtn')?.addEventListener('click', syncNoteFromHome);
  document.getElementById('genNoteFieldsBtn')?.addEventListener('click', generateNoteFields);
  document.getElementById('polishNoteFieldsBtn')?.addEventListener('click', polishNoteFields);
  document.getElementById('assembleNoteBtn')?.addEventListener('click', assembleNote);
  document.getElementById('copyAssembledBtn')?.addEventListener('click', copyAssembled);

  document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);
  document.getElementById('clearHomeBtn')?.addEventListener('click', clearHomeFields);
  document.getElementById('clearNoteBtn')?.addEventListener('click', clearNoteFields);

  document.getElementById('runDiagBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('runDiagBtn');
    btn.disabled = true;
    await Promise.resolve().then(() => runDiagnostics());
    btn.disabled = false;
  });

  document.getElementById('popupLang')?.addEventListener('change', onPopupLangChanged);
  document.getElementById('noteLang')?.addEventListener('change', onNoteLangChanged);
});
