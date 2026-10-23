/* NRC Referee Hub: evaluator page. Certification track (rules exam, video calibration), games to evaluate, my reports. */
(function () {
  const $ = NRC.$, esc = NRC.esc, sb = () => NRC.sb;
  const DIFF = { level_1: 1, level_2: 2, level_3: 3 };
  let user, ev = null, S = null, items = [], cal = [], attempts = [], games = [], mine = [];

  const msg = (t, kind) => NRC.notice($("#ev-msg"), t, kind);
  const show = (id) => { ["ev-join", "ev-main", "ev-work"].forEach(x => $("#" + x).classList.toggle("hidden", x !== id)); window.scrollTo(0, 0); };
  const current = () => ev && ev.status === "certified" && (ev.founding || (ev.rules_passed_on && ev.calibration_passed_on && addMonths(ev.rules_passed_on, S.rules_valid_months) >= NRC.localDate() && addMonths(ev.calibration_passed_on, S.calibration_valid_months) >= NRC.localDate()));
  function addMonths(d, m) { const x = new Date(d + "T00:00:00"); x.setMonth(x.getMonth() + m); return NRC.localDate(x); }
  function ytEmbed(url) {
    if (!url) return "";
    const m = /(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(url); if (!m) return "";
    const t = /[?&]t=(\d+)/.exec(url);
    return `<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}${t ? "?start=" + t[1] : ""}" title="Game video" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
  }

  async function init() {
    user = await NRC.requireUser(); if (!user) return;
    $("#ev-home").href = NRC.homeFor(user);
    if (user.role === "evaluator") $("#ev-home").classList.add("hidden");
    const [{ data: s }, its] = await Promise.all([sb().from("evaluator_settings").select("*").eq("id", 1).maybeSingle(), NRC.Report.items()]);
    S = s || { rules_question_count: 40, rules_pass_pct: 80, rules_time_limit_minutes: 45, rules_max_difficulty: "level_2", calibration_pass_pct: 80, calibration_tolerance: 1, calibration_games_required: 3, rules_valid_months: 12, calibration_valid_months: 24, weekly_target: 1, report_due_days: 3 };
    items = its;
    await load();
  }
  async function load() {
    const { data } = await sb().from("evaluators").select("*").eq("user_id", user.id).maybeSingle();
    ev = data;
    if (!ev) return renderJoin();
    $("#ev-title").textContent = "Evaluator, " + ev.first_name + " " + ev.last_name;
    const [{ data: c }, { data: a }, { data: r }] = await Promise.all([
      sb().from("calibration_library").select("*").order("sort"),
      sb().from("evaluator_attempts").select("*").eq("evaluator_id", ev.id).order("created_at", { ascending: false }),
      sb().from("observation_reports").select("id,game_id,status,submitted_at,updated_at,overall,summary,nrc_note,method").eq("evaluator_id", ev.id).order("updated_at", { ascending: false })
    ]);
    cal = c || []; attempts = a || []; mine = r || [];
    games = [];
    if (current()) { const { data: g } = await sb().from("evaluator_games").select("*").order("game_date", { ascending: false }).limit(300); games = g || []; }
    renderSteps(); renderTrack(); renderGames(); renderReports();
    show("ev-main");
    const want = location.hash.slice(1), gm = /^game=([\w-]+)/.exec(want);
    if (["track", "games", "reports"].includes(want)) tab(want); else if (current()) tab("games");
    if (gm && current()) { history.replaceState(null, "", "#games"); if (games.find(x => x.game_id === gm[1])) openReport(gm[1]); else msg("This game is not open for evaluation (not played yet, or you refereed it).", "error"); }
  }

  // ---------- join ----------
  function renderJoin() {
    $("#join-rules").textContent = `${S.rules_question_count} questions from the IHF Catalogue of Rules Questions, ${S.rules_time_limit_minutes} minutes, ${S.rules_pass_pct}% to pass.`;
    $("#join-cal").textContent = `Rate ${S.calibration_games_required} reference games on video with the IHF sheet. ${S.calibration_pass_pct}% of your ratings must fall within ${S.calibration_tolerance} step of the NRC reference rating; only your first attempt on each game counts.`;
    NRC.$$(".j-rv").forEach(x => x.textContent = S.rules_valid_months); NRC.$$(".j-cv").forEach(x => x.textContent = S.calibration_valid_months);
    $("#join-btn").onclick = async () => {
      const { error } = await sb().rpc("evaluator_enroll", { p_background: $("#join-bg").value.trim() || null });
      if (error) { msg(esc(error.message), "error"); return; }
      msg("You are on the evaluator track. Start with the rules exam.", "ok"); load();
    };
    show("ev-join");
  }

  // ---------- steps and tabs ----------
  function renderSteps() {
    const calFirst = attempts.filter(a => a.kind === "calibration" && a.first_attempt);
    const rulesOk = ev.founding || !!ev.rules_passed_on, calOk = ev.founding || !!ev.calibration_passed_on, cur = current();
    const st = (done, n, title, sub) => `<div class="ev-step ${done ? "done" : ""}"><span class="k">${done ? "&#10003;" : n}</span><div><strong>${title}</strong><div class="small">${sub}</div></div></div>`;
    const status = ev.status === "suspended" ? '<span class="pill red">Suspended</span>' : ev.status === "inactive" ? '<span class="pill">Inactive</span>' : cur ? '<span class="pill green">Certified evaluator</span>' : ev.status === "certified" ? '<span class="pill amber">Certification expired</span>' : '<span class="pill amber">In training</span>';
    $("#ev-steps").innerHTML = `<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div>${status}${ev.founding ? ' <span class="pill">Founding evaluator</span>' : ""}</div><div class="small muted">${ev.club_id ? "" : "No club affiliation"}</div></div>
      <div class="ev-steps-row">${st(rulesOk, 1, "Rules exam", ev.founding ? "Founding evaluator" : ev.rules_passed_on ? `${ev.rules_pct}%, valid to ${NRC.fmtDate(addMonths(ev.rules_passed_on, S.rules_valid_months))}` : ev.rules_pct != null ? `Best ${ev.rules_pct}%, ${S.rules_pass_pct}% needed` : `${S.rules_pass_pct}% needed`)}
      ${st(calOk, 2, "Video calibration", ev.founding ? "Sets the reference ratings" : ev.calibration_passed_on ? `${ev.calibration_pct}%, valid to ${NRC.fmtDate(addMonths(ev.calibration_passed_on, S.calibration_valid_months))}` : `${calFirst.length} of ${S.calibration_games_required} games${ev.calibration_pct != null ? ", " + ev.calibration_pct + "% so far" : ""}`)}
      ${st(cur, 3, "Evaluate games", cur ? weekLine() : "Opens once both steps are passed")}</div></div>`;
  }
  function weekLine() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const n = mine.filter(r => r.submitted_at && r.submitted_at >= since).length;
    return `${n} of ${S.weekly_target} report${S.weekly_target === 1 ? "" : "s"} in the last 7 days`;
  }
  function tab(t) {
    NRC.$$("#ev-tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
    ["track", "games", "reports"].forEach(x => $("#tab-" + x).classList.toggle("hidden", x !== t));
  }
  NRC.$$("#ev-tabs button").forEach(b => b.onclick = () => { history.replaceState(null, "", "#" + b.dataset.tab); tab(b.dataset.tab); });

  // ---------- certification tab ----------
  function renderTrack() {
    const rules = attempts.filter(a => a.kind === "rules");
    const calRows = cal.map(c => `<tr><td><strong>${esc(c.title)}</strong>${c.division ? '<div class="small muted">' + esc(NRC.divisionLabel(c.division)) + "</div>" : ""}${c.watch_notes ? '<div class="small">' + esc(c.watch_notes) + "</div>" : ""}</td><td>${c.my_first_pct != null ? `<span class="pill ${c.my_first_pct >= S.calibration_pass_pct ? "green" : "red"}">${c.my_first_pct}%</span>` : '<span class="small muted">not rated</span>'}${c.my_attempts > 1 ? '<div class="small muted">best ' + c.my_best_pct + "%</div>" : ""}</td><td><button class="btn sm ${c.my_attempts ? "ghost" : ""}" type="button" data-cal="${c.id}">${c.my_attempts ? "Practice again" : "Rate this game"}</button></td></tr>`).join("");
    const rulesLocked = false, calLocked = !ev.founding && !ev.rules_passed_on;
    $("#tab-track").innerHTML = `<div class="grid c2">
      <div class="card"><h3>Rules exam</h3><p class="small">${S.rules_question_count} questions from the IHF Catalogue of Rules Questions across all 18 rules, ${S.rules_time_limit_minutes} minutes, ${S.rules_pass_pct}% to pass. Renewed every ${S.rules_valid_months} months. Answers are shown at the end.</p>
        ${rules.length ? '<div class="small">' + rules.slice(0, 5).map(a => `${NRC.fmtDate(a.created_at.slice(0, 10))}: <strong>${a.pct}%</strong> ${a.passed ? '<span class="pill green">passed</span>' : '<span class="pill red">not passed</span>'}`).join("<br>") + "</div>" : '<p class="small muted">No attempt yet.</p>'}
        <p style="margin-top:12px"><button class="btn" type="button" id="start-rules" ${rulesLocked ? "disabled" : ""}>${ev.rules_passed_on ? "Retake the exam" : "Start the exam"}</button> <a class="btn ghost" href="training.html">Practice first</a></p></div>
      <div class="card"><h3>Video calibration</h3><p class="small">Watch a reference game and rate the pair on the IHF sheet as you would in a real report. Each rating within ${S.calibration_tolerance} step of the NRC reference counts as agreement; the summary verdict must match. You need ${S.calibration_pass_pct}% on average over your first attempts on ${S.calibration_games_required} games. After each game you see the reference rating and remarks.</p>
        ${calLocked ? '<p class="notice">Pass the rules exam first.</p>' : cal.length ? `<div class="table-wrap"><table><thead><tr><th>Reference game</th><th>Your result</th><th></th></tr></thead><tbody>${calRows}</tbody></table></div>` : '<p class="small muted">The NRC has not published reference games yet.</p>'}</div>
    </div>
    <div class="card"><h3>What the NRC expects from an evaluator</h3><ul class="small">
      <li>Rate on the definitions: number of mistakes and quality of match control. When in doubt between two steps, reread the definition rather than splitting the difference.</li>
      <li>An item that did not occur is rated Average. Invalid scores overlaps with other items; rate it on goals only.</li>
      <li>Remarks let the NRC reconstruct your ratings from the text: key scenes with video timestamps, not every error minute by minute.</li>
      <li>Suggestions: two or three concrete points for the next game.</li>
      <li>Report within ${S.report_due_days} days of the game. Never evaluate a game you refereed; declare your own club's games and family links to the NRC.</li>
    </ul></div>`;
    const sr = $("#start-rules"); if (sr) sr.onclick = startRules;
    NRC.$$("[data-cal]", $("#tab-track")).forEach(b => b.onclick = () => startCalibration(b.dataset.cal));
  }

  // ---------- rules exam ----------
  async function startRules() {
    const all = await NRC.loadQuestions();
    const pool = all.filter(q => q.src === "ihf" && q.options && q.options.length && (DIFF[q.diff] || 2) <= DIFF[S.rules_max_difficulty]);
    // spread across rules: round robin over the 18 rules
    const byRule = {}; NRC.shuffle(pool.slice()).forEach(q => { (byRule[q.rule] = byRule[q.rule] || []).push(q); });
    const deck = []; let k = 0; const rules = Object.keys(byRule);
    while (deck.length < S.rules_question_count && rules.some(r => byRule[r].length)) { const r = rules[k++ % rules.length]; if (byRule[r].length) deck.push(byRule[r].pop()); }
    if (deck.length < S.rules_question_count) { msg("Not enough questions in the bank for the exam. Contact the NRC.", "error"); return; }
    NRC.shuffle(deck);
    const answers = new Array(deck.length).fill(null), t0 = Date.now(), limit = S.rules_time_limit_minutes * 60;
    let i = 0, timer = null;
    show("ev-work");
    const W = $("#ev-work");
    const multi = (q) => q.cis && q.cis.length > 1;
    function paint() {
      const q = deck[i], a = answers[i] || [];
      W.innerHTML = `<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><strong>Evaluator rules exam</strong><span class="timer" id="ex-timer"></span></div>
        <div class="small muted">Question ${i + 1} of ${deck.length} &middot; Rule ${q.rule}: ${esc(NRC.RULES[q.rule] || "")}${multi(q) ? " &middot; several answers are correct" : ""}</div>
        <p class="quiz-q" style="margin-top:10px">${esc(q.q)}</p>
        <div class="quiz-opts">${q.options.map((o, j) => `<label class="opt ${a.includes(j) ? "on" : ""}"><input type="${multi(q) ? "checkbox" : "radio"}" name="opt" value="${j}" ${a.includes(j) ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div>
        <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" type="button" id="ex-prev" ${i ? "" : "disabled"}>Previous</button>${i < deck.length - 1 ? '<button class="btn" type="button" id="ex-next">Next</button>' : ""}<button class="btn ${i === deck.length - 1 ? "" : "ghost"}" type="button" id="ex-end">Finish the exam</button><span class="small muted" style="align-self:center">${answers.filter(x => x && x.length).length} answered</span></p></div>`;
      NRC.$$("input[name=opt]", W).forEach(inp => inp.onchange = () => { answers[i] = NRC.$$("input[name=opt]:checked", W).map(x => parseInt(x.value, 10)); NRC.$$(".opt", W).forEach(l => l.classList.toggle("on", l.querySelector("input").checked)); });
      $("#ex-prev").onclick = () => { i--; paint(); }; const n = $("#ex-next"); if (n) n.onclick = () => { i++; paint(); };
      $("#ex-end").onclick = () => { const left = answers.filter(x => !x || !x.length).length; if (left && !confirm(left + " question" + (left === 1 ? " is" : "s are") + " unanswered. Finish anyway?")) return; finish(); };
      tick();
    }
    function tick() { const left = limit - Math.floor((Date.now() - t0) / 1000), el = $("#ex-timer"); if (el) el.textContent = Math.max(0, Math.floor(left / 60)) + ":" + String(Math.max(0, left % 60)).padStart(2, "0"); if (left <= 0) finish(); }
    timer = setInterval(tick, 1000);
    async function finish() {
      if (!timer) return; clearInterval(timer); timer = null;
      const right = (q, a) => { const want = (q.cis && q.cis.length ? q.cis : [q.ci]).slice().sort().join(","); return (a || []).slice().sort().join(",") === want; };
      const correct = deck.filter((q, j) => right(q, answers[j])).length;
      const { data, error } = await sb().rpc("evaluator_submit_rules", { p_total: deck.length, p_correct: correct, p_duration: Math.round((Date.now() - t0) / 1000) });
      if (error) { W.innerHTML = '<p class="notice error">' + esc(error.message) + "</p>"; return; }
      W.innerHTML = `<div class="card" style="margin-top:16px"><div class="notice ${data.passed ? "ok" : "error"}"><strong>${data.pct}%</strong> (${correct} of ${deck.length}). ${data.passed ? "Passed. The video calibration is open." : "Not passed; " + data.pass_pct + "% is needed. Review the answers below and retake when ready."}</div>
        <p><button class="btn" type="button" id="ex-back">Back to the track</button></p>
        <h3>Answers</h3>${deck.map((q, j) => `<div class="small" style="padding:8px 0;border-bottom:1px solid var(--line)"><strong>${j + 1}.</strong> ${esc(q.q)}<br>${right(q, answers[j]) ? '<span class="pill green">correct</span>' : '<span class="pill red">wrong</span>'} ${NRC.explain(q, true)}</div>`).join("")}</div>`;
      $("#ex-back").onclick = load;
    }
    paint();
  }

  // ---------- calibration ----------
  async function startCalibration(id) {
    const c = cal.find(x => x.id === id); if (!c) return;
    show("ev-work"); const W = $("#ev-work"), t0 = Date.now();
    W.innerHTML = `<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2 style="margin:0">${esc(c.title)}</h2><button class="btn sm ghost" type="button" id="cal-back">Back</button></div>
      ${c.watch_notes ? '<p class="small">' + esc(c.watch_notes) + "</p>" : ""}${c.my_attempts ? '<p class="notice">Practice attempt: only your first attempt on this game counts toward certification.</p>' : ""}
      ${ytEmbed(c.video_url) || `<p><a class="btn ghost" href="${esc(c.video_url)}" target="_blank" rel="noopener">Open the video</a></p>`}
      <div id="cal-form"></div><div id="cal-miss" class="notice error hidden"></div>
      <p style="margin-top:14px"><button class="btn" type="button" id="cal-submit">Submit my rating</button></p></div>`;
    $("#cal-back").onclick = load;
    const key = "nrc-cal-" + id;
    let saved = null; try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { }
    const form = $("#cal-form");
    await NRC.Report.render(form, { mode: "calibration", items, value: saved || {}, onChange: () => { try { localStorage.setItem(key, JSON.stringify(NRC.Report.read(form))); } catch (e) { } } });
    $("#cal-submit").onclick = async () => {
      const miss = NRC.Report.missing(form, items, false);
      if (miss.length) { NRC.notice($("#cal-miss"), "Missing: " + miss.join(", ") + ".", "error"); return; }
      const v = NRC.Report.read(form);
      const { data, error } = await sb().rpc("evaluator_submit_calibration", { p_game: id, p_scores: v.scores, p_summary: v.summary, p_match_type: v.match_type, p_influence: v.influence, p_duration: Math.round((Date.now() - t0) / 1000) });
      if (error) { NRC.notice($("#cal-miss"), esc(error.message), "error"); return; }
      try { localStorage.removeItem(key); } catch (e) { }
      W.innerHTML = `<div class="card" style="margin-top:16px"><h2 style="margin-top:0">${esc(c.title)}: your rating against the reference</h2>${NRC.Report.resultHtml(data, items)}<p style="margin-top:12px"><button class="btn" type="button" id="cal-done">Back to the track</button></p></div>`;
      $("#cal-done").onclick = load;
    };
  }

  // ---------- games to evaluate ----------
  let gFilter = "video";
  function renderGames() {
    const T = $("#tab-games");
    if (!current()) { T.innerHTML = `<div class="card"><p>Games open once you are certified: rules exam and video calibration passed${ev.status === "certified" && !ev.founding ? ", and both still valid" : ""}.</p></div>`; return; }
    const list = games.filter(g => gFilter === "all" ? true : gFilter === "video" ? g.video_url && !g.reports && !g.my_report_id : !g.reports && !g.my_report_id);
    T.innerHTML = `<div class="filterbar"><select id="g-filter"><option value="video">With video, not yet evaluated</option><option value="open">Not yet evaluated</option><option value="all">All played games</option></select><span class="tag">${list.length} game${list.length === 1 ? "" : "s"}</span><span class="tag">${weekLine()}</span></div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Game</th><th>Referees</th><th>Reports</th><th></th></tr></thead><tbody>${list.map(g => `<tr><td>${NRC.fmtDate(g.game_date)}</td><td><strong>${esc(g.tournament || "")}</strong><div class="small">${esc([g.home_team, g.away_team].filter(Boolean).join(" v ") || "teams not entered")}${g.division ? " &middot; " + esc(NRC.divisionLabel(g.division)) : ""}</div>${g.video_url ? '<a class="small" href="' + esc(g.video_url) + '" target="_blank" rel="noopener">video</a>' : '<span class="small muted">no video</span>'}${g.ai_log ? ' <span class="pill" title="An AI log with flagged moments is loaded on this game">AI log, ' + (g.ai_flags || 0) + ' flags</span>' : ""}</td><td class="small">${esc(g.referee_1_name || "")}${g.referee_2_name ? "<br>" + esc(g.referee_2_name) : ""}</td><td>${g.reports || ""}${g.my_report_status ? " " + NRC.Report.statusPill(g.my_report_status) : ""}</td><td>${g.conflict ? '<span class="small muted">You refereed this game</span>' : `<button class="btn sm ${g.my_report_id ? "ghost" : ""}" type="button" data-game="${g.game_id}">${g.my_report_id ? (["draft", "returned"].includes(g.my_report_status) ? "Continue" : "View") : "Evaluate"}</button>`}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="small muted">${gFilter === "video" ? "No game with a video link is waiting. Ask organizers and clubs to add their stream links to the game log, or switch the filter." : "No game in this list."}</p>`}`;
    $("#g-filter").value = gFilter; $("#g-filter").onchange = (e) => { gFilter = e.target.value; renderGames(); };
    NRC.$$("[data-game]", T).forEach(b => b.onclick = () => openReport(b.dataset.game));
  }

  // ---------- my reports ----------
  function renderReports() {
    const T = $("#tab-reports");
    if (!mine.length) { T.innerHTML = '<div class="card"><p class="small muted">No report yet.</p></div>'; return; }
    const gm = Object.fromEntries(games.map(g => [g.game_id, g]));
    T.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Game</th><th>Status</th><th>Overall</th><th></th></tr></thead><tbody>${mine.map(r => { const g = gm[r.game_id] || {}; return `<tr><td><strong>${esc(g.tournament || "Game")}</strong><div class="small">${NRC.fmtDate(g.game_date)} ${esc([g.home_team, g.away_team].filter(Boolean).join(" v "))}</div>${r.nrc_note && r.status === "returned" ? '<div class="small"><strong>NRC:</strong> ' + esc(r.nrc_note) + "</div>" : ""}</td><td>${NRC.Report.statusPill(r.status)}</td><td>${r.overall != null ? NRC.scoreHtml(r.overall) : ""}</td><td><button class="btn sm ghost" type="button" data-rep="${r.id}" data-g="${r.game_id}" data-s="${r.status}">${["draft", "returned"].includes(r.status) ? "Continue" : "View"}</button></td></tr>`; }).join("")}</tbody></table></div>`;
    NRC.$$("[data-rep]", T).forEach(b => b.onclick = () => ["draft", "returned"].includes(b.dataset.s) ? openReport(b.dataset.g) : NRC.Report.openView(b.dataset.rep));
  }

  // ---------- report editor ----------
  async function openReport(gameId) {
    const g = games.find(x => x.game_id === gameId); if (!g) return;
    let rep = null;
    if (g.my_report_id) { const { data } = await sb().from("observation_reports").select("*").eq("id", g.my_report_id).single(); rep = data; }
    if (rep && !["draft", "returned"].includes(rep.status)) { NRC.Report.openView(rep.id); return; }
    show("ev-work"); const W = $("#ev-work"), key = "nrc-rep-" + gameId;
    let local = null; try { local = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { }
    W.innerHTML = `<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Observation report</h2><button class="btn sm ghost" type="button" id="rep-back">Back</button></div>
      ${rep && rep.status === "returned" && rep.nrc_note ? '<div class="notice"><strong>Returned by the NRC.</strong> ' + esc(rep.nrc_note) + "</div>" : ""}
      ${ytEmbed(g.video_url)}
      <div id="rep-ai"></div>
      <div id="rep-form"></div><div id="rep-miss" class="notice error hidden"></div>
      <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="rep-submit">Submit to the NRC</button><button class="btn ghost" type="button" id="rep-draft">Save draft</button>${rep && rep.status === "draft" ? '<button class="btn ghost" type="button" id="rep-del">Delete draft</button>' : ""}</p>
      <p class="small muted">The NRC reads every report before releasing it to the referees. Drafts are saved on this device as you type.</p></div>`;
    $("#rep-back").onclick = load;
    const form = $("#rep-form");
    await NRC.Report.render(form, { mode: "report", items, game: g, value: local || rep || {}, onChange: () => { try { localStorage.setItem(key, JSON.stringify(NRC.Report.read(form))); } catch (e) { } } });
    form.addEventListener("input", () => { try { localStorage.setItem(key, JSON.stringify(NRC.Report.read(form))); } catch (e) { } });
    // AI log and flagged moments, when the NRC has loaded one on this game
    const aiKey = "nrc-ai-" + gameId; let aiLocal = null; try { aiLocal = JSON.parse(localStorage.getItem(aiKey) || "null"); } catch (e) { }
    const ai = g.ai_log && NRC.AI ? await NRC.AI.panel($("#rep-ai"), { game: g, form, decisions: aiLocal || (rep && rep.ai_flag_decisions) || {}, onChange: () => { try { localStorage.setItem(key, JSON.stringify(NRC.Report.read(form))); localStorage.setItem(aiKey, JSON.stringify(ai ? ai.decisions() : {})); } catch (e) { } } }) : null;
    async function save(status) {
      const v = NRC.Report.read(form);
      if (status === "submitted") { const miss = NRC.Report.missing(form, items, true); if (miss.length) { NRC.notice($("#rep-miss"), "Missing: " + miss.join(", ") + ".", "error"); return; } }
      const row = Object.assign(v, { game_id: gameId, evaluator_id: ev.id, evaluator_user_id: user.id, status, video_url: g.video_url || null });
      if (ai) { row.ai_flag_decisions = ai.decisions(); row.ai_assisted = true; }
      const res = rep ? await sb().from("observation_reports").update(row).eq("id", rep.id).select().single() : await sb().from("observation_reports").insert(row).select().single();
      if (res.error) { NRC.notice($("#rep-miss"), esc(res.error.message), "error"); return; }
      rep = res.data; try { localStorage.removeItem(key); localStorage.removeItem("nrc-ai-" + gameId); } catch (e) { }
      if (status === "submitted") { msg("Report submitted. The NRC will review it before the referees see it.", "ok"); load(); }
      else NRC.notice($("#rep-miss"), "Draft saved.", "ok");
    }
    $("#rep-submit").onclick = () => save("submitted");
    $("#rep-draft").onclick = () => save("draft");
    const del = $("#rep-del"); if (del) del.onclick = async () => { if (!confirm("Delete this draft?")) return; await sb().from("observation_reports").delete().eq("id", rep.id); try { localStorage.removeItem(key); } catch (e) { } load(); };
  }

  document.addEventListener("DOMContentLoaded", init);
})();
