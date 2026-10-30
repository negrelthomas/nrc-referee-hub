/* NRC Referee Hub: shared shell (nav, auth, Supabase client, helpers) */
(function () {
  const C = window.NRC_CONFIG || {};
  const configured = C.SUPABASE_URL && !C.SUPABASE_URL.includes("YOUR-PROJECT");
  window.NRC = window.NRC || {};
  NRC.configured = !!configured;
  NRC.sb = configured && window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

  // ---------- helpers ----------
  NRC.$ = (sel, root) => (root || document).querySelector(sel);
  // neutral head and shoulders shown wherever a referee has no photo yet
  NRC.PHOTO_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#D7DEE8"/><circle cx="48" cy="38" r="17" fill="#9AA8BC"/><path d="M14 92c3-20 17-30 34-30s31 10 34 30z" fill="#9AA8BC"/></svg>');
  NRC.photoSrc = (url) => url || NRC.PHOTO_PLACEHOLDER;
  NRC.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  NRC.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // calendar date in the viewer's time zone (toISOString would give the UTC date, a day ahead in the evening in the US)
  NRC.byLastName = (a, b) => String(a.last_name || "").localeCompare(String(b.last_name || ""), "en", { sensitivity: "base" }) || String(a.first_name || "").localeCompare(String(b.first_name || ""), "en", { sensitivity: "base" });
  NRC.localDate = (d) => { d = d || new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  NRC.fmtDate = (d) => (d ? new Date(d + (String(d).length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  NRC.levelLabel = (l) => ({ candidate: "Candidate", level_1: "Level 1", level_2: "Level 2", level_3: "Level 3 (National)", nachc: "NACHC Continental", ihf: "IHF International" }[l] || l || "");
  NRC.levelPill = (l, confirmed) => {
    const cls = l === "candidate" ? "amber" : l === "level_1" ? "" : "green";
    return `<span class="pill ${cls}">${NRC.esc(NRC.levelLabel(l))}</span>` + (confirmed === false ? ' <span class="pill amber" title="Level entered from correspondence, not yet confirmed by the NRC">NRC to confirm</span>' : "");
  };
  // ---------- tournament divisions (age group x gender), stored as codes such as "U18-W" ----------
  NRC.DIV_AGES = ["Senior", "U21", "U19", "U18", "U17", "U16", "U14", "U12"];
  NRC.DIV_GENDERS = [["M", "Men"], ["W", "Women"], ["X", "Mixed"]];
  NRC.divisionLabel = (code) => { const [a, g] = String(code).split("-"); return a + " " + ({ M: "Men", W: "Women", X: "Mixed" }[g] || g || ""); };
  NRC.divisionPills = (arr) => (arr || []).slice().sort((x, y) => NRC.DIV_AGES.indexOf(x.split("-")[0]) - NRC.DIV_AGES.indexOf(y.split("-")[0]) || x.localeCompare(y)).map(c => `<span class="pill">${NRC.esc(NRC.divisionLabel(c))}</span>`).join(" ");
  // ---------- event type (colour coded) and date status ----------
  NRC.SANCTION = { usath: "USATH", regional: "Regional", club: "Club", international: "International" };
  // Who books each part of the trip: flights (travel_managed_by), hotel, rental car
  NRC.BOOKER = { organizer: "Organizer", nrc: "NRC", referee: "Referees", none: "Not needed" };
  NRC.bookers = (t) => ({ flights: (t && t.travel_managed_by) || "organizer", hotel: (t && (t.hotel_booked_by || t.travel_managed_by)) || "organizer", car: (t && (t.car_booked_by || t.travel_managed_by)) || "organizer" });
  NRC.bookingShort = (t) => { const b = NRC.bookers(t); return `Flights: ${NRC.BOOKER[b.flights]} | Hotel: ${NRC.BOOKER[b.hotel]} | Car: ${NRC.BOOKER[b.car]}`; };
  NRC.bookingSentence = (t, forReferee) => { const b = NRC.bookers(t), who = v => v === "nrc" ? "the NRC" : v === "referee" ? (forReferee ? "you" : "each referee") : "the organizer";
    const parts = [["Flights", b.flights], ["Hotel", b.hotel], ["Rental car", b.car]].map(([l, v]) => v === "none" ? (l === "Hotel" ? "No hotel needed" : "No rental car needed") : `${l} booked by ${who(v)}`);
    return parts.join(". ") + "." + (forReferee && Object.values(b).includes("referee") ? " Record what you book below and submit your expenses with receipts for reimbursement." : ""); };
  NRC.sanctionPill = (s) => `<span class="pill s-${s === "usath" ? "usath" : s === "international" ? "intl" : "club"}">${NRC.SANCTION[s] || "Club"}</span>`;
  NRC.datePill = (t) => t && t.date_status === "tentative" ? ' <span class="pill amber" title="Dates projected from the last edition; not announced by the organizer yet">Tentative dates</span>' : "";
  NRC.divisionPicker = (name, selected) => {
    const sel = new Set(selected || []);
    return `<div class="div-picker-wrap"><table class="div-picker"><thead><tr><th></th>${NRC.DIV_AGES.map(a => `<th>${a}</th>`).join("")}</tr></thead><tbody>` +
      NRC.DIV_GENDERS.map(([g, l]) => `<tr><th>${l}</th>${NRC.DIV_AGES.map(a => `<td><input type="checkbox" name="${name}" value="${a}-${g}" aria-label="${a} ${l}" ${sel.has(a + "-" + g) ? "checked" : ""}></td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
  };
  NRC.divisionsFrom = (form, name) => NRC.$$(`input[name="${name}"]:checked`, form).map(i => i.value);
  // ---------- referee profile: tournament history and latest evaluations ----------
  // rows: [{tournament_id, name, start_date, end_date, divisions, games, sanction, region, role, venue_city, venue_state}]
  // games (optional): rows of referee_game_log for the same referee, listed under their tournament
  NRC.scoreHtml = (v) => v == null ? "" : `<span class="pill ${v >= 4 ? "green" : v >= 3 ? "" : "amber"}" title="Weighted average on 5">${Number(v).toFixed(1)}</span>`;
  NRC.gameRowsHtml = (games, opts) => {
    opts = opts || {};
    if (!games || !games.length) return "";
    const g2 = games.slice().sort((a, b) => String(a.game_date).localeCompare(String(b.game_date)) || String(a.game_time || "").localeCompare(String(b.game_time || "")));
    return `<div class="table-wrap"><table class="gamelog"><thead><tr><th>Date</th>${opts.tournament ? "<th>Tournament</th>" : ""}<th>Game</th><th>Division</th><th>Partner</th><th>Score</th>${opts.noEval ? "" : "<th>Evaluation</th>"}</tr></thead><tbody>` +
      g2.map(g => `<tr><td>${NRC.fmtDate(g.game_date)}${g.game_time ? '<div class="small muted">' + String(g.game_time).slice(0, 5) + "</div>" : ""}</td>${opts.tournament ? "<td>" + NRC.esc(g.tournament || "") + "</td>" : ""}<td>${NRC.esc([g.home_team, g.away_team].filter(Boolean).join(" v ")) || '<span class="muted">teams not entered</span>'}${g.game_number ? ' <span class="small muted">#' + NRC.esc(g.game_number) + "</span>" : ""}${g.video_url ? ' <a class="small" href="' + NRC.esc(g.video_url) + '" target="_blank" rel="noopener">video</a>' : ""}</td><td>${g.division ? NRC.esc(NRC.divisionLabel(g.division)) : ""}</td><td>${NRC.esc(g.partner || "")}</td><td>${g.home_score != null && g.away_score != null ? g.home_score + " : " + g.away_score : ""}</td>${opts.noEval ? "" : "<td>" + (g.eval_overall != null ? NRC.scoreHtml(g.eval_overall) : g.evals ? '<span class="small muted">not shared</span>' : '<span class="small muted">none</span>') + "</td>"}</tr>`).join("") + "</tbody></table></div>";
  };
  NRC.historyHtml = (rows, games) => {
    rows = (rows || []).slice().sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
    if (!rows.length) return '<p class="small muted">No tournament recorded yet.</p>';
    const now = NRC.localDate(), isUp = (h) => String(h.start_date) > now;
    const yrs = {}; rows.filter(h => !isUp(h)).forEach(h => { const y = String(h.start_date).slice(0, 4); yrs[y] = yrs[y] || { g: 0, t: 0 }; yrs[y].g += h.games || 0; yrs[y].t++; });
    const G = games || null;
    return `<div class="hist-years">${Object.keys(yrs).sort().reverse().map(y => `<span class="tag"><strong>${y}</strong>: ${yrs[y].g} game${yrs[y].g === 1 ? "" : "s"}, ${yrs[y].t} tournament${yrs[y].t === 1 ? "" : "s"}</span>`).join("")}</div>` +
      `<div class="hist-list">${rows.map(h => {
        const mine = G ? G.filter(g => g.tournament_id === h.tournament_id) : null;
        const where = [h.venue_city, h.venue_state].filter(Boolean).join(", ");
        const dates = h.end_date && h.end_date !== h.start_date ? NRC.fmtDate(h.start_date) + " to " + NRC.fmtDate(h.end_date) : NRC.fmtDate(h.start_date);
        const detail = `<dl class="prof-facts small"><dt>Dates</dt><dd>${dates}</dd>${where ? `<dt>Where</dt><dd>${NRC.esc(where)}</dd>` : ""}${h.role ? `<dt>Role</dt><dd>${NRC.esc(h.role)}</dd>` : ""}<dt>Games</dt><dd>${isUp(h) ? "upcoming" : h.games != null ? h.games : "pending"}${mine && h.games && mine.length < h.games ? ` (${mine.length} itemised)` : ""}</dd></dl>` +
          (mine ? (mine.length ? NRC.gameRowsHtml(mine) : '<p class="small muted" style="margin:6px 0 0">Games not itemised yet.</p>') : "");
        return `<details class="hist-item"><summary><div><strong>${NRC.esc(h.name)}</strong> ${h.sanction ? NRC.sanctionPill(h.sanction) : ""} <span class="small muted">${new Date(h.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}${h.region ? ", " + NRC.esc(h.region) : ""}</span><div style="margin-top:4px">${NRC.divisionPills(h.divisions)}</div></div><div class="small" style="white-space:nowrap">${isUp(h) ? '<span class="pill amber">upcoming</span>' : h.games != null ? h.games + " games" : '<span class="muted">games pending</span>'}</div></summary><div class="hist-detail">${detail}</div></details>`;
      }).join("")}</div>`;
  };
  // evaluation criteria (USATH sheet), cached
  NRC.loadCriteria = async function (all) {
    if (!NRC._crit) { const { data } = await NRC.sb.from("evaluation_criteria").select("*").order("sort"); NRC._crit = data || []; }
    return all ? NRC._crit : NRC._crit.filter(c => c.active);
  };
  NRC.EVAL_SOURCE = { organizer: "Tournament organizer", observer: "NRC observer", video: "Video review", nrc: "NRC" };
  NRC.EVAL_CRIT = ["score_rules_application", "score_game_management", "score_progressive_punishment", "score_positioning", "score_pair_cooperation", "score_communication"];
  NRC.evalOverall = (e) => { if (e.overall != null) return Number(e.overall); const sc = NRC.EVAL_CRIT.map(k => e[k]).filter(v => v != null); return sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null; };
  NRC.latestEvals = async function (refereeId, userId) {
    const sb = NRC.sb, safe = (p) => p.then(r => (r && r.data) || []).catch(() => []);
    const [tests, ev, as] = await Promise.all([
      safe(sb.from("referee_tests").select("*").eq("referee_id", refereeId).order("tested_on", { ascending: false })),
      safe(sb.from("evaluations").select("*,tournaments(name)").eq("referee_id", refereeId).order("evaluated_on", { ascending: false }).limit(1)),
      userId ? safe(sb.from("assessments").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1)) : Promise.resolve([])
    ]);
    const physical = tests.find(t => t.kind === "physical") || null;
    const exam = tests.find(t => t.kind === "theory") || null, online = as[0] || null;
    let theory = null;
    if (exam) theory = { date: exam.tested_on, what: exam.test_name, result: exam.result, passed: exam.passed, by: exam.evaluator_name };
    if (online && (!exam || online.created_at.slice(0, 10) >= exam.tested_on)) theory = { date: online.created_at.slice(0, 10), what: online.kind === "retest" ? "Online re-test" : "Online assessment", result: online.pct + "% (" + online.correct + "/" + online.total + ")", passed: online.passed };
    const e = ev[0] || null; let game = null;
    if (e) { const o = NRC.evalOverall(e); game = { date: e.evaluated_on, what: e.tournaments ? e.tournaments.name : "In game evaluation", result: o != null ? o.toFixed(1) + " / 5" + (e.source ? ", " + (NRC.EVAL_SOURCE[e.source] || e.source).toLowerCase() : "") : "", by: e.evaluator_name }; }
    return { physical: physical && { date: physical.tested_on, what: physical.test_name, result: NRC.physResult(physical), passed: physical.passed, by: physical.evaluator_name }, theory, game };
  };
  NRC.latestEvalsHtml = (L) => {
    const tile = (title, x) => `<div class="stat" style="text-align:left"><div class="l" style="margin:0 0 4px">${title}</div>` + (x ? `<div><strong>${NRC.esc(x.what || "")}</strong></div><div class="small">${NRC.esc(x.result || "")}${x.passed === true ? ' <span class="pill green">passed</span>' : x.passed === false ? ' <span class="pill red">not passed</span>' : ""}</div><div class="small muted">${NRC.fmtDate(x.date)}${x.by ? ", " + NRC.esc(x.by) : ""}</div>` : '<div class="small muted">None on file</div>') + "</div>";
    return `<div class="grid c3">${tile("Physical" + NRC.physicalInfo(), L.physical)}${tile("Theory", L.theory)}${tile("In game", L.game)}</div>`;
  };
  // ---------- physical test standard (USATH, Shuttle Run Test also called the beep test) ----------
  // Source: usateamhandball.org, Refereeing, General certification. The women's second band is published as "30 - 99",
  // read here as 30 to 39 since the 40 to 49 and over 50 bands follow.
  NRC.PHYSICAL_STD = {
    source: "https://www.usateamhandball.org/refereeing/refereeing-general-certification",
    rows: [["18 to 29", "9.5", 77, "7", 52], ["30 to 39", "8", 62, "6", 42], ["40 to 49", "7", 52, "5", 33], ["50 and over", "6", 42, "4", 24]]
  };
  NRC.BEEP_REQUIRED = { M18: [9, 5], M30: [8, 0], M40: [7, 0], M50: [6, 0], W18: [7, 0], W30: [6, 0], W40: [5, 0], W50: [4, 0] };
  NRC.BEEP_BAND = { M18: "Men 18 to 29", M30: "Men 30 to 39", M40: "Men 40 to 49", M50: "Men 50 and over", W18: "Women 18 to 29", W30: "Women 30 to 39", W40: "Women 40 to 49", W50: "Women 50 and over" };
  // one fixed display for a physical test: "Level 9.5, 77 loops (standard Men 18 to 29: 9.5)"
  NRC.physResult = (t) => t && t.beep_level != null ? `Level ${t.beep_level}.${t.beep_shuttle || 0}, ${t.beep_loops} loops` + (t.std_band ? ` (standard ${NRC.BEEP_BAND[t.std_band]}: ${NRC.BEEP_REQUIRED[t.std_band].join(".").replace(/\.0$/, "")})` : "") : (t && t.result) || "";
  NRC.PHYSICAL_TIP = "Shuttle run (beep test). Pass = reach the level for your age and gender, e.g. men 18 to 29: level 9.5, women 18 to 29: level 7. Click for the full table.";
  NRC.physicalHelp = function () {
    let d = document.getElementById("dlg-phys-std");
    if (!d) {
      d = document.createElement("dialog"); d.id = "dlg-phys-std";
      const S = NRC.PHYSICAL_STD;
      d.innerHTML = `<div class="body"><h3 style="margin-top:0">Physical test: what pass means</h3>
        <ul class="small" style="padding-left:18px;margin:0 0 12px"><li>Test: Shuttle Run Test, also called the beep test</li><li>Pass: reach the level for your age group and gender in the table. Level 9.5 means level 9, shuttle 5</li><li>Recorded as three scores: level, shuttle within the level, total loops</li><li>Level 1: physical requirements completed at a clinic. Level 2 and up: the standard for your age, taken again</li><li>Referees from outside USATH: optional</li></ul>
        <div class="table-wrap"><table class="phys-std"><thead><tr><th>Age</th><th>Men</th><th>Women</th></tr></thead><tbody>${S.rows.map(r => `<tr><td>${r[0]}</td><td><strong>Level ${r[1]}</strong> <span class="muted">about ${r[2]} loops</span></td><td><strong>Level ${r[3]}</strong> <span class="muted">about ${r[4]} loops</span></td></tr>`).join("")}</tbody></table></div>
        <p class="small muted" style="margin:10px 0 0">Source: <a href="${S.source}" target="_blank" rel="noopener">USA Team Handball, referee general certification</a>. Questions: ${NRC.esc(C.CONTACT_EMAIL || "")}</p>
        <p style="margin:14px 0 0"><button class="btn sm" type="button" onclick="this.closest('dialog').close()">Close</button></p></div>`;
      document.body.appendChild(d);
    }
    d.showModal();
  };
  NRC.physicalInfo = () => `<button type="button" class="info-btn" title="${NRC.esc(NRC.PHYSICAL_TIP)}" aria-label="What pass means on the physical test" onclick="NRC.physicalHelp()">?</button>`;

  // ---------- profile completion dashboard ----------
  // items: [{ label, done, kind: "you" (counts, the person does it) | "nrc" (counts, recorded by the NRC) | "optional" (never counts),
  //           detail, action: { label, href | onclick }, info: html }]
  NRC.completionHtml = function (title, items) {
    const counted = items.filter(i => i.kind !== "optional"), done = counted.filter(i => i.done).length;
    const pct = counted.length ? Math.round(done / counted.length * 100) : 100;
    const row = (i) => `<li class="cp-item ${i.done ? "done" : ""} ${i.kind === "optional" ? "opt" : ""}"><span class="cp-mark" aria-hidden="true">${i.done ? "&#10003;" : ""}</span>
      <div class="cp-text"><div class="cp-label">${NRC.esc(i.label)}${i.info || ""}${i.kind === "nrc" && !i.done ? ' <span class="pill">recorded by the NRC</span>' : i.kind === "optional" ? ' <span class="pill">optional</span>' : ""}</div>${i.detail ? `<div class="small muted">${i.detail}</div>` : ""}</div>
      ${!i.done && i.action ? (i.action.href ? `<a class="btn sm secondary" href="${i.action.href}">${NRC.esc(i.action.label)}</a>` : `<button class="btn sm secondary" type="button" onclick="${i.action.onclick}">${NRC.esc(i.action.label)}</button>`) : ""}</li>`;
    const todo = items.filter(i => !i.done), ok = items.filter(i => i.done);
    return `<div class="card cp"><div class="cp-head"><div><h3 style="margin:0">${NRC.esc(title)}</h3><div class="small muted">${done} of ${counted.length} done${items.some(i => i.kind === "optional") ? ", optional items not counted" : ""}</div></div><div class="cp-pct ${pct === 100 ? "full" : ""}">${pct}%</div></div>
      <div class="cp-bar"><span style="width:${pct}%"></span></div>
      <ul class="cp-list">${todo.map(row).join("")}</ul>${ok.length ? `<details class="cp-done"><summary class="small">${ok.length} done</summary><ul class="cp-list">${ok.map(row).join("")}</ul></details>` : ""}</div>`;
  };
  // Nations for referees from outside USATH: the top 20 of the 2025 IHF Men's World Championship plus Canada, Mexico and Serbia.
  // Alphabetical, "Other" lets the user type any other nation. Stored as the nation name in guest_officials.federation.
  NRC.NATIONS = ["Argentina", "Austria", "Brazil", "Canada", "Croatia", "Czech Republic", "Denmark", "Egypt", "France", "Germany", "Hungary", "Iceland", "Italy", "Mexico", "Netherlands", "North Macedonia", "Norway", "Portugal", "Serbia", "Slovenia", "Spain", "Sweden", "Switzerland"];
  // Turns <input name="federation"> into a nation list with an "Other" field. The input stays the form value, hidden,
  // so code that reads or sets input.value keeps working; setting it updates the list.
  NRC.nationPicker = function (input) {
    if (!input || input.dataset.nation) return;
    input.dataset.nation = "1"; input.type = "hidden"; input.removeAttribute("placeholder");
    const sel = document.createElement("select"); sel.required = input.required; input.required = false;
    sel.innerHTML = '<option value="">Choose the nation</option>' + NRC.NATIONS.map(n => `<option>${n}</option>`).join("") + '<option value="__other">Other nation</option>';
    const other = document.createElement("input"); other.placeholder = "Nation"; other.className = "hidden"; other.style.marginTop = "6px";
    input.after(sel, other);
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const sync = () => { const v = sel.value === "__other" ? other.value.trim() : sel.value; proto.set.call(input, v); other.classList.toggle("hidden", sel.value !== "__other"); other.required = sel.value === "__other" && sel.required; };
    Object.defineProperty(input, "value", { configurable: true, get() { return proto.get.call(input); }, set(v) {
      v = String(v || "").trim(); const hit = NRC.NATIONS.find(n => n.toLowerCase() === v.toLowerCase() || v.toLowerCase().startsWith(n.toLowerCase() + " "));
      sel.value = !v ? "" : hit ? hit : "__other"; other.value = hit || !v ? "" : v; sync(); } });
    sel.addEventListener("change", sync); other.addEventListener("input", sync);
    input.value = proto.get.call(input);
    const f = input.form; if (f) f.addEventListener("reset", () => other.classList.add("hidden"));
  };
  // Dialog close: a red close button at the top (stays visible while the dialog scrolls) and the bottom
  // Cancel, Close or Later button in red. The top button does what the bottom one does (e.g. Later records the
  // first sign in prompt as seen), or simply closes the dialog when there is none.
  NRC.CANCEL_RE = /^(cancel|close|later|skip for now)$/i;
  NRC.dialogCloses = function (root) {
    (root && root.tagName === "DIALOG" ? [root] : NRC.$$("dialog", root)).forEach(d => {
      const cancel = [...d.querySelectorAll("button")].find(b => NRC.CANCEL_RE.test(b.textContent.trim()) && !b.classList.contains("dlg-x"));
      if (cancel) { cancel.classList.remove("ghost", "secondary"); cancel.classList.add("red"); }
      if (d.querySelector(":scope > .dlg-x")) return;
      const x = document.createElement("button"); x.type = "button"; x.className = "dlg-x"; x.setAttribute("aria-label", "Close"); x.title = "Close"; x.innerHTML = "&times;";
      x.onclick = () => { const c = [...d.querySelectorAll("button")].find(b => NRC.CANCEL_RE.test(b.textContent.trim()) && !b.classList.contains("dlg-x") && !b.classList.contains("hidden") && b.offsetParent !== null); if (c) c.click(); if (d.open) d.close(); };
      d.prepend(x);
    });
  };
  NRC.GUEST_LEVEL = { regional: "Regional or club", national: "National", continental: "Continental (EHF, PATHF, other)", ihf: "IHF international" };
  NRC.guestQuizLevel = (l) => ({ regional: "level_2", national: "level_3", continental: "nachc", ihf: "ihf" }[l] || "level_3");
  NRC.notice = (el, msg, kind) => { if (!el) return; el.className = "notice " + (kind || ""); el.innerHTML = msg; el.classList.remove("hidden"); const r = el.getBoundingClientRect(); if (r.top < 70 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: "smooth", block: "center" }); };
  NRC.shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- nav ----------
  NRC.renderNav = function (active) {
    const host = document.getElementById("site-nav");
    if (!host) return;
    const links = [
      ["index.html", "Home"], ["become-a-referee.html", "Become a referee"], ["training.html", "Training"],
      ["referees.html", "Referees"], ["request-referees.html", "Request referees for a tournament"], ["guide/index.html", "How to"]
    ];
    host.className = "nav";
    host.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html"><img src="assets/usath-logo.png" alt="USA Team Handball">
        <span class="word">National Referee Committee<small>Referee Hub</small></span></a>
      <button class="burger" id="burger" aria-label="Menu">&#9776;</button>
      <nav class="menu" id="menu">
        ${links.map(([h, t]) => `<a href="${h}" class="${active === h || (active === "guide" && h === "guide/index.html") ? "active" : ""}${h === "guide/index.html" ? " howto" : ""}">${t}</a>`).join("")}
        <a href="login.html" id="nav-login" class="cta">Sign in</a>
      </nav></div>`;
    NRC.$("#burger").onclick = () => NRC.$("#menu").classList.toggle("open");
    NRC.currentUser().then((u) => {
      const a = NRC.$("#nav-login");
      if (!a) return;
      if (u) {
        // referees from outside USATH: their events and training only
        if (u.role === "guest") NRC.$$("#menu > a:not(#nav-login)").forEach(x => { if (!/(training|guide\/index)\.html$/.test(x.getAttribute("href"))) x.remove(); });
        a.textContent = u.role === "admin" ? "Admin" : u.role === "organizer" ? "My tournaments" : u.role === "evaluator" ? "My evaluations" : u.role === "guest" ? "My events" : "My home"; a.href = NRC.homeFor(u);
        if (u.role === "referee" || u.role === "admin") a.insertAdjacentHTML("beforebegin", `<a href="directory.html" class="${active === "directory.html" ? "active" : ""}">Directory</a>`);
        a.insertAdjacentHTML("afterend", `<a href="#" class="nav-out" onclick="NRC.signOut();return false">Sign out</a>`);
        NRC.renderFeedback();
      }
    });
  };

  NRC.renderFooter = function () {
    const host = document.getElementById("site-footer");
    if (!host) return;
    host.innerHTML = `<div class="wrap">
      <div>USA Team Handball, National Referee Committee. Questions: <a href="mailto:${NRC.esc(C.CONTACT_EMAIL)}">${NRC.esc(C.CONTACT_EMAIL)}</a> &middot; <a href="guide/index.html">How to</a> &middot; <a href="guide/faq.html">Common questions</a></div>
      <span class="foot-logo"><img src="assets/usath-logo.png" alt="USA Team Handball"></span></div>`;
  };

  // ---------- "Give feedback" button, every page. Goes straight to the hub owner by email. ----------
  NRC.renderFeedback = function () {
    if (document.getElementById("fb-btn")) return;
    document.body.insertAdjacentHTML("beforeend", `<button type="button" class="fb-btn" id="fb-btn" aria-haspopup="dialog" title="Give feedback on the hub"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Feedback</span></button>
<dialog id="dlg-feedback"><div class="body">
  <h3 style="margin-top:0">Feedback on the hub</h3>
  <p class="small muted">Anything: a bug, a confusing screen, a missing feature, a word to change. It goes directly to the person building the site; no email or text needed.</p>
  <form id="fb-form">
    <label>Your message</label><textarea name="message" required minlength="3" rows="5" placeholder="What you were trying to do, what happened, what you expected..."></textarea>
    <div id="fb-email-wrap"><label>Your email (so we can follow up)</label><input name="email" type="email" placeholder="you@example.com"></div>
    <p class="small muted hidden" id="fb-as"></p>
    <div id="fb-msg" class="notice hidden" style="margin-top:10px"></div>
    <p style="margin-top:14px"><button class="btn" type="submit">Send</button> <button class="btn ghost" type="button" id="fb-cancel">Cancel</button></p>
  </form>
</div></dialog>`);
    const dlg = document.getElementById("dlg-feedback"), form = document.getElementById("fb-form"), msg = document.getElementById("fb-msg");
    document.getElementById("fb-btn").onclick = async () => {
      const u = await NRC.currentUser().catch(() => null);
      const signed = !!(u && u.email);
      if (signed) form.email.value = u.email;
      document.getElementById("fb-email-wrap").classList.toggle("hidden", signed);
      const as = document.getElementById("fb-as"); as.classList.toggle("hidden", !signed);
      if (signed) as.textContent = "Sent as " + u.email + ", so we can follow up with you directly.";
      msg.classList.add("hidden"); dlg.showModal(); form.message.focus();
    };
    document.getElementById("fb-cancel").onclick = () => dlg.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
      const u = await NRC.currentUser().catch(() => null);
      try {
        const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: form.message.value, email: form.email.value, page: location.pathname + location.hash, role: u ? u.role : "visitor" }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not send.");
        msg.className = "notice ok"; msg.textContent = "Sent. Thank you."; form.message.value = "";
        setTimeout(() => dlg.close(), 1400);
      } catch (err) { msg.className = "notice error"; msg.textContent = err.message || "Could not send. Try again in a minute."; }
      btn.disabled = false;
    };
  };

  // ---------- auth ----------
  // One shared lookup per page load: concurrent callers (nav and page) await the same promise,
  // so the second caller never sees a stale null while the first is still in flight.
  let _userPromise = null;
  NRC.resetUser = () => { _userPromise = null; }; // after sign in, so the next currentUser() reads the new session
  NRC.currentUser = function () {
    if (_userPromise) return _userPromise;
    _userPromise = (async () => {
      if (!NRC.sb) return null;
      const { data } = await NRC.sb.auth.getSession();
      const s = data && data.session;
      if (!s) return null;
      const { data: p } = await NRC.sb.from("profiles").select("id,email,role,full_name").eq("id", s.user.id).maybeSingle();
      return { id: s.user.id, email: s.user.email, created_at: s.user.created_at, role: (p && p.role) || "referee", full_name: p && p.full_name };
    })();
    return _userPromise;
  };
  NRC.requireUser = async function (role) {
    const u = await NRC.currentUser();
    if (!u) { const inAdmin = location.pathname.includes("/admin/"); const prefix = inAdmin && !document.querySelector("base") ? "../" : ""; location.href = prefix + "login.html?next=" + encodeURIComponent(inAdmin ? "admin/index.html" : location.pathname.split("/").pop()); return null; }
    if (role === "admin" && u.role !== "admin") { document.body.innerHTML = '<div class="wrap" style="padding:40px"><h1>Admin access only</h1><p>Your account is not an NRC administrator. Write to ' + NRC.esc(C.CONTACT_EMAIL) + ' if you believe this is a mistake.</p><p><a href="../profile.html">Back to my profile</a></p></div>'; return null; }
    return u;
  };
  NRC.homeFor = (u) => !u ? "login.html" : u.role === "admin" ? "admin/index.html" : u.role === "organizer" ? "organizer.html" : u.role === "evaluator" ? "evaluator.html" : "profile.html";
  // Calendar file with one event per item. events: [{title, start (Date), end (Date), location, desc, url}]
  NRC.downloadIcs = function (name, events) {
    const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const escT = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NRC Referee Hub//EN", "CALSCALE:GREGORIAN"];
    events.forEach((e, i) => { lines.push("BEGIN:VEVENT", `UID:nrc-${Date.now()}-${i}@nrc-referee-hub`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(e.start)}`, `DTEND:${fmt(e.end || new Date(new Date(e.start).getTime() + 36e5))}`, `SUMMARY:${escT(e.title)}`, e.location ? `LOCATION:${escT(e.location)}` : null, `DESCRIPTION:${escT(e.desc)}`, e.url ? `URL:${e.url}` : null, "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM", "END:VEVENT"); });
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.filter(Boolean).join("\r\n")], { type: "text/calendar" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };
  NRC.signOut = async function () { if (NRC.sb) await NRC.sb.auth.signOut(); location.href = "index.html"; };

  // ---------- data ----------
  // Questions: from Supabase when configured, else the static seed file.
  NRC.loadQuestions = async function () {
    if (NRC.sb) {
      const { data, error } = await NRC.sb.from("quiz_questions").select("id,rule_number,category,difficulty,question,options,correct_index,correct_indexes,answer,rule_ref,source").eq("active", true);
      if (!error && data && data.length) return data.map((d) => ({ id: d.id, rule: d.rule_number, cat: d.category, diff: d.difficulty, q: d.question, options: d.options, ci: d.correct_index, cis: d.correct_indexes, a: d.answer, rr: d.rule_ref, src: d.source === "ihf_catalogue" ? "ihf" : d.source }));
    }
    return (window.NRC_QUESTIONS || []).slice();
  };

  // Explanation text for a question. The IHF catalogue answers read "Correct option: a. Rule reference: 1:1", which is not
  // helpful on screen: show the correct answer text instead, then the rule reference once.
  NRC.explain = function (q, full) {
    const a = q.a || "";
    const m = /^correct options?:\s*([a-z](?:\s*,\s*[a-z])*)/i.exec(a);
    let text = a;
    if (m && q.options) {
      const letters = m[1].toLowerCase().split(/\s*,\s*/);
      const picks = letters.map(l => q.options[l.charCodeAt(0) - 97]).filter(Boolean);
      if (picks.length === 1) text = "Correct answer: " + picks[0] + ".";
      else if (full) text = "Correct answers: " + letters.map((l, i) => l + ") " + picks[i]).join(" ") ;
      else text = "Correct answers: " + letters.join(", ") + " (shown in green).";
    }
    const ref = q.rr && !new RegExp(q.rr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(text) ? ` <span class="small muted">(Rule ${NRC.esc(q.rr)})</span>` : "";
    return NRC.esc(text) + ref;
  };

  NRC.RULES = {
    1: "Playing court", 2: "Playing time, final signal, time-out", 3: "The ball", 4: "The team, substitutions, equipment, injuries",
    5: "The goalkeeper", 6: "The goal area", 7: "Playing the ball, passive play", 8: "Fouls and unsportsmanlike conduct",
    9: "Scoring", 10: "The throw-off", 11: "The throw-in", 12: "The goalkeeper throw", 13: "The free throw", 14: "The 7-metre throw",
    15: "General instructions for throws", 16: "Punishments", 17: "The referees", 18: "Timekeeper and scorekeeper"
  };

  // Phones: tables outside the admin console stack into one card per row; each cell
  // carries its column name in data-label so the stacked view stays readable.
  NRC.labelTables = (root = document) => {
    root.querySelectorAll(".table-wrap table").forEach(t => {
      const heads = [...t.querySelectorAll("thead th")].map(th => th.textContent.trim());
      if (!heads.length) return;
      t.querySelectorAll("tbody tr").forEach(tr => {
        let i = 0;
        for (const td of tr.children) {
          if (!td.hasAttribute("data-label")) td.setAttribute("data-label", td.colSpan > 1 ? "" : (heads[i] || ""));
          i += td.colSpan || 1;
        }
      });
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    NRC.renderNav(document.body.dataset.page);
    if (!document.querySelector(".admin-layout")) {
      let queued = false;
      NRC.labelTables();
      new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; NRC.labelTables(); }); }).observe(document.body, { childList: true, subtree: true });
    }
    NRC.renderFooter();
    if (!NRC.configured) { const b = document.getElementById("config-banner"); if (b) b.classList.remove("hidden"); }
  });
})();
