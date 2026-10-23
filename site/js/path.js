/* NRC Referee Hub: learning path. Themed quiz series (IHF rules grouped by theme, one quiz per level),
   each card showing the best score and the date last tested. Results are quiz_attempts with mode "lesson:<key>". */
(function () {
  const $ = NRC.$, esc = NRC.esc;
  const PASS = 80, PER = 10;
  // Five families of rules, one accent each: bright on the dark cards, deep on white panels
  const FAM = {
    setup: { name: "Game set-up", accent: "#2DD4BF", deep: "#0F766E" },
    play: { name: "Play and the goal area", accent: "#60A5FA", deep: "#1D4ED8" },
    fouls: { name: "Fouls and punishments", accent: "#FB7185", deep: "#BE123C" },
    restarts: { name: "Scoring and throws", accent: "#FBBF24", deep: "#B45309" },
    officials: { name: "Officials", accent: "#A78BFA", deep: "#6D28D9" }
  };
  NRC.THEMES = [
    { key: "court", title: "Court, time and ball", rules: [1, 2, 3], fam: "setup", icon: "court" },
    { key: "team", title: "Team, substitutions, equipment", rules: [4], fam: "setup", icon: "team" },
    { key: "gk", title: "The goalkeeper", rules: [5], fam: "setup", icon: "glove" },
    { key: "area", title: "The goal area", rules: [6], fam: "play", icon: "arc" },
    { key: "play", title: "Playing the ball, passive play", rules: [7], fam: "play", icon: "ball" },
    { key: "fouls", title: "Fouls and unsportsmanlike conduct", rules: [8], fam: "fouls", icon: "whistle" },
    { key: "punish", title: "Punishments", rules: [16], fam: "fouls", icon: "card" },
    { key: "score", title: "Scoring and the throw-off", rules: [9, 10], fam: "restarts", icon: "goal" },
    { key: "throws", title: "Throw-in, goalkeeper throw, free throw", rules: [11, 12, 13], fam: "restarts", icon: "throw" },
    { key: "seven", title: "The 7-metre throw", rules: [14], fam: "restarts", icon: "seven" },
    { key: "exec", title: "Executing throws", rules: [15], fam: "restarts", icon: "arrow" },
    { key: "officials", title: "Referees, timekeeper, scorekeeper", rules: [17, 18], fam: "officials", icon: "table" }
  ].map(t => Object.assign(t, { color: FAM[t.fam].deep, accent: FAM[t.fam].accent, family: FAM[t.fam].name }));
  const LEVELS = [["level_1", "Level 1"], ["level_2", "Level 2"], ["level_3", "Level 3"]];
  const ICONS = {
    court: '<rect x="3" y="7" width="26" height="18" rx="1"/><line x1="16" y1="7" x2="16" y2="25"/><path d="M3 11a5 5 0 0 1 0 10M29 11a5 5 0 0 0 0 10"/>',
    team: '<circle cx="11" cy="11" r="4"/><circle cx="22" cy="11" r="4"/><path d="M4 26c0-5 3-8 7-8s7 3 7 8M15 26c0-5 3-8 7-8s7 3 7 8"/>',
    glove: '<path d="M10 28V14l-3-5 2-1 4 5V6h2v7V4h2v9V5h2v8l3-3 2 1-5 8v9z"/>',
    arc: '<path d="M4 26a12 12 0 0 1 24 0"/><path d="M9 26a7 7 0 0 1 14 0" stroke-dasharray="2 2"/><line x1="2" y1="26" x2="30" y2="26"/>',
    ball: '<circle cx="16" cy="16" r="11"/><path d="M5 16h22M16 5c4 3 4 19 0 22M16 5c-4 3-4 19 0 22"/>',
    whistle: '<path d="M4 14h14a7 7 0 1 1-7 9H8l-4-4z"/><line x1="18" y1="14" x2="27" y2="10"/>',
    goal: '<path d="M5 26V8h22v18"/><path d="M5 12h22M5 16h22M5 20h22M11 8v18M16 8v18M21 8v18" stroke-width="1"/>',
    throw: '<circle cx="9" cy="8" r="3"/><path d="M9 11v9l-4 7M9 20l4 7M9 14l8-4"/><circle cx="24" cy="7" r="3"/>',
    seven: '<text x="16" y="22" text-anchor="middle" font-size="14" font-weight="700" stroke="none" fill="currentColor">7m</text><circle cx="16" cy="16" r="12"/>',
    arrow: '<path d="M4 24 24 8M24 8h-8M24 8v8"/><circle cx="6" cy="26" r="2"/>',
    card: '<rect x="6" y="5" width="12" height="18" rx="2" transform="rotate(-10 12 14)"/><rect x="14" y="8" width="12" height="18" rx="2" transform="rotate(10 20 17)"/>',
    table: '<rect x="4" y="12" width="24" height="6" rx="1"/><path d="M7 18v8M25 18v8M10 12V8h12v4"/>'
  };
  const icon = (k) => `<svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`;
  const ring = (pct, color, size, track) => { const r = 15, c = 2 * Math.PI * r, v = pct == null ? 0 : pct; return `<svg viewBox="0 0 36 36" width="${size || 44}" height="${size || 44}" aria-hidden="true"><circle cx="18" cy="18" r="${r}" fill="none" stroke="${track || "#E3E8EF"}" stroke-width="4"/><circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${c * v / 100} ${c}" transform="rotate(-90 18 18)"/></svg>`; };

  let ALL = [], results = {}, user = null, openTheme = null;
  const lessonKey = (t, lv) => t.key + "-" + lv;
  const poolFor = (t, lv) => ALL.filter(q => q.src === "ihf" && q.options && q.options.length && t.rules.includes(q.rule) && q.diff === lv);
  const lessonsOf = (t) => LEVELS.filter(([lv]) => poolFor(t, lv).length >= 5).map(([lv, label]) => ({ key: lessonKey(t, lv), lv, label, n: poolFor(t, lv).length }));

  async function loadResults() {
    results = {};
    const add = (key, pct, date) => { const r = results[key] = results[key] || { best: null, last: null, lastDate: null, n: 0 }; r.n++; if (r.best == null || pct > r.best) r.best = pct; if (!r.lastDate || date > r.lastDate) { r.lastDate = date; r.last = pct; } };
    if (user && NRC.sb) {
      const { data } = await NRC.sb.from("quiz_attempts").select("mode,total,correct,created_at").eq("user_id", user.id).like("mode", "lesson:%").order("created_at", { ascending: false }).limit(1000);
      (data || []).forEach(a => add(a.mode.slice(7), Math.round(100 * a.correct / a.total), a.created_at));
    } else {
      let d = { sessions: [] }; try { d = JSON.parse(localStorage.getItem("nrc_training_v1") || '{"sessions":[]}'); } catch (e) { }
      (d.sessions || []).filter(s => String(s.mode).startsWith("lesson:")).forEach(s => add(s.mode.slice(7), Math.round(100 * s.correct / s.total), s.created_at));
    }
  }

  function themeStats(t) {
    const L = lessonsOf(t), done = L.filter(l => results[l.key] && results[l.key].best >= PASS).length;
    const tried = L.filter(l => results[l.key]);
    const last = tried.map(l => results[l.key].lastDate).sort().pop() || null;
    const avg = tried.length ? Math.round(tried.reduce((a, l) => a + results[l.key].best, 0) / tried.length) : null;
    return { L, done, last, avg, complete: L.length && done === L.length };
  }
  function nextLesson() {
    for (const t of NRC.THEMES) for (const l of lessonsOf(t)) if (!results[l.key] || results[l.key].best < PASS) return { t, l };
    return null;
  }

  function render() {
    const host = $("#path-ui"); if (!host) return;
    const all = NRC.THEMES.flatMap(t => lessonsOf(t)), passed = all.filter(l => results[l.key] && results[l.key].best >= PASS).length;
    const wk = Object.values(results).filter(r => r.lastDate && r.lastDate >= new Date(Date.now() - 7 * 864e5).toISOString()).length;
    const nx = nextLesson();
    const pct = all.length ? Math.round(100 * passed / all.length) : 0;
    host.innerHTML = `<div class="path-top">
        <div class="pt-ring">${ring(pct, "#E8EB2F", 76, "rgba(255,255,255,.15)")}<span>${pct}%</span></div>
        <div class="pt-txt"><div class="pt-k">Your path through the IHF rules</div><div class="path-count"><strong>${passed}</strong> of ${all.length} quizzes passed</div>
        <div class="pt-sub">${PER} questions per quiz, ${PASS}% to pass.${wk ? " " + wk + " quiz" + (wk === 1 ? "" : "zes") + " this week." : ""}${user ? "" : ' <a href="login.html?next=training.html">Sign in</a> to keep your path across devices.'}</div></div>
        ${nx ? `<button class="btn yellow pt-next" type="button" data-start="${nx.l.key}"><span class="small" style="display:block;font-weight:600;opacity:.8">Up next</span>${esc(nx.t.title)}, ${nx.l.label}</button>` : '<span class="pill green">Every quiz passed. Retake the oldest to stay sharp.</span>'}
      </div>
      <div class="fam-legend">${Object.values(FAM).map(f => `<span><i style="background:${f.accent}"></i>${f.name}</span>`).join("")}</div>
      <div class="path-grid">${NRC.THEMES.map(t => { const s = themeStats(t); return `<button type="button" class="theme-card ${s.complete ? "complete" : ""} ${openTheme === t.key ? "open" : ""}" style="--fc:${t.accent};--tc:${t.color}" data-theme="${t.key}" aria-expanded="${openTheme === t.key}">
          <span class="tc-top"><span class="tc-ico">${icon(t.icon)}</span><span class="tc-rules">Rule${t.rules.length > 1 ? "s" : ""} ${t.rules.join(", ")}</span>${s.complete ? '<span class="tc-done" title="Completed">&#10003;</span>' : ""}</span>
          <span class="tc-title">${esc(t.title)}</span>
          <span class="tc-levels">${s.L.map(l => { const r = results[l.key]; return `<i class="lv ${r ? (r.best >= PASS ? "pass" : "try") : ""}" title="${l.label}${r ? ": best " + r.best + "%" : ": not started"}">${l.label.replace("Level ", "L")}</i>`; }).join("")}</span>
          <span class="tc-meta">${s.last ? (s.avg != null ? s.avg + "% average &middot; " : "") + NRC.fmtDate(NRC.localDate(new Date(s.last))) : "Not started"}</span></button>`; }).join("")}</div>
      <div id="path-detail"></div>`;
    NRC.$$("[data-theme]", host).forEach(b => b.onclick = () => { openTheme = openTheme === b.dataset.theme ? null : b.dataset.theme; render(); if (openTheme) $("#path-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
    NRC.$$("[data-start]", host).forEach(b => b.onclick = () => start(b.dataset.start));
    if (openTheme) renderDetail(NRC.THEMES.find(t => t.key === openTheme));
  }
  function renderDetail(t) {
    const s = themeStats(t);
    $("#path-detail").innerHTML = `<div class="card theme-detail" style="--tc:${t.color}"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span class="tc-ico">${icon(t.icon)}</span><div><h3 style="margin:0">${esc(t.title)}</h3><div class="small muted">${t.rules.map(r => "Rule " + r + ": " + esc(NRC.RULES[r] || "")).join(" &middot; ")}</div></div></div>
      <div class="lesson-list">${s.L.map(l => { const r = results[l.key]; return `<div class="lesson ${r && r.best >= PASS ? "pass" : ""}">${ring(r ? r.best : null, t.color)}<div class="lesson-txt"><strong>${l.label}</strong><div class="small muted">${r ? `Best ${r.best}%, last ${r.last}% on ${NRC.fmtDate(NRC.localDate(new Date(r.lastDate)))}, ${r.n} attempt${r.n === 1 ? "" : "s"}` : `${Math.min(PER, l.n)} questions from ${l.n} in the bank`}</div></div><button class="btn sm ${r && r.best >= PASS ? "ghost" : ""}" type="button" data-start="${l.key}">${r ? (r.best >= PASS ? "Retake" : "Try again") : "Start"}</button></div>`; }).join("") || '<p class="small muted">No IHF questions on this theme yet.</p>'}</div></div>`;
    NRC.$$("[data-start]", $("#path-detail")).forEach(b => b.onclick = () => start(b.dataset.start));
  }

  function start(key) {
    const [tk, lv] = [key.slice(0, key.lastIndexOf("-")), key.slice(key.lastIndexOf("-") + 1)];
    const t = NRC.THEMES.find(x => x.key === tk); if (!t) return;
    const qs = NRC.shuffle(poolFor(t, lv).slice()).slice(0, PER);
    const label = (LEVELS.find(x => x[0] === lv) || [, ""])[1];
    NRC.Training.startLesson({ key, title: t.title + ", " + label, color: t.color, questions: qs, difficulty: lv, onDone: async () => { await loadResults(); render(); } });
  }

  NRC.Path = {
    async init(u, all) { user = u; ALL = all; await loadResults(); render(); },
    render, refresh: async () => { await loadResults(); render(); }
  };
})();
