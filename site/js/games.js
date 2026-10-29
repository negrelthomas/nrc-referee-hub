/* NRC Referee Hub: game log and per game evaluations, shared by Admin (tournament Officiated tab, referee record) and the organizer page */
(function () {
  const G = (window.NRC.Games = {});
  const esc = (s) => NRC.esc(s);
  let ctx = null;          // current panel: { el, tournament, officials, mode, user, games, evals }
  let evalCtx = null;      // current evaluation form target

  // ---------- dialogs, injected once ----------
  function injectDialogs() {
    if (document.getElementById("dlg-g-game")) return;
    document.body.insertAdjacentHTML("beforeend", `
<dialog id="dlg-g-game"><div class="body">
  <h3 style="margin-top:0" id="g-game-title">Game</h3>
  <form id="form-g-game">
    <div class="row"><div><label>Date</label><input name="game_date" type="date" required></div><div><label>Time</label><input name="game_time" type="time"></div></div>
    <div class="row"><div><label>Division</label><select name="division"></select></div><div><label>Game number</label><input name="game_number" placeholder="Optional"></div></div>
    <div class="row"><div><label>Home team</label><input name="home_team"></div><div><label>Away team</label><input name="away_team"></div></div>
    <div class="row"><div><label>Home score</label><input name="home_score" type="number" min="0"></div><div><label>Away score</label><input name="away_score" type="number" min="0"></div></div>
    <div class="row"><div><label>Referee A</label><select name="referee_1" required></select></div><div><label>Referee B</label><select name="referee_2"></select></div></div>
    <div class="row"><div><label>Video link (YouTube or other)</label><input name="video_url" type="url" placeholder="https://"></div><div><label>Court</label><input name="court" placeholder="Optional"></div></div>
    <label>Notes</label><input name="notes">
    <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Save game</button><button class="btn ghost" type="button" id="g-game-del">Delete</button><button class="btn ghost" type="button" onclick="document.getElementById('dlg-g-game').close()">Cancel</button></p>
  </form>
</div></dialog>
<dialog id="dlg-g-eval" style="max-width:760px"><div class="body">
  <h3 style="margin-top:0" id="g-eval-title">Evaluation</h3>
  <div class="small muted" id="g-eval-sub"></div>
  <form id="form-g-eval">
    <div class="row" id="g-eval-pick"><div><label>Tournament</label><select name="tournament_id"></select></div><div><label>Game</label><select name="game_id"><option value="">Whole tournament</option></select></div></div>
    <div class="row"><div><label>Date</label><input name="evaluated_on" type="date" required></div><div><label>Evaluator</label><input name="evaluator_name" required></div></div>
    <div class="row"><div><label>Source</label><select name="source"><option value="organizer">Tournament organizer</option><option value="observer">NRC observer at the game</option><option value="video">Video review</option><option value="nrc">NRC</option></select></div><div><label>Video link</label><input name="video_url" type="url" placeholder="https://"></div></div>
    <label style="margin-top:12px">Scores</label>
    <p class="small muted" style="margin:0" id="g-eval-scale"></p>
    <div class="score-grid" id="g-eval-scores"></div>
    <label>Strengths</label><textarea name="strengths"></textarea>
    <label>Points to improve</label><textarea name="points_to_improve"></textarea>
    <label>Notes for the NRC</label><textarea name="notes"></textarea>
    <label id="g-eval-share-wrap"><input type="checkbox" name="shared_with_referee" style="width:auto"> Share with the referee</label>
    <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Save evaluation</button><button class="btn ghost" type="button" id="g-eval-del">Delete</button><button class="btn ghost" type="button" onclick="document.getElementById('dlg-g-eval').close()">Cancel</button></p>
  </form>
</div></dialog>`);
    NRC.$("#form-g-game").addEventListener("submit", saveGame);
    NRC.$("#g-game-del").addEventListener("click", deleteGame);
    NRC.$("#form-g-eval").addEventListener("submit", saveEval);
    NRC.$("#g-eval-del").addEventListener("click", deleteEval);
    NRC.$("#form-g-eval").tournament_id.addEventListener("change", (e) => fillGamePick(e.target.value, ""));
  }

  // ---------- panel ----------
  // opts: { tournament, mode: "admin" | "organizer", user, evaluatorName }
  G.mount = async function (el, opts) {
    injectDialogs();
    ctx = Object.assign({ el, games: [], evals: [], officials: [] }, opts);
    el.innerHTML = '<p class="small muted">Loading games.</p>';
    await G.refresh();
  };
  G.refresh = async function () {
    if (!ctx) return;
    const t = ctx.tournament, sb = NRC.sb;
    const [{ data: off }, { data: games, error }, { data: ev }, crit] = await Promise.all([
      sb.from("organizer_designations").select("referee_id,first_name,last_name,role").eq("tournament_id", t.id),
      sb.from("games").select("*").eq("tournament_id", t.id).order("game_date").order("game_time", { nullsFirst: true }),
      ctx.mode === "admin" ? sb.from("observation_reports").select("id,game_id,status,overall,evaluator_name,method").eq("tournament_id", t.id) : Promise.resolve({ data: [] }),
      NRC.loadCriteria()
    ]);
    ctx.ai = {};
    if (ctx.mode === "admin" && (games || []).length) { const { data: al } = await sb.from("game_ai_logs").select("game_id,facts_checked").in("game_id", games.map(g => g.id)); (al || []).forEach(l => ctx.ai[l.game_id] = l); }
    if (error) { ctx.el.innerHTML = '<p class="notice error">Games could not be loaded: ' + esc(error.message) + "</p>"; return; }
    ctx.officials = (off || []).filter(o => o.role === "referee").map(o => ({ id: o.referee_id, name: o.first_name + " " + o.last_name }));
    if (ctx.extraReferees) ctx.extraReferees.forEach(r => { if (!ctx.officials.find(o => o.id === r.id)) ctx.officials.push(r); });
    ctx.games = games || []; ctx.evals = ev || []; ctx.criteria = crit;
    render();
  };
  const refName = (id) => { const o = ctx.officials.find(x => x.id === id); return o ? o.name : (ctx.nameOf ? ctx.nameOf(id) : ""); };
  function render() {
    const t = ctx.tournament, admin = ctx.mode === "admin";
    const repOf = (gid) => ctx.evals.filter(r => r.game_id === gid);
    const cell = (rid) => rid ? esc(refName(rid)) : "";
    const reps = (g) => repOf(g.id).map(r => `<a href="#" onclick="NRC.Report.openView('${r.id}');return false" title="${esc((r.evaluator_name || "") + ", " + (r.method === "live" ? "live" : "video"))}">${r.overall != null ? NRC.scoreHtml(r.overall) : ""} ${NRC.Report.statusPill(r.status)}</a>`).join(" ") + ` <a class="btn sm ghost" href="evaluator.html#game=${g.id}">Write report</a> <button class="btn sm ghost" type="button" onclick="NRC.Games.aiLog('${g.id}')" title="Load the AI log and flagged moments for this game">${ctx.ai && ctx.ai[g.id] ? (ctx.ai[g.id].facts_checked ? "AI log" : "AI log, not reconciled") : "AI log"}</button>`;
    const done = ctx.games.length, evaluated = new Set(ctx.evals.filter(r => r.status !== "draft").map(r => r.game_id)).size;
    ctx.el.innerHTML = `<div class="filterbar"><span class="tag"><strong>${done}</strong> game${done === 1 ? "" : "s"} logged${t.games_expected ? " of " + t.games_expected + " expected" : ""}</span>${admin ? `<span class="tag"><strong>${evaluated}</strong> of ${done} games with an observation report</span><span class="tag"><strong>${ctx.games.filter(g => g.video_url).length}</strong> with video</span>` : ""}<span style="flex:1"></span><button class="btn sm" type="button" onclick="NRC.Games.newGame()">Add a game</button></div>` +
      (ctx.officials.length ? "" : `<p class="small muted">No referee designated on this event yet. ${admin ? "Add them in Designated pairs and travel." : "Games can be logged once the NRC has designated the referees."}</p>`) +
      (done ? `<div class="table-wrap"><table class="gamelog"><thead><tr><th>Date</th><th>Game</th><th>Division</th><th>Score</th><th>Referee A</th><th>Referee B</th>${admin ? "<th>Observation reports</th>" : ""}<th></th></tr></thead><tbody>` +
        ctx.games.map(g => `<tr><td>${NRC.fmtDate(g.game_date)}${g.game_time ? '<div class="small muted">' + String(g.game_time).slice(0, 5) + "</div>" : ""}</td><td>${esc([g.home_team, g.away_team].filter(Boolean).join(" v ")) || '<span class="muted">teams not entered</span>'}${g.game_number ? ' <span class="small muted">#' + esc(g.game_number) + "</span>" : ""}${g.video_url ? ' <a class="small" href="' + esc(g.video_url) + '" target="_blank" rel="noopener">video</a>' : ""}</td><td>${g.division ? esc(NRC.divisionLabel(g.division)) : ""}</td><td>${g.home_score != null && g.away_score != null ? g.home_score + " : " + g.away_score : ""}</td><td>${cell(g.referee_1)}</td><td>${cell(g.referee_2)}</td>${admin ? "<td>" + reps(g) + "</td>" : ""}<td><button class="btn sm ghost" type="button" onclick="NRC.Games.editGame('${g.id}')">Edit</button></td></tr>`).join("") + "</tbody></table></div>"
        : '<p class="small muted">No game logged yet. Add each game with its referee pair and, when there is one, the video or stream link.</p>') +
      `<p class="small muted" style="margin-top:8px">${admin ? "Certified evaluators write one observation report per pair from the game video or live (IHF sheet). Reports are reviewed and released in Referees > Evaluators." : "Log each game with its referee pair and the video or stream link when there is one. Certified NRC evaluators review the referees from the video; organizers evaluate once certified as evaluators."}</p>`;
  }

  G.aiLog = function (id) { const g = ctx.games.find(x => x.id === id); if (g && NRC.AI) NRC.AI.openAdmin(g, () => G.refresh()); };

  // ---------- games ----------
  function divisionOptions(sel) {
    const t = ctx.tournament, codes = (t.divisions && t.divisions.length) ? t.divisions : NRC.DIV_AGES.flatMap(a => NRC.DIV_GENDERS.map(([g]) => a + "-" + g));
    return '<option value="">Not specified</option>' + codes.map(c => `<option value="${c}" ${c === sel ? "selected" : ""}>${esc(NRC.divisionLabel(c))}</option>`).join("");
  }
  function refOptions(sel, allowNone) {
    return (allowNone ? '<option value="">None</option>' : "") + ctx.officials.map(o => `<option value="${o.id}" ${o.id === sel ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  }
  let gameId = null;
  G.newGame = function () {
    if (!ctx.officials.length) { alert("No referee designated on this event yet."); return; }
    gameId = null; const f = NRC.$("#form-g-game"); f.reset();
    const last = ctx.games[ctx.games.length - 1];
    f.game_date.value = last ? last.game_date : (ctx.tournament.start_date <= NRC.localDate() ? ctx.tournament.start_date : NRC.localDate());
    f.division.innerHTML = divisionOptions(last ? last.division : (ctx.tournament.divisions || [])[0]);
    f.referee_1.innerHTML = refOptions(last ? last.referee_1 : (ctx.officials[0] || {}).id, false);
    f.referee_2.innerHTML = refOptions(last ? last.referee_2 : (ctx.officials[1] || {}).id, true);
    NRC.$("#g-game-title").textContent = "Add a game, " + ctx.tournament.name; NRC.$("#g-game-del").classList.add("hidden");
    NRC.$("#dlg-g-game").showModal();
  };
  G.editGame = function (id) {
    const g = ctx.games.find(x => x.id === id); if (!g) return; gameId = id;
    const f = NRC.$("#form-g-game"); f.reset();
    f.division.innerHTML = divisionOptions(g.division);
    f.referee_1.innerHTML = refOptions(g.referee_1, false); f.referee_2.innerHTML = refOptions(g.referee_2, true);
    ["game_date", "game_number", "home_team", "away_team", "home_score", "away_score", "video_url", "court", "notes"].forEach(k => f[k].value = g[k] == null ? "" : g[k]);
    f.game_time.value = g.game_time ? String(g.game_time).slice(0, 5) : "";
    NRC.$("#g-game-title").textContent = "Game, " + ctx.tournament.name; NRC.$("#g-game-del").classList.remove("hidden");
    NRC.$("#dlg-g-game").showModal();
  };
  async function saveGame(e) {
    e.preventDefault(); const f = e.target;
    if (f.referee_2.value && f.referee_2.value === f.referee_1.value) { alert("Referee A and Referee B must be two different people."); return; }
    const num = (v) => v === "" ? null : parseInt(v, 10);
    const row = { tournament_id: ctx.tournament.id, game_date: f.game_date.value, game_time: f.game_time.value || null, division: f.division.value || null, game_number: f.game_number.value.trim() || null, home_team: f.home_team.value.trim() || null, away_team: f.away_team.value.trim() || null, home_score: num(f.home_score.value), away_score: num(f.away_score.value), referee_1: f.referee_1.value || null, referee_2: f.referee_2.value || null, video_url: f.video_url.value.trim() || null, court: f.court.value.trim() || null, notes: f.notes.value.trim() || null };
    const res = gameId ? await NRC.sb.from("games").update(row).eq("id", gameId) : await NRC.sb.from("games").insert({ ...row, entered_by: ctx.user && ctx.user.id });
    if (res.error) { alert("Could not save the game: " + res.error.message); return; }
    NRC.$("#dlg-g-game").close(); await G.refresh(); if (ctx.onChange) ctx.onChange();
  }
  async function deleteGame() {
    if (!gameId || !confirm("Delete this game? Its evaluations stay on file without the game link.")) return;
    const { error } = await NRC.sb.from("games").delete().eq("id", gameId);
    if (error) { alert(error.message); return; }
    NRC.$("#dlg-g-game").close(); await G.refresh(); if (ctx.onChange) ctx.onChange();
  }

  // ---------- evaluations ----------
  // opts for G.openEval: { referee: {id, name}, mode, user, evaluatorName, tournament_id, game_id, eval, tournaments: [{id,name,start_date}], onSaved }
  async function fillGamePick(tid, gid) {
    const f = NRC.$("#form-g-eval"); f.game_id.innerHTML = '<option value="">Whole tournament</option>';
    if (!tid || !evalCtx) return;
    const { data } = await NRC.sb.from("games").select("id,game_date,home_team,away_team,division,referee_1,referee_2").eq("tournament_id", tid).order("game_date");
    (data || []).filter(g => g.referee_1 === evalCtx.referee.id || g.referee_2 === evalCtx.referee.id).forEach(g => f.game_id.insertAdjacentHTML("beforeend", `<option value="${g.id}" ${g.id === gid ? "selected" : ""}>${NRC.fmtDate(g.game_date)}, ${esc([g.home_team, g.away_team].filter(Boolean).join(" v ") || "game")}${g.division ? " (" + esc(NRC.divisionLabel(g.division)) + ")" : ""}</option>`));
  }
  G.openEval = async function (o) {
    injectDialogs(); evalCtx = o; const admin = o.mode === "admin";
    const crit = await NRC.loadCriteria(), e = o.eval || {};
    const f = NRC.$("#form-g-eval"); f.reset();
    NRC.$("#g-eval-title").textContent = (e.id ? "Evaluation, " : "Evaluate ") + o.referee.name;
    NRC.$("#g-eval-sub").textContent = o.subtitle || "";
    // tournament and game: fixed when opened from a game row, picked when opened from the referee record
    const pick = NRC.$("#g-eval-pick"); pick.classList.toggle("hidden", !!o.fixed);
    f.tournament_id.innerHTML = '<option value="">None</option>' + (o.tournaments || []).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
    if (o.fixed) { f.tournament_id.innerHTML = `<option value="${o.tournament_id}">x</option>`; f.game_id.innerHTML = `<option value="${o.game_id || ""}">x</option>`; f.tournament_id.value = o.tournament_id; f.game_id.value = o.game_id || ""; }
    else { f.tournament_id.value = e.tournament_id || o.tournament_id || ""; await fillGamePick(f.tournament_id.value, e.game_id || o.game_id || ""); }
    f.evaluated_on.value = e.evaluated_on || o.date || NRC.localDate();
    f.evaluator_name.value = e.evaluator_name || o.evaluatorName || "";
    f.source.value = e.source || (admin ? "observer" : "organizer");
    NRC.$$("option", f.source).forEach(op => op.hidden = !admin && op.value !== "organizer"); f.source.disabled = !admin;
    f.video_url.value = e.video_url || o.video_url || "";
    ["strengths", "points_to_improve", "notes"].forEach(k => f[k].value = e[k] || "");
    f.shared_with_referee.checked = !!e.shared_with_referee;
    NRC.$("#g-eval-share-wrap").classList.toggle("hidden", !admin);
    const sc = e.scores || {};
    const maxes = [...new Set(crit.map(c => c.scale_max))];
    NRC.$("#g-eval-scale").textContent = maxes.length === 1 ? "1 = well below the standard, " + maxes[0] + " = excellent. Leave n/a when not observed." : "Leave n/a when not observed.";
    NRC.$("#g-eval-scores").innerHTML = crit.map(c => `<div><label title="${esc(c.description || "")}">${esc(c.label)}${c.weight != 1 ? ' <span class="small muted">x' + c.weight + "</span>" : ""}</label><select data-crit="${esc(c.code)}"><option value="">n/a</option>${Array.from({ length: c.scale_max }, (_, i) => i + 1).map(n => `<option ${String(sc[c.code]) === String(n) ? "selected" : ""}>${n}</option>`).join("")}</select>${c.description ? '<div class="small muted">' + esc(c.description) + "</div>" : ""}</div>`).join("") || '<p class="small muted">No criteria defined yet. Set them in Admin > Rankings.</p>';
    NRC.$("#g-eval-del").classList.toggle("hidden", !e.id);
    NRC.$("#dlg-g-eval").showModal();
  };
  G.newEval = function (gid, rid) {
    const g = ctx.games.find(x => x.id === gid);
    G.openEval({ referee: { id: rid, name: refName(rid) }, mode: ctx.mode, user: ctx.user, evaluatorName: ctx.evaluatorName, tournament_id: ctx.tournament.id, game_id: gid, fixed: true, date: g.game_date, video_url: g.video_url, subtitle: ctx.tournament.name + ", " + NRC.fmtDate(g.game_date) + (g.home_team ? ", " + [g.home_team, g.away_team].filter(Boolean).join(" v ") : ""), onSaved: () => { G.refresh(); if (ctx.onChange) ctx.onChange(); } });
  };
  G.editEval = async function (id, o) {
    const { data: e, error } = await NRC.sb.from("evaluations").select("*").eq("id", id).single();
    if (error) { alert(error.message); return; }
    o = o || { mode: ctx.mode, user: ctx.user, fixed: true, tournament_id: e.tournament_id, game_id: e.game_id, subtitle: ctx.tournament.name, onSaved: () => { G.refresh(); if (ctx.onChange) ctx.onChange(); } };
    G.openEval(Object.assign({}, o, { eval: e, referee: o.referee || { id: e.referee_id, name: refName(e.referee_id) } }));
  };
  async function saveEval(ev) {
    ev.preventDefault(); const f = ev.target, o = evalCtx, e = o.eval || {};
    const scores = {}; NRC.$$("#g-eval-scores select[data-crit]").forEach(s => { if (s.value) scores[s.dataset.crit] = parseInt(s.value, 10); });
    if (!Object.keys(scores).length && !confirm("No score entered. Save the comments only?")) return;
    const row = { referee_id: o.referee.id, tournament_id: f.tournament_id.value || null, game_id: f.game_id.value || null, evaluated_on: f.evaluated_on.value, evaluator_name: f.evaluator_name.value.trim(), source: o.mode === "admin" ? f.source.value : "organizer", video_url: f.video_url.value.trim() || null, scores, strengths: f.strengths.value.trim() || null, points_to_improve: f.points_to_improve.value.trim() || null, notes: f.notes.value.trim() || null };
    if (o.mode === "admin") row.shared_with_referee = f.shared_with_referee.checked;
    if (!e.id) row.evaluator_user_id = o.user && o.user.id;
    const res = e.id ? await NRC.sb.from("evaluations").update(row).eq("id", e.id) : await NRC.sb.from("evaluations").insert(row);
    if (res.error) { alert("Could not save the evaluation: " + res.error.message); return; }
    NRC.$("#dlg-g-eval").close(); if (o.onSaved) o.onSaved();
  }
  async function deleteEval() {
    const e = evalCtx && evalCtx.eval; if (!e || !confirm("Delete this evaluation?")) return;
    const { error } = await NRC.sb.from("evaluations").delete().eq("id", e.id);
    if (error) { alert(error.message); return; }
    NRC.$("#dlg-g-eval").close(); if (evalCtx.onSaved) evalCtx.onSaved();
  }
})();
