/* Admin area */
(function () {
  const $ = NRC.$, sb = () => NRC.sb;
  let user, clubs = [], refs = [], tournaments = [], questions = [], cov = [], sessions = [], inquiries = [], pstat = [], psettings = null, ctest = null, staffing = [], currentRef = null, contacts = [], clubMsgs = [];
  const today = () => new Date().toISOString().slice(0, 10);
  const CRIT = [["score_rules_application", "Rules application"], ["score_game_management", "Game management"], ["score_progressive_punishment", "Progressive punishment"], ["score_positioning", "Positioning"], ["score_pair_cooperation", "Pair cooperation"], ["score_communication", "Communication"]];
  const SANCTION = { usath: "USATH", regional: "Regional", club: "Club", international: "International" };
  const PROG = { none: "Not started", nominated: "Nominated", mentor_assigned: "Mentor assigned", in_training: "In training", observed: "Observed", certified_pair: "Certified pair" };

  // ---------- routing ----------
  function route() {
    const [h, arg] = (location.hash || "#dashboard").slice(1).split("/");
    const pane = h === "club" ? "clubs" : h === "referee" ? "referees" : h;
    NRC.$$(".admin-nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + pane));
    NRC.$$("#panes > div").forEach(p => p.classList.toggle("hidden", p.id !== "pane-" + pane));
    if (h === "referee" && arg && refs.length) openRefFromLink(arg);
    if (h === "club" && arg && clubs.length) renderClubPage(arg);
    window.scrollTo(0, 0);
  }
  // admin/index.html#referee/<id> (Edit profile on the public Referees page) opens the editor once
  function openRefFromLink(id) { history.replaceState(null, "", "#referees"); openRef(id); }
  window.addEventListener("hashchange", route);
  // <base href="../"> makes "#pane" links resolve to the site root; keep them on this page
  document.addEventListener("click", e => { const a = e.target.closest('a[href^="#"]'); if (!a || a.getAttribute("href") === "#" || a.onclick) return; e.preventDefault(); location.hash = a.getAttribute("href"); });

  // ---------- load ----------
  async function loadAll() {
    const [c, r, t, q, v, ts, inq, ps, pse, ct, st] = await Promise.all([
      sb().from("clubs").select("*").order("name"),
      sb().from("referees").select("*").order("last_name"),
      sb().from("tournaments").select("*").order("start_date", { ascending: false }),
      sb().from("quiz_questions").select("*").order("rule_number").order("created_at"),
      sb().from("club_coverage").select("*"),
      sb().from("training_sessions").select("*").order("starts_at", { ascending: false }),
      sb().from("referee_inquiries").select("*").order("created_at", { ascending: false }),
      sb().from("referee_program_status").select("*").order("last_name"),
      sb().from("program_settings").select("*").eq("id", 1).maybeSingle(),
      sb().from("certification_tests").select("*").eq("level", "level_1").maybeSingle(),
      sb().from("tournament_staffing").select("*").order("start_date")
    ]);
    staffing = (st && st.data) || [];
    inquiries = (inq && inq.data) || []; pstat = (ps && ps.data) || []; psettings = (pse && pse.data) || null; ctest = (ct && ct.data) || null;
    clubs = c.data || []; refs = r.data || []; tournaments = t.data || []; questions = q.data || []; cov = v.data || []; sessions = ts.data || [];
    // stats per referee
    const [{ data: cc }, { data: cm }] = await Promise.all([sb().from("club_contacts").select("*").order("is_primary", { ascending: false }).order("name"), sb().from("club_messages").select("*").order("created_at", { ascending: false })]);
    contacts = cc || []; clubMsgs = cm || [];
    const { data: stats } = await sb().from("referee_season_stats").select("*");
    const { data: evals } = await sb().from("evaluations").select("referee_id,evaluated_on").order("evaluated_on", { ascending: false });
    const yr = new Date().getFullYear();
    refs.forEach(r => { r._games = (stats || []).filter(s => s.referee_id === r.id && s.season === yr).reduce((a, s) => a + s.games, 0); const e = (evals || []).find(e => e.referee_id === r.id); r._lastEval = e ? e.evaluated_on : null; });
    fillSelects(); renderDashboard(); renderPoolRules(); renderRefs(); renderClubs(); renderTournaments(); renderQuestions(); renderSessions(); renderInquiries(); renderPrograms(); renderStaffing(); renderPlan(); loadTasks(); loadImportLog();
    const [h, arg] = (location.hash || "").slice(1).split("/"); if (h === "club" && arg) renderClubPage(arg);
    if (h === "referee" && arg) openRefFromLink(arg);
  }
  function fillSelects() {
    NRC.$$("select[name=club_id]").forEach(s => { s.innerHTML = '<option value="">No club</option>' + clubs.map(c => `<option value="${c.id}">${NRC.esc(c.name)}</option>`).join(""); });
    NRC.$$("select[name=tournament_id]").forEach(s => { s.innerHTML = '<option value="">None</option>' + tournaments.map(t => `<option value="${t.id}">${NRC.esc(t.name)} (${NRC.fmtDate(t.start_date)})</option>`).join(""); });
    const rs = Object.keys(NRC.RULES).map(r => `<option value="${r}">Rule ${r}: ${NRC.RULES[r]}</option>`).join("");
    $("#q-rule").innerHTML = '<option value="">All rules</option>' + rs; $("select[name=rule_number]").innerHTML = rs;
  }

  // ---------- dashboard ----------
  function renderDashboard() {
    const active = refs.filter(r => r.active);
    $("#k-refs").textContent = active.length;
    $("#k-certified").textContent = active.filter(r => r.cert_level !== "candidate").length;
    $("#k-noclub").textContent = cov.filter(c => c.referee_count == 0).length;
    $("#k-pairs").textContent = cov.filter(c => c.has_certified_pair).length;
    const newInq = inquiries.filter(i => i.status === "new").length;
    $("#k-inq").textContent = newInq; const nb = $("#nav-inq"); nb.textContent = newInq; nb.classList.toggle("hidden", !newInq);
    const cert = pstat.filter(p => p.cert_level !== "candidate");
    $("#k-nobase").textContent = cert.filter(p => !p.baseline_at).length;
    $("#k-inprog").textContent = pstat.filter(p => p.program_status === "active" || p.program_status === "ready_for_retest").length;
    $("#k-overdue").textContent = pstat.filter(p => (p.program_status === "active" || p.program_status === "ready_for_retest") && p.due_on < today()).length;
    $("#cov tbody").innerHTML = cov.slice().sort((a, b) => a.referee_count - b.referee_count || a.name.localeCompare(b.name)).map(c => `<tr><td><a href="#club/${c.id}"><strong>${NRC.esc(c.name)}</strong></a></td><td>${NRC.esc([c.city, c.state].filter(Boolean).join(", "))}</td><td>${c.referee_count}</td><td>${c.certified_count}</td><td>${c.has_certified_pair ? '<span class="pill green">Yes</span>' : '<span class="pill red">No</span>'}</td><td>${PROG[c.pair_program_status] || ""}</td></tr>`).join("");
    const t = today();
    const bad = active.filter(r => [r.usath_membership_valid_until, r.safesport_valid_until, r.background_check_valid_until].some(d => !d || d < t));
    const cell = d => !d ? '<span class="pill amber">missing</span>' : d < t ? '<span class="pill red">' + NRC.fmtDate(d) + '</span>' : '<span class="pill green">' + NRC.fmtDate(d) + '</span>';
    $("#compl tbody").innerHTML = bad.map(r => `<tr><td><a href="#" onclick="openRef('${r.id}');return false">${NRC.esc(r.first_name + " " + r.last_name)}</a></td><td>${NRC.levelPill(r.cert_level)}</td><td>${cell(r.usath_membership_valid_until)}</td><td>${cell(r.safesport_valid_until)}</td><td>${cell(r.background_check_valid_until)}</td></tr>`).join("") || '<tr><td colspan="5">Everyone is current.</td></tr>';
  }

  async function renderPoolRules() {
    const { data: ans } = await sb().from("quiz_answers").select("correct,quiz_questions(rule_number)");
    const m = {}; (ans || []).forEach(a => { const k = a.quiz_questions && a.quiz_questions.rule_number; if (k == null) return; m[k] = m[k] || { n: 0, c: 0 }; m[k].n++; if (a.correct) m[k].c++; });
    $("#pool-rules tbody").innerHTML = Object.keys(m).map(Number).sort((a, b) => m[a].c / m[a].n - m[b].c / m[b].n).slice(0, 8).map(r => { const pct = Math.round(m[r].c / m[r].n * 100); return `<tr><td>Rule ${r}: ${NRC.esc(NRC.RULES[r] || "")}</td><td>${m[r].n}</td><td><span class="pill ${pct >= 80 ? "green" : pct >= 70 ? "amber" : "red"}">${pct}%</span></td></tr>`; }).join("") || '<tr><td colspan="3">No quiz answers yet.</td></tr>';
  }

  // ---------- tasks ----------
  async function loadTasks() {
    const { data } = await sb().from("admin_tasks").select("*").is("completed_at", null).order("due_on");
    const t = today();
    const open = (data || []);
    $("#tasks").innerHTML = open.map(x => `<div class="task ${x.due_on && x.due_on <= t ? "overdue" : ""}"><div style="flex:1"><div class="t">${NRC.esc(x.title)} ${x.due_on ? `<span class="small muted">due ${NRC.fmtDate(x.due_on)}</span>` : ""}</div><div class="small">${NRC.esc(x.description || "")}</div></div>${x.key === "sport80_import" ? '<a class="btn sm" href="#imports">Go to import</a>' : `<button class="btn sm ghost" onclick="completeTask('${x.id}')">Done</button>`}</div>`).join("") || '<div class="notice ok">No open tasks.</div>';
  }
  window.completeTask = async function (id) { await sb().from("admin_tasks").update({ completed_at: new Date().toISOString() }).eq("id", id); loadTasks(); };
  async function rollRecurring(key) {
    const { data } = await sb().from("admin_tasks").select("*").eq("key", key).maybeSingle();
    if (!data) return;
    const next = new Date(); next.setDate(next.getDate() + (data.recurrence_days || 30));
    await sb().from("admin_tasks").update({ completed_at: null, due_on: next.toISOString().slice(0, 10) }).eq("id", data.id);
  }

  // ---------- referees ----------
  function renderRefs() {
    const q = $("#r-q").value.toLowerCase(), l = $("#r-level").value, inc = $("#r-inactive").checked;
    const club = id => (clubs.find(c => c.id === id) || {}).name || "";
    $("#refs tbody").innerHTML = refs.filter(r => (inc || r.active) && (!l || r.cert_level === l) && (!q || [r.first_name, r.last_name, r.email, club(r.club_id), r.home_city, r.home_state, r.home_airport_iata].join(" ").toLowerCase().includes(q)))
      .map(r => `<tr class="clickable" onclick="openRef('${r.id}')"><td><img class="avatar" src="${r.photo_url ? NRC.esc(r.photo_url) : "assets/avatar.svg"}" alt=""></td><td><strong>${NRC.esc(r.first_name + " " + r.last_name)}</strong>${r.active ? "" : ' <span class="pill">inactive</span>'}<br><span class="small muted">${NRC.esc(r.email)}</span></td><td>${NRC.levelPill(r.cert_level, r.level_confirmed)}${r.level1_theory_passed_on ? ' <span class="pill green">theory passed ' + NRC.fmtDate(r.level1_theory_passed_on) + "</span>" : ""}</td><td>${NRC.esc(club(r.club_id))}</td><td>${NRC.esc([r.home_city, r.home_state].filter(Boolean).join(", "))}</td><td>${NRC.esc(r.home_airport_iata || "")}${r.departure_airport_iata ? " / " + NRC.esc(r.departure_airport_iata) : ""}</td><td>${r._games}</td><td>${r._lastEval ? NRC.fmtDate(r._lastEval) : '<span class="muted">none</span>'}</td><td><button class="btn sm ghost" onclick="event.stopPropagation();openRef('${r.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="9">No referee yet. Add one or import.</td></tr>';
  }
  ["#r-q", "#r-level", "#r-inactive"].forEach(s => $(s).addEventListener("input", renderRefs));
  window.exportCsv = function () {
    const cols = ["first_name", "last_name", "email", "phone", "cert_level", "cert_date", "home_city", "home_state", "home_airport_iata", "departure_airport_iata", "usath_member_id", "usath_membership_valid_until", "safesport_valid_until", "background_check_valid_until", "active"];
    const club = id => (clubs.find(c => c.id === id) || {}).name || "";
    const esc = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lines = [["club", ...cols, "games_this_season", "last_evaluation"].join(",")].concat(refs.map(r => [esc(club(r.club_id)), ...cols.map(c => esc(r[c])), r._games, esc(r._lastEval)].join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "nrc-referees-" + today() + ".csv"; a.click();
  };
  window.openRef = async function (id) {
    currentRef = id ? refs.find(r => r.id === id) : null;
    const f = $("#form-ref"); f.reset();
    $("#dlg-ref-title").textContent = currentRef ? currentRef.first_name + " " + currentRef.last_name : "New referee";
    ["#btn-eval", "#btn-game", "#btn-phys", "#btn-theory"].forEach(b => $(b).classList.toggle("hidden", !currentRef));
    if (id && !currentRef) { alert("Referee not found."); return; }
    $("#ref-photo").src = (currentRef && currentRef.photo_url) || "assets/avatar.svg";
    $("#ref-photo-remove").classList.toggle("hidden", !(currentRef && currentRef.photo_url));
    if (currentRef) { Object.keys(currentRef).forEach(k => { if (f[k] && f[k].type !== "checkbox" && f[k].type !== "file") f[k].value = currentRef[k] == null ? "" : currentRef[k]; }); f.active.checked = currentRef.active; if (f.level_confirmed) f.level_confirmed.checked = currentRef.level_confirmed !== false; }
    // history
    const ex = $("#ref-extra"); ex.innerHTML = "";
    if (currentRef) {
      const { data: ev } = await sb().from("evaluations").select("*").eq("referee_id", currentRef.id).order("evaluated_on", { ascending: false });
      const { data: certs } = await sb().from("certifications").select("*").eq("referee_id", currentRef.id).order("obtained_on", { ascending: false });
      const { data: hist } = await sb().from("referee_tournament_history").select("*").eq("referee_id", currentRef.id).order("start_date", { ascending: false });
      let training = "";
      if (currentRef.user_id) {
        const { data: ans } = await sb().from("quiz_answers").select("correct,quiz_questions(rule_number),quiz_attempts!inner(user_id)").eq("quiz_attempts.user_id", currentRef.user_id);
        const m = {}; (ans || []).forEach(a => { const k = a.quiz_questions && a.quiz_questions.rule_number; if (k == null) return; m[k] = m[k] || { n: 0, c: 0 }; m[k].n++; if (a.correct) m[k].c++; });
        const tot = (ans || []).length, ok = (ans || []).filter(a => a.correct).length;
        const weak = Object.keys(m).map(Number).filter(r => m[r].n >= 3 && m[r].c / m[r].n < .7).sort((a, b) => m[a].c / m[a].n - m[b].c / m[b].n);
        training = tot ? `${tot} questions answered, ${Math.round(ok / tot * 100)}% correct. ` + (weak.length ? "Weak rules: " + weak.map(r => `Rule ${r} (${Math.round(m[r].c / m[r].n * 100)}%)`).join(", ") + "." : "No rule below 70%.") : "No training activity yet.";
      } else training = "Has not signed in yet.";
      const [L, { data: tests }] = await Promise.all([NRC.latestEvals(currentRef.id, currentRef.user_id), sb().from("referee_tests").select("*").eq("referee_id", currentRef.id).order("tested_on", { ascending: false })]);
      ex.innerHTML = `<h3 style="margin-top:16px">Latest evaluations</h3>` + NRC.latestEvalsHtml(L)
        + `<h3 style="margin-top:16px">Tournaments</h3>` + NRC.historyHtml(hist) + '<div class="small muted">Add or correct from Tournaments > Open > Officiated.</div>'
        + `<h3 style="margin-top:16px">Physical tests and theory exams</h3>` + ((tests || []).map(t => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${NRC.fmtDate(t.tested_on)}</strong>, ${t.kind === "physical" ? "Physical" : "Theory"}: ${NRC.esc(t.test_name)}${t.result ? " " + NRC.esc(t.result) : ""}${t.passed === true ? ' <span class="pill green">passed</span>' : t.passed === false ? ' <span class="pill red">not passed</span>' : ""}${t.evaluator_name ? ", " + NRC.esc(t.evaluator_name) : ""} <a href="#" onclick="delTest('${t.id}');return false" class="muted">remove</a></div>`).join("") || '<div class="small muted">None recorded.</div>')
        + `<h3 style="margin-top:16px">Training</h3><div class="small">${training}</div>`
        + `<h3 style="margin-top:16px">Certification history</h3>` + ((certs || []).map(c => `<div class="small">${NRC.fmtDate(c.obtained_on)}: ${NRC.levelLabel(c.level)}${c.certified_by ? ", by " + NRC.esc(c.certified_by) : ""}${c.event ? ", " + NRC.esc(c.event) : ""}</div>`).join("") || '<div class="small muted">No history. Saving a level change adds a row.</div>')
        + `<h3 style="margin-top:16px">Evaluations</h3>` + ((ev || []).map(e => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${NRC.fmtDate(e.evaluated_on)}</strong>, ${NRC.esc(e.evaluator_name)}: ${CRIT.map(([k]) => e[k] || "-").join(" / ")}${e.points_to_improve ? "<br>Improve: " + NRC.esc(e.points_to_improve) : ""}${e.shared_with_referee ? ' <span class="pill green">shared</span>' : ""}</div>`).join("") || '<div class="small muted">None yet.</div>');
    }
    if (!$("#dlg-ref").open) $("#dlg-ref").showModal();
  };
  $("#form-ref").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = {};
    ["first_name", "last_name", "email", "phone", "club_id", "cert_level", "cert_date", "cert_by", "home_city", "home_state", "home_airport_iata", "departure_airport_iata", "usath_member_id", "usath_membership_valid_until", "safesport_valid_until", "background_check_valid_until", "admin_notes"].forEach(k => row[k] = f[k].value.trim() || null);
    row.active = f.active.checked; row.level_confirmed = f.level_confirmed ? f.level_confirmed.checked : true; row.updated_at = new Date().toISOString();
    ["home_state", "home_airport_iata", "departure_airport_iata"].forEach(k => { if (row[k]) row[k] = row[k].toUpperCase(); });
    let res;
    if (currentRef) res = await sb().from("referees").update(row).eq("id", currentRef.id).select().single();
    else res = await sb().from("referees").insert(row).select().single();
    if (res.error) { alert("Save failed: " + res.error.message); return; }
    const file = f.photo.files[0];
    if (file) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase(), path = `${res.data.id}/photo-${Date.now()}.${ext}`;
      const up = await sb().storage.from("referee-photos").upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) alert("Profile saved, photo upload failed: " + up.error.message);
      else await sb().from("referees").update({ photo_url: sb().storage.from("referee-photos").getPublicUrl(path).data.publicUrl }).eq("id", res.data.id);
    } else if (f.remove_photo.checked) await sb().from("referees").update({ photo_url: null }).eq("id", res.data.id);
    if (!currentRef || currentRef.cert_level !== row.cert_level) await sb().from("certifications").insert({ referee_id: res.data.id, level: row.cert_level, obtained_on: row.cert_date || today(), certified_by: row.cert_by });
    if (!currentRef) alert("Referee added. " + row.email + " can now sign in on the Sign in page with a magic link; send them the site address.");
    $("#dlg-ref").close(); loadAll();
  });

  // physical test or in person theory exam
  window.openTest = function (kind) {
    const f = $("#form-test"); f.reset(); f.kind.value = kind; f.tested_on.value = today();
    $("#dlg-test-title").textContent = (kind === "physical" ? "Physical test" : "Theory exam") + ", " + currentRef.first_name + " " + currentRef.last_name;
    $("#dlg-test").showModal();
  };
  $("#form-test").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const row = { referee_id: currentRef.id, kind: f.kind.value, tested_on: f.tested_on.value, test_name: f.test_name.value.trim(), result: f.result.value.trim() || null, passed: f.passed.value === "" ? null : f.passed.value === "true", evaluator_name: f.evaluator_name.value.trim() || null, notes: f.notes.value.trim() || null, shared_with_referee: f.shared_with_referee.checked, entered_by: user.id };
    const { error } = await sb().from("referee_tests").insert(row);
    if (error) { alert("Save failed: " + error.message); return; }
    $("#dlg-test").close(); openRef(currentRef.id);
  });
  window.delTest = async function (id) { if (!confirm("Remove this test record?")) return; await sb().from("referee_tests").delete().eq("id", id); openRef(currentRef.id); };

  // evaluation
  window.openEval = function () {
    const f = $("#form-eval"); f.reset(); f.evaluated_on.value = today();
    $("#eval-scores").innerHTML = CRIT.map(([k, l]) => `<div><label>${l} (1 to 5)</label><select name="${k}"><option value="">n/a</option>${[1, 2, 3, 4, 5].map(n => `<option>${n}</option>`).join("")}</select></div>`).join("");
    $("#dlg-eval").showModal();
  };
  $("#form-eval").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = { referee_id: currentRef.id, evaluator_user_id: user.id, evaluated_on: f.evaluated_on.value, evaluator_name: f.evaluator_name.value, tournament_id: f.tournament_id.value || null, strengths: f.strengths.value || null, points_to_improve: f.points_to_improve.value || null, notes: f.notes.value || null, shared_with_referee: f.shared_with_referee.checked };
    CRIT.forEach(([k]) => row[k] = f[k].value ? parseInt(f[k].value, 10) : null);
    const { error } = await sb().from("evaluations").insert(row);
    if (error) { alert(error.message); return; }
    $("#dlg-eval").close(); openRef(currentRef.id); loadAll();
  });

  // game
  window.openGame = function () {
    const f = $("#form-game"); f.reset(); f.game_date.value = today();
    f.referee_2.innerHTML = '<option value="">None</option>' + refs.filter(r => r.id !== currentRef.id && r.active).map(r => `<option value="${r.id}">${NRC.esc(r.first_name + " " + r.last_name)}</option>`).join("");
    $("#dlg-game").showModal();
  };
  $("#form-game").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const row = { game_date: f.game_date.value, tournament_id: f.tournament_id.value || null, home_team: f.home_team.value || null, away_team: f.away_team.value || null, category: f.category.value, referee_1: currentRef.id, referee_2: f.referee_2.value || null, entered_by: user.id };
    const file = f.sheet.files[0];
    if (file) { const path = `${row.game_date}/${Date.now()}-${file.name.replace(/[^a-z0-9.]+/gi, "-")}`; const up = await sb().storage.from("game-sheets").upload(path, file); if (!up.error) row.game_sheet_url = path; }
    const { error } = await sb().from("games").insert(row);
    if (error) { alert(error.message); return; }
    $("#dlg-game").close(); loadAll();
  });

  // ---------- clubs ----------
  let currentClub = null;
  window.openClub = function (id) {
    currentClub = id ? clubs.find(c => c.id === id) : null; const f = $("#form-club"); f.reset();
    if (currentClub) { Object.keys(currentClub).forEach(k => { if (f[k] && f[k].type !== "checkbox") f[k].value = currentClub[k] == null ? "" : currentClub[k]; }); f.active.checked = currentClub.active; }
    $("#dlg-club").showModal();
  };
  $("#form-club").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = {};
    ["name", "club_type", "website", "city", "state", "nearest_airport_iata", "pair_program_status", "pair_program_notes"].forEach(k => row[k] = f[k].value.trim() || null);
    row.active = f.active.checked; if (row.state) row.state = row.state.toUpperCase(); if (row.nearest_airport_iata) row.nearest_airport_iata = row.nearest_airport_iata.toUpperCase();
    const res = currentClub ? await sb().from("clubs").update(row).eq("id", currentClub.id) : await sb().from("clubs").insert(row);
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-club").close(); loadAll();
  });

  // ---------- clubs: list, club page, contacts, messages, action plan ----------
  const CTYPE = { adult: "Adult", collegiate_men: "Collegiate (M)", collegiate_women: "Collegiate (W)", youth: "Youth" };
  const CERT = ["level_1", "level_2", "level_3", "nachc", "ihf"];
  const AFF = { member: "Member", volunteer: "Volunteer", none: "No club" };
  const normClub = s => String(s || "").toLowerCase().replace(/\b(thc|hc|wthc|team handball( club)?|handball( club)?|club)\b/g, "").replace(/[^a-z0-9]/g, "");
  const clubName = id => (clubs.find(c => c.id === id) || {}).name || "";
  // inquiry belongs to a club when it was picked from the list, or when the free text matches the club name
  const inqClub = i => i.club_id || (i.club_name && (clubs.find(c => { const a = normClub(c.name), b = normClub(i.club_name); return a && b && (a === b || (b.length > 3 && a.includes(b)) || (a.length > 3 && b.includes(a))); }) || {}).id) || null;
  function clubStats(c) {
    const r = refs.filter(x => x.club_id === c.id && x.active);
    const certified = r.filter(x => CERT.includes(x.cert_level));
    const candidates = r.filter(x => x.cert_level === "candidate");
    const progOpen = pstat.filter(p => r.some(x => x.id === p.referee_id) && p.cert_level !== "candidate" && ["active", "ready_for_retest"].includes(p.program_status));
    const ct = contacts.filter(x => x.club_id === c.id);
    const emails = ct.filter(x => x.email && x.receives_messages).map(x => x.email.toLowerCase());
    const inq = inquiries.filter(i => inqClub(i) === c.id && i.status !== "closed");
    const tours = tournaments.filter(t => t.club_id === c.id || (!t.club_id && ct.some(x => x.email && x.email.toLowerCase() === (t.organizer_email || "").toLowerCase())));
    const cv = cov.find(x => x.id === c.id) || {};
    return { refs: r, certified, candidates, progOpen, contacts: ct, emails, inq, prospects: inq.filter(i => ["new", "contacted"].includes(i.status)), tours, upcoming: tours.filter(t => t.end_date >= today() && t.status !== "cancelled"), pair: !!cv.has_certified_pair };
  }

  // list
  let clubFilter = "all"; const clubSel = new Set();
  NRC.$$("#club-filter .chip").forEach(ch => ch.onclick = () => { NRC.$$("#club-filter .chip").forEach(x => x.classList.remove("on")); ch.classList.add("on"); clubFilter = ch.dataset.v; renderClubs(); });
  function shownClubs() {
    const q = ($("#c-q").value || "").toLowerCase();
    return clubs.filter(c => c.active).map(c => ({ c, s: clubStats(c) })).filter(({ c, s }) =>
      (!q || [c.name, c.city, c.state].join(" ").toLowerCase().includes(q)) &&
      ({ all: true, noref: !s.refs.length, nopair: !s.pair, training: s.candidates.length > 0, host: s.tours.length > 0, adult: c.club_type === "adult" || c.club_type === "youth", college: c.club_type.startsWith("collegiate"), nocontact: !s.emails.length })[clubFilter]);
  }
  function renderClubs() {
    const list = shownClubs();
    $("#clubs tbody").innerHTML = list.map(({ c, s }) => `<tr><td><input type="checkbox" style="width:auto" ${clubSel.has(c.id) ? "checked" : ""} onchange="toggleClubSel('${c.id}',this.checked)"></td><td><a href="#club/${c.id}"><strong>${NRC.esc(c.name)}</strong></a><br><span class="small muted">${CTYPE[c.club_type] || ""}</span></td><td class="small">${NRC.esc([c.city, c.state].filter(Boolean).join(", "))}</td><td>${s.refs.length || '<span class="pill red">0</span>'}</td><td>${s.certified.length}${s.pair ? ' <span class="pill green">pair</span>' : ""}</td><td>${s.candidates.length || ""}</td><td>${s.prospects.length ? '<span class="pill amber">' + s.prospects.length + " new</span>" : s.inq.length || ""}</td><td>${s.tours.length ? s.tours.length + (s.upcoming.length ? ' <span class="pill">' + s.upcoming.length + " upcoming</span>" : "") : ""}</td><td class="small">${PROG[c.pair_program_status]}</td><td>${s.emails.length ? s.emails.length : '<span class="pill amber">none</span>'}</td><td><a class="btn sm ghost" href="#club/${c.id}">Open</a></td></tr>`).join("") || '<tr><td colspan="11">No club matches.</td></tr>';
    $("#club-all").checked = list.length > 0 && list.every(({ c }) => clubSel.has(c.id));
    const b = $("#btn-club-email"); b.disabled = !clubSel.size; b.textContent = clubSel.size ? `Email selected (${clubSel.size})` : "Email selected";
  }
  window.toggleClubSel = (id, on) => { on ? clubSel.add(id) : clubSel.delete(id); renderClubs(); };
  $("#club-all").addEventListener("change", e => { shownClubs().forEach(({ c }) => e.target.checked ? clubSel.add(c.id) : clubSel.delete(c.id)); renderClubs(); });
  $("#c-q").addEventListener("input", renderClubs);
  window.emailSelectedClubs = () => openComposer([...clubSel], "general");

  // club page
  window.currentClubPage = null;
  function renderClubPage(id) {
    const c = clubs.find(x => x.id === id); if (!c) { $("#cp-name").textContent = "Club not found"; return; }
    window.currentClubPage = id; const s = clubStats(c);
    $("#cp-name").textContent = c.name;
    $("#cp-sub").innerHTML = [CTYPE[c.club_type], [c.city, c.state].filter(Boolean).join(", "), c.nearest_airport_iata ? "airport " + c.nearest_airport_iata : "", c.website ? `<a href="${NRC.esc(c.website)}" target="_blank" rel="noopener">website</a>` : ""].filter(Boolean).map(x => x.startsWith("<a") ? x : NRC.esc(x)).join(" · ");
    $("#cp-refs").textContent = s.refs.length; $("#cp-cert").textContent = s.certified.length; $("#cp-train").textContent = s.candidates.length; $("#cp-tour").textContent = s.tours.length;
    $("#cp-actions").innerHTML = clubActions(c, s).map(a => `<div class="task"><div style="flex:1"><div class="t">${NRC.esc(a.title)}</div><div class="small">${NRC.esc(a.why)}</div></div>${a.template ? `<button class="btn sm" onclick="openComposer(['${c.id}'],'${a.template}')">Prepare message</button>` : a.href ? `<a class="btn sm ghost" href="${a.href}">Open</a>` : ""}</div>`).join("") || '<div class="notice ok">Nothing pending for this club.</div>';
    $("#cp-contacts").innerHTML = s.contacts.map(x => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><div><strong>${NRC.esc(x.name || "No name")}</strong>${x.is_primary ? ' <span class="pill green">primary</span>' : ""}${x.receives_messages ? "" : ' <span class="pill">no messages</span>'}<br>${NRC.esc(x.role || "")}${x.email ? ` <a href="mailto:${NRC.esc(x.email)}">${NRC.esc(x.email)}</a>` : ""}${x.phone ? " · " + NRC.esc(x.phone) : ""}${x.source ? `<br><span class="muted">${NRC.esc(x.source)}</span>` : ""}</div><button class="btn sm ghost" style="align-self:flex-start" onclick="openContact('${x.id}')">Edit</button></div>`).join("") || '<span class="muted">No contact on file. Add one to message this club.</span>';
    $("#cp-pair").innerHTML = `<p style="margin-top:0"><span class="pill ${s.pair ? "green" : c.pair_program_status === "none" ? "red" : "amber"}">${PROG[c.pair_program_status]}</span>${s.pair ? ' <span class="pill green">certified pair on the roster</span>' : ""}</p>${c.pair_program_notes ? "<p>" + NRC.esc(c.pair_program_notes) + "</p>" : '<p class="muted">No notes. Update the status and notes with Edit club.</p>'}`;
    const prog = id => { const p = pstat.find(x => x.referee_id === id); if (!p) return ""; const r = refs.find(x => x.id === id);
      if (r.cert_level === "candidate") return r.level1_theory_passed_on ? '<span class="pill green">theory passed</span>' : p.user_id ? '<span class="pill amber">Level 1 course</span>' : '<span class="pill">not signed in yet</span>';
      if (!p.baseline_at) return '<span class="pill red">no baseline</span>';
      return p.program_status === "cleared" ? '<span class="pill green">cleared</span>' : p.program_status ? '<span class="pill amber">program ' + (p.due_on < today() ? "overdue" : "due " + NRC.fmtDate(p.due_on)) + "</span>" : ""; };
    $("#cp-reftable tbody").innerHTML = s.refs.map(r => `<tr><td><strong>${NRC.esc(r.first_name + " " + r.last_name)}</strong></td><td>${NRC.levelPill(r.cert_level, r.level_confirmed)}</td><td>${prog(r.id)}</td><td>${r._games || ""}</td><td>${r._lastEval ? NRC.fmtDate(r._lastEval) : '<span class="muted">none</span>'}</td><td><button class="btn sm ghost" onclick="openRef('${r.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="6">No referee from this club on the roster.</td></tr>';
    $("#cp-inq tbody").innerHTML = inquiries.filter(i => inqClub(i) === c.id).map(i => `<tr><td class="small">${NRC.fmtDate(i.created_at)}</td><td><strong>${NRC.esc(i.first_name + " " + i.last_name)}</strong><br><a class="small" href="mailto:${NRC.esc(i.email)}">${NRC.esc(i.email)}</a></td><td>${i.club_affiliation ? '<span class="pill">' + AFF[i.club_affiliation] + "</span>" : '<span class="muted small">not asked</span>'}</td><td class="small">${NRC.esc(i.background || "")}</td><td class="small">${NRC.esc(i.status)}</td><td><button class="btn sm ghost" onclick="inviteFromInquiry('${i.id}')">Add to roster</button></td></tr>`).join("") || '<tr><td colspan="6">No contact request names this club.</td></tr>';
    $("#cp-tours tbody").innerHTML = s.tours.map(t => `<tr><td><strong>${NRC.esc(t.name)}</strong><br><span class="small muted">${NRC.esc(t.organizer_name)}</span></td><td>${NRC.fmtDate(t.start_date)}</td><td>${t.pairs_needed}</td><td><span class="pill">${NRC.esc(t.status)}</span></td><td><button class="btn sm ghost" onclick="openTour('${t.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="5">No tournament request from this club.</td></tr>';
    $("#cp-msgs tbody").innerHTML = clubMsgs.filter(m => (m.club_ids || []).includes(c.id)).map(m => `<tr><td class="small">${NRC.fmtDate(m.created_at)}</td><td>${NRC.esc(m.subject)}</td><td class="small">${m.club_ids.length > 1 ? "Group of " + m.club_ids.length + " clubs" : "This club"}, ${m.sent} email(s)</td></tr>`).join("") || '<tr><td colspan="3">Nothing sent yet.</td></tr>';
  }

  // contacts
  let currentContact = null;
  window.openContact = function (id) {
    currentContact = id ? contacts.find(x => x.id === id) : null; const f = $("#form-cc"); f.reset();
    if (currentContact) { ["name", "role", "email", "phone", "notes"].forEach(k => f[k].value = currentContact[k] || ""); f.is_primary.checked = currentContact.is_primary; f.receives_messages.checked = currentContact.receives_messages; }
    $("#btn-cc-delete").classList.toggle("hidden", !currentContact); $("#dlg-cc").showModal();
  };
  $("#form-cc").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = {};
    ["name", "role", "email", "phone", "notes"].forEach(k => row[k] = f[k].value.trim() || null);
    if (!row.email && !row.phone) { alert("Enter an email or a phone number."); return; }
    if (row.email) row.email = row.email.toLowerCase();
    row.is_primary = f.is_primary.checked; row.receives_messages = f.receives_messages.checked;
    if (row.is_primary) await sb().from("club_contacts").update({ is_primary: false }).eq("club_id", window.currentClubPage);
    const res = currentContact ? await sb().from("club_contacts").update(row).eq("id", currentContact.id) : await sb().from("club_contacts").insert({ ...row, club_id: window.currentClubPage, source: "Added by " + (user.email || "admin") });
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-cc").close(); loadAll();
  });
  $("#btn-cc-delete").addEventListener("click", async () => {
    if (!currentContact || !confirm("Delete this contact?")) return;
    const res = await sb().from("club_contacts").delete().eq("id", currentContact.id); if (res.error) { alert(res.error.message); return; }
    $("#dlg-cc").close(); loadAll();
  });

  // message templates
  const SIGN = "\n\nNational Referee Committee\nUSA Team Handball\n{contact_email}";
  const TEMPLATES = {
    general: { label: "Blank message", subject: "Refereeing at {club}", body: "Hi {first_name},\n\n" + SIGN },
    nominate: { label: "No referee yet: nominate two members", subject: "Two referees for {club}", body: "Hi {first_name},\n\nThe National Referee Committee is working toward one certified referee pair in every USATH club. {club} has no referee on our roster today.\n\nWe would like {club} to nominate two members to train together as a pair this season. The Level 1 theory course is online and free on the NRC Referee Hub; the NRC then runs the practical part, ideally at a tournament your club attends. A club pair also means your own events rely less on referees travelling in.\n\nCould you send us the names and emails of two members who would be interested, or forward this message to them? They can register directly here: {hub_url}" + SIGN },
    college: { label: "Collegiate program with no referee", subject: "Referees from {club}", body: "Hi {first_name},\n\nThe National Referee Committee is building a referee pool in collegiate handball. {club} has no referee on our roster today.\n\nCollegiate Nationals and regional events depend on referees travelling in. Two players or staff from your program trained to Level 1 could officiate your scrimmages and help staff collegiate events. The Level 1 theory course is online and free, and fits around a semester; the NRC runs the practical part at a tournament.\n\nCould you share this with your team and send us the names of anyone interested? They can also register here: {hub_url}" + SIGN },
    pair_partner: { label: "One certified referee: find a partner", subject: "A second referee for {club}", body: "Hi {first_name},\n\n{club} has {certified} certified referee(s) on our roster. Referees are designated to tournaments in pairs, so a second trained referee at the club would make a big difference for your members and for the events you attend.\n\nIs there a member who would train alongside your current referee this season? Your referee can mentor them, the NRC provides the online Level 1 course and runs the practical part.\n\nPlease send us a name, or point them to {hub_url}" + SIGN },
    host: { label: "Hosting a tournament without local referees", subject: "Referees for your tournament and for {club}", body: "Hi {first_name},\n\nThank you for your referee request. {club} has {certified} certified referee(s) on our roster today, so the referees for your event will mostly travel in, with the flights and hotel nights that implies.\n\nWe propose to train two to four of your members ahead of the event: the Level 1 theory online on the NRC Referee Hub, and the practical part during your tournament alongside the designated referees. Your next events would then start with local referees.\n\nCould you tell us which members would take part? They can register here: {hub_url}" + SIGN },
    prospect: { label: "Prospects from the club asked to referee", subject: "Referee candidates from {club}", body: "Hi {first_name},\n\n{prospects} person(s) who list {club} as their club asked the NRC about becoming a referee. We are contacting them directly.\n\nCandidates progress much faster when their club backs them: time at practice to whistle scrimmages, a club member to pair with, and an active USATH membership through the club. Could you tell us who at {club} they should talk to, and whether the club can support them this season?" + SIGN },
    clinic: { label: "Regional clinic proposal", subject: "Referee clinic for clubs in {state}", body: "Hi {first_name},\n\nThe National Referee Committee is considering a referee clinic for the clubs in {state}. None of the clubs in the area has a certified referee pair today, and a shared clinic is the fastest way to change that.\n\nThe format would be one day: rules session, signals and positioning, then refereeing live games. Candidates complete the online Level 1 theory beforehand on the NRC Referee Hub.\n\nWould {club} send members, and could the club host? Please tell us which weekends work and how many members might attend." + SIGN },
    mentor: { label: "Club with a certified pair: mentor others", subject: "Your referees and the clubs near you", body: "Hi {first_name},\n\n{club} has a certified referee pair on our roster ({certified} certified referees). Thank you for the work behind it.\n\nWe are asking clubs in this position two things for this season: whether your referees would mentor a candidate from a nearby club, and whether {club} could host a practical session where candidates referee live games under supervision. Let us know what is possible." + SIGN }
  };
  $("#msg-template").innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");

  // composer
  let msgClubs = [];
  const varsFor = (c, ct) => { const s = clubStats(c); return { club: c.name, first_name: ct && ct.name ? ct.name.split(" ")[0] : "there", referees: s.refs.length, certified: s.certified.length, in_training: s.candidates.length, pair_status: (PROG[c.pair_program_status] || "").toLowerCase(), prospects: s.prospects.length, state: c.state || "your state", hub_url: location.origin + "/become-a-referee.html", contact_email: NRC_CONFIG.CONTACT_EMAIL }; };
  const fillT = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? String(v[k]) : m);
  function msgPreview() {
    const f = $("#form-msg"); const c = clubs.find(x => x.id === msgClubs.find(id => clubStats(clubs.find(y => y.id === id)).emails.length)) || clubs.find(x => x.id === msgClubs[0]); if (!c) return;
    const ct = clubStats(c).contacts.find(x => x.email && x.receives_messages);
    const v = varsFor(c, ct);
    $("#msg-preview").innerHTML = `<div class="muted" style="margin-bottom:6px">Preview for ${NRC.esc(c.name)}${ct ? ", to " + NRC.esc(ct.email) : ""}</div><strong>${NRC.esc(fillT(f.subject.value, v))}</strong>\n\n${NRC.esc(fillT(f.body.value, v))}`;
  }
  window.openComposer = function (ids, template) {
    msgClubs = ids.filter(Boolean); if (!msgClubs.length) { alert("Select at least one club."); return; }
    const withMail = msgClubs.filter(id => clubStats(clubs.find(c => c.id === id)).emails.length);
    const nRecipients = withMail.reduce((a, id) => a + clubStats(clubs.find(c => c.id === id)).emails.length, 0);
    const without = msgClubs.filter(id => !withMail.includes(id)).map(clubName);
    $("#msg-to").innerHTML = `<p style="margin-top:0"><strong>To:</strong> ${withMail.map(id => NRC.esc(clubName(id))).join(", ") || "nobody"} (${nRecipients} contact${nRecipients === 1 ? "" : "s"})</p>${without.length ? `<div class="notice">${without.length} club(s) have no contact on file and will be skipped: ${without.map(NRC.esc).join(", ")}.</div>` : ""}`;
    const f = $("#form-msg"); f.template.value = template || "general"; f.subject.value = TEMPLATES[f.template.value].subject; f.body.value = TEMPLATES[f.template.value].body;
    $("#btn-msg-send").disabled = !nRecipients; $("#btn-msg-send").textContent = nRecipients ? `Send to ${nRecipients} contact${nRecipients === 1 ? "" : "s"}` : "Send";
    msgPreview(); $("#dlg-msg").showModal();
  };
  window.emailClub = () => openComposer([window.currentClubPage], "general");
  $("#msg-template").addEventListener("change", () => { const f = $("#form-msg"), t = TEMPLATES[f.template.value]; f.subject.value = t.subject; f.body.value = t.body; msgPreview(); });
  ["subject", "body"].forEach(n => $("#form-msg")[n].addEventListener("input", msgPreview));
  window.copyClubEmails = async function () {
    const list = [...new Set(msgClubs.flatMap(id => clubStats(clubs.find(c => c.id === id)).emails))];
    try { await navigator.clipboard.writeText(list.join(", ")); alert(list.length + " address(es) copied."); } catch (e) { prompt("Copy the addresses:", list.join(", ")); }
  };
  window.sendClubMessage = async function (test) {
    const f = $("#form-msg");
    if (!f.subject.value.trim() || !f.body.value.trim()) { alert("Subject and message are required."); return; }
    if (!test && !confirm("Send this message now? Each contact receives their own email.")) return;
    const { data: sess } = await sb().auth.getSession();
    const res = await fetch("/api/club-message", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ club_ids: msgClubs, subject: f.subject.value, body: f.body.value, template: f.template.value, test: !!test }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { alert("Failed: " + (d.error || res.status)); return; }
    const sent = d.results.filter(r => r.sent).length, failed = d.results.filter(r => !r.sent);
    alert(test ? (sent ? "Test sent to " + d.results[0].email + "." : "Test not sent: " + (failed[0] && failed[0].error)) : sent + " email(s) sent." + (failed.length ? " Not sent: " + failed.map(r => (r.email || r.club) + " (" + String(r.error || "").slice(0, 60) + ")").join("; ") : ""));
    if (!test) { $("#dlg-msg").close(); clubSel.clear(); loadAll(); }
  };
  $("#form-msg").addEventListener("submit", e => { e.preventDefault(); sendClubMessage(false); });

  // action plan, in priority order
  function planActions() {
    const act = clubs.filter(c => c.active).map(c => ({ c, s: clubStats(c) }));
    const ids = arr => arr.map(x => x.c.id);
    const out = [];
    const prospects = act.filter(x => x.s.prospects.length);
    const orphanInq = inquiries.filter(i => ["new", "contacted"].includes(i.status) && !inqClub(i));
    if (prospects.length) out.push({ title: "Introduce new prospects to their club", why: `${prospects.reduce((a, x) => a + x.s.prospects.length, 0)} open contact request(s) name a club. Ask each club to back its candidates (practice time, a partner, membership).`, clubs: ids(prospects), template: "prospect" });
    if (orphanInq.length) out.push({ title: "Answer contact requests with no club", why: `${orphanInq.length} prospect(s) have no club. Point them to the nearest club or a clinic.`, href: "#inquiries" });
    const hosts = act.filter(x => x.s.upcoming.length && x.s.certified.length < 2);
    if (hosts.length) out.push({ title: "Train local referees at clubs hosting a tournament", why: `${hosts.length} club(s) requested referees for an upcoming event without a local pair. Propose a Level 1 course with the practical at their event.`, clubs: ids(hosts), template: "host" });
    const one = act.filter(x => x.s.certified.length === 1 && !x.s.pair);
    if (one.length) out.push({ title: "Find a partner for clubs with one certified referee", why: `${one.length} club(s) are one referee away from a pair.`, clubs: ids(one), template: "pair_partner" });
    const two = act.filter(x => x.s.certified.length >= 2 && !x.s.pair);
    if (two.length) out.push({ title: "Record pairs where two certified referees already exist", why: `${two.length} club(s) have two or more certified referees but no pair on record. Confirm they work together and record the pair.`, clubs: ids(two) });
    const cand = refs.filter(r => r.active && r.cert_level === "candidate" && !r.level1_theory_passed_on);
    if (cand.length) out.push({ title: "Move candidates through the Level 1 course", why: `${cand.length} candidate(s) have not passed the Level 1 theory. Check progress and schedule the practical for those who passed.`, href: "#programs" });
    const noneAdult = act.filter(x => !x.s.refs.length && !x.c.club_type.startsWith("collegiate"));
    if (noneAdult.length) out.push({ title: "Ask clubs with no referee to nominate two members", why: `${noneAdult.length} club(s) have no referee on the roster.`, clubs: ids(noneAdult), template: "nominate" });
    const noneCollege = act.filter(x => !x.s.refs.length && x.c.club_type.startsWith("collegiate"));
    if (noneCollege.length) out.push({ title: "Recruit student referees in collegiate programs", why: `${noneCollege.length} collegiate program(s) have no referee on the roster.`, clubs: ids(noneCollege), template: "college" });
    const byState = {}; act.forEach(x => { if (x.c.state) (byState[x.c.state] = byState[x.c.state] || []).push(x); });
    const regions = Object.entries(byState).filter(([, l]) => l.length >= 2 && !l.some(x => x.s.pair)).sort((a, b) => b[1].length - a[1].length);
    if (regions.length) out.push({ title: "Propose regional clinics where several clubs share a state", why: `${regions.map(([st, l]) => st + " (" + l.length + ")").join(", ")}: clubs with no certified pair in the state. One clinic per state covers them all; each club receives its own state in the message.`, clubs: regions.flatMap(([, l]) => ids(l)), template: "clinic" });
    const noContact = act.filter(x => !x.s.emails.length);
    if (noContact.length) out.push({ title: "Find a contact for clubs with none on file", why: `${noContact.length} club(s) cannot be messaged from the hub.`, clubs: ids(noContact), href: "#clubs" });
    const mentors = act.filter(x => x.s.pair);
    if (mentors.length) out.push({ title: "Ask clubs with a certified pair to mentor nearby clubs", why: `${mentors.length} club(s) have a certified pair.`, clubs: ids(mentors), template: "mentor" });
    return out;
  }
  function clubActions(c, s) {
    const a = [];
    if (s.prospects.length) a.push({ title: `${s.prospects.length} prospect(s) from the club`, why: "Ask the club to back them.", template: "prospect" });
    if (s.upcoming.length && s.certified.length < 2) a.push({ title: "Hosting without a local pair", why: `${s.upcoming.length} upcoming request(s), ${s.certified.length} certified referee(s).`, template: "host" });
    if (s.certified.length === 1 && !s.pair) a.push({ title: "One referee away from a pair", why: "Find a partner who trains alongside the current referee.", template: "pair_partner" });
    if (s.certified.length >= 2 && !s.pair) a.push({ title: "Record the pair", why: "Two certified referees, no pair on record." });
    if (!s.refs.length) a.push({ title: "No referee yet", why: "Ask the club to nominate two members.", template: c.club_type.startsWith("collegiate") ? "college" : "nominate" });
    if (!s.emails.length) a.push({ title: "No contact on file", why: "Add a contact to message this club." });
    return a;
  }
  function renderPlan() {
    const chip = id => `<a class="chip" href="#club/${id}">${NRC.esc(clubName(id))}</a>`;
    $("#plan").innerHTML = planActions().map((a, i) => `<div class="task"><div class="pill" style="min-width:28px;text-align:center">${i + 1}</div><div style="flex:1;min-width:0"><div class="t">${NRC.esc(a.title)}</div><div class="small">${NRC.esc(a.why)}</div>${a.clubs ? `<div class="chips" style="margin:6px 0 0">${a.clubs.slice(0, 8).map(chip).join("")}${a.clubs.length > 8 ? `<span class="chip" onclick="this.parentNode.innerHTML=${NRC.esc(JSON.stringify(a.clubs.map(chip).join("")))}">+${a.clubs.length - 8} more</span>` : ""}</div>` : ""}</div>${a.template ? `<button class="btn sm" onclick='openComposer(${JSON.stringify(a.clubs)},"${a.template}")'>Prepare message</button>` : a.href ? `<a class="btn sm ghost" href="${a.href}">Open</a>` : ""}</div>`).join("") || '<div class="notice ok">No action pending.</div>';
  }

  // ---------- training sessions ----------
  const STYPE = { online: "Online", in_person: "In person", course: "Certification course" };
  const fmtWhen = (iso, tz) => { if (!iso) return ""; const d = new Date(iso); tz = tz || "America/Los_Angeles"; return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }); };
  function renderSessions() {
    const now = Date.now();
    $("#sessions-admin tbody").innerHTML = sessions.map(t => `<tr${new Date(t.starts_at).getTime() < now ? ' class="muted"' : ""}><td><strong>${NRC.esc(t.title)}</strong></td><td>${STYPE[t.session_type] || NRC.esc(t.session_type)}</td><td>${NRC.esc(fmtWhen(t.starts_at, t.timezone))}</td><td>${NRC.esc(t.location || "")}</td><td>${NRC.esc(t.audience || "")}</td><td>${t.published ? "Yes" : "No"}</td><td><button class="btn sm ghost" onclick="openSession('${t.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="7">No sessions yet. Add the next clinic or online rule session.</td></tr>';
  }
  // datetime-local works in wall clock time of the chosen zone; convert with a fixed offset lookup
  const toLocalInput = (iso, tz) => { if (!iso) return ""; const d = new Date(iso); const p = new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {}); return `${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}`; };
  const fromLocalInput = (v, tz) => { if (!v) return null; const guess = new Date(v + ":00Z"); const asTz = new Date(toLocalInput(guess.toISOString(), tz) + ":00Z"); return new Date(guess.getTime() - (asTz.getTime() - guess.getTime())).toISOString(); };
  let currentSession = null;
  window.openSession = function (id) {
    currentSession = id ? sessions.find(t => t.id === id) : null; const f = $("#form-session"); f.reset();
    if (currentSession) { ["title", "session_type", "audience", "timezone", "location", "description", "registration_url"].forEach(k => { if (f[k]) f[k].value = currentSession[k] == null ? "" : currentSession[k]; }); f.starts_at.value = toLocalInput(currentSession.starts_at, currentSession.timezone); f.ends_at.value = toLocalInput(currentSession.ends_at, currentSession.timezone); f.published.checked = currentSession.published; }
    $("#btn-session-delete").classList.toggle("hidden", !currentSession);
    $("#dlg-session").showModal();
  };
  $("#form-session").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = {};
    ["title", "session_type", "audience", "timezone", "location", "description", "registration_url"].forEach(k => row[k] = f[k].value.trim() || null);
    row.starts_at = fromLocalInput(f.starts_at.value, row.timezone); row.ends_at = fromLocalInput(f.ends_at.value, row.timezone); row.published = f.published.checked;
    const res = currentSession ? await sb().from("training_sessions").update(row).eq("id", currentSession.id) : await sb().from("training_sessions").insert(row);
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-session").close(); loadAll();
  });
  $("#btn-session-delete").addEventListener("click", async () => {
    if (!currentSession || !confirm("Delete this session?")) return;
    const res = await sb().from("training_sessions").delete().eq("id", currentSession.id);
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-session").close(); loadAll();
  });

  // ---------- inquiries ----------
  function renderInquiries() {
    const ST = ["new", "contacted", "invited", "closed"];
    $("#inq tbody").innerHTML = inquiries.map(i => `<tr><td class="small">${NRC.fmtDate(i.created_at)}</td><td><strong>${NRC.esc(i.first_name + " " + i.last_name)}</strong></td><td class="small"><a href="mailto:${NRC.esc(i.email)}">${NRC.esc(i.email)}</a>${i.phone ? "<br>" + NRC.esc(i.phone) : ""}</td><td class="small">${NRC.esc([i.city, i.state].filter(Boolean).join(", "))}</td><td class="small">${NRC.esc(i.club_name || "")}</td><td class="small">${inqClub(i) ? `<a href="#club/${inqClub(i)}">${NRC.esc(clubName(inqClub(i)))}</a>` : ""}${i.club_affiliation ? '<br><span class="pill">' + AFF[i.club_affiliation] + "</span>" : ""}</td><td class="small">${NRC.esc(i.background || "")}</td><td class="small">${NRC.esc(i.availability || "")}</td><td class="small">${NRC.esc(i.message || "")}</td><td><select onchange="setInqStatus('${i.id}',this.value)">${ST.map(x => `<option ${x === i.status ? "selected" : ""}>${x}</option>`).join("")}</select></td><td><button class="btn sm ghost" onclick="inviteFromInquiry('${i.id}')">Add to roster</button></td></tr>`).join("") || '<tr><td colspan="11">No contact requests yet.</td></tr>';
  }
  window.setInqStatus = async function (id, status) { const res = await sb().from("referee_inquiries").update({ status }).eq("id", id); if (res.error) alert(res.error.message); else loadAll(); };
  window.inviteFromInquiry = function (id) {
    const i = inquiries.find(x => x.id === id); if (!i) return;
    openRef(null); const f = $("#form-ref");
    if (f) { f.first_name.value = i.first_name; f.last_name.value = i.last_name; f.email.value = i.email; if (f.phone) f.phone.value = i.phone || ""; if (f.home_city) f.home_city.value = i.city || ""; if (f.home_state) f.home_state.value = i.state || ""; if (f.cert_level) f.cert_level.value = "candidate"; if (f.club_id && inqClub(i)) f.club_id.value = inqClub(i); }
    sb().from("referee_inquiries").update({ status: "invited" }).eq("id", id).then(() => {});
  };

  // ---------- programs ----------
  function renderPrograms() {
    const PS = { active: "In progress", ready_for_retest: "Ready for re-test", cleared: "Cleared", expired: "Replaced" };
    $("#pstat tbody").innerHTML = pstat.map(p => `<tr><td><strong>${NRC.esc(p.first_name + " " + p.last_name)}</strong></td><td>${NRC.levelPill(p.cert_level)}</td><td>${p.user_id ? "Yes" : '<span class="muted">not yet</span>'}</td><td>${p.cert_level === "candidate" ? '<span class="muted">Level 1 course</span>' : p.baseline_at ? NRC.fmtDate(p.baseline_at) : '<span class="pill red">missing</span>'}</td><td>${p.last_pct != null ? p.last_pct + "%" : ""}</td><td>${p.program_status ? (p.program_status === "cleared" ? '<span class="pill green">Cleared</span>' : p.program_status === "active" && p.due_on < today() ? '<span class="pill red">Overdue</span>' : '<span class="pill amber">' + PS[p.program_status] + "</span>") : ""}</td><td>${p.modules_total ? p.modules_done + "/" + p.modules_total : ""}</td><td>${p.due_on && p.program_status !== "cleared" ? NRC.fmtDate(p.due_on) : ""}</td></tr>`).join("") || '<tr><td colspan="8">No referees on the roster yet.</td></tr>';
    if (psettings) { const f = $("#form-ps"); Object.keys(psettings).forEach(k => { if (f[k]) f[k].value = psettings[k]; }); }
    if (ctest) { const f = $("#form-ct"); Object.keys(ctest).forEach(k => { if (f[k]) f[k].value = ctest[k]; }); }
  }
  $("#form-ps").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; const row = {}; ["assessment_questions", "assessment_pass_pct", "weak_rule_pct", "program_weeks", "sessions_per_week", "time_limit_minutes", "module_question_count", "module_pass_pct"].forEach(k => row[k] = parseInt(f[k].value, 10)); row.updated_at = new Date().toISOString(); const res = await sb().from("program_settings").update(row).eq("id", 1); if (res.error) alert(res.error.message); else loadAll(); });
  $("#form-ct").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; const row = { max_difficulty: f.max_difficulty.value }; ["question_count", "pass_pct", "time_limit_minutes", "module_question_count", "module_pass_pct"].forEach(k => row[k] = parseInt(f[k].value, 10)); row.updated_at = new Date().toISOString(); const res = await sb().from("certification_tests").update(row).eq("level", "level_1"); if (res.error) alert(res.error.message); else loadAll(); });

  // ---------- staffing cards ----------
  let staffFilter = "open";
  NRC.$$("#staff-filter .chip").forEach(c => c.onclick = () => { NRC.$$("#staff-filter .chip").forEach(x => x.classList.remove("on")); c.classList.add("on"); staffFilter = c.dataset.v; renderStaffing(); });
  function renderStaffing() {
    const t = today();
    const list = staffing.filter(s => staffFilter === "all" || (!["completed", "cancelled"].includes(s.status) && s.end_date >= t));
    $("#staff-cards").innerHTML = list.map(s => {
      const need = s.pairs_needed * 2; const pct = Math.min(100, Math.round(s.confirmed / need * 100));
      const travel = s.travel_managed_by === "nrc" ? `<div class="small" style="margin-top:6px">Travel: ${s.bookings_done} booked, ${s.bookings_pending} pending</div>` : '<div class="small muted" style="margin-top:6px">Travel booked by the organizer</div>';
      const days = Math.ceil((new Date(s.start_date) - new Date()) / 864e5);
      return `<div class="card" style="cursor:pointer" onclick="openTour('${s.id}')"><div style="display:flex;justify-content:space-between;gap:8px"><strong>${NRC.esc(s.name)}</strong><span class="pill ${s.confirmed >= need ? "green" : s.status === "submitted" ? "red" : "amber"}">${s.confirmed >= need ? "staffed" : s.status}</span></div>
        <div class="small muted">${NRC.fmtDate(s.start_date)}, ${NRC.esc([s.venue_city, s.venue_state].filter(Boolean).join(", "))}${days >= 0 ? ", in " + days + " days" : ""}</div>
        <div class="timer" style="margin:10px 0 6px;height:8px"><div style="width:${pct}%;background:${pct >= 100 ? "var(--green)" : "var(--red)"}"></div></div>
        <div class="small">${s.confirmed}/${need} referees confirmed, ${s.accepted} accepted, ${s.waiting} waiting${s.supervisor_needed ? ", supervisor " + (s.officials ? "assigned" : "needed") : ""}</div>${travel}
        ${s.organizer_notified_at ? '<div class="small muted" style="margin-top:4px">Organizer notified ' + NRC.fmtDate(s.organizer_notified_at) + "</div>" : ""}</div>`;
    }).join("") || '<div class="card">Nothing to staff. New requests appear here.</div>';
  }

  // ---------- designated and travel ----------
  let desRows = [], travelRows = [];
  const KIND = { flight: "Flight", hotel: "Hotel", car: "Car", train: "Train", other: "Other" };
  const fmtDT = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  async function renderDesignated() {
    const [{ data: asg }, { data: acc }] = await Promise.all([sb().from("assignments").select("*").eq("tournament_id", currentTour.id), sb().from("assignment_requests").select("referee_id,status").eq("tournament_id", currentTour.id).in("status", ["accepted", "tentative"])]);
    desRows = asg || [];
    const ids = desRows.map(a => a.id);
    const { data: tb } = ids.length ? await sb().from("travel_bookings").select("*").in("assignment_id", ids).order("start_at") : { data: [] };
    travelRows = tb || [];
    const need = currentTour.pairs_needed * 2; const refsConfirmed = desRows.filter(a => a.role === "referee").length;
    const openList = (acc || []).filter(a => !desRows.find(d => d.referee_id === a.referee_id));
    $("#des-summary").innerHTML = `<span class="chip ${refsConfirmed >= need ? "on" : ""}">${refsConfirmed}/${need} referees designated</span><span class="chip">${desRows.filter(a => a.role !== "referee").length} supervisor or observer${currentTour.supervisor_needed ? " (requested)" : ""}</span><span class="chip">${currentTour.travel_managed_by === "nrc" ? "NRC books travel" : "Organizer books travel"}</span>` + (openList.length ? `<span class="chip">Open to officiate, not designated: ${openList.map(a => NRC.esc(refName(a.referee_id)) + (a.status === "tentative" ? " (tentative)" : "")).join(", ")}</span>` : "");
    $("#des tbody").innerHTML = desRows.map(a => { const r = refs.find(x => x.id === a.referee_id) || {}; const bk = travelRows.filter(b => b.assignment_id === a.id);
      return `<tr><td><strong>${NRC.esc(refName(a.referee_id))}</strong><br><span class="small muted">${NRC.esc(r.email || "")}${r.phone ? ", " + NRC.esc(r.phone) : ""}</span></td><td>${NRC.esc(a.role)}</td><td class="small">${NRC.esc([r.home_city, r.home_state].filter(Boolean).join(", "))}${r.home_airport_iata ? " (" + NRC.esc(r.departure_airport_iata || r.home_airport_iata) + ")" : ""}</td><td class="small">${bk.map(b => `<div>${KIND[b.kind]}: ${NRC.esc(b.provider || "")} ${NRC.esc(b.reference || "")} ${fmtDT(b.start_at)}${b.end_at ? " to " + fmtDT(b.end_at) : ""}${b.cost ? " $" + b.cost : ""} <span class="pill ${b.status === "booked" ? "green" : b.status === "cancelled" ? "red" : "amber"}">${b.status}</span> <a href="#" onclick="openTravel('${a.id}','${b.id}');return false">edit</a></div>`).join("") || '<span class="muted">none</span>'}<div style="margin-top:4px"><button class="btn sm ghost" type="button" onclick="openTravel('${a.id}',null)">Add booking</button></div></td><td><button class="btn sm ghost" type="button" onclick="removeDesignated('${a.id}')">Remove</button></td></tr>`; }).join("") || '<tr><td colspan="5">Nobody designated yet. Confirm accepted referees on the Invitations tab.</td></tr>';
    $("#des-ref").innerHTML = refs.filter(r => r.active && !desRows.find(d => d.referee_id === r.id)).map(r => `<option value="${r.id}">${NRC.esc(r.first_name + " " + r.last_name)} (${NRC.levelLabel(r.cert_level).replace(" (National)", "")})</option>`).join("");
  }
  window.addDesignated = async function () {
    const rid = $("#des-ref").value; if (!rid) return;
    const { error } = await sb().from("assignments").upsert({ tournament_id: currentTour.id, referee_id: rid, role: $("#des-role").value }, { onConflict: "tournament_id,referee_id" });
    if (error) { alert(error.message); return; }
    renderDesignated(); renderTourAsg();
  };
  window.removeDesignated = async function (id) {
    const a = desRows.find(x => x.id === id); if (!a || !confirm("Remove " + refName(a.referee_id) + " from this tournament? Their invitation is marked declined so you can pick a replacement.")) return;
    await sb().from("assignments").delete().eq("id", id);
    await sb().from("assignment_requests").update({ status: "declined", response_note: "Removed by the NRC after confirmation" }).eq("tournament_id", currentTour.id).eq("referee_id", a.referee_id);
    renderDesignated(); renderInvites(); renderTourAsg();
  };
  let currentTravel = null;
  const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  window.openTravel = function (assignmentId, bookingId) {
    currentTravel = bookingId ? travelRows.find(b => b.id === bookingId) : null; const f = $("#form-travel"); f.reset(); f.assignment_id.value = assignmentId;
    const a = desRows.find(x => x.id === assignmentId); $("#dlg-travel-title").textContent = "Travel booking, " + (a ? refName(a.referee_id) : "");
    if (currentTravel) { ["kind", "status", "provider", "reference", "from_place", "to_place", "cost", "paid_by", "notes"].forEach(k => { if (f[k]) f[k].value = currentTravel[k] == null ? "" : currentTravel[k]; }); f.start_at.value = toLocal(currentTravel.start_at); f.end_at.value = toLocal(currentTravel.end_at); }
    $("#btn-travel-delete").classList.toggle("hidden", !currentTravel);
    $("#dlg-travel").showModal();
  };
  $("#form-travel").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = { assignment_id: f.assignment_id.value };
    ["kind", "status", "provider", "reference", "from_place", "to_place", "paid_by", "notes"].forEach(k => row[k] = f[k].value.trim() || null);
    row.cost = f.cost.value === "" ? null : parseFloat(f.cost.value); row.start_at = f.start_at.value ? new Date(f.start_at.value).toISOString() : null; row.end_at = f.end_at.value ? new Date(f.end_at.value).toISOString() : null; row.updated_at = new Date().toISOString();
    const res = currentTravel ? await sb().from("travel_bookings").update(row).eq("id", currentTravel.id) : await sb().from("travel_bookings").insert(row);
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-travel").close(); renderDesignated();
  });
  $("#btn-travel-delete").addEventListener("click", async () => { if (!currentTravel || !confirm("Delete this booking?")) return; await sb().from("travel_bookings").delete().eq("id", currentTravel.id); $("#dlg-travel").close(); renderDesignated(); });

  // ---------- expenses and report ----------
  const CK = { flight: "Flight", hotel: "Hotel", car: "Car", mileage: "Mileage", transport: "Transport", per_diem: "Per diem", other: "Other" };
  async function renderMoney() {
    const [{ data: asg }, { data: fin }, { data: rep }] = await Promise.all([sb().from("assignments").select("id,referee_id,role").eq("tournament_id", currentTour.id), sb().from("tournament_finance").select("*").eq("tournament_id", currentTour.id).maybeSingle(), sb().from("tournament_reports").select("*").eq("tournament_id", currentTour.id).maybeSingle()]);
    const ids = (asg || []).map(a => a.id);
    const { data: claims } = ids.length ? await sb().from("expense_claims").select("*").in("assignment_id", ids).order("created_at") : { data: [] };
    const F = fin || {};
    $("#money-summary").innerHTML = `<span class="chip">NRC paid bookings: $${Number(F.nrc_paid_bookings || 0).toFixed(0)}</span><span class="chip">Organizer paid bookings: $${Number(F.organizer_paid_bookings || 0).toFixed(0)}</span><span class="chip ${Number(F.referee_paid_bookings) ? "on" : ""}">Referee paid bookings: $${Number(F.referee_paid_bookings || 0).toFixed(0)}</span><span class="chip ${Number(F.claims_submitted) ? "on" : ""}">Claims to review: $${Number(F.claims_submitted || 0).toFixed(0)}</span><span class="chip">Approved: $${Number(F.claims_approved || 0).toFixed(0)}</span><span class="chip">Reimbursed: $${Number(F.claims_reimbursed || 0).toFixed(0)}</span>`;
    $("#claims tbody").innerHTML = (claims || []).map(c => { const a = (asg || []).find(x => x.id === c.assignment_id) || {}; return `<tr><td>${NRC.esc(refName(a.referee_id))}</td><td>${CK[c.kind] || c.kind}</td><td class="small">${NRC.esc(c.description || "")}</td><td><strong>$${Number(c.amount).toFixed(2)}</strong></td><td>${c.receipt_url ? `<a href="#" onclick="openReceipt('${c.receipt_url}');return false">view</a>` : '<span class="muted">none</span>'}</td><td><span class="pill ${c.status === "reimbursed" || c.status === "approved" ? "green" : c.status === "rejected" ? "red" : "amber"}">${c.status}</span></td><td><select onchange="setClaim('${c.id}',{reimbursed_by:this.value})"><option value="organizer" ${c.reimbursed_by === "organizer" ? "selected" : ""}>Organizer</option><option value="nrc" ${c.reimbursed_by === "nrc" ? "selected" : ""}>NRC</option></select></td><td><input value="${NRC.esc(c.review_note || "")}" placeholder="note" onchange="setClaim('${c.id}',{review_note:this.value})" style="min-width:120px"></td><td style="white-space:nowrap"><button class="btn sm ghost" onclick="setClaim('${c.id}',{status:'approved'})">Approve</button> <button class="btn sm ghost" onclick="setClaim('${c.id}',{status:'rejected'})">Reject</button> <button class="btn sm ghost" onclick="setClaim('${c.id}',{status:'reimbursed',paid_at:new Date().toISOString()})">Reimbursed</button></td></tr>`; }).join("") || '<tr><td colspan="9">No expense claim yet. Referees submit them from their home after the event.</td></tr>';
    $("#report-view").innerHTML = rep ? `<div class="card"><h3 style="margin-top:0">Organizer report, ${NRC.fmtDate(rep.submitted_at)}</h3><p class="small">Games played: ${rep.games_played ?? "not given"}. Referee team ${rep.referee_rating ? rep.referee_rating + "/5" : "not rated"}${rep.supervisor_rating ? ", supervisor " + rep.supervisor_rating + "/5" : ""}. Would request again: ${rep.would_request_again ? "yes" : "no"}.</p>${rep.highlights ? "<p class='small'><strong>Went well:</strong> " + NRC.esc(rep.highlights) + "</p>" : ""}${rep.incidents ? "<p class='small'><strong>Incidents:</strong> " + NRC.esc(rep.incidents) + "</p>" : ""}</div>` : '<p class="small muted">No organizer report yet. The organizer is reminded three days after the event.</p>';
  }
  window.setClaim = async function (id, patch) { if (patch.status) { patch.reviewed_by = user.id; patch.reviewed_at = new Date().toISOString(); } const { error } = await sb().from("expense_claims").update(patch).eq("id", id); if (error) alert(error.message); else renderMoney(); };
  window.openReceipt = async function (path) { const { data, error } = await sb().storage.from("receipts").createSignedUrl(path, 300); if (error) { alert(error.message); return; } window.open(data.signedUrl, "_blank"); };

  // ---------- tournaments ----------
  function renderTournaments() {
    $("#tour tbody").innerHTML = tournaments.map(t => `<tr><td><strong>${NRC.esc(t.name)}</strong><br><span class="small muted">${t.games_expected ? t.games_expected + " games" : ""}</span></td><td><span class="pill">${SANCTION[t.sanction] || ""}</span>${t.created_by_nrc ? ' <span class="pill">entered by NRC</span>' : ""}${t.region ? '<div class="small muted">' + NRC.esc(t.region) + "</div>" : ""}${t.divisions && t.divisions.length ? '<div style="margin-top:4px">' + NRC.divisionPills(t.divisions) + "</div>" : ""}</td><td>${NRC.fmtDate(t.start_date)} to ${NRC.fmtDate(t.end_date)}</td><td>${NRC.esc(t.venue_name || "")}<br><span class="small muted">${NRC.esc([t.venue_city, t.venue_state].filter(Boolean).join(", "))}${t.nearest_airport_iata ? " (" + NRC.esc(t.nearest_airport_iata) + ")" : ""}</span></td><td>${t.pairs_needed}</td><td class="small">${t.supervisor_needed ? "Yes" + (t.supervisor_notes ? "<br>" + NRC.esc(t.supervisor_notes) : "") : "No"}</td><td class="small">${t.travel_managed_by === "nrc" ? '<span class="pill amber">NRC books</span>' : "Organizer"}</td><td class="small">${t.hotel_nights_covered || 0} hotel nights<br>${t.flights_covered ? "flights" : "no flights"}, ${t.airport_transfers_covered ? "transfers" : "no transfers"}${t.food_stipend_per_day ? "<br>$" + t.food_stipend_per_day + "/day" : ""}${t.earliest_return_last_day ? "<br>return after " + t.earliest_return_last_day.slice(0, 5) : ""}</td><td class="small">${NRC.esc(t.organizer_name)}<br><a href="mailto:${NRC.esc(t.organizer_email)}">${NRC.esc(t.organizer_email)}</a></td><td><select onchange="setTourStatus('${t.id}',this.value)">${["submitted", "reviewing", "staffed", "completed", "cancelled"].map(s => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select></td><td><button class="btn sm ghost" onclick="openTour('${t.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="11">No requests yet.</td></tr>';
  }
  window.openNewTour = function () {
    const f = $("#form-newtour"); f.reset();
    f.club_id.innerHTML = '<option value="">None</option>' + clubs.map(c => `<option value="${c.id}">${NRC.esc(c.name)}</option>`).join("");
    $("#newtour-div").innerHTML = NRC.divisionPicker("divisions", []);
    $("#dlg-newtour").showModal();
  };
  $("#form-newtour").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const row = { name: f.name.value.trim(), sanction: f.sanction.value, region: f.region.value.trim() || null, start_date: f.start_date.value, end_date: f.end_date.value,
      venue_name: f.venue_name.value.trim() || null, venue_city: f.venue_city.value.trim() || null, venue_state: f.venue_state.value.trim().toUpperCase() || null,
      games_expected: f.games_expected.value === "" ? null : parseInt(f.games_expected.value, 10), club_id: f.club_id.value || null, divisions: NRC.divisionsFrom(f, "divisions"),
      organizer_name: "NRC", organizer_email: (window.NRC_CONFIG && NRC_CONFIG.CONTACT_EMAIL) || "referee@handballusa.org", organizer_user_id: user.id,
      created_by_nrc: true, status: f.end_date.value < today() ? "completed" : "reviewing", pairs_needed: 1 };
    if (row.end_date < row.start_date) { alert("End date is before the start date."); return; }
    const { data, error } = await sb().from("tournaments").insert(row).select().single();
    if (error) { alert("Save failed: " + error.message); return; }
    $("#dlg-newtour").close(); await loadAll(); openTour(data.id);
    const b = NRC.$$("#dlg-tour .tabs button").find(x => x.dataset.ttab === "officiated"); if (b) b.click();
  });
  window.setTourStatus = async function (id, status) { await sb().from("tournaments").update({ status }).eq("id", id); };
  let currentTour = null, pairsCache = [], availCache = [];
  NRC.$$("#dlg-tour .tabs button").forEach(b => b.onclick = () => { NRC.$$("#dlg-tour .tabs button").forEach(x => x.classList.toggle("active", x === b)); ["invites", "candidates", "designated", "money", "officiated"].forEach(t => $("#ttab-" + t).classList.toggle("hidden", t !== b.dataset.ttab));
    // each tab reads fresh data when opened, so a confirmation on one tab shows on the next
    ({ invites: renderInvites, candidates: renderCandidates, designated: renderDesignated, money: renderMoney, officiated: renderTourAsg }[b.dataset.ttab] || (() => {}))(); });
  window.openTour = async function (id) {
    currentTour = tournaments.find(t => t.id === id); const f = $("#form-tour");
    $("#dlg-tour-title").textContent = currentTour.name;
    $("#dlg-tour-sub").textContent = `${NRC.fmtDate(currentTour.start_date)} to ${NRC.fmtDate(currentTour.end_date)}, ${[currentTour.venue_city, currentTour.venue_state].filter(Boolean).join(", ")}${currentTour.nearest_airport_iata ? " (" + currentTour.nearest_airport_iata + ")" : ""}. ${currentTour.pairs_needed} pairs needed.`;
    f.sanction.value = currentTour.sanction || "club"; f.region.value = currentTour.region || "";
    $("#tour-div").innerHTML = NRC.divisionPicker("divisions", currentTour.divisions);
    ["start_date", "end_date", "venue_name", "venue_city", "pairs_needed", "travel_managed_by", "club_id"].forEach(k => { if (f[k]) f[k].value = currentTour[k] == null ? "" : currentTour[k]; });
    $("#asg-ref").innerHTML = refs.filter(r => r.active).map(r => `<option value="${r.id}">${NRC.esc(r.first_name + " " + r.last_name)}</option>`).join("");
    // weekends touched by the tournament (Saturday keys)
    const sat = (d) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + ((6 - x.getDay() + 7) % 7)); return x.toISOString().slice(0, 10); };
    const wk = []; for (let d = new Date(currentTour.start_date + "T12:00:00"); d <= new Date(currentTour.end_date + "T12:00:00"); d.setDate(d.getDate() + 1)) { const k = sat(d.toISOString().slice(0, 10)); if (!wk.includes(k)) wk.push(k); }
    const [{ data: pr }, { data: av }, { data: wa }] = await Promise.all([sb().from("pairs").select("*"), sb().from("availability_blocks").select("*").lte("start_date", currentTour.end_date).gte("end_date", currentTour.start_date), sb().from("weekend_availability").select("*").in("weekend", wk)]);
    pairsCache = pr || []; availCache = av || []; weekendCache = wa || [];
    $("#dlg-tour-sub").textContent += currentTour.supervisor_needed ? " Supervisor requested" + (currentTour.supervisor_notes ? ": " + currentTour.supervisor_notes : "") + "." : "";
    $("#btn-organizer").textContent = currentTour.organizer_notified_at ? "Notify organizer again" : "Notify organizer";
    await Promise.all([renderInvites(), renderCandidates(), renderTourAsg(), renderDesignated(), renderMoney()]);
    $("#dlg-tour").showModal();
  };
  const refName = id => { const r = refs.find(x => x.id === id); return r ? r.first_name + " " + r.last_name : "?"; };
  const partnerOf = id => { const p = pairsCache.find(p => (p.referee_a === id || p.referee_b === id) && (!p.valid_until || p.valid_until >= today())); return p ? (p.referee_a === id ? p.referee_b : p.referee_a) : null; };
  const unavailable = id => availCache.find(b => b.referee_id === id);
  let weekendCache = [];
  // declared weekend availability for the tournament weekends: available | tentative | unavailable | unknown
  const weekendStatus = id => { const rows = weekendCache.filter(w => w.referee_id === id); if (!rows.length) return "unknown"; if (rows.some(w => w.status === "unavailable")) return "unavailable"; if (rows.every(w => w.status === "available")) return "available"; return "tentative"; };
  const availPill = id => { const u = unavailable(id); if (u) return `<span class="pill red">blocked ${NRC.fmtDate(u.start_date)}</span>`; const w = weekendStatus(id); return w === "available" ? '<span class="pill green">available</span>' : w === "tentative" ? '<span class="pill amber">tentative</span>' : w === "unavailable" ? '<span class="pill red">unavailable</span>' : '<span class="pill">not declared</span>'; };

  // Invitations
  let invites = [];
  async function renderInvites() {
    const { data } = await sb().from("assignment_requests").select("*").eq("tournament_id", currentTour.id).order("created_at");
    invites = data || [];
    const c = s => invites.filter(i => i.status === s).length;
    $("#inv-summary").innerHTML = [["draft", "Draft"], ["sent", "Waiting"], ["tentative", "Tentative"], ["accepted", "Accepted"], ["declined", "Declined"], ["confirmed", "Confirmed"]].map(([k, l]) => `<span class="chip ${c(k) ? "on" : ""}">${l}: ${c(k)}</span>`).join("") + `<span class="chip">Needed: ${currentTour.pairs_needed * 2} referees</span>`;
    const STATUS = { draft: "", sent: "amber", tentative: "amber", accepted: "green", declined: "red", confirmed: "green", no_response: "red", cancelled: "" };
    $("#inv tbody").innerHTML = invites.map(i => `<tr><td><input type="checkbox" class="inv-sel" value="${i.id}" style="width:auto"></td><td><strong>${NRC.esc(refName(i.referee_id))}</strong> ${availPill(i.referee_id)}${partnerOf(i.referee_id) ? '<div class="small muted">pair with ' + NRC.esc(refName(partnerOf(i.referee_id))) + "</div>" : ""}</td><td><span class="pill ${STATUS[i.status] || ""}">${i.status.replace("_", " ")}</span>${i.reminder_count ? ` <span class="small muted">${i.reminder_count} reminder${i.reminder_count > 1 ? "s" : ""}</span>` : ""}</td><td class="small">${i.sent_at ? NRC.fmtDate(i.sent_at) : ""}</td><td class="small">${i.responded_at ? NRC.fmtDate(i.responded_at) : ""}</td><td class="small">${NRC.esc(i.response_note || "")}</td></tr>`).join("") || '<tr><td colspan="6">No invitations yet. Use Find referees to add candidates.</td></tr>';
  }
  const selectedInv = () => NRC.$$(".inv-sel:checked").map(x => x.value);
  window.sendSelected = async function (kind) {
    let ids = selectedInv(); if (!ids.length) { alert("Select referees first."); return; }
    if (kind === "confirm") {
      ids = ids.filter(id => invites.find(i => i.id === id && i.status === "accepted")); if (!ids.length) { alert("Only accepted invitations can be confirmed."); return; }
      const already = invites.filter(i => i.status === "confirmed").map(i => i.referee_id);
      const toConfirm = ids.map(id => invites.find(i => i.id === id).referee_id);
      const after = new Set([...already, ...toConfirm]);
      const need = currentTour.pairs_needed * 2; const issues = [];
      if (after.size !== need) issues.push(`${after.size} referees would be confirmed; the tournament needs ${need} (${currentTour.pairs_needed} pairs).`);
      toConfirm.forEach(rid => { const p = partnerOf(rid); if (p && !after.has(p)) issues.push(`${refName(rid)} forms a pair with ${refName(p)}, who is not in the confirmed set.`); });
      if (issues.length && !confirm("Check before confirming:\n\n" + issues.join("\n") + "\n\nConfirm anyway?")) return;
    }
    if (kind === "invite") ids = ids.filter(id => ["draft", "sent"].includes((invites.find(i => i.id === id) || {}).status));
    const { data: sess } = await sb().auth.getSession();
    const res = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: currentTour.id, request_ids: ids, kind }) });
    const d = await res.json();
    if (!res.ok) { alert("Failed: " + (d.error || res.status)); return; }
    let released = 0;
    if (kind === "confirm") {
      for (const id of ids) { const i = invites.find(x => x.id === id); await sb().from("assignments").upsert({ tournament_id: currentTour.id, referee_id: i.referee_id, role: "referee" }, { onConflict: "tournament_id,referee_id" }); }
      if (currentTour.status === "submitted" || currentTour.status === "reviewing") await sb().from("tournaments").update({ status: "staffed" }).eq("id", currentTour.id);
      // team complete: close the invitations still open and tell those referees, so nobody waits for an answer that will not come
      const confirmedNow = invites.filter(i => i.status === "confirmed").length + ids.length;
      const open = invites.filter(i => ["sent", "tentative"].includes(i.status) && !ids.includes(i.id)).map(i => i.id);
      if (confirmedNow >= currentTour.pairs_needed * 2 && open.length && confirm(`The team is complete. Close the ${open.length} invitation${open.length > 1 ? "s" : ""} still open and tell those referees they are released?`)) {
        const r2 = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: currentTour.id, request_ids: open, kind: "release" }) });
        const d2 = await r2.json(); released = r2.ok ? d2.results.filter(r => r.sent).length : 0;
      }
    }
    const failed = d.results.filter(r => !r.sent);
    alert(`${d.results.length - failed.length} email${d.results.length - failed.length === 1 ? "" : "s"} sent.` + (failed.length ? ` ${failed.length} not sent: ` + failed.map(f => f.email + " (" + (f.error || "").slice(0, 80) + ")").join("; ") : "") + (released ? ` ${released} referee${released > 1 ? "s" : ""} released.` : ""));
    renderInvites(); renderTourAsg(); renderDesignated();
  };
  window.notifyOrganizer = async function () {
    const { data: asg } = await sb().from("assignments").select("id").eq("tournament_id", currentTour.id);
    if (!(asg || []).length && !confirm("No official is confirmed yet. Send the organizer an update anyway?")) return;
    const { data: sess } = await sb().auth.getSession();
    const res = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: currentTour.id, kind: "organizer" }) });
    const d = await res.json(); if (!res.ok) { alert("Failed: " + (d.error || res.status)); return; }
    const r = d.results[0]; alert(r.sent ? "Organizer notified at " + r.email + "." : "Not sent: " + (r.error || "").slice(0, 120)); loadAll();
  };
  window.removeSelected = async function () { const ids = selectedInv().filter(id => (invites.find(i => i.id === id) || {}).status === "draft"); if (ids.length) await sb().from("assignment_requests").delete().in("id", ids); renderInvites(); };

  // Candidates
  function renderCandidates() {
    const q = $("#cand-q").value.toLowerCase(), lvl = $("#cand-level").value, hide = $("#cand-avail").checked;
    const order = ["candidate", "level_1", "level_2", "level_3", "nachc", "ihf"];
    const invited = new Set(invites.map(i => i.referee_id));
    const club = id => (clubs.find(c => c.id === id) || {}).name || "";
    const yr = new Date().getFullYear();
    const AR = { available: 0, tentative: 1, unknown: 2, unavailable: 3 };
    const qualified = r => r.cert_level !== "candidate";
    $("#cand tbody").innerHTML = refs.filter(r => r.active && qualified(r) && !invited.has(r.id) && (!lvl || order.indexOf(r.cert_level) >= order.indexOf(lvl)) && (!hide || (!unavailable(r.id) && weekendStatus(r.id) !== "unavailable")) && (!q || [r.first_name, r.last_name, club(r.club_id), r.home_airport_iata, r.home_city].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => AR[unavailable(a.id) ? "unavailable" : weekendStatus(a.id)] - AR[unavailable(b.id) ? "unavailable" : weekendStatus(b.id)] || (a.home_airport_iata === currentTour.nearest_airport_iata ? -1 : 0) - (b.home_airport_iata === currentTour.nearest_airport_iata ? -1 : 0) || order.indexOf(b.cert_level) - order.indexOf(a.cert_level))
      .map(r => { const p = partnerOf(r.id); return `<tr><td><input type="checkbox" class="cand-sel" value="${r.id}" style="width:auto"></td><td><strong>${NRC.esc(r.first_name + " " + r.last_name)}</strong></td><td>${NRC.levelPill(r.cert_level, r.level_confirmed)}</td><td>${NRC.esc(club(r.club_id))}</td><td>${NRC.esc(r.home_airport_iata || "")}${r.home_airport_iata && r.home_airport_iata === currentTour.nearest_airport_iata ? ' <span class="pill green">local</span>' : ""}</td><td>${availPill(r.id)}</td><td class="small">${r._games} games ${yr}</td><td class="small">${p ? "with " + NRC.esc(refName(p)) : ""}</td></tr>`; }).join("") || '<tr><td colspan="8">No referee matches.</td></tr>';
  }
  ["#cand-q", "#cand-level", "#cand-avail"].forEach(sel => $(sel).addEventListener("input", renderCandidates));
  window.addCandidates = async function () {
    const ids = NRC.$$(".cand-sel:checked").map(x => x.value); if (!ids.length) { alert("Select referees first."); return; }
    const rows = ids.map(id => ({ tournament_id: currentTour.id, referee_id: id, status: "draft" }));
    const { error } = await sb().from("assignment_requests").insert(rows); if (error) { alert(error.message); return; }
    await renderInvites(); renderCandidates(); NRC.$$("#dlg-tour .tabs button")[0].click();
  };

  // Officiated
  async function renderTourAsg() {
    const { data } = await sb().from("assignments").select("*").eq("tournament_id", currentTour.id);
    $("#tour-asg tbody").innerHTML = (data || []).map(a => `<tr><td>${NRC.esc(refName(a.referee_id))}</td><td>${NRC.esc(a.role)}</td><td><input type="number" min="0" value="${a.games_officiated == null ? "" : a.games_officiated}" style="width:80px" onchange="setAsgGames('${a.id}',this.value)"></td><td><button class="btn sm ghost" onclick="delAssignment('${a.id}')">Remove</button></td></tr>`).join("") || '<tr><td colspan="4">Nobody recorded yet. Confirmed invitations land here automatically.</td></tr>';
  }
  window.setAsgGames = async function (id, v) { await sb().from("assignments").update({ games_officiated: v === "" ? null : parseInt(v, 10) }).eq("id", id); };
  window.addAssignment = async function () {
    const g = $("#asg-games").value; const { error } = await sb().from("assignments").upsert({ tournament_id: currentTour.id, referee_id: $("#asg-ref").value, role: "referee", games_officiated: g === "" ? null : parseInt(g, 10) }, { onConflict: "tournament_id,referee_id" });
    if (error) { alert(error.message); return; } $("#asg-games").value = ""; renderTourAsg();
  };
  window.delAssignment = async function (id) { await sb().from("assignments").delete().eq("id", id); renderTourAsg(); };
  $("#form-tour").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; const row = { sanction: f.sanction.value, divisions: NRC.divisionsFrom(f, "divisions"), region: f.region.value || null, start_date: f.start_date.value || currentTour.start_date, end_date: f.end_date.value || currentTour.end_date, venue_name: f.venue_name.value || null, venue_city: f.venue_city.value || null, pairs_needed: parseInt(f.pairs_needed.value, 10) || currentTour.pairs_needed, travel_managed_by: f.travel_managed_by.value, club_id: f.club_id.value || null }; const { error } = await sb().from("tournaments").update(row).eq("id", currentTour.id); if (error) { alert(error.message); return; } Object.assign(currentTour, row); loadAll(); alert("Saved. Use Notify changes to tell the officials and the organizer."); });
  async function callMail(body) { const { data: sess } = await sb().auth.getSession(); const res = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: currentTour.id, ...body }) }); const d = await res.json(); if (!res.ok) { alert("Failed: " + (d.error || res.status)); return null; } const ok = d.results.filter(r => r.sent).length; alert(ok + " email(s) sent." + (d.results.length - ok ? " Not sent: " + d.results.filter(r => !r.sent).map(r => r.email + " (" + (r.error || "").slice(0, 60) + ")").join("; ") : "")); return d; }
  window.notifyChanges = () => callMail({ kind: currentTour.status === "cancelled" ? "cancel" : "changes" });
  window.sendBriefs = () => { if (!desRows.length) { alert("Nobody designated yet."); return; } callMail({ kind: "brief", assignment_ids: desRows.map(a => a.id) }); };

  // ---------- questions ----------
  function renderQuestions() {
    const q = $("#q-q").value.toLowerCase(), r = $("#q-rule").value, d = $("#q-diff").value, s = $("#q-src").value;
    $("#qs tbody").innerHTML = questions.filter(x => (!r || String(x.rule_number) === r) && (!d || x.difficulty === d) && (!s || x.source === s) && (!q || (x.question + " " + x.answer).toLowerCase().includes(q)))
      .map(x => `<tr><td>${x.rule_number || ""}</td><td>${NRC.esc(NRC.levelLabel(x.difficulty).replace(" (National)", ""))}</td><td>${NRC.esc(x.question)}${x.active ? "" : ' <span class="pill">inactive</span>'}</td><td>${x.options ? (x.correct_indexes ? "MCQ, multi" : "MCQ") : "Flashcard"}</td><td class="small">${NRC.esc(x.source)}${x.source_ref ? " " + NRC.esc(x.source_ref) : ""}</td><td><button class="btn sm ghost" onclick="openQ('${x.id}')">Edit</button></td></tr>`).join("");
  }
  ["#q-q", "#q-rule", "#q-diff", "#q-src"].forEach(s => $(s).addEventListener("input", renderQuestions));
  let currentQ = null;
  window.openQ = function (id) {
    currentQ = id ? questions.find(x => x.id === id) : null; const f = $("#form-q"); f.reset();
    if (currentQ) { ["rule_number", "difficulty", "category", "rule_ref", "question", "answer", "source", "source_ref"].forEach(k => f[k].value = currentQ[k] == null ? "" : currentQ[k]); f.options.value = (currentQ.options || []).join("\n"); f.correct_index.value = currentQ.correct_indexes ? currentQ.correct_indexes.map(i => i + 1).join(", ") : currentQ.correct_index == null ? "" : currentQ.correct_index + 1; f.active.checked = currentQ.active; }
    $("#dlg-q").showModal();
  };
  $("#form-q").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const opts = f.options.value.split("\n").map(s => s.trim()).filter(Boolean);
    const idxs = f.correct_index.value.split(",").map(x => parseInt(x, 10) - 1).filter(x => !isNaN(x)).sort((a, b) => a - b);
    const row = { rule_number: parseInt(f.rule_number.value, 10), difficulty: f.difficulty.value, category: f.category.value.trim(), rule_ref: f.rule_ref.value.trim() || null, question: f.question.value.trim(), options: opts.length ? opts : null, correct_index: opts.length && idxs.length ? idxs[0] : null, correct_indexes: opts.length && idxs.length > 1 ? idxs : null, answer: f.answer.value.trim(), source: f.source.value, source_ref: f.source_ref.value.trim() || null, active: f.active.checked };
    if (row.options && (!idxs.length || idxs.some(i => i < 0 || i >= row.options.length))) { alert("Set valid correct option numbers."); return; }
    const res = currentQ ? await sb().from("quiz_questions").update(row).eq("id", currentQ.id) : await sb().from("quiz_questions").insert(row);
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-q").close(); loadAll();
  });

  // ---------- imports ----------
  function parseCsv(text) {
    const rows = []; let row = [], cell = "", inq = false;
    for (let i = 0; i < text.length; i++) { const ch = text[i];
      if (inq) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += ch; }
      else if (ch === '"') inq = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch; }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function toIso(d) { if (!d) return null; const m = String(d).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; const t = new Date(d); return isNaN(t) ? null : t.toISOString().slice(0, 10); }
  window.importRoster = async function () {
    const file = $("#roster-file").files[0]; if (!file) { alert("Choose the CSV file first."); return; }
    const rows = parseCsv(await file.text()); if (rows.length < 2) { alert("Empty file."); return; }
    const h = rows[0].map(norm);
    const col = (...names) => h.findIndex(x => names.some(n => x === n || x.includes(n)));
    const C = { first_name: col("firstname", "first", "prenom"), last_name: col("lastname", "last", "surname", "nom"), email: col("email", "mail"), phone: col("phone", "mobile", "tel"), club: col("club"), home_city: col("city", "ville"), home_state: col("state"), home_airport_iata: col("airport", "iata"), cert_level: col("level", "certification", "grade"), cert_date: col("certdate", "certified", "certificationdate", "since"), usath_member_id: col("memberid", "membershipid", "sport80"), usath_membership_valid_until: col("membershipexpir", "membershipvalid", "membership"), safesport_valid_until: col("safesport"), background_check_valid_until: col("background"), admin_notes: col("notes", "comment") };
    if (C.email < 0 && (C.first_name < 0 || C.last_name < 0)) { alert("Could not find an email or name column."); return; }
    const LV = v => { const x = norm(v); if (!x) return null; if (x.includes("cand")) return "candidate"; if (x.includes("nachc") || x.includes("contin")) return "nachc"; if (x.includes("ihf") || x.includes("intern")) return "ihf"; if (x.includes("3") || x.includes("nation")) return "level_3"; if (x.includes("2")) return "level_2"; if (x.includes("1")) return "level_1"; return null; };
    let created = 0, updated = 0, skipped = [];
    for (const r of rows.slice(1)) {
      const get = k => C[k] >= 0 ? String(r[C[k]] || "").trim() : "";
      const email = get("email").toLowerCase(), fn = get("first_name"), ln = get("last_name");
      let ref = email ? refs.find(x => x.email.toLowerCase() === email) : null;
      if (!ref && fn && ln) ref = refs.find(x => norm(x.first_name) === norm(fn) && norm(x.last_name) === norm(ln));
      const patch = {};
      if (fn) patch.first_name = fn; if (ln) patch.last_name = ln; if (email) patch.email = email;
      ["phone", "home_city", "admin_notes"].forEach(k => { if (get(k)) patch[k] = get(k); });
      if (get("home_state")) patch.home_state = get("home_state").toUpperCase().slice(0, 2);
      if (get("home_airport_iata")) patch.home_airport_iata = get("home_airport_iata").toUpperCase().slice(0, 3);
      if (get("club")) { const c = clubs.find(x => norm(x.name) === norm(get("club")) || norm(x.name).includes(norm(get("club")))); if (c) patch.club_id = c.id; }
      const lv = LV(get("cert_level")); if (lv) patch.cert_level = lv;
      ["cert_date", "usath_membership_valid_until", "safesport_valid_until", "background_check_valid_until"].forEach(k => { const d = toIso(get(k)); if (d) patch[k] = d; });
      if (get("usath_member_id")) patch.usath_member_id = get("usath_member_id");
      if (ref) { const { error } = await sb().from("referees").update(patch).eq("id", ref.id); if (error) skipped.push((email || fn + " " + ln) + ": " + error.message); else updated++; }
      else if (email && fn && ln) { if (!patch.cert_level) patch.cert_level = "candidate"; const { error } = await sb().from("referees").insert(patch); if (error) skipped.push(email + ": " + error.message); else created++; }
      else skipped.push("row without email and full name: " + r.filter(Boolean).slice(0, 3).join(", "));
    }
    await sb().from("import_log").insert({ kind: "roster", rows_processed: rows.length - 1, rows_updated: updated + created, rows_unmatched: skipped.length, imported_by: user.id, notes: skipped.slice(0, 50).join(" | ") });
    $("#roster-result").innerHTML = `<p>${created} created, ${updated} updated, ${skipped.length} skipped.</p>` + (skipped.length ? '<p class="muted">' + skipped.slice(0, 20).map(NRC.esc).join("<br>") + "</p>" : "");
    loadAll();
  };
  window.importSport80 = async function () {
    const file = $("#s80-file").files[0]; if (!file) { alert("Choose the CSV file first."); return; }
    const rows = parseCsv(await file.text()); if (rows.length < 2) { alert("Empty file."); return; }
    const h = rows[0].map(norm);
    const col = (...names) => h.findIndex(x => names.some(n => x.includes(n)));
    const iE = col("email"), iF = col("firstname", "first"), iL = col("lastname", "last", "surname"), iId = col("memberid", "membershipid", "membernumber", "id"), iX = col("expir", "validuntil", "enddate", "renewal");
    if (iE < 0 && (iF < 0 || iL < 0)) { alert("Could not find an email or name column."); return; }
    let updated = 0, unmatched = [];
    for (const r of rows.slice(1)) {
      const email = iE >= 0 ? r[iE].trim().toLowerCase() : "", fn = iF >= 0 ? norm(r[iF]) : "", ln = iL >= 0 ? norm(r[iL]) : "";
      let ref = email ? refs.find(x => x.email.toLowerCase() === email) : null;
      if (!ref && fn && ln) ref = refs.find(x => norm(x.first_name) === fn && norm(x.last_name) === ln);
      if (!ref) { unmatched.push(r.filter(Boolean).slice(0, 4).join(", ")); continue; }
      const patch = {}; if (iId >= 0 && r[iId]) patch.usath_member_id = r[iId].trim(); if (iX >= 0 && toIso(r[iX])) patch.usath_membership_valid_until = toIso(r[iX]);
      if (Object.keys(patch).length) { const { error } = await sb().from("referees").update(patch).eq("id", ref.id); if (!error) updated++; }
    }
    await sb().from("import_log").insert({ kind: "sport80", rows_processed: rows.length - 1, rows_updated: updated, rows_unmatched: unmatched.length, imported_by: user.id, notes: unmatched.slice(0, 50).join(" | ") });
    await rollRecurring("sport80_import");
    $("#s80-result").innerHTML = `<div class="notice ok">Processed ${rows.length - 1} rows, updated ${updated} referees, ${unmatched.length} unmatched.</div>` + (unmatched.length ? `<p style="margin-top:8px"><strong>Unmatched rows</strong> (add the referee first, then re-run):</p><ul>${unmatched.map(u => `<li>${NRC.esc(u)}</li>`).join("")}</ul>` : "");
    loadAll();
  };

  // IHF catalogue parser: "7.12) question text" then "a) ...", "b) ..." ; answers "7.12) a, c"
  let ihfPreview = [];
  function parseIhf(qText, aText) {
    const answers = {};
    (aText || "").split(/\r?\n/).forEach(l => { const m = l.match(/^\s*(\d+)\.(\d+)\)?\s*[:\-]?\s*([a-h](?:\s*[,\/]\s*[a-h])*)\s*$/i); if (m) answers[m[1] + "." + m[2]] = m[3].toLowerCase().replace(/[^a-h]/g, "").split(""); });
    const out = []; let cur = null;
    const flush = () => { if (cur && cur.options.length) out.push(cur); cur = null; };
    (qText || "").split(/\r?\n/).forEach(line => {
      const l = line.trim(); if (!l) return;
      let m = l.match(/^(\d{1,2})\.(\d{1,3})\)\s*(.*)$/);
      if (m) { flush(); cur = { num: m[1] + "." + m[2], rule: parseInt(m[1], 10), q: m[3], options: [] }; return; }
      m = l.match(/^([a-h])\)\s*(.*)$/i);
      if (m && cur) { cur.options.push(m[2]); return; }
      if (cur) { if (cur.options.length) cur.options[cur.options.length - 1] += " " + l; else cur.q += " " + l; }
    });
    flush();
    out.forEach(x => { x.correct = answers[x.num] || null; });
    return out;
  }
  window.previewIhf = function () {
    ihfPreview = parseIhf($("#ihf-q").value, $("#ihf-a").value);
    const noAns = ihfPreview.filter(x => !x.correct).length, multi = ihfPreview.filter(x => x.correct && x.correct.length > 1).length;
    $("#ihf-result").innerHTML = `<div class="notice">${ihfPreview.length} questions parsed. ${noAns} without an answer (skipped on import). ${multi} with several correct options (imported with all correct options listed in the explanation and the first one as the scored answer).</div>` + ihfPreview.slice(0, 5).map(x => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${x.num}</strong> ${NRC.esc(x.q)}<br>${x.options.map((o, i) => `${String.fromCharCode(97 + i)}) ${NRC.esc(o)}`).join("<br>")}<br><em>Correct: ${x.correct ? x.correct.join(", ") : "?"}</em></div>`).join("");
    $("#ihf-go").disabled = !ihfPreview.some(x => x.correct);
  };
  window.importIhf = async function () {
    const ed = $("#ihf-ed").value.trim() || "IHF";
    const rows = ihfPreview.filter(x => x.correct).map(x => { const idxs = x.correct.map(c => c.charCodeAt(0) - 97).filter(i => i < x.options.length).sort((a, b) => a - b); return { source: "ihf_catalogue", source_ref: ed + " " + x.num, rule_number: x.rule, category: "Rule " + x.rule + ": " + (NRC.RULES[x.rule] || ""), difficulty: "level_2", question: x.q, options: x.options, correct_index: idxs[0], correct_indexes: idxs.length > 1 ? idxs : null, answer: "Correct option" + (idxs.length > 1 ? "s: " + x.correct.join(", ") : ": " + x.correct[0]) + ". See IHF Rules of the Game, Rule " + x.rule + ".", rule_ref: "Rule " + x.rule }; });
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 100) { const { error, data } = await sb().from("quiz_questions").insert(rows.slice(i, i + 100)).select("id"); if (error) { alert(error.message); break; } inserted += data.length; }
    await sb().from("import_log").insert({ kind: "ihf_catalogue", rows_processed: ihfPreview.length, rows_updated: inserted, rows_unmatched: ihfPreview.length - rows.length, imported_by: user.id, notes: ed });
    $("#ihf-result").innerHTML = `<div class="notice ok">Imported ${inserted} questions as ${ed}.</div>`; $("#ihf-go").disabled = true; loadAll();
  };
  async function loadImportLog() {
    const { data } = await sb().from("import_log").select("*").order("created_at", { ascending: false }).limit(20);
    $("#imp-log").innerHTML = (data || []).map(x => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${NRC.fmtDate(x.created_at)} &middot; ${NRC.esc(x.kind)} &middot; ${x.rows_processed} rows, ${x.rows_updated} updated, ${x.rows_unmatched} unmatched${x.notes ? '<br><span class="muted">' + NRC.esc(x.notes.slice(0, 300)) + "</span>" : ""}</div>`).join("") || "No imports yet.";
  }

  document.addEventListener("DOMContentLoaded", async () => {
    user = await NRC.requireUser("admin"); if (!user) return;
    route(); loadAll();
  });
})();
