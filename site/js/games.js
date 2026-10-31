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
    <div class="row"><div><label>Game number</label><input name="game_number" required inputmode="numeric"></div><div><label>Division</label><select name="division"></select></div></div>
    <div class="row"><div><label>Team A</label><input name="home_team" required></div><div><label>Team B</label><input name="away_team" required></div></div>
    <div class="row"><div><label>Team A score</label><input name="home_score" type="number" min="0"></div><div><label>Team B score</label><input name="away_score" type="number" min="0"></div></div>
    <label>Referees</label><select name="pair" required></select>
    <div class="row hidden" id="g-other"><div><label>Referee A</label><select name="referee_1"></select></div><div><label>Referee B</label><select name="referee_2"></select></div></div>
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
    NRC.$("#form-g-game").pair.addEventListener("change", syncPair);
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
    const t = ctx.tournament, sb = NRC.sb, admin = ctx.mode === "admin";
    const [{ data: off }, { data: games, error }, { data: ev }, crit, { data: prs }, { data: evs }] = await Promise.all([
      sb.from("organizer_designations").select("*").eq("tournament_id", t.id),
      sb.from("games").select("*").eq("tournament_id", t.id).order("game_date").order("game_time", { nullsFirst: true }),
      admin ? sb.from("observation_reports").select("id,game_id,status,overall,evaluator_id,evaluator_name,method").eq("tournament_id", t.id) : Promise.resolve({ data: [] }),
      NRC.loadCriteria(),
      sb.from("event_pairs").select("*").eq("tournament_id", t.id),
      admin ? sb.from("evaluators").select("id,first_name,last_name,status,referee_id").in("status", ["certified", "in_training"]).order("first_name") : Promise.resolve({ data: [] })
    ]);
    ctx.ai = {};
    if (admin && (games || []).length) { const { data: al } = await sb.from("game_ai_logs").select("game_id,facts_checked").in("game_id", games.map(g => g.id)); (al || []).forEach(l => ctx.ai[l.game_id] = l); }
    if (error) { ctx.el.innerHTML = '<p class="notice error">Games could not be loaded: ' + esc(error.message) + "</p>"; return; }
    const D = (off || []).filter(o => o.role === "referee");
    ctx.officials = D.filter(o => o.referee_id).map(o => ({ id: o.referee_id, name: o.first_name + " " + o.last_name })).sort((a, b) => a.name.split(" ").pop().localeCompare(b.name.split(" ").pop()));
    ctx.guests = D.filter(o => o.guest_official_id).map(o => ({ id: o.guest_official_id, name: o.first_name + " " + o.last_name }));
    if (ctx.extraReferees) ctx.extraReferees.forEach(r => { if (!ctx.officials.find(o => o.id === r.id)) ctx.officials.push(r); });
    ctx.pairs = (prs || []).sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "usath" ? -1 : 1));
    ctx.evaluators = evs || [];
    ctx.games = (games || []).sort((a, b) => numSort(a.game_number, b.game_number) || String(a.game_date).localeCompare(String(b.game_date)) || String(a.game_time || "").localeCompare(String(b.game_time || "")));
    ctx.evals = ev || []; ctx.criteria = crit;
    render();
  };
  const numSort = (a, b) => { const x = parseInt(a, 10), y = parseInt(b, 10); if (isNaN(x) && isNaN(y)) return 0; if (isNaN(x)) return 1; if (isNaN(y)) return -1; return x - y; };
  const refName = (id) => { const o = ctx.officials.find(x => x.id === id) || (ctx.guests || []).find(x => x.id === id); return o ? o.name : (ctx.nameOf ? ctx.nameOf(id) : ""); };
  const pairKey = (g) => g.guest_official_1 ? "g:" + g.guest_official_1 + ":" + (g.guest_official_2 || "") : g.referee_1 ? "r:" + g.referee_1 + ":" + (g.referee_2 || "") : "";
  const pairOptKey = (p) => p.kind === "organizer" ? "g:" + p.guest_official_1 + ":" + (p.guest_official_2 || "") : "r:" + p.referee_1 + ":" + p.referee_2;
  const sameRefs = (k1, k2) => { if (!k1 || !k2) return false; const a = k1.split(":"), b = k2.split(":"); return a[0] === b[0] && [a[1], a[2]].sort().join() === [b[1], b[2]].sort().join(); };
  // what is still missing on a game: number, teams, pair, score once the game date has passed
  const gaps = (g) => { const m = []; if (!g.game_number) m.push("game number"); if (!g.home_team || !g.away_team) m.push("teams"); if (!g.referee_1 && !g.guest_official_1) m.push("pair"); if (g.game_date < NRC.localDate() && (g.home_score == null || g.away_score == null)) m.push("score"); return m; };
  function render() {
    const t = ctx.tournament, admin = ctx.mode === "admin";
    const repOf = (gid) => ctx.evals.filter(r => r.game_id === gid);
    const person = (rid) => !rid ? "" : admin && window.openRef && ctx.officials.find(o => o.id === rid) ? `<a href="#" class="ref-link" title="Open the referee record" onclick="openRef('${rid}');return false">${esc(refName(rid))}</a>` : esc(refName(rid));
    const pairCell = (g) => { const a = g.referee_1 || g.guest_official_1, b = g.referee_2 || g.guest_official_2; if (!a) return '<span class="pill amber">pair missing</span>'; return person(a) + (b ? " / " + person(b) : "") + (g.guest_official_1 ? ' <span class="pill">organizer pair</span>' : ""); };
    const done = ctx.games.length, evaluated = new Set(ctx.evals.filter(r => r.status !== "draft").map(r => r.game_id)).size;
    const incomplete = ctx.games.filter(g => gaps(g).length), checked = ctx.games.filter(g => g.sheet_check && g.sheet_check.status === "match").length, diff = ctx.games.filter(g => g.sheet_check && g.sheet_check.status === "differs").length;
    const evalCell = (g) => { const R = repOf(g.id); return R.length ? R.map(r => `${r.overall != null ? NRC.scoreHtml(r.overall) : ""} ${NRC.Report.statusPill(r.status)}`).join(" ") : '<span class="muted small">none</span>'; };
    ctx.el.innerHTML = `<div class="filterbar"><span class="tag"><strong>${done}</strong> game${done === 1 ? "" : "s"} recorded${t.games_expected ? " of " + t.games_expected + " expected" : ""}</span>${incomplete.length ? `<span class="tag" style="background:#FFF4D6"><strong>${incomplete.length}</strong> missing information</span>` : ""}${checked || diff ? `<span class="tag"><strong>${checked}</strong> match the score sheet${diff ? `, <strong style="color:var(--red)">${diff}</strong> differ` : ""}</span>` : ""}${admin ? `<span class="tag"><strong>${evaluated}</strong> with an observation report</span>` : ""}<span style="flex:1"></span><button class="btn sm" type="button" onclick="NRC.Games.newGame()" data-tip="Adds one game: number, teams, score and the pair that refereed it.">Add a game</button>${NRC.Sheets ? `<button class="btn sm secondary" type="button" onclick="NRC.Sheets.open()" data-tip="Upload every score sheet of the event at once. The hub reads game number, teams and score from each and compares them with the games recorded here.">Upload score sheets</button>` : ""}</div>` +
      (ctx.officials.length || (ctx.guests || []).length ? "" : `<p class="small muted">No referee designated on this event yet. ${admin ? "Add them in Designated pairs and travel." : "Games can be recorded once the NRC has designated the referees."}</p>`) +
      (incomplete.length ? `<p class="notice amber small" style="margin:8px 0">Every game needs its number, both teams, the pair and, once played, the score, whether or not it is evaluated. ${incomplete.length} game${incomplete.length === 1 ? " is" : "s are"} incomplete.</p>` : "") +
      (done ? `<div class="table-wrap"><table class="gamelog"><thead><tr><th>#</th><th>Date</th><th>Division</th><th>Team A</th><th>Score</th><th>Team B</th><th>Referees</th>${admin ? "<th>Evaluation</th>" : ""}<th></th></tr></thead><tbody>` +
        ctx.games.map(g => { const m = gaps(g), sc = g.sheet_check;
          return `<tr${m.length ? ' style="background:#FFFBEA"' : ""}><td><strong>${esc(g.game_number || "")}</strong></td><td>${NRC.fmtDate(g.game_date)}${g.game_time ? '<div class="small muted">' + String(g.game_time).slice(0, 5) + "</div>" : ""}</td><td class="small">${g.division ? esc(NRC.divisionLabel(g.division)) : ""}</td><td>${esc(g.home_team || "")}</td><td style="white-space:nowrap"><strong>${g.home_score != null && g.away_score != null ? g.home_score + " : " + g.away_score : ""}</strong>${sc ? (sc.status === "match" ? ' <span class="pill green" title="Same as the score sheet">sheet ✓</span>' : sc.status === "differs" ? ` <span class="pill red" title="${esc((sc.diffs || []).join("; "))}">sheet differs</span>` : "") : ""}</td><td>${esc(g.away_team || "")}</td><td class="small">${pairCell(g)}${g.video_url ? ' <a href="' + esc(g.video_url) + '" target="_blank" rel="noopener">video</a>' : ""}${m.length ? '<div class="small" style="color:#8A5A00">Missing: ' + m.join(", ") + "</div>" : ""}</td>${admin ? `<td class="small">${evalCell(g)}</td>` : ""}<td style="white-space:nowrap"><button class="btn sm ghost" type="button" onclick="NRC.Games.editGame('${g.id}')">Edit</button></td></tr>` +
            (admin ? `<tr class="g-eval-row"><td colspan="9" style="padding:0 8px 6px"><details class="g-eval" data-game="${g.id}"><summary class="small"><strong>Evaluation</strong>, IHF Indoor Referee Performance Report${repOf(g.id).length ? " (" + repOf(g.id).length + ")" : ""}</summary><div class="g-eval-body" style="padding:8px 0"></div></details></td></tr>` : ""); }).join("") + "</tbody></table></div>"
        : '<p class="small muted">No game recorded yet. Add each game with its number, the teams, the pair and the score, or upload the score sheets of the event.</p>') +
      `<p class="small muted" style="margin-top:8px">${admin ? "Open Evaluation under a game to fill in the IHF report for its pair. Reports go to Referees > Evaluators for review before the referees see them." : "Record every game: number, teams, the pair from the designated referees and, once played, the score. Certified NRC evaluators review the referees from the video."}</p>`;
    NRC.$$("details.g-eval", ctx.el).forEach(d => d.addEventListener("toggle", () => { if (d.open && !d.dataset.loaded) { d.dataset.loaded = "1"; mountEval(d.querySelector(".g-eval-body"), d.dataset.game); } }));
  }

  // ---------- inline IHF evaluation under a game (admin) ----------
  async function mountEval(el, gid) {
    const g = ctx.games.find(x => x.id === gid); if (!g) return;
    if (!g.referee_1) { el.innerHTML = `<p class="small muted">${g.guest_official_1 ? "Organizer pairs from outside USATH are not evaluated." : "Choose the pair first (Edit), then evaluate."}</p>`; return; }
    const R = ctx.evals.filter(r => r.game_id === gid);
    const evOpts = ctx.evaluators.filter(e => !e.referee_id || ![g.referee_1, g.referee_2].includes(e.referee_id));
    el.innerHTML = `<div class="row" style="align-items:end"><div><label>Evaluator</label><select data-k="ev"><option value="">Choose</option>${evOpts.map(e => `<option value="${e.id}">${esc((e.first_name + " " + (e.last_name || "")).trim())}${e.status !== "certified" ? " (in training)" : ""}</option>`).join("")}</select></div>
      <div class="small muted" style="padding-bottom:8px">${R.length ? "Reports on this game: " + R.map(r => `<a href="#" onclick="NRC.Report.openView('${r.id}');return false">${esc(r.evaluator_name || "evaluator")}</a> ${NRC.Report.statusPill(r.status)}`).join(", ") : "No report on this game yet."} Evaluators are managed in Referees > Evaluators.</div></div>
      <div data-k="form"></div><div data-k="miss" class="notice error hidden"></div>
      <p data-k="acts" class="hidden" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn pos" type="button" data-k="submit" data-tip="Saves the report as submitted. It then waits in Referees > Evaluators for the NRC to release it to the referees.">Submit to the NRC</button><button class="btn ghost" type="button" data-k="draft">Save draft</button>${g.video_url ? `<a class="btn ghost" href="${esc(g.video_url)}" target="_blank" rel="noopener">Open the video</a>` : ""}<button class="btn ghost" type="button" onclick="NRC.Games.aiLog('${g.id}')">AI log</button></p>`;
    const q = (k) => el.querySelector(`[data-k="${k}"]`); let rep = null, items = null;
    q("ev").onchange = async () => {
      const eid = q("ev").value; q("acts").classList.toggle("hidden", !eid); if (!eid) { q("form").innerHTML = ""; return; }
      const ex = R.find(r => r.evaluator_id === eid); rep = null;
      if (ex) { const { data } = await NRC.sb.from("observation_reports").select("*").eq("id", ex.id).single(); rep = data; }
      const names = { referee_1_name: refName(g.referee_1), referee_2_name: refName(g.referee_2) };
      const r = await NRC.Report.render(q("form"), { mode: rep && ["submitted", "released"].includes(rep.status) ? "view" : "report", game: Object.assign({ tournament: ctx.tournament.name, venue_city: ctx.tournament.venue_city, venue_state: ctx.tournament.venue_state }, g, names), value: rep || {} });
      items = r.items; const ro = rep && ["submitted", "released"].includes(rep.status);
      q("acts").classList.toggle("hidden", ro);
      if (ro) q("form").insertAdjacentHTML("afterbegin", `<p class="small muted">This report is ${rep.status}. Review or return it in Referees > Evaluators.</p>`);
    };
    async function save(status) {
      const eid = q("ev").value; if (!eid) return;
      if (status === "submitted") { const miss = NRC.Report.missing(q("form"), items, true); if (miss.length) { NRC.notice(q("miss"), "Missing: " + miss.join(", ") + ".", "error"); return; } }
      const row = Object.assign(NRC.Report.read(q("form")), { game_id: gid, evaluator_id: eid, status, video_url: g.video_url || null });
      if (!rep) row.evaluator_user_id = ctx.user && ctx.user.id;
      const res = rep ? await NRC.sb.from("observation_reports").update(row).eq("id", rep.id).select().single() : await NRC.sb.from("observation_reports").insert(row).select().single();
      if (res.error) { NRC.notice(q("miss"), esc(res.error.message), "error"); return; }
      rep = res.data; NRC.notice(q("miss"), status === "submitted" ? "Report submitted. Release it to the referees in Referees > Evaluators." : "Draft saved.", "ok");
      const { data: ev } = await NRC.sb.from("observation_reports").select("id,game_id,status,overall,evaluator_id,evaluator_name,method").eq("tournament_id", ctx.tournament.id); ctx.evals = ev || [];
      if (status === "submitted") setTimeout(() => render(), 900);
    }
    q("submit").onclick = () => save("submitted"); q("draft").onclick = () => save("draft");
  }

  G.aiLog = function (id) { const g = ctx.games.find(x => x.id === id); if (g && NRC.AI) NRC.AI.openAdmin(g, () => G.refresh()); };
  G.ctx = () => ctx;

  // ---------- games ----------
  function divisionOptions(sel) {
    const t = ctx.tournament, codes = (t.divisions && t.divisions.length) ? t.divisions : NRC.DIV_AGES.flatMap(a => NRC.DIV_GENDERS.map(([g]) => a + "-" + g));
    return '<option value="">Not specified</option>' + codes.map(c => `<option value="${c}" ${c === sel ? "selected" : ""}>${esc(NRC.divisionLabel(c))}</option>`).join("");
  }
  function refOptions(sel, allowNone) {
    return (allowNone ? '<option value="">None</option>' : '<option value="">Choose</option>') + ctx.officials.map(o => `<option value="${o.id}" ${o.id === sel ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  }
  function pairOptions(g) {
    const cur = g ? pairKey(g) : "";
    let found = false;
    const opts = ctx.pairs.map(p => { const k = pairOptKey(p), on = sameRefs(k, cur); if (on) found = true; return `<option value="${k}" ${on ? "selected" : ""}>${esc(p.label)}${p.kind === "organizer" ? " (organizer pair)" : ""}</option>`; }).join("");
    const other = cur && !found && cur.startsWith("r:");
    return '<option value="">Choose the pair</option>' + opts + `<option value="other" ${other ? "selected" : ""}>Two referees not registered as a pair</option>`;
  }
  function syncPair() { const f = NRC.$("#form-g-game"); NRC.$("#g-other").classList.toggle("hidden", f.pair.value !== "other"); }
  let gameId = null;
  function openForm(g) {
    const f = NRC.$("#form-g-game"); f.reset();
    f.division.innerHTML = divisionOptions(g ? g.division : (ctx.tournament.divisions || [])[0]);
    f.pair.innerHTML = pairOptions(g);
    f.referee_1.innerHTML = refOptions(g ? g.referee_1 : null, false); f.referee_2.innerHTML = refOptions(g ? g.referee_2 : null, true);
    syncPair();
  }
  G.newGame = function () {
    if (!ctx.officials.length && !(ctx.guests || []).length) { alert("No referee designated on this event yet."); return; }
    gameId = null; const last = ctx.games[ctx.games.length - 1];
    openForm(null); const f = NRC.$("#form-g-game");
    const T = ctx.tournament, td = NRC.localDate(); f.game_date.value = last ? last.game_date : (td >= T.start_date && td <= (T.end_date || T.start_date) ? td : T.start_date);
    if (last && last.division) f.division.value = last.division;
    const n = ctx.games.map(x => parseInt(x.game_number, 10)).filter(x => !isNaN(x)); f.game_number.value = n.length ? Math.max(...n) + 1 : 1;
    NRC.$("#g-game-title").textContent = "Add a game, " + ctx.tournament.name; NRC.$("#g-game-del").classList.add("hidden");
    NRC.$("#dlg-g-game").showModal();
  };
  G.editGame = function (id) {
    const g = ctx.games.find(x => x.id === id); if (!g) return; gameId = id;
    openForm(g); const f = NRC.$("#form-g-game");
    ["game_date", "game_number", "home_team", "away_team", "home_score", "away_score", "video_url", "court", "notes"].forEach(k => f[k].value = g[k] == null ? "" : g[k]);
    f.game_time.value = g.game_time ? String(g.game_time).slice(0, 5) : "";
    NRC.$("#g-game-title").textContent = "Game, " + ctx.tournament.name; NRC.$("#g-game-del").classList.remove("hidden");
    NRC.$("#dlg-g-game").showModal();
  };
  async function saveGame(e) {
    e.preventDefault(); const f = e.target;
    const num = (v) => v === "" ? null : parseInt(v, 10);
    let r1 = null, r2 = null, g1 = null, g2 = null;
    if (f.pair.value === "other") { r1 = f.referee_1.value || null; r2 = f.referee_2.value || null; if (!r1) { alert("Choose referee A."); return; } if (r2 && r2 === r1) { alert("Referee A and Referee B must be two different people."); return; } }
    else if (f.pair.value) { const [k, a, b] = f.pair.value.split(":"); if (k === "g") { g1 = a || null; g2 = b || null; } else { r1 = a || null; r2 = b || null; } }
    else { alert("Choose the pair that refereed this game."); return; }
    const row = { tournament_id: ctx.tournament.id, game_date: f.game_date.value, game_time: f.game_time.value || null, division: f.division.value || null, game_number: f.game_number.value.trim() || null, home_team: f.home_team.value.trim() || null, away_team: f.away_team.value.trim() || null, home_score: num(f.home_score.value), away_score: num(f.away_score.value), referee_1: r1, referee_2: r2, guest_official_1: g1, guest_official_2: g2, video_url: f.video_url.value.trim() || null, court: f.court.value.trim() || null, notes: f.notes.value.trim() || null };
    if (!row.game_number || !row.home_team || !row.away_team) { alert("Game number and both teams are required."); return; }
    if ((row.home_score == null) !== (row.away_score == null)) { alert("Enter both scores, or neither if the game has not been played."); return; }
    if (row.game_date < NRC.localDate() && row.home_score == null && !confirm("This game is in the past and has no score. Save it without the score for now?")) return;
    const dup = ctx.games.find(x => x.id !== gameId && String(x.game_number) === String(row.game_number)); if (dup && !confirm(`Game ${row.game_number} already exists (${[dup.home_team, dup.away_team].filter(Boolean).join(" v ")}). Save a second game with the same number?`)) return;
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
