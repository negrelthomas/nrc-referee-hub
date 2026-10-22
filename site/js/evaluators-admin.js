/* NRC Referee Hub admin: Evaluators pane (review queue, evaluators, calibration library, settings) */
(function () {
  const $ = NRC.$, esc = NRC.esc, sb = () => NRC.sb;
  const ORIGIN = { referee: "Referee", club_member: "Club member", coach: "Coach", nrc: "NRC", organizer: "Organizer", other: "Other" };
  let evs = [], queue = [], lib = [], refs = {}, clubs = [], S = null, items = [], user = null, curEv = null, curCal = null;

  async function load() {
    const pane = $("#pane-evaluators"); if (!pane) return;
    user = await NRC.currentUser();
    const [o, q, l, r, c, s, it] = await Promise.all([
      sb().from("evaluator_overview").select("*").order("last_name"),
      sb().from("observation_reports").select("id,game_id,tournament_id,evaluator_name,evaluator_club,method,overall,summary,match_type,submitted_at,status,referee_1,referee_2,video_url,games(game_date,home_team,away_team,division),tournaments(name)").in("status", ["submitted", "released", "returned"]).order("submitted_at", { ascending: false }).limit(200),
      sb().from("calibration_games").select("*,calibration_references(rated_by,updated_at,summary)").order("sort").order("created_at"),
      sb().from("referees").select("id,first_name,last_name"),
      sb().from("clubs").select("id,name").order("name"),
      sb().from("evaluator_settings").select("*").eq("id", 1).maybeSingle(),
      NRC.Report.items()
    ]);
    if (o.error) { $("#evx-list").innerHTML = '<p class="notice error">The evaluator module needs the database update evaluator_track.sql.</p>'; return; }
    evs = o.data || []; queue = q.data || []; lib = l.data || []; clubs = c.data || []; S = s.data; items = it;
    refs = Object.fromEntries((r.data || []).map(x => [x.id, x.first_name + " " + x.last_name]));
    render();
  }
  window.loadEvaluatorsAdmin = load;

  function render() {
    const pending = queue.filter(x => x.status === "submitted"), cur = evs.filter(e => e.current), train = evs.filter(e => e.status === "in_training");
    const wk = queue.filter(x => x.submitted_at && x.submitted_at >= new Date(Date.now() - 7 * 864e5).toISOString()).length;
    $("#evx-kpis").innerHTML = `<div class="stat good"><div class="n">${cur.length}</div><div class="l">Certified evaluators</div></div><div class="stat"><div class="n">${train.length}</div><div class="l">In training</div></div><div class="stat ${pending.length ? "bad" : ""}"><div class="n">${pending.length}</div><div class="l">Reports to review</div></div><div class="stat"><div class="n">${wk}</div><div class="l">Reports, last 7 days</div></div>`;
    const nav = $("#nav-evx"); if (nav) { nav.textContent = pending.length; nav.classList.toggle("hidden", !pending.length); }
    // review queue
    const qrow = (x) => `<tr class="clickable" data-rep="${x.id}"><td>${x.games ? NRC.fmtDate(x.games.game_date) : ""}</td><td><strong>${esc(x.tournaments ? x.tournaments.name : "")}</strong><div class="small">${esc(x.games ? [x.games.home_team, x.games.away_team].filter(Boolean).join(" v ") : "")}</div></td><td class="small">${esc(refs[x.referee_1] || "")}${x.referee_2 ? "<br>" + esc(refs[x.referee_2] || "") : ""}</td><td class="small">${esc(x.evaluator_name || "")}<div class="muted">${x.method === "live" ? "live" : "video"}</div></td><td>${x.overall != null ? NRC.scoreHtml(x.overall) : ""}</td><td>${NRC.Report.statusPill(x.status)}</td></tr>`;
    const qf = $("#evx-qfilter").value;
    const ql = queue.filter(x => qf === "all" || x.status === qf);
    $("#evx-queue tbody").innerHTML = ql.map(qrow).join("") || `<tr><td colspan="6" class="small muted">${qf === "submitted" ? "Nothing to review." : "No report."}</td></tr>`;
    NRC.$$("#evx-queue [data-rep]").forEach(tr => tr.onclick = () => openReview(tr.dataset.rep));
    // evaluators
    $("#evx-list tbody").innerHTML = evs.map(e => `<tr class="clickable" data-ev="${e.id}"><td><strong>${esc(e.first_name + " " + e.last_name)}</strong><div class="small muted">${esc(e.email)}</div></td><td class="small">${esc(ORIGIN[e.origin] || e.origin)}${e.referee_level ? "<br>" + esc(NRC.levelLabel(e.referee_level)) : ""}</td><td class="small">${esc(e.club_name || "No club affiliation")}</td><td>${e.status === "suspended" ? '<span class="pill red">Suspended</span>' : e.status === "inactive" ? '<span class="pill">Inactive</span>' : e.current ? '<span class="pill green">Certified</span>' : e.status === "certified" ? '<span class="pill amber">Expired</span>' : '<span class="pill amber">In training</span>'}${e.founding ? ' <span class="pill">Founding</span>' : ""}</td><td class="small">${e.founding ? "n/a" : e.rules_passed_on ? e.rules_pct + "%, to " + NRC.fmtDate(e.rules_valid_until) : e.rules_pct != null ? "best " + e.rules_pct + "%" : "not taken"}</td><td class="small">${e.founding ? "n/a" : e.calibration_passed_on ? e.calibration_pct + "%, to " + NRC.fmtDate(e.calibration_valid_until) : e.calibration_games_done + " of " + (S ? S.calibration_games_required : 3) + (e.calibration_pct != null ? ", " + e.calibration_pct + "%" : "")}</td><td class="small">${e.reports_released} released${e.reports_pending ? ", " + e.reports_pending + " pending" : ""}${e.reports_7d ? '<br><span class="pill green">' + e.reports_7d + " this week</span>" : ""}${e.current && !e.founding && e.reports_released < (S ? S.probation_reports : 2) ? '<br><span class="pill amber">probation</span>' : ""}</td></tr>`).join("") || '<tr><td colspan="7" class="small muted">No evaluator yet.</td></tr>';
    NRC.$$("#evx-list [data-ev]").forEach(tr => tr.onclick = () => openEv(tr.dataset.ev));
    // calibration library
    $("#evx-lib tbody").innerHTML = lib.map(g => { const ref = g.calibration_references; return `<tr><td><strong>${esc(g.title)}</strong>${g.watch_notes ? '<div class="small">' + esc(g.watch_notes) + "</div>" : ""}<a class="small" href="${esc(g.video_url)}" target="_blank" rel="noopener">video</a></td><td>${ref ? '<span class="pill green">rated</span><div class="small muted">' + esc(ref.rated_by || "") + "</div>" : '<span class="pill amber">reference to rate</span>'}</td><td>${g.active ? "yes" : "no"}</td><td style="white-space:nowrap"><button class="btn sm" type="button" data-rate="${g.id}">${ref ? "Edit rating" : "Rate"}</button> <button class="btn sm ghost" type="button" data-cal="${g.id}">Edit</button></td></tr>`; }).join("") || '<tr><td colspan="4" class="small muted">No reference game yet. Add three to eight games of different levels with a video link, then rate each one.</td></tr>';
    NRC.$$("#evx-lib [data-rate]").forEach(b => b.onclick = () => rateRef(b.dataset.rate));
    NRC.$$("#evx-lib [data-cal]").forEach(b => b.onclick = () => openCal(b.dataset.cal));
    const ready = lib.filter(g => g.active && g.calibration_references).length;
    $("#evx-lib-note").textContent = `${ready} rated and active. Candidates need ${S ? S.calibration_games_required : 3}; keep more in the library so a candidate who fails can attempt new games.`;
    // settings
    const f = $("#form-evx-settings"); if (S) Object.keys(S).forEach(k => { if (f[k]) f[k].value = S[k]; });
  }
  $("#evx-qfilter") && $("#evx-qfilter").addEventListener("input", render);

  // ---------- review ----------
  async function openReview(id) {
    await NRC.Report.openView(id, (el, r) => {
      el.innerHTML = `<h3 style="margin-top:16px">NRC review</h3><label>Note to the evaluator (shown when returned)</label><textarea id="rv-note" rows="2">${esc(r.nrc_note || "")}</textarea>
        <p style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${r.status !== "released" ? '<button class="btn" type="button" id="rv-release">Release to the referees</button>' : '<button class="btn ghost" type="button" id="rv-unrelease">Withdraw from the referees</button>'}${r.status !== "returned" ? '<button class="btn ghost" type="button" id="rv-return">Return to the evaluator</button>' : ""}${r.video_url ? '<button class="btn ghost" type="button" id="rv-ref">Use as a calibration reference</button>' : ""}</p>`;
      const upd = async (patch, done) => { const { error } = await sb().from("observation_reports").update(Object.assign({ nrc_note: $("#rv-note").value.trim() || null, reviewed_by: (user && (user.full_name || user.email)) || "NRC", reviewed_at: new Date().toISOString() }, patch)).eq("id", r.id); if (error) { alert(error.message); return; } $("#dlg-rep-view").close(); load(); if (done) done(); };
      const a = $("#rv-release"); if (a) a.onclick = () => upd({ status: "released" });
      const b = $("#rv-unrelease"); if (b) b.onclick = () => upd({ status: "submitted" });
      const c = $("#rv-return"); if (c) c.onclick = () => { if (!$("#rv-note").value.trim()) { alert("Write a note saying what to change."); return; } upd({ status: "returned" }); };
      const d = $("#rv-ref"); if (d) d.onclick = async () => {
        const title = prompt("Title of the reference game", (r.evaluator_name ? "" : "") + "Reference game " + (lib.length + 1)); if (!title) return;
        const { data: g, error } = await sb().from("calibration_games").insert({ title, video_url: r.video_url, game_id: r.game_id, created_by: user.id, sort: lib.length + 1 }).select().single();
        if (error) { alert(error.message); return; }
        const { error: e2 } = await sb().from("calibration_references").upsert({ calibration_game_id: g.id, scores: r.scores, summary: r.summary, match_type: r.match_type, influence: r.influence, positive: r.positive, negative: r.negative, suggestions: r.suggestions, rated_by: r.evaluator_name });
        if (e2) { alert(e2.message); return; }
        $("#dlg-rep-view").close(); load(); alert("Added to the calibration library with this report's ratings as the reference. Check the rating before candidates use it.");
      };
    });
  }

  // ---------- evaluators ----------
  function clubOptions(sel) { return '<option value="">No club affiliation</option>' + clubs.map(c => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join(""); }
  function openEv(id) {
    curEv = id ? evs.find(e => e.id === id) : null; const e = curEv || { origin: "club_member", status: "in_training" };
    const f = $("#form-evx"); f.reset();
    f.club_id.innerHTML = clubOptions(e.club_id);
    ["first_name", "last_name", "email", "phone", "origin", "handball_background", "usath_member_id", "safesport_valid_until", "status", "admin_notes"].forEach(k => f[k].value = e[k] == null ? "" : e[k]);
    f.founding.checked = !!e.founding; f.email.readOnly = !!(curEv && curEv.user_id);
    $("#evx-dlg-title").textContent = curEv ? e.first_name + " " + e.last_name : "Add an evaluator";
    $("#evx-hist").innerHTML = curEv ? "" : '<p class="small muted">The person signs in with this email (magic link) and lands on the evaluator page to take the rules exam and the calibration. Referees can also join from their profile.</p>';
    $("#evx-del").classList.toggle("hidden", !curEv);
    if (curEv) sb().from("evaluator_attempts").select("kind,pct,passed,first_attempt,created_at,calibration_game_id").eq("evaluator_id", id).order("created_at", { ascending: false }).then(({ data }) => {
      $("#evx-hist").innerHTML = '<h3 style="margin-top:14px">Attempts</h3>' + ((data || []).map(a => `<div class="small">${NRC.fmtDate(a.created_at.slice(0, 10))}: ${a.kind === "rules" ? "Rules exam" : "Calibration, " + esc((lib.find(g => g.id === a.calibration_game_id) || {}).title || "game") + (a.first_attempt ? "" : " (practice)")} <strong>${a.pct}%</strong> ${a.passed ? '<span class="pill green">passed</span>' : '<span class="pill red">not passed</span>'}</div>`).join("") || '<div class="small muted">None yet.</div>');
    });
    $("#dlg-evx").showModal();
  }
  window.openEvaluator = openEv;
  $("#form-evx") && $("#form-evx").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const row = { first_name: f.first_name.value.trim(), last_name: f.last_name.value.trim(), email: f.email.value.trim().toLowerCase(), phone: f.phone.value.trim() || null, club_id: f.club_id.value || null, origin: f.origin.value, handball_background: f.handball_background.value.trim() || null, usath_member_id: f.usath_member_id.value.trim() || null, safesport_valid_until: f.safesport_valid_until.value || null, status: f.status.value, founding: f.founding.checked, admin_notes: f.admin_notes.value.trim() || null };
    if (row.founding && row.status === "in_training") row.status = "certified";
    if (row.founding && (!curEv || !curEv.founding)) { row.certified_on = NRC.localDate(); row.certified_by = "NRC, founding evaluator"; }
    const res = curEv ? await sb().from("evaluators").update(row).eq("id", curEv.id) : await sb().from("evaluators").insert(row);
    if (res.error) { alert(res.error.message.includes("evaluators_email_uq") ? "An evaluator with this email already exists." : res.error.message); return; }
    $("#dlg-evx").close(); load();
  });
  $("#evx-del") && $("#evx-del").addEventListener("click", async () => {
    if (!curEv || !confirm("Remove this evaluator? Their reports stay on file. Use status Inactive to keep the record.")) return;
    const { error } = await sb().from("evaluators").delete().eq("id", curEv.id); if (error) { alert(error.message); return; }
    $("#dlg-evx").close(); load();
  });

  // ---------- calibration library ----------
  function openCal(id) {
    curCal = id ? lib.find(g => g.id === id) : null; const g = curCal || { active: true, sort: lib.length + 1 };
    const f = $("#form-evx-cal"); f.reset();
    ["title", "video_url", "watch_notes", "sort"].forEach(k => f[k].value = g[k] == null ? "" : g[k]);
    f.division.innerHTML = '<option value="">Not specified</option>' + NRC.DIV_AGES.flatMap(a => NRC.DIV_GENDERS.map(([x]) => a + "-" + x)).map(c => `<option value="${c}" ${c === g.division ? "selected" : ""}>${esc(NRC.divisionLabel(c))}</option>`).join("");
    f.active.checked = !!g.active; $("#evx-cal-del").classList.toggle("hidden", !curCal);
    $("#dlg-evx-cal").showModal();
  }
  window.openCalGame = openCal;
  $("#form-evx-cal") && $("#form-evx-cal").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const row = { title: f.title.value.trim(), video_url: f.video_url.value.trim(), division: f.division.value || null, watch_notes: f.watch_notes.value.trim() || null, sort: parseInt(f.sort.value || "0", 10), active: f.active.checked };
    const res = curCal ? await sb().from("calibration_games").update(row).eq("id", curCal.id) : await sb().from("calibration_games").insert(Object.assign(row, { created_by: user.id })).select().single();
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-evx-cal").close(); await load(); if (!curCal && res.data) rateRef(res.data.id);
  });
  $("#evx-cal-del") && $("#evx-cal-del").addEventListener("click", async () => {
    if (!curCal || !confirm("Delete this reference game? Candidates' attempts stay on file.")) return;
    const { error } = await sb().from("calibration_games").delete().eq("id", curCal.id); if (error) { alert(error.message); return; }
    $("#dlg-evx-cal").close(); load();
  });
  async function rateRef(id) {
    const g = lib.find(x => x.id === id); if (!g) return;
    const { data: ref } = await sb().from("calibration_references").select("*").eq("calibration_game_id", id).maybeSingle();
    $("#evx-ref-title").textContent = "Reference rating, " + g.title;
    $("#evx-ref-video").innerHTML = `<a href="${esc(g.video_url)}" target="_blank" rel="noopener">Open the video</a>${g.watch_notes ? " &middot; " + esc(g.watch_notes) : ""}`;
    const box = $("#evx-ref-form");
    await NRC.Report.render(box, { mode: "reference", items, value: ref || {} });
    $("#evx-ref-save").onclick = async () => {
      const miss = NRC.Report.missing(box, items, false); if (miss.length) { alert("Missing: " + miss.join(", ")); return; }
      const v = NRC.Report.read(box);
      const { error } = await sb().from("calibration_references").upsert({ calibration_game_id: id, scores: v.scores, summary: v.summary, match_type: v.match_type, influence: v.influence, positive: v.positive, negative: v.negative, suggestions: v.suggestions, rated_by: (user && (user.full_name || user.email)) || "NRC", updated_at: new Date().toISOString() });
      if (error) { alert(error.message); return; }
      $("#dlg-evx-ref").close(); load();
    };
    $("#dlg-evx-ref").showModal();
  }

  // ---------- settings ----------
  $("#form-evx-settings") && $("#form-evx-settings").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target, row = { updated_at: new Date().toISOString() };
    ["rules_question_count", "rules_pass_pct", "rules_time_limit_minutes", "calibration_pass_pct", "calibration_tolerance", "calibration_games_required", "rules_valid_months", "calibration_valid_months", "probation_reports", "report_due_days", "weekly_target"].forEach(k => row[k] = parseInt(f[k].value, 10));
    row.rules_max_difficulty = f.rules_max_difficulty.value;
    const { error } = await sb().from("evaluator_settings").update(row).eq("id", 1); if (error) { alert(error.message); return; }
    NRC.notice($("#evx-set-msg"), "Saved.", "ok"); load();
  });

  document.addEventListener("DOMContentLoaded", () => { setTimeout(load, 300); });
})();
