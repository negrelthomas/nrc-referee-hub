/* Admin area */
(function () {
  const $ = NRC.$, sb = () => NRC.sb;
  let user, clubs = [], refs = [], tournaments = [], questions = [], cov = [], sessions = [], currentRef = null;
  const today = () => new Date().toISOString().slice(0, 10);
  const CRIT = [["score_rules_application", "Rules application"], ["score_game_management", "Game management"], ["score_progressive_punishment", "Progressive punishment"], ["score_positioning", "Positioning"], ["score_pair_cooperation", "Pair cooperation"], ["score_communication", "Communication"]];
  const SANCTION = { usath: "USATH", regional: "Regional", club: "Club", international: "International" };
  const PROG = { none: "Not started", nominated: "Nominated", mentor_assigned: "Mentor assigned", in_training: "In training", observed: "Observed", certified_pair: "Certified pair" };

  // ---------- routing ----------
  function route() {
    const h = (location.hash || "#dashboard").slice(1);
    NRC.$$(".admin-nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + h));
    NRC.$$("#panes > div").forEach(p => p.classList.toggle("hidden", p.id !== "pane-" + h));
  }
  window.addEventListener("hashchange", route);

  // ---------- load ----------
  async function loadAll() {
    const [c, r, t, q, v, ts] = await Promise.all([
      sb().from("clubs").select("*").order("name"),
      sb().from("referees").select("*").order("last_name"),
      sb().from("tournaments").select("*").order("start_date", { ascending: false }),
      sb().from("quiz_questions").select("*").order("rule_number").order("created_at"),
      sb().from("club_coverage").select("*"),
      sb().from("training_sessions").select("*").order("starts_at", { ascending: false })
    ]);
    clubs = c.data || []; refs = r.data || []; tournaments = t.data || []; questions = q.data || []; cov = v.data || []; sessions = ts.data || [];
    // stats per referee
    const { data: stats } = await sb().from("referee_season_stats").select("*");
    const { data: evals } = await sb().from("evaluations").select("referee_id,evaluated_on").order("evaluated_on", { ascending: false });
    const yr = new Date().getFullYear();
    refs.forEach(r => { r._games = (stats || []).filter(s => s.referee_id === r.id && s.season === yr).reduce((a, s) => a + s.games, 0); const e = (evals || []).find(e => e.referee_id === r.id); r._lastEval = e ? e.evaluated_on : null; });
    fillSelects(); renderDashboard(); renderPoolRules(); renderRefs(); renderClubs(); renderTournaments(); renderQuestions(); renderSessions(); loadTasks(); loadImportLog();
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
    $("#cov tbody").innerHTML = cov.slice().sort((a, b) => a.referee_count - b.referee_count || a.name.localeCompare(b.name)).map(c => `<tr><td><strong>${NRC.esc(c.name)}</strong></td><td>${NRC.esc([c.city, c.state].filter(Boolean).join(", "))}</td><td>${c.referee_count}</td><td>${c.certified_count}</td><td>${c.has_certified_pair ? '<span class="pill green">Yes</span>' : '<span class="pill red">No</span>'}</td><td>${PROG[c.pair_program_status] || ""}</td></tr>`).join("");
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
      .map(r => `<tr><td><img class="avatar" src="${r.photo_url ? NRC.esc(r.photo_url) : "assets/avatar.svg"}" alt=""></td><td><strong>${NRC.esc(r.first_name + " " + r.last_name)}</strong>${r.active ? "" : ' <span class="pill">inactive</span>'}<br><span class="small muted">${NRC.esc(r.email)}</span></td><td>${NRC.levelPill(r.cert_level)}</td><td>${NRC.esc(club(r.club_id))}</td><td>${NRC.esc([r.home_city, r.home_state].filter(Boolean).join(", "))}</td><td>${NRC.esc(r.home_airport_iata || "")}${r.departure_airport_iata ? " / " + NRC.esc(r.departure_airport_iata) : ""}</td><td>${r._games}</td><td>${r._lastEval ? NRC.fmtDate(r._lastEval) : '<span class="muted">none</span>'}</td><td><button class="btn sm ghost" onclick="openRef('${r.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="9">No referee yet. Add one or import.</td></tr>';
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
    $("#btn-eval").classList.toggle("hidden", !currentRef); $("#btn-game").classList.toggle("hidden", !currentRef);
    if (currentRef) { Object.keys(currentRef).forEach(k => { if (f[k] && f[k].type !== "checkbox") f[k].value = currentRef[k] == null ? "" : currentRef[k]; }); f.active.checked = currentRef.active; }
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
      ex.innerHTML = `<h3 style="margin-top:16px">Tournaments</h3>` + ((hist || []).map(t => `<div class="small">${new Date(t.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}: ${NRC.esc(t.name)} <span class="pill">${SANCTION[t.sanction] || ""}</span> ${t.games != null ? t.games + " games" : '<span class="muted">games pending</span>'}</div>`).join("") || '<div class="small muted">None recorded. Add from Tournament requests > Open.</div>')
        + `<h3 style="margin-top:16px">Training</h3><div class="small">${training}</div>`
        + `<h3 style="margin-top:16px">Certification history</h3>` + ((certs || []).map(c => `<div class="small">${NRC.fmtDate(c.obtained_on)}: ${NRC.levelLabel(c.level)}${c.certified_by ? ", by " + NRC.esc(c.certified_by) : ""}${c.event ? ", " + NRC.esc(c.event) : ""}</div>`).join("") || '<div class="small muted">No history. Saving a level change adds a row.</div>')
        + `<h3 style="margin-top:16px">Evaluations</h3>` + ((ev || []).map(e => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${NRC.fmtDate(e.evaluated_on)}</strong>, ${NRC.esc(e.evaluator_name)}: ${CRIT.map(([k]) => e[k] || "-").join(" / ")}${e.points_to_improve ? "<br>Improve: " + NRC.esc(e.points_to_improve) : ""}${e.shared_with_referee ? ' <span class="pill green">shared</span>' : ""}</div>`).join("") || '<div class="small muted">None yet.</div>');
    }
    $("#dlg-ref").showModal();
  };
  $("#form-ref").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = {};
    ["first_name", "last_name", "email", "phone", "club_id", "cert_level", "cert_date", "cert_by", "home_city", "home_state", "home_airport_iata", "departure_airport_iata", "usath_member_id", "usath_membership_valid_until", "safesport_valid_until", "background_check_valid_until", "admin_notes"].forEach(k => row[k] = f[k].value.trim() || null);
    row.active = f.active.checked; row.updated_at = new Date().toISOString();
    ["home_state", "home_airport_iata", "departure_airport_iata"].forEach(k => { if (row[k]) row[k] = row[k].toUpperCase(); });
    let res;
    if (currentRef) res = await sb().from("referees").update(row).eq("id", currentRef.id).select().single();
    else res = await sb().from("referees").insert(row).select().single();
    if (res.error) { alert("Save failed: " + res.error.message); return; }
    if (!currentRef || currentRef.cert_level !== row.cert_level) await sb().from("certifications").insert({ referee_id: res.data.id, level: row.cert_level, obtained_on: row.cert_date || today(), certified_by: row.cert_by });
    if (!currentRef) alert("Referee added. " + row.email + " can now sign in on the Sign in page with a magic link; send them the site address.");
    $("#dlg-ref").close(); loadAll();
  });

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
  function renderClubs() {
    const TYPE = { adult: "Adult", collegiate_men: "Collegiate (M)", collegiate_women: "Collegiate (W)", youth: "Youth" };
    $("#clubs tbody").innerHTML = clubs.map(c => `<tr><td><strong>${NRC.esc(c.name)}</strong>${c.active ? "" : ' <span class="pill">inactive</span>'}</td><td>${TYPE[c.club_type] || ""}</td><td>${NRC.esc([c.city, c.state].filter(Boolean).join(", "))}</td><td>${NRC.esc(c.nearest_airport_iata || "")}</td><td>${PROG[c.pair_program_status]}</td><td><button class="btn sm ghost" onclick="openClub('${c.id}')">Open</button></td></tr>`).join("");
  }
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

  // ---------- tournaments ----------
  function renderTournaments() {
    $("#tour tbody").innerHTML = tournaments.map(t => `<tr><td><strong>${NRC.esc(t.name)}</strong><br><span class="small muted">${t.games_expected ? t.games_expected + " games" : ""}</span></td><td><span class="pill">${SANCTION[t.sanction] || ""}</span>${t.region ? '<div class="small muted">' + NRC.esc(t.region) + "</div>" : ""}</td><td>${NRC.fmtDate(t.start_date)} to ${NRC.fmtDate(t.end_date)}</td><td>${NRC.esc(t.venue_name || "")}<br><span class="small muted">${NRC.esc([t.venue_city, t.venue_state].filter(Boolean).join(", "))}${t.nearest_airport_iata ? " (" + NRC.esc(t.nearest_airport_iata) + ")" : ""}</span></td><td>${t.pairs_needed}</td><td class="small">${t.hotel_nights_covered || 0} hotel nights<br>${t.flights_covered ? "flights" : "no flights"}, ${t.airport_transfers_covered ? "transfers" : "no transfers"}${t.food_stipend_per_day ? "<br>$" + t.food_stipend_per_day + "/day" : ""}${t.earliest_return_last_day ? "<br>return after " + t.earliest_return_last_day.slice(0, 5) : ""}</td><td class="small">${NRC.esc(t.organizer_name)}<br><a href="mailto:${NRC.esc(t.organizer_email)}">${NRC.esc(t.organizer_email)}</a></td><td><select onchange="setTourStatus('${t.id}',this.value)">${["submitted", "reviewing", "staffed", "completed", "cancelled"].map(s => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select></td><td><button class="btn sm ghost" onclick="openTour('${t.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="9">No requests yet.</td></tr>';
  }
  window.setTourStatus = async function (id, status) { await sb().from("tournaments").update({ status }).eq("id", id); };
  let currentTour = null, pairsCache = [], availCache = [];
  NRC.$$("#dlg-tour .tabs button").forEach(b => b.onclick = () => { NRC.$$("#dlg-tour .tabs button").forEach(x => x.classList.toggle("active", x === b)); ["invites", "candidates", "officiated"].forEach(t => $("#ttab-" + t).classList.toggle("hidden", t !== b.dataset.ttab)); });
  window.openTour = async function (id) {
    currentTour = tournaments.find(t => t.id === id); const f = $("#form-tour");
    $("#dlg-tour-title").textContent = currentTour.name;
    $("#dlg-tour-sub").textContent = `${NRC.fmtDate(currentTour.start_date)} to ${NRC.fmtDate(currentTour.end_date)}, ${[currentTour.venue_city, currentTour.venue_state].filter(Boolean).join(", ")}${currentTour.nearest_airport_iata ? " (" + currentTour.nearest_airport_iata + ")" : ""}. ${currentTour.pairs_needed} pairs needed.`;
    f.sanction.value = currentTour.sanction || "club"; f.region.value = currentTour.region || "";
    $("#asg-ref").innerHTML = refs.filter(r => r.active).map(r => `<option value="${r.id}">${NRC.esc(r.first_name + " " + r.last_name)}</option>`).join("");
    const [{ data: pr }, { data: av }] = await Promise.all([sb().from("pairs").select("*"), sb().from("availability_blocks").select("*").lte("start_date", currentTour.end_date).gte("end_date", currentTour.start_date)]);
    pairsCache = pr || []; availCache = av || [];
    await Promise.all([renderInvites(), renderCandidates(), renderTourAsg()]);
    $("#dlg-tour").showModal();
  };
  const refName = id => { const r = refs.find(x => x.id === id); return r ? r.first_name + " " + r.last_name : "?"; };
  const partnerOf = id => { const p = pairsCache.find(p => (p.referee_a === id || p.referee_b === id) && (!p.valid_until || p.valid_until >= today())); return p ? (p.referee_a === id ? p.referee_b : p.referee_a) : null; };
  const unavailable = id => availCache.find(b => b.referee_id === id);

  // Invitations
  let invites = [];
  async function renderInvites() {
    const { data } = await sb().from("assignment_requests").select("*").eq("tournament_id", currentTour.id).order("created_at");
    invites = data || [];
    const c = s => invites.filter(i => i.status === s).length;
    $("#inv-summary").innerHTML = [["draft", "Draft"], ["sent", "Waiting"], ["accepted", "Accepted"], ["declined", "Declined"], ["confirmed", "Confirmed"]].map(([k, l]) => `<span class="chip ${c(k) ? "on" : ""}">${l}: ${c(k)}</span>`).join("") + `<span class="chip">Needed: ${currentTour.pairs_needed * 2} referees</span>`;
    const STATUS = { draft: "", sent: "amber", accepted: "green", declined: "red", confirmed: "green", no_response: "red", cancelled: "" };
    $("#inv tbody").innerHTML = invites.map(i => `<tr><td><input type="checkbox" class="inv-sel" value="${i.id}" style="width:auto"></td><td><strong>${NRC.esc(refName(i.referee_id))}</strong>${unavailable(i.referee_id) ? ' <span class="pill red">blocked dates</span>' : ""}</td><td><span class="pill ${STATUS[i.status] || ""}">${i.status.replace("_", " ")}</span>${i.reminder_count ? ` <span class="small muted">${i.reminder_count} reminder${i.reminder_count > 1 ? "s" : ""}</span>` : ""}</td><td class="small">${i.sent_at ? NRC.fmtDate(i.sent_at) : ""}</td><td class="small">${i.responded_at ? NRC.fmtDate(i.responded_at) : ""}</td><td class="small">${NRC.esc(i.response_note || "")}</td></tr>`).join("") || '<tr><td colspan="6">No invitations yet. Use Find referees to add candidates.</td></tr>';
  }
  const selectedInv = () => NRC.$$(".inv-sel:checked").map(x => x.value);
  window.sendSelected = async function (kind) {
    let ids = selectedInv(); if (!ids.length) { alert("Select referees first."); return; }
    if (kind === "confirm") { ids = ids.filter(id => invites.find(i => i.id === id && i.status === "accepted")); if (!ids.length) { alert("Only accepted invitations can be confirmed."); return; } }
    if (kind === "invite") ids = ids.filter(id => ["draft", "sent"].includes((invites.find(i => i.id === id) || {}).status));
    const { data: sess } = await sb().auth.getSession();
    const res = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: currentTour.id, request_ids: ids, kind }) });
    const d = await res.json();
    if (!res.ok) { alert("Failed: " + (d.error || res.status)); return; }
    if (kind === "confirm") { for (const id of ids) { const i = invites.find(x => x.id === id); await sb().from("assignments").upsert({ tournament_id: currentTour.id, referee_id: i.referee_id, role: "referee" }, { onConflict: "tournament_id,referee_id" }); } if (currentTour.status === "submitted" || currentTour.status === "reviewing") await sb().from("tournaments").update({ status: "staffed" }).eq("id", currentTour.id); }
    const failed = d.results.filter(r => !r.sent);
    alert(`${d.results.length - failed.length} email${d.results.length - failed.length === 1 ? "" : "s"} sent.` + (failed.length ? ` ${failed.length} not sent: ` + failed.map(f => f.email + " (" + (f.error || "").slice(0, 80) + ")").join("; ") : ""));
    renderInvites(); renderTourAsg();
  };
  window.removeSelected = async function () { const ids = selectedInv().filter(id => (invites.find(i => i.id === id) || {}).status === "draft"); if (ids.length) await sb().from("assignment_requests").delete().in("id", ids); renderInvites(); };

  // Candidates
  function renderCandidates() {
    const q = $("#cand-q").value.toLowerCase(), lvl = $("#cand-level").value, hide = $("#cand-avail").checked;
    const order = ["candidate", "level_1", "level_2", "level_3", "nachc", "ihf"];
    const invited = new Set(invites.map(i => i.referee_id));
    const club = id => (clubs.find(c => c.id === id) || {}).name || "";
    const yr = new Date().getFullYear();
    $("#cand tbody").innerHTML = refs.filter(r => r.active && !invited.has(r.id) && (!lvl || order.indexOf(r.cert_level) >= order.indexOf(lvl)) && (!hide || !unavailable(r.id)) && (!q || [r.first_name, r.last_name, club(r.club_id), r.home_airport_iata, r.home_city].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => (a.home_airport_iata === currentTour.nearest_airport_iata ? -1 : 0) - (b.home_airport_iata === currentTour.nearest_airport_iata ? -1 : 0) || order.indexOf(b.cert_level) - order.indexOf(a.cert_level))
      .map(r => { const u = unavailable(r.id); const p = partnerOf(r.id); return `<tr><td><input type="checkbox" class="cand-sel" value="${r.id}" style="width:auto"></td><td><strong>${NRC.esc(r.first_name + " " + r.last_name)}</strong></td><td>${NRC.levelPill(r.cert_level)}</td><td>${NRC.esc(club(r.club_id))}</td><td>${NRC.esc(r.home_airport_iata || "")}${r.home_airport_iata && r.home_airport_iata === currentTour.nearest_airport_iata ? ' <span class="pill green">local</span>' : ""}</td><td>${u ? `<span class="pill red">blocked ${NRC.fmtDate(u.start_date)}</span>` : '<span class="pill green">open</span>'}</td><td class="small">${r._games} games ${yr}</td><td class="small">${p ? "with " + NRC.esc(refName(p)) : ""}</td></tr>`; }).join("") || '<tr><td colspan="8">No referee matches.</td></tr>';
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
  $("#form-tour").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; await sb().from("tournaments").update({ sanction: f.sanction.value, region: f.region.value || null }).eq("id", currentTour.id); currentTour.sanction = f.sanction.value; currentTour.region = f.region.value || null; loadAll(); });

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
