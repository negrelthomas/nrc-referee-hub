/* Admin area */
(function () {
  const $ = NRC.$, sb = () => NRC.sb;
  let staffSettings = null, staffDups = [], staffView = "table", tourStats = {}, tourFilter = "upcoming";
  let user, clubs = [], refs = [], tournaments = [], questions = [], cov = [], sessions = [], inquiries = [], pstat = [], psettings = null, ctest = null, staffing = [], currentRef = null, contacts = [], clubMsgs = [];
  const today = () => NRC.localDate();
  const CRIT = [["score_rules_application", "Rules application"], ["score_game_management", "Game management"], ["score_progressive_punishment", "Progressive punishment"], ["score_positioning", "Positioning"], ["score_pair_cooperation", "Pair cooperation"], ["score_communication", "Communication"]];
  const SANCTION = { usath: "USATH", regional: "Regional", club: "Club", international: "International" };
  const PROG = { none: "Not started", nominated: "Nominated", mentor_assigned: "Mentor assigned", in_training: "In training", observed: "Observed", certified_pair: "Certified pair" };

  // ---------- routing ----------
  function route() {
    const [h, arg] = (location.hash || "#dashboard").slice(1).split("/");
    if (h === "staffing") { location.replace("#tournaments"); return; }
    const pane = h === "club" ? "clubs" : h === "referee" ? "referees" : h;
    NRC.$$(".admin-nav a:not(.sec-top)").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + pane));
    // the section holding the current page stays open; the others fold to their title
    NRC.$$(".admin-nav .nav-sec").forEach(s => { if (s.querySelector('.sub a[href="#' + pane + '"]')) setSec(s, true); });
    NRC.$$("#panes > div").forEach(p => p.classList.toggle("hidden", p.id !== "pane-" + pane));
    if (h === "referee" && arg && refs.length) openRefFromLink(arg);
    if (h === "club" && arg && clubs.length) renderClubPage(arg);
    window.scrollTo(0, 0);
  }
  // admin/index.html#referee/<id> (Edit profile on the public Referees page) opens the editor once
  function openRefFromLink(id) { history.replaceState(null, "", "#referees"); openRef(id); }
  function setSec(s, open) { s.classList.toggle("open", open); s.querySelector(".sec-top").setAttribute("aria-expanded", open); }
  // section titles fold and unfold; every section can be closed, including the one holding the current page
  NRC.$$(".admin-nav .sec-top").forEach(b => b.addEventListener("click", () => { const s = b.closest(".nav-sec"); setSec(s, !s.classList.contains("open")); }));
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
      sb().from("tournament_overview").select("*").order("start_date")
    ]);
    staffing = (st && st.data) || [];
    if (st && st.error) { const old = await sb().from("tournament_staffing").select("*").order("start_date"); staffing = old.data || []; } // before staffing_overview.sql
    const [{ data: ss }, { data: dd }] = await Promise.all([sb().from("staffing_settings").select("*").eq("id", 1).maybeSingle(), sb().from("tournament_duplicates").select("*")]);
    staffSettings = ss || null; staffDups = dd || [];
    inquiries = (inq && inq.data) || []; pstat = ((ps && ps.data) || []).sort(NRC.byLastName); psettings = (pse && pse.data) || null; ctest = (ct && ct.data) || null;
    clubs = c.data || []; refs = (r.data || []).sort(NRC.byLastName); tournaments = t.data || []; questions = q.data || []; cov = v.data || []; sessions = ts.data || [];
    // stats per referee
    const [{ data: cc }, { data: cm }] = await Promise.all([sb().from("club_contacts").select("*").order("is_primary", { ascending: false }).order("name"), sb().from("club_messages").select("*").order("created_at", { ascending: false })]);
    contacts = cc || []; clubMsgs = cm || [];
    const { data: stats } = await sb().from("referee_season_stats").select("*");
    const [{ data: evals }, { data: gcount }, { data: acount }] = await Promise.all([
      sb().from("evaluations").select("referee_id,evaluated_on,tournament_id,game_id").order("evaluated_on", { ascending: false }),
      sb().from("games").select("id,tournament_id,referee_1,referee_2"),
      sb().from("assignments").select("tournament_id,referee_id,guest_official_id,role,games_officiated")]);
    tourStats = {};
    tournaments.forEach(t => { const A = (acount || []).filter(a => a.tournament_id === t.id), Gm = (gcount || []).filter(g => g.tournament_id === t.id);
      tourStats[t.id] = { officials: A.filter(a => a.referee_id).length, referees: A.filter(a => a.role === "referee" && a.referee_id).length, guests: A.filter(a => a.guest_official_id).length, games: Gm.length, gamesReported: A.reduce((n, a) => n + (a.games_officiated || 0), 0), slots: Gm.reduce((n, g) => n + (g.referee_1 ? 1 : 0) + (g.referee_2 ? 1 : 0), 0), evals: (evals || []).filter(e => e.tournament_id === t.id).length, gameEvals: (evals || []).filter(e => e.tournament_id === t.id && e.game_id).length }; });
    const yr = new Date().getFullYear();
    const { data: logins } = await sb().rpc("admin_referee_logins");
    const LG = {}; (logins || []).forEach(x => LG[x.referee_id] = x);
    refs.forEach(r => { const x = LG[r.id]; r._lastLogin = x ? x.last_sign_in_at : null; r._firstLogin = x ? x.first_sign_in_at : null; });
    refs.forEach(r => { r._games = (stats || []).filter(s => s.referee_id === r.id && s.season === yr).reduce((a, s) => a + s.games, 0); const e = (evals || []).find(e => e.referee_id === r.id); r._lastEval = e ? e.evaluated_on : null; });
    fillSelects(); renderDashboard(); loadRankings(); renderPoolRules(); renderRefs(); renderClubs(); renderTournaments(); renderQuestions(); renderSessions(); renderInquiries(); renderPrograms(); renderStaffing(); renderPlan(); loadTasks(); loadImportLog();
    const [h, arg] = (location.hash || "").slice(1).split("/"); if (h === "club" && arg) renderClubPage(arg);
    if (h === "referee" && arg) openRefFromLink(arg);
  }
  function fillSelects() {
    NRC.$$("select[name=club_id]").forEach(s => { s.innerHTML = '<option value="">No club affiliation</option>' + clubs.map(c => `<option value="${c.id}">${NRC.esc(c.name)}</option>`).join(""); });
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
    $("#compl tbody").innerHTML = bad.map(r => `<tr><td><a href="#" onclick="openRef('${r.id}');return false">${NRC.esc(r.last_name + ", " + r.first_name)}</a></td><td>${NRC.levelPill(r.cert_level)}</td><td>${cell(r.usath_membership_valid_until)}</td><td>${cell(r.safesport_valid_until)}</td><td>${cell(r.background_check_valid_until)}</td></tr>`).join("") || '<tr><td colspan="5">Everyone is current.</td></tr>';
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
  const refSel = new Set();
  const ago = (ts) => { if (!ts) return ""; const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 60 ? d + " days ago" : NRC.fmtDate(String(ts).slice(0, 10)); };
  const fmtTs = (ts) => ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  function shownRefs() {
    const q = $("#r-q").value.toLowerCase(), l = $("#r-level").value, inc = $("#r-inactive").checked, lg = $("#r-login").value;
    const club = id => (clubs.find(c => c.id === id) || {}).name || "";
    const old = Date.now() - 30 * 86400000;
    return refs.filter(r => (inc || r.active) && (!l || r.cert_level === l)
      && (!lg || (lg === "never" ? !r._lastLogin : lg === "yes" ? !!r._lastLogin : (!r._lastLogin || new Date(r._lastLogin).getTime() < old)))
      && (!q || [r.first_name, r.last_name, r.email, club(r.club_id), r.home_city, r.home_state, r.home_airport_iata].join(" ").toLowerCase().includes(q)));
  }
  function renderRefs() {
    const club = id => (clubs.find(c => c.id === id) || {}).name || "";
    const list = shownRefs();
    $("#refs tbody").innerHTML = list
      .map(r => `<tr class="clickable" onclick="openRef('${r.id}')"><td onclick="event.stopPropagation()"><input type="checkbox" style="width:auto" ${refSel.has(r.id) ? "checked" : ""} onchange="toggleRefSel('${r.id}',this.checked)"></td><td><img class="avatar" src="${r.photo_url ? NRC.esc(r.photo_url) : "assets/avatar.svg"}" alt=""></td><td><strong>${NRC.esc(r.last_name + ", " + r.first_name)}</strong>${r.active ? "" : ' <span class="pill">inactive</span>'}<br><span class="small muted">${NRC.esc(r.email)}</span></td><td>${NRC.levelPill(r.cert_level, r.level_confirmed)}${r.level1_theory_passed_on ? ' <span class="pill green">theory passed ' + NRC.fmtDate(r.level1_theory_passed_on) + "</span>" : ""}</td><td>${NRC.esc(club(r.club_id))}</td><td>${NRC.esc([r.home_city, r.home_state].filter(Boolean).join(", "))}</td><td>${NRC.esc(r.home_airport_iata || "")}${r.departure_airport_iata ? " / " + NRC.esc(r.departure_airport_iata) : ""}</td><td>${r._games}</td><td>${r._lastEval ? NRC.fmtDate(r._lastEval) : '<span class="muted">none</span>'}</td><td class="small" title="${NRC.esc(fmtTs(r._lastLogin))}">${r._lastLogin ? ago(r._lastLogin) : r.user_id ? '<span class="muted">unknown</span>' : '<span class="pill amber">never</span>'}</td><td class="small" title="${NRC.esc(fmtTs(r.updated_at))}">${r.updated_by_label ? ago(r.updated_at) + "<br><span class=\"muted\">" + NRC.esc(r.updated_by_label) + "</span>" : '<span class="muted">' + ago(r.updated_at) + "</span>"}</td><td><button class="btn sm ghost" onclick="event.stopPropagation();openRef('${r.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="12">No referee matches.</td></tr>';
    $("#ref-all").checked = list.length > 0 && list.every(r => refSel.has(r.id));
    const b = $("#btn-ref-email"); b.disabled = !refSel.size; b.textContent = refSel.size ? `Email selected (${refSel.size})` : "Email selected";
  }
  window.toggleRefSel = (id, on) => { on ? refSel.add(id) : refSel.delete(id); renderRefs(); };
  $("#ref-all").addEventListener("change", e => { shownRefs().forEach(r => e.target.checked ? refSel.add(r.id) : refSel.delete(r.id)); renderRefs(); });
  ["#r-q", "#r-level", "#r-inactive", "#r-login"].forEach(s => $(s).addEventListener("input", renderRefs));

  // ---------- messages to referees ----------
  const REF_SIGN = "\n\nNational Referee Committee\n{contact_email}";
  function refMsgPreview() {
    const f = $("#form-refmsg"); const r = refs.find(x => refSel.has(x.id)); if (!r) return;
    const v = { first_name: r.first_name, last_name: r.last_name, hub_url: location.origin, profile_url: location.origin + "/profile.html", contact_email: NRC_CONFIG.CONTACT_EMAIL };
    const fill = t => t.replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? String(v[k]) : m);
    $("#refmsg-preview").innerHTML = `<div class="muted" style="margin-bottom:6px">Preview for ${NRC.esc(r.first_name + " " + r.last_name)}, to ${NRC.esc(r.email)}</div><strong>${NRC.esc(fill(f.subject.value))}</strong>\n\n${NRC.esc(fill(f.body.value))}`;
  }
  window.openRefComposer = function () {
    const sel = refs.filter(r => refSel.has(r.id)); if (!sel.length) { alert("Select at least one referee."); return; }
    const ok = sel.filter(r => r.email && !/@demo\.nrc$/i.test(r.email)), skip = sel.filter(r => !ok.includes(r));
    const names = ok.map(r => NRC.esc(r.last_name + ", " + r.first_name));
    $("#refmsg-to").innerHTML = `<p style="margin-top:0"><strong>To:</strong> ${names.slice(0, 25).join("; ")}${names.length > 25 ? " and " + (names.length - 25) + " more" : ""} (${ok.length} referee${ok.length === 1 ? "" : "s"})</p>${skip.length ? `<div class="notice">${skip.length} without a usable email will be skipped: ${skip.map(r => NRC.esc(r.first_name + " " + r.last_name)).join("; ")}.</div>` : ""}`;
    const f = $("#form-refmsg"); if (!f.body.value) f.body.value = "Hi {first_name},\n\n" + REF_SIGN.trim();
    $("#btn-refmsg-send").disabled = !ok.length; $("#btn-refmsg-send").textContent = ok.length ? `Send to ${ok.length} referee${ok.length === 1 ? "" : "s"}` : "Send";
    refMsgPreview(); $("#dlg-refmsg").showModal();
  };
  ["subject", "body"].forEach(n => $("#form-refmsg")[n].addEventListener("input", refMsgPreview));
  window.copyRefEmails = async function () {
    const list = refs.filter(r => refSel.has(r.id) && r.email && !/@demo\.nrc$/i.test(r.email)).map(r => r.email);
    try { await navigator.clipboard.writeText(list.join(", ")); alert(list.length + " address(es) copied."); } catch (e) { prompt("Copy the addresses:", list.join(", ")); }
  };
  window.sendRefMessage = async function (test) {
    const f = $("#form-refmsg");
    if (!f.subject.value.trim() || !f.body.value.trim()) { alert("Subject and message are required."); return; }
    if (!test && !confirm(`Send this message now to ${refSel.size} referee(s)? Each receives their own email.`)) return;
    const { data: sess } = await sb().auth.getSession();
    const res = await fetch("/api/referee-message", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ referee_ids: [...refSel], subject: f.subject.value, body: f.body.value, test: !!test }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { alert("Failed: " + (d.error || res.status)); return; }
    const sent = d.results.filter(r => r.sent).length, failed = d.results.filter(r => !r.sent);
    alert(test ? (sent ? "Test sent to " + d.results[0].email + "." : "Test not sent: " + (failed[0] && failed[0].error)) : sent + " email(s) sent." + (failed.length ? " Not sent: " + failed.map(r => (r.name || r.email) + " (" + String(r.error || "").slice(0, 60) + ")").join("; ") : ""));
    if (!test) { $("#dlg-refmsg").close(); f.reset(); refSel.clear(); renderRefs(); }
  };
  $("#form-refmsg").addEventListener("submit", e => { e.preventDefault(); sendRefMessage(false); });
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
    ["#btn-game", "#btn-phys", "#btn-theory"].forEach(b => $(b).classList.toggle("hidden", !currentRef));
    if (currentRef) $("#btn-game").href = "profile.html?as=" + currentRef.id;
    if (id && !currentRef) { alert("Referee not found."); return; }
    $("#ref-photo").src = (currentRef && currentRef.photo_url) || "assets/avatar.svg";
    const locked = !!(currentRef && currentRef.user_id); f.email.readOnly = locked; f.email.style.background = locked ? "#F0F3F8" : "";
    $("#ref-email-help").textContent = locked ? "Their sign in. Only the referee changes it, under My profile." : currentRef ? "Not signed in yet: correct the address here if the invitation went to the wrong one." : "Their sign in address.";
    $("#ref-photo-remove").classList.toggle("hidden", !(currentRef && currentRef.photo_url));
    if (currentRef) { Object.keys(currentRef).forEach(k => { if (f[k] && f[k].type !== "checkbox" && f[k].type !== "file") f[k].value = currentRef[k] == null ? "" : currentRef[k]; }); f.active.checked = currentRef.active; if (f.level_confirmed) f.level_confirmed.checked = currentRef.level_confirmed !== false; }
    // history
    const ex = $("#ref-extra"); ex.innerHTML = "";
    if (currentRef) {
      const { data: ev } = await sb().from("evaluations").select("*").eq("referee_id", currentRef.id).order("evaluated_on", { ascending: false });
      const { data: certs } = await sb().from("certifications").select("*").eq("referee_id", currentRef.id).order("obtained_on", { ascending: false });
      const { data: hist } = await sb().from("referee_tournament_history").select("*").eq("referee_id", currentRef.id).order("start_date", { ascending: false });
      const { data: glog } = await sb().from("referee_game_log").select("*").eq("referee_id", currentRef.id);
      let training = "";
      if (currentRef.user_id) {
        const { data: ans } = await sb().from("quiz_answers").select("correct,quiz_questions(rule_number),quiz_attempts!inner(user_id)").eq("quiz_attempts.user_id", currentRef.user_id);
        const m = {}; (ans || []).forEach(a => { const k = a.quiz_questions && a.quiz_questions.rule_number; if (k == null) return; m[k] = m[k] || { n: 0, c: 0 }; m[k].n++; if (a.correct) m[k].c++; });
        const tot = (ans || []).length, ok = (ans || []).filter(a => a.correct).length;
        const weak = Object.keys(m).map(Number).filter(r => m[r].n >= 3 && m[r].c / m[r].n < .7).sort((a, b) => m[a].c / m[a].n - m[b].c / m[b].n);
        training = tot ? `${tot} questions answered, ${Math.round(ok / tot * 100)}% correct. ` + (weak.length ? "Weak rules: " + weak.map(r => `Rule ${r} (${Math.round(m[r].c / m[r].n * 100)}%)`).join(", ") + "." : "No rule below 70%.") : "No training activity yet.";
      } else training = "Has not signed in yet.";
      const [L, { data: tests }] = await Promise.all([NRC.latestEvals(currentRef.id, currentRef.user_id), sb().from("referee_tests").select("*").eq("referee_id", currentRef.id).order("tested_on", { ascending: false })]);
      const { data: chg } = await sb().from("referee_changes").select("*").eq("referee_id", currentRef.id).order("changed_at", { ascending: false }).limit(50);
      ex.innerHTML = recordHtml(currentRef, chg || []) + `<h3 style="margin-top:16px">Latest evaluations</h3>` + NRC.latestEvalsHtml(L)
        + `<h3 style="margin-top:16px">Tournaments and games</h3>` + NRC.historyHtml(hist, glog || []) + '<div class="small muted">Click a tournament for its games. Add or correct from Tournaments, Officiated tab.</div>'
        + `<h3 style="margin-top:16px">Physical tests and theory exams</h3>` + ((tests || []).map(t => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${NRC.fmtDate(t.tested_on)}</strong>, ${t.kind === "physical" ? "Physical" : "Theory"}: ${NRC.esc(t.test_name)}${t.result ? " " + NRC.esc(t.result) : ""}${t.passed === true ? ' <span class="pill green">passed</span>' : t.passed === false ? ' <span class="pill red">not passed</span>' : ""}${t.evaluator_name ? ", " + NRC.esc(t.evaluator_name) : ""} <a href="#" onclick="delTest('${t.id}');return false" class="muted">remove</a></div>`).join("") || '<div class="small muted">None recorded.</div>')
        + `<h3 style="margin-top:16px">Training</h3><div class="small">${training}</div>`
        + `<h3 style="margin-top:16px">Certification history</h3>` + ((certs || []).map(c => `<div class="small">${NRC.fmtDate(c.obtained_on)}: ${NRC.levelLabel(c.level)}${c.certified_by ? ", by " + NRC.esc(c.certified_by) : ""}${c.event ? ", " + NRC.esc(c.event) : ""}</div>`).join("") || '<div class="small muted">No history. Saving a level change adds a row.</div>')
        + `<h3 style="margin-top:16px">Evaluations</h3>` + ((ev || []).map(e => { const o = NRC.evalOverall(e), tn = (tournaments.find(t => t.id === e.tournament_id) || {}).name; return `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><a href="#" onclick="editRefEval('${e.id}');return false"><strong>${NRC.fmtDate(e.evaluated_on)}</strong></a>${tn ? ", " + NRC.esc(tn) : ""}${e.game_id ? " (game)" : ""}, ${NRC.esc(NRC.EVAL_SOURCE[e.source] || "")}: ${NRC.esc(e.evaluator_name)} ${o != null ? NRC.scoreHtml(o) : ""}${e.shared_with_referee ? ' <span class="pill green">shared</span>' : ' <span class="pill">NRC only</span>'}${e.points_to_improve ? "<br>Improve: " + NRC.esc(e.points_to_improve) : ""}</div>`; }).join("") || '<div class="small muted">None yet.</div>');
    }
    if (!$("#dlg-ref").open) $("#dlg-ref").showModal();
  };
  const FIELD = { first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone", club_id: "Club", cert_level: "Level", cert_date: "Certified on", cert_by: "Certified by", level_confirmed: "Level confirmed", level1_theory_passed_on: "Level 1 theory passed", home_city: "Home city", home_state: "State", home_airport_iata: "Home airport", departure_airport_iata: "Departure airport", usath_member_id: "USATH member ID", usath_membership_valid_until: "Membership valid until", safesport_valid_until: "SafeSport valid until", background_check_valid_until: "Background check valid until", admin_notes: "Admin notes", availability_notes: "Availability notes", active: "Active", photo_url: "Photo", user_id: "Sign in account", share_contact: "Shares contact details" };
  function recordHtml(r, chg) {
    const val = (k, v) => { if (v == null || v === "") return "empty"; if (k === "club_id") return clubName(v) || "club"; if (k === "cert_level") return NRC.levelLabel(v); if (k === "photo_url") return "photo"; if (k === "user_id") return "linked"; if (typeof v === "boolean") return v ? "yes" : "no"; const s = String(v); return s.length > 60 ? s.slice(0, 60) + "..." : s; };
    const head = `<div class="card small" style="margin-top:16px;background:#F7F9FC"><strong>Record</strong><br>Created ${NRC.esc(fmtTs(r.created_at))}${r.created_by_label ? " by " + NRC.esc(r.created_by_label) : ""}<br>Last updated ${NRC.esc(fmtTs(r.updated_at))}${r.updated_by_label ? " by " + NRC.esc(r.updated_by_label) : " (author not recorded: before change tracking started)"}<br>Last sign in: ${r._lastLogin ? NRC.esc(fmtTs(r._lastLogin)) : r.user_id ? "unknown" : "never signed in"}${r._firstLogin ? ", first sign in " + NRC.esc(fmtTs(r._firstLogin)) : ""}</div>`;
    const rows = chg.map(c => { const ch = c.changes || {}; const keys = Object.keys(ch).filter(k => FIELD[k] || !/^(id|_)/.test(k));
      const what = c.action === "insert" ? "Record created" : keys.map(k => `${NRC.esc(FIELD[k] || k.replace(/_/g, " "))}: ${NRC.esc(val(k, ch[k][0]))} &rarr; <strong>${NRC.esc(val(k, ch[k][1]))}</strong>`).join("<br>");
      return `<tr><td style="white-space:nowrap">${NRC.esc(fmtTs(c.changed_at))}</td><td>${NRC.esc(c.changed_by_label)}</td><td>${what}</td></tr>`; }).join("");
    return head + `<details style="margin-top:8px"><summary class="small"><strong>Change history</strong> (${chg.length}${chg.length === 50 ? "+" : ""})</summary>${rows ? `<div class="table-wrap"><table class="small"><thead><tr><th>When</th><th>Who</th><th>What changed</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="small muted">No change recorded since tracking started on October 22, 2026.</p>'}</details>`;
  }
  $("#form-ref").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = {};
    ["first_name", "last_name", "email", "phone", "club_id", "cert_level", "cert_date", "cert_by", "home_city", "home_state", "home_airport_iata", "departure_airport_iata", "usath_member_id", "usath_membership_valid_until", "safesport_valid_until", "background_check_valid_until", "admin_notes"].forEach(k => row[k] = f[k].value.trim() || null);
    row.active = f.active.checked; row.level_confirmed = f.level_confirmed ? f.level_confirmed.checked : true; row.updated_at = new Date().toISOString();
    ["home_state", "home_airport_iata", "departure_airport_iata"].forEach(k => { if (row[k]) row[k] = row[k].toUpperCase(); });
    // Once a referee has signed in, the email is theirs: they change it under My profile (confirmed by email)
    if (currentRef && currentRef.user_id) row.email = currentRef.email;
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

  // evaluation (shared form in games.js, criteria from Rankings)
  const refEvalOpts = () => ({ referee: { id: currentRef.id, name: currentRef.first_name + " " + currentRef.last_name }, mode: "admin", user, evaluatorName: (user && (user.full_name || user.email)) || "NRC", tournaments: tournaments.filter(t => t.start_date <= today()).map(t => ({ id: t.id, name: t.name + " (" + NRC.fmtDate(t.start_date) + ")" })), onSaved: () => { openRef(currentRef.id); loadAll(); } });
  window.openEval = function () { NRC.Games.openEval(refEvalOpts()); };
  window.editRefEval = function (id) { NRC.Games.editEval(id, refEvalOpts()); };
  // game
  window.openGame = function () {
    const f = $("#form-game"); f.reset(); f.game_date.value = today();
    f.referee_2.innerHTML = '<option value="">None</option>' + refs.filter(r => r.id !== currentRef.id && r.active).map(r => `<option value="${r.id}">${NRC.esc(r.last_name + ", " + r.first_name)}</option>`).join("");
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
    if (currentClub) { Object.keys(currentClub).forEach(k => { if (f[k] && f[k].type !== "checkbox") f[k].value = currentClub[k] == null ? "" : currentClub[k]; }); f.active.checked = currentClub.active; f.usath_registered.checked = currentClub.usath_registered !== false; }
    $("#dlg-club").showModal();
  };
  $("#form-club").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const row = {};
    ["name", "club_type", "website", "city", "state", "nearest_airport_iata", "pair_program_status", "pair_program_notes"].forEach(k => row[k] = f[k].value.trim() || null);
    row.active = f.active.checked; if (currentClub && "usath_registered" in currentClub || !currentClub) row.usath_registered = f.usath_registered.checked; if (row.state) row.state = row.state.toUpperCase(); if (row.nearest_airport_iata) row.nearest_airport_iata = row.nearest_airport_iata.toUpperCase();
    const res = currentClub ? await sb().from("clubs").update(row).eq("id", currentClub.id) : await sb().from("clubs").insert(row);
    if (res.error) { alert(res.error.message); return; }
    $("#dlg-club").close(); loadAll();
  });

  // ---------- clubs: list, club page, contacts, messages, action plan ----------
  const CTYPE = { adult: "Adult", collegiate_men: "Collegiate (M)", collegiate_women: "Collegiate (W)", youth: "Youth" };
  const CERT = ["level_1", "level_2", "level_3", "nachc", "ihf"];
  const AFF = { member: "Member", volunteer: "Volunteer", none: "No club affiliation" };
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
    $("#cp-actions").innerHTML = clubActions(c, s).map(a => `<div class="task"><div style="flex:1"><div class="t">${NRC.esc(a.title)}</div><div class="small">${NRC.esc(a.why)}</div></div>${a.template ? `<button class="btn sm secondary" onclick="openComposer(['${c.id}'],'${a.template}')">Prepare message</button>` : a.href ? `<a class="btn sm ghost" href="${a.href}">Open</a>` : ""}</div>`).join("") || '<div class="notice ok">Nothing pending for this club.</div>';
    $("#cp-contacts").innerHTML = s.contacts.map(x => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><div><strong>${NRC.esc(x.name || "No name")}</strong>${x.is_primary ? ' <span class="pill green">primary</span>' : ""}${x.receives_messages ? "" : ' <span class="pill">no messages</span>'}<br>${NRC.esc(x.role || "")}${x.email ? ` <a href="mailto:${NRC.esc(x.email)}">${NRC.esc(x.email)}</a>` : ""}${x.phone ? " · " + NRC.esc(x.phone) : ""}${x.source ? `<br><span class="muted">${NRC.esc(x.source)}</span>` : ""}</div><button class="btn sm ghost" style="align-self:flex-start" onclick="openContact('${x.id}')">Edit</button></div>`).join("") || '<span class="muted">No contact on file. Add one to message this club.</span>';
    $("#cp-pair").innerHTML = `<p style="margin-top:0"><span class="pill ${s.pair ? "green" : c.pair_program_status === "none" ? "red" : "amber"}">${PROG[c.pair_program_status]}</span>${s.pair ? ' <span class="pill green">certified pair on the roster</span>' : ""}</p>${c.pair_program_notes ? "<p>" + NRC.esc(c.pair_program_notes) + "</p>" : '<p class="muted">No notes. Update the status and notes with Edit club.</p>'}`;
    const prog = id => { const p = pstat.find(x => x.referee_id === id); if (!p) return ""; const r = refs.find(x => x.id === id);
      if (r.cert_level === "candidate") return r.level1_theory_passed_on ? '<span class="pill green">theory passed</span>' : p.user_id ? '<span class="pill amber">Level 1 course</span>' : '<span class="pill">not signed in yet</span>';
      if (!p.baseline_at) return '<span class="pill red">no baseline</span>';
      return p.program_status === "cleared" ? '<span class="pill green">cleared</span>' : p.program_status ? '<span class="pill amber">program ' + (p.due_on < today() ? "overdue" : "due " + NRC.fmtDate(p.due_on)) + "</span>" : ""; };
    $("#cp-reftable tbody").innerHTML = s.refs.map(r => `<tr><td><strong>${NRC.esc(r.last_name + ", " + r.first_name)}</strong></td><td>${NRC.levelPill(r.cert_level, r.level_confirmed)}</td><td>${prog(r.id)}</td><td>${r._games || ""}</td><td>${r._lastEval ? NRC.fmtDate(r._lastEval) : '<span class="muted">none</span>'}</td><td><button class="btn sm ghost" onclick="openRef('${r.id}')">Open</button></td></tr>`).join("") || '<tr><td colspan="6">No referee from this club on the roster.</td></tr>';
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
    $("#plan").innerHTML = planActions().map((a, i) => `<div class="task"><div class="pill" style="min-width:28px;text-align:center">${i + 1}</div><div style="flex:1;min-width:0"><div class="t">${NRC.esc(a.title)}</div><div class="small">${NRC.esc(a.why)}</div>${a.clubs ? `<div class="chips" style="margin:6px 0 0">${a.clubs.slice(0, 8).map(chip).join("")}${a.clubs.length > 8 ? `<span class="chip" onclick="this.parentNode.innerHTML=${NRC.esc(JSON.stringify(a.clubs.map(chip).join("")))}">+${a.clubs.length - 8} more</span>` : ""}</div>` : ""}</div>${a.template ? `<button class="btn sm secondary" onclick='openComposer(${JSON.stringify(a.clubs)},"${a.template}")'>Prepare message</button>` : a.href ? `<a class="btn sm ghost" href="${a.href}">Open</a>` : ""}</div>`).join("") || '<div class="notice ok">No action pending.</div>';
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
    $("#inq tbody").innerHTML = inquiries.map(i => `<tr><td class="small">${NRC.fmtDate(i.created_at)}</td><td><strong>${NRC.esc(i.last_name + ", " + i.first_name)}</strong></td><td class="small"><a href="mailto:${NRC.esc(i.email)}">${NRC.esc(i.email)}</a>${i.phone ? "<br>" + NRC.esc(i.phone) : ""}</td><td class="small">${NRC.esc([i.city, i.state].filter(Boolean).join(", "))}</td><td class="small">${NRC.esc(i.club_name || "")}</td><td class="small">${inqClub(i) ? `<a href="#club/${inqClub(i)}">${NRC.esc(clubName(inqClub(i)))}</a>` : ""}${i.club_affiliation ? '<br><span class="pill">' + AFF[i.club_affiliation] + "</span>" : ""}</td><td class="small">${NRC.esc(i.background || "")}</td><td class="small">${NRC.esc(i.availability || "")}</td><td class="small">${NRC.esc(i.message || "")}</td><td><select onchange="setInqStatus('${i.id}',this.value)">${ST.map(x => `<option ${x === i.status ? "selected" : ""}>${x}</option>`).join("")}</select></td><td><button class="btn sm ghost" onclick="inviteFromInquiry('${i.id}')">Add to roster</button></td></tr>`).join("") || '<tr><td colspan="11">No contact requests yet.</td></tr>';
  }
  window.setInqStatus = async function (id, status) { const res = await sb().from("referee_inquiries").update({ status }).eq("id", id); if (res.error) alert(res.error.message); else loadAll(); };
  window.inviteFromInquiry = function (id) {
    const i = inquiries.find(x => x.id === id); if (!i) return;
    openRef(null); const f = $("#form-ref");
    if (f) { f.first_name.value = i.first_name; f.last_name.value = i.last_name; f.email.value = i.email; if (f.phone) f.phone.value = i.phone || ""; if (f.home_city) f.home_city.value = i.city || ""; if (f.home_state) f.home_state.value = i.state || ""; if (f.cert_level) f.cert_level.value = "candidate"; if (f.club_id && inqClub(i)) f.club_id.value = inqClub(i); }
    sb().from("referee_inquiries").update({ status: "invited" }).eq("id", id).then(() => {});
  };

  // ---------- programs ----------
  // initial assessment due 7 days after the first sign in; reminders go out every 48 hours (daily job)
  function baselineDue(p) {
    const r = refs.find(x => x.id === p.referee_id); const first = r && r._firstLogin;
    if (!p.user_id || !first) return '<span class="pill">not signed in</span>';
    const due = new Date(new Date(first).getTime() + 7 * 864e5), d = NRC.localDate(due);
    return due < new Date() ? `<span class="pill red">overdue, due ${NRC.fmtDate(d)}</span>` : `<span class="pill amber">due ${NRC.fmtDate(d)}</span>`;
  }
  function renderPrograms() {
    const PS = { active: "In progress", ready_for_retest: "Ready for re-test", cleared: "Cleared", expired: "Replaced" };
    $("#pstat tbody").innerHTML = pstat.map(p => `<tr><td><strong>${NRC.esc(p.last_name + ", " + p.first_name)}</strong></td><td>${NRC.levelPill(p.cert_level)}</td><td>${p.user_id ? "Yes" : '<span class="muted">not yet</span>'}</td><td>${p.cert_level === "candidate" ? '<span class="muted">Level 1 course</span>' : p.baseline_at ? NRC.fmtDate(p.baseline_at) : baselineDue(p)}</td><td>${p.last_pct != null ? p.last_pct + "%" : ""}</td><td>${p.program_status ? (p.program_status === "cleared" ? '<span class="pill green">Cleared</span>' : p.program_status === "active" && p.due_on < today() ? '<span class="pill red">Overdue</span>' : '<span class="pill amber">' + PS[p.program_status] + "</span>") : ""}</td><td>${p.modules_total ? p.modules_done + "/" + p.modules_total : ""}</td><td>${p.due_on && p.program_status !== "cleared" ? NRC.fmtDate(p.due_on) : ""}</td></tr>`).join("") || '<tr><td colspan="8">No referees on the roster yet.</td></tr>';
    if (psettings) { const f = $("#form-ps"); Object.keys(psettings).forEach(k => { if (f[k]) f[k].value = psettings[k]; }); }
    if (ctest) { const f = $("#form-ct"); Object.keys(ctest).forEach(k => { if (f[k]) f[k].value = ctest[k]; }); }
  }
  $("#form-ps").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; const row = {}; ["assessment_questions", "assessment_pass_pct", "weak_rule_pct", "program_weeks", "sessions_per_week", "time_limit_minutes", "module_question_count", "module_pass_pct"].forEach(k => row[k] = parseInt(f[k].value, 10)); row.updated_at = new Date().toISOString(); const res = await sb().from("program_settings").update(row).eq("id", 1); if (res.error) alert(res.error.message); else loadAll(); });
  $("#form-ct").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; const row = { max_difficulty: f.max_difficulty.value }; ["question_count", "pass_pct", "time_limit_minutes", "module_question_count", "module_pass_pct"].forEach(k => row[k] = parseInt(f[k].value, 10)); row.updated_at = new Date().toISOString(); const res = await sb().from("certification_tests").update(row).eq("level", "level_1"); if (res.error) alert(res.error.message); else loadAll(); });

  // ---------- staffing cards ----------
  let staffFilter = "open";
  window.openStaffSettings = function () {
    const f = $("#form-staffset"), v = staffSettings || { staff_by_days_before: 42, remind_every_days: 7, remind_daily_within_days: 14, remind_to: "" };
    ["staff_by_days_before", "remind_every_days", "remind_daily_within_days", "remind_to"].forEach(k => f[k].value = v[k] == null ? "" : v[k]);
    $("#dlg-staffset").showModal();
  };
  $("#form-staffset").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const row = { id: 1, staff_by_days_before: parseInt(f.staff_by_days_before.value, 10), remind_every_days: parseInt(f.remind_every_days.value, 10), remind_daily_within_days: parseInt(f.remind_daily_within_days.value, 10), remind_to: f.remind_to.value.trim() || null, updated_at: new Date().toISOString() };
    const { error } = await sb().from("staffing_settings").upsert(row);
    if (error) { alert("Save failed: " + error.message); return; }
    staffSettings = row; $("#dlg-staffset").close(); renderStaffing();
  });
  function renderStaffing() {
    const t = today();
    const v = staffSettings;
    $("#staff-settings-line").innerHTML = v ? `Deadline to staff: ${v.staff_by_days_before} days before the event. Reminders to ${NRC.esc(v.remind_to || "the NRC contact email")}: on each new request, every ${v.remind_every_days} days while not staffed, daily in the last ${v.remind_daily_within_days} days before the deadline. <a href="#" onclick="openStaffSettings();return false">Change</a>` : "Run supabase/staffing_overview.sql to enable deadlines and reminders.";
    $("#staff-dups").innerHTML = staffDups.length ? `<div class="alert"><div><div class="t">Possible duplicate requests (${staffDups.length})</div>${staffDups.map(d => `<div class="small"><a href="#" onclick="openTour('${d.id_a}');return false">${NRC.esc(d.name_a)}</a> (${NRC.fmtDate(d.start_a)}, ${NRC.esc(d.email_a)}) and <a href="#" onclick="openTour('${d.id_b}');return false">${NRC.esc(d.name_b)}</a> (${NRC.fmtDate(d.start_b)}, ${NRC.esc(d.email_b)}): ${NRC.esc(d.reason)}. Cancel the one to drop.</div>`).join("")}</div></div>` : "";
  }

  // ---------- designated and travel ----------
  let desRows = [], travelRows = [], noInvite = [];
  // Designated before the hub tracked invitations (acceptance given by email or in person): the admin records it
  window.openRecordAccept = function (ids) {
    ids = (ids || noInvite).filter(Boolean); if (!ids.length) return;
    const f = $("#form-accept"); f.reset(); f.ids.value = ids.join(","); f.reqs.value = ""; f.mode.value = "record";
    $("#acc-title").textContent = "Record acceptance given outside the hub"; $("#acc-submit").textContent = "Record";
    $("#acc-effect").textContent = "Records their invitation as accepted and designated, on the Answers tab and on their home";
    f.reason.placeholder = "";
    f.reason.value = "You accepted by email before the NRC Referee Hub was used for this event.";
    $("#acc-who").innerHTML = `<strong>${NRC.esc(currentTour.name)}</strong>: ${ids.map(id => NRC.esc(refName(id))).join("; ")}`;
    $("#dlg-accept").showModal();
  };
  // Overrule: designate referees who said yes by phone, email or in person but have not answered on the hub
  window.openDesignateOutside = function () {
    const sel = selectedInv().map(id => invites.find(i => i.id === id)).filter(i => i && i.status !== "confirmed");
    if (!sel.length) { alert("Tick the referees who accepted by phone, email or in person (not those already designated)."); return; }
    const refIds = sel.map(i => i.referee_id);
    const already = invites.filter(i => i.status === "confirmed").map(i => i.referee_id);
    const after = new Set([...already, ...refIds]); const need = currentTour.pairs_needed * 2; const issues = [];
    if (after.size > need) issues.push(`${after.size} referees would be designated; the tournament needs ${need} (${currentTour.pairs_needed} pairs).`);
    refIds.forEach(rid => { const p = partnerOf(rid); if (p && !after.has(p)) issues.push(`${refName(rid)} forms a pair with ${refName(p)}, who is not in the designated set.`); });
    const declined = sel.filter(i => i.status === "declined").map(i => refName(i.referee_id));
    if (declined.length) issues.push(`Declined on the hub: ${declined.join("; ")}. Designate only if they told you they now accept.`);
    if (issues.length && !confirm("Check before designating:\n\n" + issues.join("\n") + "\n\nContinue?")) return;
    const f = $("#form-accept"); f.reset(); f.mode.value = "designate"; f.ids.value = ""; f.reqs.value = sel.map(i => i.id).join(",");
    $("#acc-title").textContent = "Designate on an acceptance given outside the hub"; $("#acc-submit").textContent = "Designate";
    $("#acc-effect").textContent = "Marks them accepted and designated, adds them to the team and moves the event to staffed; the note is kept on their invitation";
    f.reason.value = ""; f.reason.placeholder = "For example: You accepted by phone with Joshua Forsthoefel on October 23, 2026.";
    $("#acc-who").innerHTML = `<strong>${NRC.esc(currentTour.name)}</strong>: ${sel.map(i => NRC.esc(refName(i.referee_id)) + ' <span class="small muted">(' + NRC.esc((STATUS_WORD[i.status] || i.status).replace("_", " ")) + ")</span>").join("; ")}`;
    $("#dlg-accept").showModal();
  };
  const STATUS_WORD = { draft: "not invited yet", sent: "invited, no answer", tentative: "tentative", accepted: "accepted", declined: "declined", no_response: "no answer", cancelled: "released" };
  $("#form-accept").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const ids = f.ids.value.split(",").filter(Boolean); const reason = f.reason.value.trim();
    if (reason.length < 15) { alert("Say how and when they accepted, in a full sentence."); return; }
    const sb_ = f.querySelector("[type=submit]"); if (sb_.disabled) return; sb_.disabled = true; sb_.classList.add("busy"); toast("Recording" + (f.send.checked ? " and sending the designation emails" : "") + "...");
    try {
    const by = (user && (user.full_name || user.email)) || "NRC admin";
    const now = new Date().toISOString();
    const note = "Recorded by " + by + ": " + reason;
    let rows, error;
    if (f.mode.value === "designate") {
      const reqIds = f.reqs.value.split(",").filter(Boolean);
      ({ data: rows, error } = await sb().from("assignment_requests").update({ status: "confirmed", responded_at: now, response_note: note }).in("id", reqIds).select("id,referee_id,sent_at"));
      if (!error) {
        const unsent = rows.filter(q => !q.sent_at).map(q => q.id);
        if (unsent.length) await sb().from("assignment_requests").update({ sent_at: now }).in("id", unsent);
        for (const q of rows) await sb().from("assignments").upsert({ tournament_id: currentTour.id, referee_id: q.referee_id, role: "referee" }, { onConflict: "tournament_id,referee_id" });
        if (currentTour.status === "submitted" || currentTour.status === "reviewing") { await sb().from("tournaments").update({ status: "staffed" }).eq("id", currentTour.id); currentTour.status = "staffed"; }
      }
    } else {
      ({ data: rows, error } = await sb().from("assignment_requests").insert(ids.map(id => ({ tournament_id: currentTour.id, referee_id: id, status: "confirmed", sent_at: now, responded_at: now, response_note: note }))).select("id,referee_id"));
    }
    if (error) { alert(error.message); return; }
    let msg = f.mode.value === "designate" ? `${rows.length} referee${rows.length > 1 ? "s" : ""} designated on an acceptance given outside the hub.` : `${rows.length} acceptance${rows.length > 1 ? "s" : ""} recorded.`;
    if (f.send.checked) {
      const mail = rows.filter(q => { const r = refs.find(x => x.id === q.referee_id); return r && r.email && !/@demo\.nrc$/i.test(r.email); }).map(q => q.id);
      if (mail.length) {
        const { data: sess } = await sb().auth.getSession();
        const res = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: currentTour.id, request_ids: mail, kind: "confirm" }) });
        const d = await res.json().catch(() => ({}));
        msg += res.ok ? ` ${d.results.filter(r => r.sent).length} designation email(s) sent.` : " Emails not sent: " + (d.error || res.status);
      }
    }
    toast(msg, "ok", 8000); $("#dlg-accept").close(); renderInvites(); renderDesignated();
    } finally { sb_.disabled = false; sb_.classList.remove("busy"); }
  });
  const KIND = { flight: "Flight", hotel: "Hotel", car: "Car", train: "Train", other: "Other" };
  const fmtDT = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  async function renderDesignated() {
    const [{ data: asg }, { data: acc }] = await Promise.all([sb().from("assignments").select("*, guest_officials(*)").eq("tournament_id", currentTour.id), sb().from("assignment_requests").select("referee_id,status").eq("tournament_id", currentTour.id).in("status", ["accepted", "tentative"])]);
    desRows = asg || [];
    const usath = desRows.filter(a => a.referee_id), guests = desRows.filter(a => a.guest_official_id);
    const { data: allReq } = await sb().from("assignment_requests").select("referee_id,status").eq("tournament_id", currentTour.id);
    const hasReq = new Set((allReq || []).map(q => q.referee_id));
    noInvite = usath.filter(a => a.role === "referee" && !hasReq.has(a.referee_id)).map(a => a.referee_id);
    const ids = desRows.map(a => a.id);
    const { data: tb } = ids.length ? await sb().from("travel_bookings").select("*").in("assignment_id", ids).order("start_at") : { data: [] };
    travelRows = tb || [];
    const need = currentTour.pairs_needed * 2; const refsConfirmed = usath.filter(a => a.role === "referee").length;
    const openList = (acc || []).filter(a => !desRows.find(d => d.referee_id === a.referee_id));
    $("#des-summary").innerHTML = `<span class="chip ${refsConfirmed >= need ? "on" : ""}">${refsConfirmed}/${need} referees designated</span><span class="chip">${usath.filter(a => a.role !== "referee").length} supervisor or observer${currentTour.supervisor_needed ? " (requested)" : ""}</span><span class="chip">${currentTour.travel_managed_by === "nrc" ? "NRC books travel" : "Organizer books travel"}</span>` + (openList.length ? `<span class="chip">Open to officiate, not designated: ${openList.map(a => NRC.esc(refName(a.referee_id)) + (a.status === "tentative" ? " (tentative)" : "")).join("; ")}</span>` : "");
    if (noInvite.length) $("#des-summary").insertAdjacentHTML("beforeend", `<span class="chip" style="background:#FFF4D6">${noInvite.length} designated without an acceptance on file <button class="btn sm" type="button" style="margin-left:6px" onclick="openRecordAccept()">Record acceptance</button></span>`);
    $("#des tbody").innerHTML = usath.map(a => { const r = refs.find(x => x.id === a.referee_id) || {};
      const blk = unavailable(a.referee_id); const st = overrideOf(a.referee_id) ? "available" : blk && a.confirmed_at && new Date(blk.created_at) > new Date(a.confirmed_at) ? "blocked" : weekendStatus(a.referee_id) === "booked" ? "unavailable" : "available";
      return `<tr><td><strong>${NRC.esc(refName(a.referee_id))}</strong>${noInvite.includes(a.referee_id) ? ` <span class="pill amber" title="Designated without an invitation on the hub">no acceptance on file</span> <button class="btn sm ghost" type="button" onclick="openRecordAccept(['${a.referee_id}'])">Record acceptance</button>` : ""}${st === "blocked" || st === "unavailable" ? ` <span class="pill red" title="Declared by the referee after the designation">conflict: ${NRC.esc(availWord(a.referee_id))}</span>${ovBtn(a.referee_id)}` : ""} ${ovPill(a.referee_id)}<br><span class="small muted">${NRC.esc(r.email || "")}${r.phone ? ", " + NRC.esc(r.phone) : ""}</span></td><td>${NRC.esc(a.role)}</td><td class="small">${NRC.esc([r.home_city, r.home_state].filter(Boolean).join("; "))}${r.home_airport_iata ? " (" + NRC.esc(r.departure_airport_iata || r.home_airport_iata) + ")" : ""}</td><td class="small">${bookingsCell(a)}</td><td><button class="btn sm ghost" type="button" onclick="removeDesignated('${a.id}')">Remove</button></td></tr>`; }).join("") || '<tr><td colspan="5">Nobody designated yet. Designate accepted referees on the Answers tab.</td></tr>';
    // guest pairs: grouped by pair, numbered in the order they were added
    const keys = [...new Set(guests.map(a => a.guest_officials.pair_key || a.guest_official_id))];
    guests.sort((x, y) => keys.indexOf(x.guest_officials.pair_key || x.guest_official_id) - keys.indexOf(y.guest_officials.pair_key || y.guest_official_id) || asgName(x).localeCompare(asgName(y)));
    const declared = currentTour.pairs_organizer || 0;
    $("#guest-summary").innerHTML = `<span class="chip ${declared && keys.length >= declared ? "on" : ""}">${keys.length}/${declared} organizer pair${declared === 1 ? "" : "s"} named${currentTour.organizer_pairs_note ? " (" + NRC.esc(currentTour.organizer_pairs_note) + ")" : ""}</span>`;
    $("#btn-guest-add").disabled = keys.length >= declared;
    $("#guests tbody").innerHTML = guests.map(a => { const g = a.guest_officials, k = g.pair_key || a.guest_official_id;
      return `<tr><td><strong>${NRC.esc(asgName(a))}</strong> <span class="pill">pair ${keys.indexOf(k) + 1}</span><br><span class="small muted">${NRC.esc(g.email || "no email")}${g.phone ? ", " + NRC.esc(g.phone) : ""}</span></td><td class="small">${NRC.esc(g.federation)}</td><td class="small">${NRC.esc(g.home_city || "")}${g.home_airport_iata ? " (" + NRC.esc(g.home_airport_iata) + ")" : ""}</td><td class="small">${bookingsCell(a)}</td><td style="white-space:nowrap"><button class="btn sm ghost" type="button" onclick="openGuestPair('${k}')">Edit</button> <button class="btn sm ghost" type="button" onclick="removeDesignated('${a.id}')">Remove pair</button></td></tr>`; }).join("") || `<tr><td colspan="5" class="muted">${currentTour.pairs_organizer ? "No organizer pair named yet." : "The organizer declared no pair from outside USATH."}</td></tr>`;
    $("#des-ref").innerHTML = refs.filter(r => r.active && !desRows.find(d => d.referee_id === r.id)).map(r => `<option value="${r.id}">${NRC.esc(r.last_name + ", " + r.first_name)} (${NRC.levelLabel(r.cert_level).replace(" (National)", "")})</option>`).join("");
    renderSnap();
  }
  function bookingsCell(a) {
    const bk = travelRows.filter(b => b.assignment_id === a.id);
    return (bk.map(b => `<div>${KIND[b.kind]}: ${NRC.esc(b.provider || "")} ${NRC.esc(b.reference || "")} ${fmtDT(b.start_at)}${b.end_at ? " to " + fmtDT(b.end_at) : ""}${b.cost ? " $" + b.cost : ""} <span class="pill ${b.status === "booked" ? "green" : b.status === "cancelled" ? "red" : "amber"}">${b.status}</span> <a href="#" onclick="openTravel('${a.id}','${b.id}');return false">edit</a></div>`).join("") || '<span class="muted">none</span>') + `<div style="margin-top:4px"><button class="btn sm ghost" type="button" onclick="openTravel('${a.id}',null)">Add booking</button></div>`;
  }
  // ---------- organizer pairs from outside USATH (guests) ----------
  // Rule: always the organizer's pairs; the NRC or the organizer names them, within pairs_organizer. Enforced in save_guest_pair.
  let guestPool = [], guestEdit = null;
  const guestFields = (f, x, g) => { f[x + "_first"].value = g ? g.first_name : ""; f[x + "_last"].value = g ? g.last_name : ""; f[x + "_email"].value = g ? g.email || "" : ""; f[x + "_phone"].value = g ? g.phone || "" : ""; f[x + "_city"].value = g ? g.home_city || "" : ""; f[x + "_iata"].value = g ? g.home_airport_iata || "" : ""; };
  const pairOf = k => guestPool.filter(g => (g.pair_key || g.id) === k).sort((x, y) => x.created_at.localeCompare(y.created_at));
  function fillGuestForm(k) {
    const f = $("#form-guest"), P = k ? pairOf(k) : [];
    guestFields(f, "a", P[0]); guestFields(f, "b", P[1]);
    f.federation.value = P[0] ? P[0].federation : (currentTour.organizer_pairs_note || "");
    f.payment_notes.value = P[0] ? P[0].payment_notes || "" : ""; f.notes.value = P[0] ? P[0].notes || "" : "";
  }
  window.openGuestPair = async function (pairKey) {
    const named = Math.ceil(desRows.filter(a => a.guest_official_id).length / 2), declared = currentTour.pairs_organizer || 0;
    if (!pairKey && named >= declared) { alert(declared ? `The organizer declared ${declared} pair${declared > 1 ? "s" : ""} from outside USATH and ${declared > 1 ? "all are" : "it is"} named. Raise "Pairs sourced outside USATH" in the event details first.` : `The organizer declared no pair from outside USATH. Set "Pairs sourced outside USATH" in the event details first; the pairs USATH staffs go down by the same number.`); return; }
    const { data } = await sb().from("guest_officials").select("*").order("created_at");
    guestPool = data || []; guestEdit = pairKey || null;
    const f = $("#form-guest"); f.reset();
    const onEvent = new Set(desRows.filter(a => a.guest_official_id).map(a => a.guest_officials.pair_key || a.guest_official_id));
    const keys = [...new Set(guestPool.map(g => g.pair_key || g.id))].filter(k => k === pairKey || !onEvent.has(k)).filter(k => pairOf(k).length === 2);
    f.reuse.innerHTML = '<option value="">New pair</option>' + keys.map(k => { const P = pairOf(k); return `<option value="${k}">${NRC.esc(P.map(g => g.last_name + ", " + g.first_name).join(" and "))} (${NRC.esc(P[0].federation)})</option>`; }).join("");
    f.reuse.value = pairKey || ""; f.reuse.disabled = !!pairKey;
    fillGuestForm(pairKey);
    $("#dlg-guest h3").textContent = pairKey ? "Edit organizer pair" : "Organizer pair from outside USATH";
    $("#dlg-guest").showModal();
  };
  $("#form-guest").reuse.addEventListener("change", e => fillGuestForm(e.target.value || null));
  $("#form-guest").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target, k = f.reuse.value || guestEdit || null, P = k ? pairOf(k) : [];
    const person = (x, old) => ({ id: old ? old.id : null, first_name: f[x + "_first"].value, last_name: f[x + "_last"].value, email: f[x + "_email"].value, phone: f[x + "_phone"].value, home_city: f[x + "_city"].value, home_airport_iata: f[x + "_iata"].value });
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const { error } = await sb().rpc("save_guest_pair", { p_tournament: currentTour.id, p_people: [person("a", P[0]), person("b", P[1])], p_federation: f.federation.value, p_payment_notes: f.payment_notes.value || null, p_notes: f.notes.value || null, p_pair_key: k && P[0] && P[0].pair_key ? P[0].pair_key : null });
      if (error) { alert(error.message); return; }
      toast(guestEdit ? "Pair details saved." : "Organizer pair named.", "ok");
      $("#dlg-guest").close(); renderDesignated(); renderTourAsg(); renderMoney();
    } finally { btn.disabled = false; }
  });
  window.addDesignated = async function () {
    const rid = $("#des-ref").value; if (!rid) return;
    const { error } = await sb().from("assignments").upsert({ tournament_id: currentTour.id, referee_id: rid, role: $("#des-role").value }, { onConflict: "tournament_id,referee_id" });
    if (error) { alert(error.message); return; }
    renderDesignated(); renderTourAsg();
  };
  window.removeDesignated = async function (id) {
    const a = desRows.find(x => x.id === id); if (!a) return;
    if (a.guest_official_id) {
      const k = a.guest_officials.pair_key || a.guest_official_id, both = desRows.filter(x => x.guest_official_id && (x.guest_officials.pair_key || x.guest_official_id) === k).map(asgName).join(" and ");
      if (!confirm("Remove the organizer pair " + both + " from this tournament? Their bookings and expense claims on this event are deleted with it.")) return;
      const { error } = await sb().rpc("remove_guest_pair", { p_tournament: currentTour.id, p_pair_key: k }); if (error) { alert(error.message); return; }
      renderDesignated(); renderTourAsg(); return;
    }
    if (!confirm("Remove " + refName(a.referee_id) + " from this tournament? Their invitation is marked declined so you can pick a replacement.")) return;
    await sb().from("assignments").delete().eq("id", id);
    await sb().from("assignment_requests").update({ status: "declined", response_note: "Removed by the NRC after designation" }).eq("tournament_id", currentTour.id).eq("referee_id", a.referee_id);
    renderDesignated(); renderInvites(); renderTourAsg();
  };
  let currentTravel = null;
  const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  window.openTravel = function (assignmentId, bookingId) {
    currentTravel = bookingId ? travelRows.find(b => b.id === bookingId) : null; const f = $("#form-travel"); f.reset(); f.assignment_id.value = assignmentId;
    const a = desRows.find(x => x.id === assignmentId); $("#dlg-travel-title").textContent = "Travel booking, " + (a ? asgName(a) : "");
    if (currentTravel) { ["kind", "status", "provider", "reference", "from_place", "to_place", "cost", "paid_by", "notes"].forEach(k => { if (f[k]) f[k].value = currentTravel[k] == null ? "" : currentTravel[k]; }); f.start_at.value = toLocal(currentTravel.start_at); f.end_at.value = toLocal(currentTravel.end_at); }
    $("#btn-travel-delete").classList.toggle("hidden", !currentTravel);
    $("#btn-travel-claim").classList.toggle("hidden", !(currentTravel && currentTravel.paid_by === "referee" && currentTravel.status === "booked" && currentTravel.cost));
    $("#dlg-travel").showModal();
  };
  // a booking the official paid becomes an approved claim, linked to the booking so it is never claimed twice
  const CLAIM_KIND = { flight: "flight", hotel: "hotel", car: "car", train: "transport", other: "other" };
  $("#btn-travel-claim").addEventListener("click", async () => {
    const b = currentTravel; if (!b) return;
    const { data: ex } = await sb().from("expense_claims").select("id,status,amount").eq("booking_id", b.id).maybeSingle();
    if (ex) { alert(`This booking is already claimed ($${Number(ex.amount).toFixed(2)}, ${ex.status}). See the Expenses tab.`); return; }
    const guestClaim = !!(desRows.find(x => x.id === b.assignment_id) || {}).guest_official_id;
    if (!confirm(`Create an approved claim of $${Number(b.cost).toFixed(2)} for this booking, reimbursed by ${guestClaim ? "the organizer (organizer pair)" : "the NRC"}? You can change who reimburses on the Expenses tab.`)) return;
    const { error } = await sb().from("expense_claims").insert({ assignment_id: b.assignment_id, booking_id: b.id, kind: CLAIM_KIND[b.kind] || "other", amount: b.cost, description: [KIND[b.kind], b.provider, b.reference].filter(Boolean).join(" "), status: "approved", reimbursed_by: guestClaim ? "organizer" : "nrc", submitted_by: user.id, reviewed_by: user.id, reviewed_at: new Date().toISOString() });
    if (error) { alert(error.message); return; }
    toast("Claim created.", "ok"); $("#dlg-travel").close(); renderMoney();
  });
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
    const [{ data: asg }, { data: fin }, { data: rep }] = await Promise.all([sb().from("assignments").select("id,referee_id,guest_official_id,role,guest_officials(first_name,last_name,federation,payment_notes)").eq("tournament_id", currentTour.id), sb().from("tournament_finance").select("*").eq("tournament_id", currentTour.id).maybeSingle(), sb().from("tournament_reports").select("*").eq("tournament_id", currentTour.id).maybeSingle()]);
    const ids = (asg || []).map(a => a.id);
    const [{ data: claims }, { data: books }] = ids.length ? await Promise.all([sb().from("expense_claims").select("*").in("assignment_id", ids).order("created_at"), sb().from("travel_bookings").select("id,assignment_id,cost,status,paid_by").in("assignment_id", ids)]) : [{ data: [] }, { data: [] }];
    moneyAsg = asg || []; renderPayees(claims || [], books || []);
    const F = fin || {};
    $("#money-summary").innerHTML = `<span class="chip">NRC paid bookings: $${Number(F.nrc_paid_bookings || 0).toFixed(0)}</span><span class="chip">Organizer paid bookings: $${Number(F.organizer_paid_bookings || 0).toFixed(0)}</span><span class="chip ${Number(F.referee_paid_bookings) ? "on" : ""}">Referee paid bookings: $${Number(F.referee_paid_bookings || 0).toFixed(0)}</span><span class="chip ${Number(F.claims_submitted) ? "on" : ""}">Claims to review: $${Number(F.claims_submitted || 0).toFixed(0)}</span><span class="chip">Approved: $${Number(F.claims_approved || 0).toFixed(0)}</span><span class="chip">Reimbursed: $${Number(F.claims_reimbursed || 0).toFixed(0)}</span>`;
    $("#claims tbody").innerHTML = (claims || []).map(c => { const a = (asg || []).find(x => x.id === c.assignment_id) || {}; return `<tr><td>${NRC.esc(asgName(a))}</td><td>${CK[c.kind] || c.kind}</td><td class="small">${NRC.esc(c.description || "")}</td><td><strong>$${Number(c.amount).toFixed(2)}</strong></td><td>${c.receipt_url ? `<a href="#" onclick="openReceipt('${c.receipt_url}');return false">view</a>` : '<span class="muted">none</span>'}</td><td><span class="pill ${c.status === "reimbursed" || c.status === "approved" ? "green" : c.status === "rejected" ? "red" : "amber"}">${c.status}</span></td><td><select onchange="setClaim('${c.id}',{reimbursed_by:this.value})"><option value="organizer" ${c.reimbursed_by === "organizer" ? "selected" : ""}>Organizer</option><option value="nrc" ${c.reimbursed_by === "nrc" ? "selected" : ""}>NRC</option></select></td><td><input value="${NRC.esc(c.review_note || "")}" placeholder="note" onchange="setClaim('${c.id}',{review_note:this.value})" style="min-width:120px"></td><td style="white-space:nowrap"><button class="btn sm ghost" onclick="setClaim('${c.id}',{status:'approved'})">Approve</button> <button class="btn sm ghost" onclick="setClaim('${c.id}',{status:'rejected'})">Reject</button> <button class="btn sm ghost" onclick="setClaim('${c.id}',{status:'reimbursed',paid_at:new Date().toISOString()})">Reimbursed</button></td></tr>`; }).join("") || '<tr><td colspan="9">No expense claim yet. Referees submit them from their home after the event; use Add expense for guests.</td></tr>';
    $("#report-view").innerHTML = rep ? `<div class="card"><h3 style="margin-top:0">Organizer report, ${NRC.fmtDate(rep.submitted_at)}</h3><p class="small">Games played: ${rep.games_played ?? "not given"}. Referee team ${rep.referee_rating ? rep.referee_rating + "/5" : "not rated"}${rep.supervisor_rating ? ", supervisor " + rep.supervisor_rating + "/5" : ""}. Would request again: ${rep.would_request_again ? "yes" : "no"}.</p>${rep.highlights ? "<p class='small'><strong>Went well:</strong> " + NRC.esc(rep.highlights) + "</p>" : ""}${rep.incidents ? "<p class='small'><strong>Incidents:</strong> " + NRC.esc(rep.incidents) + "</p>" : ""}</div>` : '<p class="small muted">No organizer report yet. The organizer is reminded three days after the event.</p>';
  }
  let moneyAsg = [], payeeRows = [];
  function renderPayees(claims, books) {
    const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0), usd = n => n ? "$" + n.toFixed(2) : '<span class="muted">0</span>';
    payeeRows = moneyAsg.map(a => {
      const C = claims.filter(c => c.assignment_id === a.id), B = books.filter(b => b.assignment_id === a.id && b.status === "booked" && b.paid_by === "referee");
      const claimed = new Set(C.map(c => c.booking_id).filter(Boolean));
      return { name: asgName(a), guest: !!a.guest_official_id, federation: a.guest_officials ? a.guest_officials.federation : "USATH", how: a.guest_officials ? a.guest_officials.payment_notes || "" : "",
        paid: sum(B, b => b.cost), unclaimed: sum(B.filter(b => !claimed.has(b.id)), b => b.cost), review: sum(C.filter(c => c.status === "submitted"), c => c.amount), due: sum(C.filter(c => c.status === "approved"), c => c.amount), done: sum(C.filter(c => c.status === "reimbursed"), c => c.amount) };
    }).filter(r => r.paid || r.review || r.due || r.done || r.guest).sort((x, y) => x.name.localeCompare(y.name));
    const tot = k => payeeRows.reduce((n, r) => n + r[k], 0);
    $("#payees tbody").innerHTML = payeeRows.length ? payeeRows.map(r => `<tr><td><strong>${NRC.esc(r.name)}</strong>${r.guest ? ' <span class="pill">guest, ' + NRC.esc(r.federation) + "</span>" : ""}</td><td>${usd(r.paid)}</td><td>${r.unclaimed ? '<span class="pill amber" title="Open the booking on Designated and travel and use Create claim">$' + r.unclaimed.toFixed(2) + "</span>" : usd(0)}</td><td>${usd(r.review)}</td><td><strong>${usd(r.due)}</strong></td><td>${usd(r.done)}</td><td class="small">${NRC.esc(r.how)}</td></tr>`).join("") + `<tr><td><strong>Total</strong></td><td>${usd(tot("paid"))}</td><td>${usd(tot("unclaimed"))}</td><td>${usd(tot("review"))}</td><td><strong>${usd(tot("due"))}</strong></td><td>${usd(tot("done"))}</td><td></td></tr>` : '<tr><td colspan="7" class="muted">Nothing paid or claimed yet.</td></tr>';
  }
  window.exportPayees = function () {
    if (!payeeRows.length) { alert("Nothing to export yet."); return; }
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Official", "Federation", "Paid by them", "Not claimed", "To review", "Approved to pay", "Reimbursed", "How to pay"].map(q).join(",")].concat(payeeRows.map(r => [r.name, r.federation, r.paid.toFixed(2), r.unclaimed.toFixed(2), r.review.toFixed(2), r.due.toFixed(2), r.done.toFixed(2), r.how].map(q).join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `reimbursements_${currentTour.name.replace(/[^\w]+/g, "_")}_${currentTour.start_date}.csv`; a.click();
  };
  window.openClaim = function () {
    if (!moneyAsg.length) { alert("Nobody designated yet."); return; }
    const f = $("#form-claim"); f.reset();
    f.assignment_id.innerHTML = moneyAsg.slice().sort((x, y) => asgName(x).localeCompare(asgName(y))).map(a => `<option value="${a.id}">${NRC.esc(asgName(a))}${a.guest_official_id ? " (guest)" : ""}</option>`).join("");
    const setPayer = () => { const a = moneyAsg.find(x => x.id === f.assignment_id.value); f.reimbursed_by.value = a && a.guest_official_id ? "organizer" : "nrc"; };
    f.assignment_id.onchange = setPayer; setPayer();
    $("#dlg-claim").showModal();
  };
  $("#form-claim").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target, btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      let receipt_url = null; const file = f.receipt.files[0];
      if (file) { const ext = (file.name.split(".").pop() || "jpg").toLowerCase(); const path = `${user.id}/${Date.now()}.${ext}`; const up = await sb().storage.from("receipts").upload(path, file, { contentType: file.type }); if (up.error) { alert("Receipt upload failed: " + up.error.message); return; } receipt_url = path; }
      const approved = f.status.value === "approved";
      const { error } = await sb().from("expense_claims").insert({ assignment_id: f.assignment_id.value, kind: f.kind.value, amount: parseFloat(f.amount.value), description: f.description.value.trim() || null, status: f.status.value, reimbursed_by: f.reimbursed_by.value, receipt_url, submitted_by: user.id, reviewed_by: approved ? user.id : null, reviewed_at: approved ? new Date().toISOString() : null });
      if (error) { alert(error.message); return; }
      $("#dlg-claim").close(); renderMoney();
    } finally { btn.disabled = false; }
  });
  window.setClaim = async function (id, patch) { if (patch.status) { patch.reviewed_by = user.id; patch.reviewed_at = new Date().toISOString(); } const { error } = await sb().from("expense_claims").update(patch).eq("id", id); if (error) alert(error.message); else renderMoney(); };
  window.openReceipt = async function (path) { const { data, error } = await sb().storage.from("receipts").createSignedUrl(path, 300); if (error) { alert(error.message); return; } window.open(data.signedUrl, "_blank"); };

  // ---------- tournaments ----------
  async function renderReports() {
    const { data, error } = await sb().from("referee_game_reports").select("*, referees(first_name,last_name), tournaments(name,start_date,sanction)").eq("status", "reported").order("created_at");
    const rows = error ? [] : (data || []);
    const c = $("#reports-count"); c.textContent = rows.length; c.classList.toggle("hidden", !rows.length);
    $("#reports-card").classList.toggle("hidden", !rows.length);
    $("#reports tbody").innerHTML = rows.map(r => `<tr><td>${NRC.esc(r.referees ? r.referees.first_name + " " + r.referees.last_name : "")}</td><td><strong>${NRC.esc(r.tournaments ? r.tournaments.name : "")}</strong> ${r.tournaments ? NRC.sanctionPill(r.tournaments.sanction) : ""}<div class="small muted">${r.tournaments ? NRC.fmtDate(r.tournaments.start_date) : ""}</div></td><td>${r.games}</td><td>${NRC.esc(r.role)}</td><td>${NRC.esc(r.partner || "")}</td><td class="small">${NRC.fmtDate(r.created_at)}</td><td style="white-space:nowrap"><button class="btn sm" onclick="reviewReport('${r.id}','confirmed')">Confirm</button> <button class="btn sm ghost" onclick="reviewReport('${r.id}','rejected')">Not confirmed</button></td></tr>`).join("") || '<tr><td colspan="7" class="muted">No report waiting.</td></tr>';
  }
  window.reviewReport = async function (id, status) {
    let note = null;
    if (status === "rejected") { note = prompt("Note for the referee (why, or what to correct):", ""); if (note === null) return; }
    const { error } = await sb().rpc("review_game_report", { p_id: id, p_status: status, p_note: note || null });
    if (error) { alert(error.message); return; }
    renderReports(); if (status === "confirmed") loadAll();
  };
  function renderTournaments() {
    renderReports();
    const q = ($("#tour-q").value || "").toLowerCase(), now = today();
    const clubName = (id) => (clubs.find(c => c.id === id) || {}).name || "";
    // staffing status of each event: one bucket per upcoming event, past ones split by what is left to enter
    const bucket = t => { const st = tourStats[t.id] || {}, need = (t.pairs_needed || 0) * 2;
      if (t.status === "cancelled") return "cancelled";
      if (t.end_date < now) return "past";
      if (t.nrc_staffs === false) return "calendar";
      if (t.created_by_nrc) return "norequest";
      return !st.referees ? "none" : st.referees < need ? "partial" : "full"; };
    const todo = t => { const st = tourStats[t.id] || {}; return t.start_date <= now && t.status !== "cancelled" && st.referees > 0 && (st.games === 0 || st.gameEvals < st.slots); };
    const match = (t, f) => f === "all" ? true : f === "upcoming" ? !["past", "cancelled"].includes(bucket(t)) : f === "todo" ? todo(t) : f === "past" ? bucket(t) === "past" : bucket(t) === f;
    NRC.$$("#tour-filter .chip").forEach(b => { const n = tournaments.filter(t => match(t, b.dataset.f)).length; b.textContent = b.textContent.replace(/ \(\d+\)$/, "") + " (" + n + ")"; });
    const list = tournaments.filter(t => {
      if (q && ![t.name, t.venue_city, t.venue_state, t.region, clubName(t.club_id)].join(" ").toLowerCase().includes(q)) return false;
      return match(t, tourFilter);
    }).sort((a, b) => ["past", "todo", "all"].includes(tourFilter) ? b.start_date.localeCompare(a.start_date) : a.start_date.localeCompare(b.start_date));
    const STAT = { submitted: "amber", reviewing: "amber", staffed: "green", completed: "", cancelled: "red" };
    $("#tour tbody").innerHTML = list.map(t => { const st = tourStats[t.id] || {}, need = t.pairs_needed * 2, past = t.start_date <= now;
      return `<tr class="clickable" tabindex="0" data-id="${t.id}"><td><strong>${NRC.esc(t.name)}</strong>${t.club_id ? '<div class="small muted">' + NRC.esc(clubName(t.club_id)) + "</div>" : ""}${t.divisions && t.divisions.length ? '<div style="margin-top:4px">' + NRC.divisionPills(t.divisions) + "</div>" : ""}</td><td>${NRC.sanctionPill(t.sanction)}${NRC.datePill(t)}${t.nrc_staffs === false ? '<div class="small muted" style="margin-top:4px">calendar only</div>' : ""}</td><td class="small" style="white-space:nowrap">${NRC.fmtDate(t.start_date)}<br><span class="muted">to ${NRC.fmtDate(t.end_date)}</span></td><td class="small">${NRC.esc([t.venue_city, t.venue_state].filter(Boolean).join(", ") || t.region || "")}</td><td class="small">${organizerCell(t, t.end_date < now)}</td><td>${t.nrc_staffs === false && !st.officials ? '<span class="muted">-</span>' : `<span class="pill ${st.referees >= need ? "green" : past ? "red" : "amber"}">${st.referees || 0}/${need}</span>`}${st.officials > st.referees ? '<div class="small muted">+' + (st.officials - st.referees) + " other</div>" : ""}${st.guests ? '<div class="small muted">+' + st.guests + " guest" + (st.guests > 1 ? "s" : "") + "</div>" : ""}${(() => { const sx = staffing.find(x => x.id === t.id); if (!sx || t.end_date < now || bucket(t) === "full") return ""; const left = sx.staff_by ? Math.round((new Date(sx.staff_by + "T12:00:00") - new Date(now + "T12:00:00")) / 864e5) : null; return `<div class="small muted" style="margin-top:4px;white-space:nowrap">${sx.staff_by ? "staff by " + NRC.fmtDate(sx.staff_by) + (left < 0 ? ' <span style="color:var(--red)">' + (-left) + " days late</span>" : "") : ""}${sx.contacted ? "<br>" + sx.contacted + " invited, " + sx.accepted + " yes, " + sx.waiting + " waiting" : ""}</div>`; })()}</td><td>${past ? (st.games ? st.games + (t.games_expected ? '<span class="small muted">/' + t.games_expected + "</span>" : "") : st.gamesReported ? '<span class="small muted" title="Reported as a total, not logged one by one">' + st.gamesReported + " reported</span>" : '<span class="muted">none</span>') : '<span class="muted">-</span>'}</td><td>${past ? (st.slots ? `<span class="pill ${st.gameEvals >= st.slots ? "green" : "amber"}">${st.gameEvals}/${st.slots}</span>` : st.evals ? st.evals : '<span class="muted">none</span>') : '<span class="muted">-</span>'}</td><td><select class="tour-status" onclick="event.stopPropagation()" onchange="setTourStatus('${t.id}',this.value)" style="min-width:110px">${["submitted", "reviewing", "staffed", "completed", "cancelled"].map(x => `<option value="${x}" ${x === t.status ? "selected" : ""}>${x[0].toUpperCase() + x.slice(1)}</option>`).join("")}</select></td></tr>`; }).join("") || '<tr><td colspan="9">No tournament in this view.</td></tr>';
  }
  // ---------- organizer outreach ----------
  // Events the NRC placed on the calendar carry a tentative organizer contact: the one saved on the event, otherwise the
  // host club's primary contact. Reach out invites them to place the request; it is off once the organizer has done so.
  function outreachFor(t) {
    const club = clubs.find(c => c.id === t.club_id);
    if (t.outreach_email) return { email: t.outreach_email, name: t.outreach_name || "", note: t.outreach_note || "Saved on the event" };
    const cs = contacts.filter(c => c.club_id === t.club_id && c.email && c.receives_messages !== false);
    const c = cs.find(x => x.is_primary) || cs[0];
    if (c) return { email: c.email, name: c.name || "", note: `${club ? club.name : "Host club"}, ${(c.role || "contact").toLowerCase()} (${c.source || "club contacts"})` };
    return { email: "", name: "", note: t.outreach_note || (club ? `No email on file for ${club.name}` : "No host club linked to the event") };
  }
  function organizerCell(t, past) {
    if (!t.created_by_nrc) return `<span class="pill green">Request in</span><div>${NRC.esc(t.organizer_name || "")}</div><div class="muted">${NRC.esc(t.organizer_email || "")}</div><button class="btn sm ghost" disabled title="The organizer placed the request" style="margin-top:6px">Reach out</button>`;
    const o = outreachFor(t);
    const sent = t.outreach_sent_at ? `<div class="muted">Invited ${NRC.fmtDate(t.outreach_sent_at.slice(0, 10))}</div>` : "";
    const who = o.email ? `<div title="${NRC.esc(o.note)}">${NRC.esc(o.email)}</div><div class="muted">tentative</div>` : `<div class="muted" title="${NRC.esc(o.note)}">No contact</div>`;
    return who + sent + (past ? "" : `<button class="btn sm ghost" style="margin-top:6px" onclick="openOutreach('${t.id}')">${t.outreach_sent_at ? "Remind" : "Reach out"}</button>`);
  }
  let outreachTour = null;
  window.openOutreach = function (id) {
    const t = tournaments.find(x => x.id === id); if (!t) return; outreachTour = t;
    const o = outreachFor(t), f = $("#form-outreach"), club = clubs.find(c => c.id === t.club_id);
    const when = t.start_date === t.end_date ? NRC.fmtDate(t.start_date) : NRC.fmtDate(t.start_date) + " to " + NRC.fmtDate(t.end_date);
    const where = [t.venue_city, t.venue_state].filter(Boolean).join(", ");
    $("#out-event").textContent = `${t.name}, ${when}${where ? ", " + where : ""}${club ? ". Host club: " + club.name : ""}`;
    $("#out-emails").innerHTML = contacts.filter(c => c.club_id === t.club_id && c.email).map(c => `<option value="${NRC.esc(c.email)}">${NRC.esc([c.name, c.role].filter(Boolean).join(", "))}</option>`).join("");
    $("#out-source").textContent = "Source: " + o.note + (t.outreach_sent_at ? `. Invited on ${NRC.fmtDate(t.outreach_sent_at.slice(0, 10))} (${t.outreach_sent_to || ""}).` : "");
    f.to.value = o.email; f.name.value = (o.name || "").split(" ")[0];
    const datesLine = t.date_status === "tentative" ? `${when} on our calendar, dates to confirm` : when;
    f.subject.value = `Referees for ${t.name}: request on the NRC Referee Hub`;
    f.body.value = [
      `Hello${f.name.value ? " " + f.name.value : ""},`,
      `The USATH National Referee Committee is testing a website to handle referee requests for tournaments, and we would like to include ${t.name} (${datesLine}${where ? ", " + where : ""}) in the test.`,
      `Could you place your referee request through the hub? The event is already filled in. The form asks for the venue, the divisions, the number of referee pairs and what the event covers for travel and lodging, and takes a few minutes:\n{link}`,
      `Once the request is in, you can follow it on your organizer page: the referees designated, their arrival details and the status of each booking.`,
      `The site is still a prototype, so your comments on the form are welcome. If someone else handles referees for this event, a reply with their contact would help.`,
      `Thank you,\n${(user && user.full_name) || ""}`.trim()
    ].join("\n\n");
    $("#dlg-outreach").showModal();
  };
  window.sendOutreach = async function (test) {
    const f = $("#form-outreach"), t = outreachTour; if (!t) return;
    if (!test && !confirm(`Send this invitation to ${f.to.value || "(no address)"}?`)) return;
    const { data: sess } = await sb().auth.getSession();
    const btn = $("#btn-out-send"); btn.disabled = true;
    const res = await fetch("/api/organizer-outreach", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: t.id, to: f.to.value.trim(), name: f.name.value.trim() || null, subject: f.subject.value, body: f.body.value, test: !!test }) }).catch(() => null);
    btn.disabled = false;
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { alert("Not sent: " + (d.error || "network error")); return; }
    if (test) { alert("Test sent to your own address."); return; }
    $("#dlg-outreach").close(); loadAll();
  };
  window.saveOutreachContact = async function () {
    const f = $("#form-outreach"), t = outreachTour; if (!t) return;
    const row = { outreach_email: f.to.value.trim().toLowerCase() || null, outreach_name: f.name.value.trim() || null, outreach_note: f.to.value.trim() ? "Saved by " + (user.email || "admin") : null };
    const { error } = await sb().from("tournaments").update(row).eq("id", t.id);
    if (error) { alert(error.message); return; }
    Object.assign(t, row); $("#dlg-outreach").close(); renderTournaments();
  };
  $("#form-outreach").addEventListener("submit", e => { e.preventDefault(); sendOutreach(false); });
  NRC.$$("#tour-filter .chip").forEach(b => b.onclick = () => { tourFilter = b.dataset.f; NRC.$$("#tour-filter .chip").forEach(x => x.classList.toggle("on", x === b)); renderTournaments(); });
  $("#tour-q").addEventListener("input", () => renderTournaments());
  $("#tour tbody").addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if (tr && !e.target.closest("select,a,button")) openTour(tr.dataset.id); });
  $("#tour tbody").addEventListener("keydown", e => { const tr = e.target.closest("tr[data-id]"); if (tr && e.key === "Enter" && e.target === tr) openTour(tr.dataset.id); });
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
      created_by_nrc: true, status: f.end_date.value < today() ? "completed" : "reviewing", pairs_total: 1, pairs_needed: 1,
      date_status: f.date_status.value, source_url: f.source_url.value.trim() || null, nrc_staffs: f.nrc_staffs.checked };
    if (row.end_date < row.start_date) { alert("End date is before the start date."); return; }
    const { data, error } = await sb().from("tournaments").insert(row).select().single();
    if (error) { alert("Save failed: " + error.message); return; }
    $("#dlg-newtour").close(); await loadAll(); openTour(data.id);
    const b = NRC.$$("#dlg-tour .tabs button").find(x => x.dataset.ttab === "officiated"); if (b) b.click();
  });
  window.setTourStatus = async function (id, status) { await sb().from("tournaments").update({ status }).eq("id", id); };
  let currentTour = null, pairsCache = [], availCache = [];
  NRC.$$("#dlg-tour .tabs button").forEach(b => b.onclick = () => { NRC.$$("#dlg-tour .tabs button").forEach(x => x.classList.toggle("active", x === b)); ["invites", "candidates", "designated", "money", "officiated", "log"].forEach(t => $("#ttab-" + t).classList.toggle("hidden", t !== b.dataset.ttab));
    // each tab reads fresh data when opened, so a confirmation on one tab shows on the next
    ({ invites: renderInvites, candidates: renderCandidates, designated: renderDesignated, money: renderMoney, officiated: renderTourAsg, log: renderTourLog }[b.dataset.ttab] || (() => {}))(); });
  window.openTour = async function (id) {
    currentTour = tournaments.find(t => t.id === id); const f = $("#form-tour"); renderTourAsg.mountedFor = null;
    tourPublicChanges = 0; $("#tour-save-state").textContent = ""; NRC.$$("#form-tour .saved,#form-tour .err,#form-tour .saving").forEach(x => x.classList.remove("saved", "err", "saving"));
    $("#dlg-tour-title").textContent = currentTour.name;
    $("#dlg-tour-sub").textContent = `${NRC.fmtDate(currentTour.start_date)} to ${NRC.fmtDate(currentTour.end_date)}, ${[currentTour.venue_city, currentTour.venue_state].filter(Boolean).join(", ")}${currentTour.nearest_airport_iata ? " (" + currentTour.nearest_airport_iata + ")" : ""}. ${currentTour.pairs_total ?? currentTour.pairs_needed} pairs required: ${currentTour.pairs_needed} staffed by the NRC${currentTour.pairs_organizer ? ", " + currentTour.pairs_organizer + " sourced by the organizer outside USATH" : ""}.`;
    f.sanction.value = currentTour.sanction || "club"; f.region.value = currentTour.region || ""; f.date_status.value = currentTour.date_status || "confirmed"; f.source_url.value = currentTour.source_url || ""; f.nrc_staffs.checked = currentTour.nrc_staffs !== false;
    $("#tour-div").innerHTML = NRC.divisionPicker("divisions", currentTour.divisions);
    ["start_date", "end_date", "venue_name", "venue_city", "pairs_total", "pairs_organizer", "organizer_pairs_note", "travel_managed_by", "club_id", "staff_by", "flights_covered", "hotel_nights_covered", "food_stipend_per_day", "airport_transfers_covered", "airport_transfer_how", "hotel_to_venue_transport", "meals_provided"].forEach(k => { if (f[k]) f[k].value = currentTour[k] == null ? "" : String(currentTour[k]); });
    f.agreed_note.value = ""; tourAgreedNote = "";
    tourPairsCalc(f);
    $("#asg-ref").innerHTML = refs.filter(r => r.active).map(r => `<option value="${r.id}">${NRC.esc(r.last_name + ", " + r.first_name)}</option>`).join("");
    // weekends touched by the tournament (Saturday keys)
    const sat = (d) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + ((6 - x.getDay() + 7) % 7)); return x.toISOString().slice(0, 10); };
    const wk = []; for (let d = new Date(currentTour.start_date + "T12:00:00"); d <= new Date(currentTour.end_date + "T12:00:00"); d.setDate(d.getDate() + 1)) { const k = sat(d.toISOString().slice(0, 10)); if (!wk.includes(k)) wk.push(k); }
    const [{ data: pr }, { data: av }, { data: wa }, { data: ov }] = await Promise.all([sb().from("pairs").select("*"), sb().from("availability_blocks").select("*").lte("start_date", currentTour.end_date).gte("end_date", currentTour.start_date), sb().from("weekend_availability").select("*").in("weekend", wk), sb().from("availability_overrides").select("*").eq("tournament_id", currentTour.id)]);
    pairsCache = pr || []; availCache = av || []; weekendCache = wa || []; overrideCache = ov || [];
    $("#dlg-tour-sub").textContent += currentTour.supervisor_needed ? " Supervisor requested" + (currentTour.supervisor_notes ? ": " + currentTour.supervisor_notes : "") + "." : "";
    $("#btn-organizer").textContent = currentTour.organizer_notified_at ? "Notify organizer again" : "Notify organizer";
    const T = currentTour;
    $("#dlg-tour-sub").innerHTML = NRC.esc($("#dlg-tour-sub").textContent) + `<br>Organizer: ${NRC.esc(T.organizer_name || "")} <a href="mailto:${NRC.esc(T.organizer_email || "")}">${NRC.esc(T.organizer_email || "")}</a>. Travel booked by ${T.travel_managed_by === "nrc" ? "the NRC" : T.travel_managed_by === "referee" ? "the referees" : "the organizer"}; ${T.hotel_nights_covered || 0} hotel nights, ${T.flights_covered ? "flights" : "no flights"}, ${T.airport_transfers_covered ? "transfers" : "no transfers"}${T.food_stipend_per_day ? ", $" + T.food_stipend_per_day + " per day" : ""}.`;
    await Promise.all([renderInvites(), renderDesignated(), renderMoney()]); renderCandidates();
    // past or calendar only events open on what is left to do: officials, games, evaluations
    const tab = (T.start_date <= today() || T.nrc_staffs === false) ? "officiated" : "invites";
    NRC.$$("#dlg-tour .tabs button").find(x => x.dataset.ttab === tab).click();
    $("#dlg-tour").showModal();
  };
  const refName = id => { const r = refs.find(x => x.id === id); return r ? r.last_name + ", " + r.first_name : "?"; };
  const asgName = a => a && a.guest_official_id ? (a.guest_officials ? a.guest_officials.last_name + ", " + a.guest_officials.first_name : "Guest") : refName(a && a.referee_id);
  const partnerOf = id => { const p = pairsCache.find(p => (p.referee_a === id || p.referee_b === id) && (!p.valid_until || p.valid_until >= today())); return p ? (p.referee_a === id ? p.referee_b : p.referee_a) : null; };
  const unavailable = id => availCache.find(b => b.referee_id === id);
  let weekendCache = [];
  // declared weekend availability for the tournament weekends: available | tentative | unavailable | unknown
  const weekendStatus = id => { const rows = weekendCache.filter(w => w.referee_id === id).map(w => w.status === "assigned" ? { ...w, status: currentTour && w.tournament_id === currentTour.id ? "available" : "booked" } : w); if (!rows.length) return "unknown"; if (rows.some(w => w.status === "booked")) return "booked"; if (rows.some(w => w.status === "unavailable")) return "unavailable"; if (rows.every(w => w.status === "available")) return "available"; return "tentative"; };
  let overrideCache = [];
  const overrideOf = id => overrideCache.find(o => o.referee_id === id && o.status !== "reverted");
  const declaredWord = id => { const u = unavailable(id); return u ? `blocked dates ${NRC.fmtDate(u.start_date)} to ${NRC.fmtDate(u.end_date)}` : weekendStatus(id) === "booked" ? bookedWord(id) : { available: "available", tentative: "tentative", unavailable: "weekend marked unavailable", unknown: "not declared" }[weekendStatus(id)]; };
  const bookedWord = id => { const w = weekendCache.find(x => x.referee_id === id && x.status === "assigned" && (!currentTour || x.tournament_id !== currentTour.id)); return w && w.note ? w.note.replace(/^Designated for /, "designated for ") : "designated for another event that weekend"; };
  const availState = id => overrideOf(id) ? "available" : unavailable(id) ? "blocked" : weekendStatus(id);
  const availWord = id => { const o = overrideOf(id); return o ? `available by NRC override (${o.status === "accepted" ? "accepted by the referee" : "awaiting the referee"})` : declaredWord(id); };
  const ovPill = id => { const o = overrideCache.find(x => x.referee_id === id); if (!o) return ""; return o.status === "accepted" ? '<span class="pill green" title="' + NRC.esc(o.reason) + '">override accepted</span>' : o.status === "pending" ? '<span class="pill amber" title="' + NRC.esc(o.reason) + '">override: awaiting referee</span>' : '<span class="pill red" title="' + NRC.esc(o.response_note || o.reason) + '">override reverted by referee</span>'; };
  const ovBtn = id => (availState(id) === "blocked" || availState(id) === "unavailable" || availState(id) === "tentative" || availState(id) === "unknown") && !overrideOf(id) ? ` <button class="btn sm ghost" type="button" onclick="event.stopPropagation();openOverride('${id}')">Override</button>` : "";
  window.openOverride = function (id) {
    const f = $("#form-override"); f.reset(); f.referee_id.value = id;
    $("#ov-who").innerHTML = `<strong>${NRC.esc(refName(id))}</strong>, ${NRC.esc(currentTour.name)} (${NRC.fmtDate(currentTour.start_date)} to ${NRC.fmtDate(currentTour.end_date)})<br>Declared on their home: <strong>${NRC.esc(declaredWord(id))}</strong>`;
    $("#dlg-override").showModal();
  };
  $("#form-override").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target; const reason = f.reason.value.trim();
    if (reason.length < 15) { alert("Give the reason in a full sentence."); return; }
    const sb_ = f.querySelector("[type=submit]"); if (sb_.disabled) return; sb_.disabled = true; sb_.classList.add("busy"); toast("Recording the override and emailing the referee...");
    try {
    const { data: sess } = await sb().auth.getSession();
    const res = await fetch("/api/availability-override", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ action: "create", tournament_id: currentTour.id, referee_id: f.referee_id.value, reason, declared: declaredWord(f.referee_id.value) }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { alert("Failed: " + (d.error || res.status)); return; }
    toast(d.sent ? `Override recorded. ${refName(f.referee_id.value)} was emailed at ${d.email} to accept or revert.` : "Override recorded, but the email did not go out: " + (d.error || ""), d.sent ? "ok" : "error", 8000);
    $("#dlg-override").close();
    const { data: ov } = await sb().from("availability_overrides").select("*").eq("tournament_id", currentTour.id); overrideCache = ov || [];
    renderInvites(); renderCandidates(); renderDesignated();
    } finally { sb_.disabled = false; sb_.classList.remove("busy"); }
  });
  const availPill = id => { if (overrideCache.find(x => x.referee_id === id)) return ovPill(id) + (overrideOf(id) ? "" : ' <span class="pill red">' + NRC.esc(declaredWord(id)) + "</span>"); const u = unavailable(id); if (u) return `<span class="pill red">blocked ${NRC.fmtDate(u.start_date)}</span>`; const w = weekendStatus(id); return w === "available" ? '<span class="pill green">available</span>' : w === "tentative" ? '<span class="pill amber">tentative</span>' : w === "unavailable" ? '<span class="pill red">unavailable</span>' : '<span class="pill">not declared</span>'; };

  // snapshot at the top of the tournament window
  function renderSnap() {
    const T = currentTour; if (!T) return;
    const need = (T.pairs_needed || 0) * 2, des = desRows.filter(a => a.role === "referee" && a.referee_id).length, sup = desRows.filter(a => a.role !== "referee").length, gst = desRows.filter(a => a.role === "referee" && a.guest_official_id).length;
    const c = s => invites.filter(i => i.status === s).length;
    const box = (n, l, cls) => `<div class="snap-i ${cls || ""}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    const travelOwn = T.travel_managed_by === "nrc" ? "NRC" : T.travel_managed_by === "referee" ? "Referees" : "Organizer";
    $("#tour-snap").innerHTML = box(`${des}/${need}`, "referees designated" + (T.pairs_organizer ? `<br>+${T.pairs_organizer} organizer pair${T.pairs_organizer > 1 ? "s" : ""}, ${Math.ceil(gst / 2)} named` : ""), des >= need ? "good" : des ? "warn" : "bad")
      + box(c("sent"), "invited, no answer")
      + box(c("tentative"), "tentative")
      + box(c("accepted"), "accepted, to designate", c("accepted") ? "warn" : "")
      + box(c("declined"), "declined")
      + (T.supervisor_needed ? box(sup ? "set" : "needed", "supervisor", sup ? "good" : "bad") : "")
      + box(travelOwn, "books travel");
    $("#tour-cover").innerHTML = coverRecap(T, des + gst + sup);
  }
  // what the organizer agreed to cover, by category; USD only where the request gives an amount
  function coverRecap(T, officials) {
    const days = Math.round((new Date(T.end_date + "T12:00:00") - new Date(T.start_date + "T12:00:00")) / 864e5) + 1;
    const usd = n => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const yes = (v, txt) => v ? '<span class="pill green">Covered</span>' + (txt ? " " + NRC.esc(txt) : "") : '<span class="pill">Not covered</span>';
    const nights = T.hotel_nights_covered || 0, stip = +T.food_stipend_per_day || 0, per = stip * days;
    const rows = [
      ["Flights", yes(T.flights_covered), "Not set in the request"],
      ["Hotel", nights ? `<span class="pill green">Covered</span> ${nights} night${nights === 1 ? "" : "s"} per official` : '<span class="pill">Not covered</span>', "Not set in the request"],
      ["Airport transfers", yes(T.airport_transfers_covered, T.airport_transfer_how ? "(" + T.airport_transfer_how + ")" : ""), "Not set in the request"],
      ["Hotel to venue", T.hotel_to_venue_transport ? NRC.esc(T.hotel_to_venue_transport) : '<span class="muted">Not stated</span>', ""],
      ["Food stipend", stip ? `${usd(stip)} per day` : '<span class="pill">None</span>', stip ? `${usd(per)} per official (${days} day${days === 1 ? "" : "s"})${officials ? ", " + usd(per * officials) + " for " + officials + " designated" : ""}` : ""],
      ["Meals on site", T.meals_provided ? NRC.esc(T.meals_provided) : '<span class="muted">Not stated</span>', ""]];
    return `<h4 style="margin:14px 0 6px">What the organizer covers</h4><div class="table-wrap"><table class="cover-recap"><thead><tr><th>Category</th><th>Agreed</th><th>Amount (USD)</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r[0]}</strong></td><td class="small">${r[1]}</td><td class="small">${r[2] || '<span class="muted">-</span>'}</td></tr>`).join("")}</tbody></table></div><p class="small muted">Edit in Event details, What the organizer covers. The request form records an amount for the food stipend only; flights, hotel and transfers are covered or not, at cost.</p>`;
  }
  // Invitations
  let invites = [];
  async function renderInvites() {
    const { data } = await sb().from("assignment_requests").select("*").eq("tournament_id", currentTour.id).order("created_at");
    invites = data || [];
    const c = s => invites.filter(i => i.status === s).length;
    $("#inv-summary").innerHTML = [["draft", "Draft"], ["sent", "Invited, no answer"], ["tentative", "Tentative"], ["accepted", "Accepted"], ["declined", "Declined"], ["confirmed", "Designated"]].map(([k, l]) => `<span class="chip ${c(k) ? "on" : ""}">${l}: ${c(k)}</span>`).join("") + `<span class="chip">Needed: ${currentTour.pairs_needed * 2} referees</span>`;
    const STATUS_LABEL = { sent: "invited", confirmed: "designated", no_response: "no answer" };
    const STATUS = { draft: "", sent: "amber", tentative: "amber", accepted: "green", declined: "red", confirmed: "green", no_response: "red", cancelled: "" };
    $("#inv tbody").innerHTML = invites.map(i => `<tr><td><input type="checkbox" class="inv-sel" value="${i.id}" style="width:auto"></td><td><strong>${NRC.esc(refName(i.referee_id))}</strong> ${availPill(i.referee_id)}${partnerOf(i.referee_id) ? '<div class="small muted">pair with ' + NRC.esc(refName(partnerOf(i.referee_id))) + "</div>" : ""}</td><td><span class="pill ${STATUS[i.status] || ""}">${STATUS_LABEL[i.status] || i.status.replace("_", " ")}</span>${i.reminder_count ? ` <span class="small muted">${i.reminder_count} reminder${i.reminder_count > 1 ? "s" : ""}</span>` : ""}</td><td class="small">${i.sent_at ? NRC.fmtDate(i.sent_at) : ""}</td><td class="small">${i.responded_at ? NRC.fmtDate(i.responded_at) : ""}</td><td class="small">${NRC.esc(i.response_note || "")}</td></tr>`).join("") || '<tr><td colspan="6">No invitations yet. Use Find referees to add candidates.</td></tr>';
    renderSnap();
  }
  const selectedInv = () => NRC.$$(".inv-sel:checked").map(x => x.value);
  window.sendSelected = async function (kind) {
    let ids = selectedInv(); if (!ids.length) { alert("Select referees first."); return; }
    if (kind === "confirm") {
      ids = ids.filter(id => invites.find(i => i.id === id && i.status === "accepted")); if (!ids.length) { alert("Only referees who accepted can be designated."); return; }
      const already = invites.filter(i => i.status === "confirmed").map(i => i.referee_id);
      const toConfirm = ids.map(id => invites.find(i => i.id === id).referee_id);
      const after = new Set([...already, ...toConfirm]);
      const need = currentTour.pairs_needed * 2; const issues = [];
      if (after.size !== need) issues.push(`${after.size} referees would be designated; the tournament needs ${need} (${currentTour.pairs_needed} pairs).`);
      toConfirm.forEach(rid => { const p = partnerOf(rid); if (p && !after.has(p)) issues.push(`${refName(rid)} forms a pair with ${refName(p)}, who is not in the designated set.`); });
      if (issues.length && !confirm("Check before designating:\n\n" + issues.join("\n") + "\n\nDesignate anyway?")) return;
    }
    if (kind === "invite") {
      ids = ids.filter(id => ["draft", "sent"].includes((invites.find(i => i.id === id) || {}).status));
      const sel = ids.map(id => invites.find(i => i.id === id).referee_id);
      const split = sel.filter(rid => { const p = partnerOf(rid); return p && !sel.includes(p) && !invites.find(i => i.referee_id === p && i.status !== "draft") && !(desRows || []).find(a => a.referee_id === p); });
      if (split.length && !confirm("Pair split: " + split.map(rid => refName(rid) + " without " + refName(partnerOf(rid))).join("; ") + ". Add the partner from Find referees to invite the pair together.\n\nSend anyway?")) return;
    }
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
    if (!(asg || []).length && !confirm("No official is designated yet. Send the organizer an update anyway?")) return;
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
    (desRows || []).forEach(a => invited.add(a.referee_id));
    const club = id => (clubs.find(c => c.id === id) || {}).name || "";
    const yr = new Date().getFullYear();
    const AR = { available: 0, tentative: 1, unknown: 2, unavailable: 3, booked: 4 };
    const qualified = r => r.cert_level !== "candidate";
    const isOut = r => !overrideOf(r.id) && (unavailable(r.id) || ["unavailable", "booked"].includes(weekendStatus(r.id)));
    const hiddenOut = hide ? refs.filter(r => r.active && qualified(r) && !invited.has(r.id) && isOut(r)) : [];
    $("#cand-hidden").innerHTML = (hiddenOut.length ? `Hidden as unavailable: ${hiddenOut.map(r => NRC.esc(r.last_name + ", " + r.first_name) + " (" + NRC.esc(availWord(r.id)) + `, <a href="#" onclick="openOverride('${r.id}');return false">override</a>)`).join("; ")}. Untick "hide unavailable" to see them. ` : "");
    const onTeam = (desRows || []).map(a => refs.find(r => r.id === a.referee_id)).filter(r => r && (!q || [r.first_name, r.last_name, club(r.club_id)].join(" ").toLowerCase().includes(q)));
    const teamRows = onTeam.map(r => { const p = partnerOf(r.id); const a = desRows.find(x => x.referee_id === r.id); return `<tr style="background:#F2F8F3"><td><input type="checkbox" disabled style="width:auto" title="Already on the team"></td><td><strong>${NRC.esc(r.last_name + ", " + r.first_name)}</strong> <span class="pill green">on the team${a && a.role !== "referee" ? ", " + NRC.esc(a.role) : ""}</span></td><td>${NRC.levelPill(r.cert_level, r.level_confirmed)}</td><td>${NRC.esc(club(r.club_id))}</td><td>${NRC.esc(r.home_airport_iata || "")}</td><td>${availPill(r.id)}${(availState(r.id) === "blocked" || availState(r.id) === "unavailable") ? ovBtn(r.id) : ""}</td><td class="small">${r._games} games ${yr}</td><td class="small">${p ? "with " + NRC.esc(refName(p)) + "<br>" + availPill(p) : ""}</td></tr>`; }).join("");
    $("#cand tbody").innerHTML = teamRows + refs.filter(r => r.active && qualified(r) && !invited.has(r.id) && (!lvl || order.indexOf(r.cert_level) >= order.indexOf(lvl)) && (!hide || !isOut(r)) && (!q || [r.first_name, r.last_name, club(r.club_id), r.home_airport_iata, r.home_city].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => AR[unavailable(a.id) ? "unavailable" : weekendStatus(a.id)] - AR[unavailable(b.id) ? "unavailable" : weekendStatus(b.id)] || NRC.byLastName(a, b))
      .map(r => { const p = partnerOf(r.id); return `<tr><td><input type="checkbox" class="cand-sel" value="${r.id}" style="width:auto"></td><td><strong>${NRC.esc(r.last_name + ", " + r.first_name)}</strong></td><td>${NRC.levelPill(r.cert_level, r.level_confirmed)}</td><td>${NRC.esc(club(r.club_id))}</td><td>${NRC.esc(r.home_airport_iata || "")}${r.home_airport_iata && r.home_airport_iata === currentTour.nearest_airport_iata ? ' <span class="pill green">local</span>' : ""}</td><td>${availPill(r.id)}${ovBtn(r.id)}</td><td class="small">${r._games} games ${yr}</td><td class="small">${p ? "with " + NRC.esc(refName(p)) + "<br>" + availPill(p) : ""}</td></tr>`; }).join("") || '<tr><td colspan="8">No referee matches.</td></tr>';
  }
  ["#cand-q", "#cand-level", "#cand-avail", "#cand-pairs"].forEach(sel => $(sel).addEventListener("input", renderCandidates));
  window.addCandidates = async function () {
    let ids = NRC.$$(".cand-sel:checked").map(x => x.value); if (!ids.length) { alert("Select referees first."); return; }
    const taken = new Set([...invites.map(i => i.referee_id), ...(desRows || []).map(a => a.referee_id)]);
    if ($("#cand-pairs").checked) {
      const added = [];
      ids.slice().forEach(id => { const p = partnerOf(id); const pr = p && refs.find(r => r.id === p && r.active); if (pr && !ids.includes(p) && !taken.has(p)) { ids.push(p); added.push(refName(p) + " (" + availWord(p) + ")"); } });
      if (added.length && !confirm("Partners added so each pair is invited together:\n" + added.join("\n") + "\n\nContinue?")) return;
    }
    const doubt = ids.filter(id => availState(id) !== "available");
    if (doubt.length) alert("Availability not declared as available for: " + doubt.map(id => refName(id) + " (" + availWord(id) + ")").join("; ") + ". Their invitation email will ask them to check they are available before accepting.");
    const rows = ids.map(id => ({ tournament_id: currentTour.id, referee_id: id, status: "draft" }));
    const { error } = await sb().from("assignment_requests").insert(rows); if (error) { alert(error.message); return; }
    await renderInvites(); renderCandidates(); NRC.$$("#dlg-tour .tabs button")[0].click();
  };

  // Officiated
  async function renderTourAsg() {
    const { data } = await sb().from("assignments").select("*, guest_officials(first_name,last_name)").eq("tournament_id", currentTour.id);
    const { data: gl } = await sb().from("games").select("referee_1,referee_2").eq("tournament_id", currentTour.id);
    const logged = (rid) => (gl || []).filter(g => g.referee_1 === rid || g.referee_2 === rid).length;
    $("#tour-asg tbody").innerHTML = (data || []).sort((x, y) => asgName(x).localeCompare(asgName(y))).map(a => { const n = a.referee_id ? logged(a.referee_id) : 0;
      return `<tr><td>${a.referee_id ? `<a href="#" onclick="openRef('${a.referee_id}');return false">${NRC.esc(refName(a.referee_id))}</a>` : NRC.esc(asgName(a)) + ' <span class="pill">guest</span>'}</td><td>${NRC.esc(a.role === "delegate" ? "supervisor" : a.role)}</td><td>${n || '<span class="muted">0</span>'}</td><td>${n ? '<span class="small muted">from the game log</span>' : `<input type="number" min="0" value="${a.games_officiated == null ? "" : a.games_officiated}" style="width:90px" onchange="setAsgGames('${a.id}',this.value)">`}</td></tr>`; }).join("") || '<tr><td colspan="4" class="muted">Nobody designated yet.</td></tr>';
    // games panel: mounted once per tournament opened, refreshed by its own saves
    if (renderTourAsg.mountedFor !== currentTour.id) { renderTourAsg.mountedFor = currentTour.id; await NRC.Games.mount($("#tour-games"), { tournament: currentTour, mode: "admin", user, evaluatorName: (user && (user.full_name || user.email)) || "NRC", nameOf: refName, onChange: () => { renderTourAsg(); loadAll(); } }); }
  }
  window.setAsgGames = async function (id, v) { await sb().from("assignments").update({ games_officiated: v === "" ? null : parseInt(v, 10) }).eq("id", id); };
  window.addAssignment = async function () {
    const g = $("#asg-games").value; const { error } = await sb().from("assignments").upsert({ tournament_id: currentTour.id, referee_id: $("#asg-ref").value, role: "referee", games_officiated: g === "" ? null : parseInt(g, 10) }, { onConflict: "tournament_id,referee_id" });
    if (error) { alert(error.message); return; } $("#asg-games").value = ""; renderTourAsg(); loadAll();
  };
  window.delAssignment = async function (id) { await sb().from("assignments").delete().eq("id", id); renderTourAsg(); };
  // ---------- tournament window: autosave, notify on close, change log ----------
  let tourPublicChanges = 0, tourAgreedNote = "";
  const INTERNAL = ["sanction", "region", "club_id", "divisions", "staff_by", "date_status", "nrc_staffs", "source_url"];
  const TF = { start_date: "Start", end_date: "End", date_status: "Dates", venue_name: "Venue", venue_city: "City", pairs_total: "Total pairs required", pairs_needed: "Pairs the NRC staffs", pairs_organizer: "Pairs sourced outside USATH", organizer_pairs_note: "Organizer pairs from", travel_managed_by: "Travel booked by", staff_by: "Staff by", nrc_staffs: "NRC staffs", sanction: "Sanction", region: "Region", club_id: "Hosting club", source_url: "Source link", divisions: "Divisions", name: "Name", status: "Status", venue_address: "Address", venue_state: "State", nearest_airport_iata: "Nearest airport", games_expected: "Games expected", supervisor_needed: "Supervisor needed", supervisor_notes: "Supervisor notes", hotel_nights_covered: "Hotel nights", flights_covered: "Flights covered", airport_transfers_covered: "Airport transfers", airport_transfer_how: "Transfers", hotel_to_venue_transport: "Hotel to venue", food_stipend_per_day: "Food stipend per day", meals_provided: "Meals", earliest_return_last_day: "Earliest departure", notes: "Notes", organizer_name: "Organizer", organizer_email: "Organizer email", organizer_phone: "Organizer phone" };
  const saveState = (txt, cls) => { const el = $("#tour-save-state"); el.textContent = txt; el.style.color = cls === "err" ? "var(--red)" : cls === "ok" ? "#17532D" : "var(--muted)"; };
  function tourPairsCalc(f) {
    const total = parseInt(f.pairs_total.value, 10) || 0, n = parseInt(f.pairs_organizer.value, 10) || 0, usath = total - n;
    $("#tour-pairs-usath").textContent = usath < 0 ? "check" : usath;
    $("#tour-pairs-calc").classList.toggle("bad", usath < 0);
  }
  function tourPatch(f, el) {
    const k = el.name || (el.closest("#tour-div") ? "divisions" : "");
    if (k === "divisions") return { k, patch: { divisions: NRC.divisionsFrom(f, "divisions") } };
    if (k === "nrc_staffs") return { k, patch: { nrc_staffs: el.checked } };
    // not a tournament field: how the change was agreed, sent to the organizer and kept in the change log when the window closes
    if (k === "agreed_note") { tourAgreedNote = el.value.trim(); saveState(tourAgreedNote ? "Agreement note kept for the update email" : "", "ok"); return {}; }
    if (k === "flights_covered" || k === "airport_transfers_covered") return { k, patch: { [k]: el.value === "true" } };
    if (k === "hotel_nights_covered" || k === "food_stipend_per_day") { const v = el.value.trim(); if (v !== "" && (isNaN(+v) || +v < 0)) return { err: "Enter a number, 0 or more." }; return { k, patch: { [k]: v === "" ? (k === "hotel_nights_covered" ? 0 : null) : +v } }; }
    if (k === "pairs_total" || k === "pairs_organizer" || k === "organizer_pairs_note") {
      // the NRC count is never entered: total less the pairs sourced outside USATH (the database recalculates it too)
      tourPairsCalc(f);
      const total = parseInt(f.pairs_total.value, 10), n = parseInt(f.pairs_organizer.value, 10) || 0, note = f.organizer_pairs_note.value.trim();
      if (isNaN(total) || total < 0) return { err: "Enter the total number of pairs required (0 or more)." };
      if (n > total) return { err: `The pairs sourced outside USATH (${n}) exceed the total pairs required (${total}).` };
      if (n && !note) return { wait: "Add the country or federation of the organizer's pairs to save." };
      return { k, patch: { pairs_total: total, pairs_organizer: n, pairs_needed: total - n, organizer_pairs_note: n ? note : null } };
    }
    if (k === "start_date" || k === "end_date") { const a = f.start_date.value, b = f.end_date.value; if (!a || !b) return { err: "Both dates are needed." }; if (b < a) return { err: "The end date is before the start date." }; return { k, patch: { start_date: a, end_date: b } }; }
    if (!k) return {};
    return { k, patch: { [k]: el.value.trim() === "" ? null : el.value.trim() } };
  }
  $("#form-tour").addEventListener("submit", e => e.preventDefault());
  $("#form-tour").addEventListener("change", async (e) => {
    const f = e.currentTarget, el = e.target; const r = tourPatch(f, el);
    if (r.wait) { saveState(r.wait, "err"); return; }
    if (r.err) { saveState(r.err, "err"); el.classList.add("err"); return; }
    if (!r.patch) return;
    el.classList.remove("saved", "err"); el.classList.add("saving"); saveState("Saving...");
    const { error } = await sb().from("tournaments").update(r.patch).eq("id", currentTour.id);
    el.classList.remove("saving");
    if (error) {
      el.classList.add("err"); saveState("Not saved: " + error.message, "err");
      if (r.k && r.k !== "divisions" && f[r.k] && f[r.k].type !== "checkbox") f[r.k].value = currentTour[r.k] == null ? "" : currentTour[r.k];
      return;
    }
    Object.assign(currentTour, r.patch); renderSnap(); el.classList.add("saved"); setTimeout(() => el.classList.remove("saved"), 1500);
    if (!Object.keys(r.patch).every(k => INTERNAL.includes(k))) tourPublicChanges++;
    saveState("Saved " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + (tourPublicChanges ? ", officials and organizer told when you close" : ""), "ok");
    $("#dlg-tour-title").textContent = currentTour.name;
  });
  window.closeTour = () => $("#dlg-tour").close();
  $("#dlg-tour").addEventListener("close", async () => {
    const T = currentTour, n = tourPublicChanges, agreed = tourAgreedNote; tourPublicChanges = 0; tourAgreedNote = "";
    if (T && n && T.status !== "cancelled" && T.end_date >= today() && (desRows.length || !T.created_by_nrc)) {
      toast(`Sending the update on ${T.name} to the designated officials and the organizer...`);
      const { data: sess } = await sb().auth.getSession();
      const res = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: T.id, kind: "changes", agreed_note: agreed || null }) }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) toast("The update on " + T.name + " was not sent: " + ((d && d.error) || "network error") + ". Open the tournament and close it again to retry.", "error", 10000);
      else if (d.nothing) toast("Saved. No detail that officials see changed, so nothing was sent.", "ok");
      else { const ok = d.results.filter(r => r.sent).length, ko = d.results.filter(r => !r.sent); toast(`Update on ${T.name} sent: ${ok} email${ok === 1 ? "" : "s"}${ko.length ? ", " + ko.length + " not sent (" + ko.map(r => r.email).join(", ") + ")" : ""}.`, ko.length ? "error" : "ok", 8000); }
    }
    loadAll();
  });
  async function renderTourLog() {
    const { data, error } = await sb().from("tournament_changes").select("*").eq("tournament_id", currentTour.id).order("created_at", { ascending: false });
    const val = (k, v) => { if (v == null || v === "") return "empty"; if (k === "club_id") return clubName(v) || "club"; if (k === "travel_managed_by") return { nrc: "NRC", organizer: "Organizer", referee: "Referees" }[v] || v; if (v === "true" || v === true) return "yes"; if (v === "false" || v === false) return "no"; const s = String(v); return s.length > 80 ? s.slice(0, 80) + "..." : s; };
    const ts = x => new Date(x).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    $("#tour-log tbody").innerHTML = error ? `<tr><td colspan="4">${NRC.esc(error.message)}</td></tr>` : (data || []).map(c => `<tr><td class="small" style="white-space:nowrap">${ts(c.created_at)}</td><td class="small">${NRC.esc(c.changed_by_label || c.changed_by_role || "")}${c.changed_by_role && c.changed_by_label ? '<br><span class="muted">' + NRC.esc(c.changed_by_role) + "</span>" : ""}</td><td class="small">${Object.entries(c.changes || {}).map(([k, v]) => `${NRC.esc(TF[k] || k.replace(/_/g, " "))}: ${NRC.esc(val(k, v.from))} &rarr; <strong>${NRC.esc(val(k, v.to))}</strong>${INTERNAL.includes(k) ? ' <span class="muted">(internal)</span>' : ""}`).join("<br>")}${c.agreed_note ? '<div class="small muted" style="margin-top:4px">Agreed with the organizer: ' + NRC.esc(c.agreed_note) + "</div>" : ""}</td><td class="small">${c.notified_at ? ts(c.notified_at) : '<span class="muted">not yet</span>'}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">No change recorded.</td></tr>';
  }
  // toast and sending locks: email buttons show "Sending..." and ignore a second click until the server answers
  function toast(msg, kind, ms) {
    let el = document.getElementById("nrc-toast"); if (!el) { el = document.createElement("div"); el.id = "nrc-toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.className = "nrc-toast " + (kind || ""); el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms || (kind ? 6000 : 60000));
  }
  window.nrcToast = toast;
  const busyWrap = (fn, label) => { let running = false; return async function (...args) {
    if (running) { toast("Still sending, one moment..."); return; }
    const b = document.activeElement && document.activeElement.tagName === "BUTTON" ? document.activeElement : null;
    running = true; if (b) { b.disabled = true; b.classList.add("busy"); } toast(label || "Sending emails...");
    try { return await fn.apply(this, args); } finally { running = false; if (b) { b.disabled = false; b.classList.remove("busy"); } const el = document.getElementById("nrc-toast"); if (el && !el.className.match(/ok|error/)) el.hidden = true; }
  }; };
  setTimeout(() => ["sendSelected", "notifyOrganizer", "sendBriefs", "sendRefMessage", "sendClubMessage", "notifyChanges"].forEach(n => { if (typeof window[n] === "function") window[n] = busyWrap(window[n]); }), 0);
  async function callMail(body) { const { data: sess } = await sb().auth.getSession(); const res = await fetch("/api/send-invitations", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + sess.session.access_token }, body: JSON.stringify({ tournament_id: currentTour.id, ...body }) }); const d = await res.json(); if (!res.ok) { alert("Failed: " + (d.error || res.status)); return null; } const ok = d.results.filter(r => r.sent).length; alert(ok + " email(s) sent." + (d.results.length - ok ? " Not sent: " + d.results.filter(r => !r.sent).map(r => r.email + " (" + (r.error || "").slice(0, 60) + ")").join("; ") : "")); return d; }
  window.notifyChanges = () => callMail({ kind: currentTour.status === "cancelled" ? "cancel" : "changes" });
  window.sendBriefs = () => { if (!desRows.length) { alert("Nobody designated yet."); return; } callMail({ kind: "brief", assignment_ids: desRows.map(a => a.id) }); };

  // ---------- rankings ----------
  let rankings = [], criteria = [], rkSettings = null;
  async function loadRankings() {
    const [{ data: rk, error }, { data: cr }, { data: rs }] = await Promise.all([sb().from("referee_rankings").select("*"), sb().from("evaluation_criteria").select("*").order("sort"), sb().from("ranking_settings").select("*").eq("id", 1).maybeSingle()]);
    if (error) { $("#rk tbody").innerHTML = '<tr><td colspan="11">Rankings need the database update games_evaluations.sql.</td></tr>'; return; }
    rankings = rk || []; criteria = cr || []; rkSettings = rs; NRC._crit = null;
    const f = $("#form-rk-settings"); if (rs) { f.window_months.value = rs.window_months; f.min_evaluations.value = rs.min_evaluations; }
    renderRankings(); renderCriteria();
  }
  function renderRankings() {
    const lv = $("#rk-level").value, prov = $("#rk-prov").checked, R = { level_1: 1, level_2: 2, level_3: 3, nachc: 4, ihf: 5 };
    const list = rankings.filter(r => (!lv || (lv === "level_3" ? R[r.cert_level] >= 3 : r.cert_level === lv)) && (prov || r.ranked))
      .sort((a, b) => (b.ranked - a.ranked) || ((a.rank || 999) - (b.rank || 999)) || ((b.avg_overall || 0) - (a.avg_overall || 0)) || (b.games - a.games));
    if (rankings[0]) $("#rk-since").textContent = "Evaluations since " + NRC.fmtDate(rankings[0].since) + ", ranked from " + (rkSettings ? rkSettings.min_evaluations : 3) + " evaluations";
    $("#rk tbody").innerHTML = list.map(r => `<tr class="clickable" onclick="openRef('${r.referee_id}')"><td>${r.ranked ? '<span class="rank-n">' + r.rank + "</span>" : '<span class="pill">provisional</span>'}</td><td><img class="avatar" src="${r.photo_url ? NRC.esc(r.photo_url) : "assets/avatar.svg"}" alt=""></td><td><strong>${NRC.esc(r.last_name + ", " + r.first_name)}</strong><div class="small muted">${NRC.esc(r.club_name || "")}</div></td><td>${NRC.levelPill(r.cert_level)}</td><td>${r.avg_overall != null ? NRC.scoreHtml(r.avg_overall) : '<span class="muted">-</span>'}</td><td>${r.avg_organizer != null ? Number(r.avg_organizer).toFixed(1) : '<span class="muted">-</span>'}</td><td>${r.avg_nrc != null ? Number(r.avg_nrc).toFixed(1) : '<span class="muted">-</span>'}</td><td>${r.evals}</td><td>${r.games}</td><td>${r.tournaments}</td><td class="small">${r.last_eval ? NRC.fmtDate(r.last_eval) : '<span class="muted">none</span>'}</td></tr>`).join("") || '<tr><td colspan="11">No referee in this view.</td></tr>';
  }
  ["#rk-level", "#rk-prov"].forEach(x => $(x).addEventListener("input", renderRankings));
  window.exportRankings = function () {
    const head = ["rank", "first_name", "last_name", "level", "club", "average", "organizers", "nrc", "evaluations", "games", "tournaments", "last_evaluation"];
    const rows = rankings.map(r => [r.rank || "provisional", r.first_name, r.last_name, NRC.levelLabel(r.cert_level), r.club_name || "", r.avg_overall ?? "", r.avg_organizer ?? "", r.avg_nrc ?? "", r.evals, r.games, r.tournaments, r.last_eval || ""]);
    const csv = [head, ...rows].map(a => a.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "nrc-rankings-" + today() + ".csv"; a.click();
  };
  $("#form-rk-settings").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; const { error } = await sb().from("ranking_settings").update({ window_months: parseInt(f.window_months.value, 10), min_evaluations: parseInt(f.min_evaluations.value, 10), updated_at: new Date().toISOString() }).eq("id", 1); if (error) { alert(error.message); return; } loadRankings(); });
  function renderCriteria() {
    $("#crit tbody").innerHTML = criteria.filter(c => c.scale === "ihf6" || !criteria.some(x => x.scale === "ihf6")).map(c => `<tr class="clickable" onclick="editCrit('${c.code}')"><td>${c.sort}</td><td><strong>${NRC.esc(c.label)}</strong>${c.description ? '<div class="small muted">' + NRC.esc(c.description) + "</div>" : ""}</td><td>${c.weight}</td><td>${c.scale === "ihf6" ? "-- to +++" : "1 to " + c.scale_max}</td><td>${c.active ? '<span class="pill green">yes</span>' : '<span class="pill">no</span>'}</td><td><button class="btn sm ghost" type="button">Edit</button></td></tr>`).join("") || '<tr><td colspan="6">No criteria yet.</td></tr>';
  }
  let currentCrit = null;
  window.editCrit = function (code) {
    currentCrit = code ? criteria.find(c => c.code === code) : null; const f = $("#form-crit"); f.reset();
    const c = currentCrit || { sort: (criteria.length ? Math.max(...criteria.map(x => x.sort)) + 1 : 1), weight: 1, scale_max: 5, active: true };
    ["code", "label", "description", "sort", "weight", "scale_max"].forEach(k => f[k].value = c[k] == null ? "" : c[k]); f.active.checked = c.active !== false; f.code.readOnly = !!currentCrit;
    $("#dlg-crit").showModal();
  };
  $("#form-crit").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.target;
    const row = { code: f.code.value.trim(), label: f.label.value.trim(), description: f.description.value.trim() || null, sort: parseInt(f.sort.value || "0", 10), weight: parseFloat(f.weight.value), scale_max: parseInt(f.scale_max.value, 10), active: f.active.checked, updated_at: new Date().toISOString() };
    const { error } = await sb().from("evaluation_criteria").upsert(row, { onConflict: "code" });
    if (error) { alert(error.message); return; } $("#dlg-crit").close(); loadRankings();
  });

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
