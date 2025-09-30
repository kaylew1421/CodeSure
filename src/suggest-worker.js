/* Suggestion scoring worker (classic) */
self.onmessage = (ev) => {
  try {
    const { cptData, tokens } = ev.data || {};
    if (!Array.isArray(cptData) || !Array.isArray(tokens)) {
      self.postMessage({ ok: true, results: [] });
      return;
    }
    const toks = tokens.map(t => String(t || '').toLowerCase()).filter(Boolean);
    const results = cptData.map(row => {
      const d = (row.description || "").toLowerCase();
      const c = (row.category || "").toLowerCase();
      let s = 0;
      for (const t of toks) { if (d.includes(t)) s += 2; if (c.includes(t)) s += 1; }
      return { code: row.code, description: row.description, category: row.category, score: s };
    }).filter(x => x.score > 0).sort((a,b)=>b.score-a.score).slice(0,5);
    self.postMessage({ ok: true, results });
  } catch {
    self.postMessage({ ok: true, results: [] });
  }
};
