/* NRC Referee Hub: shared shell (nav, auth, Supabase client, helpers) */
(function () {
  const C = window.NRC_CONFIG || {};
  const configured = C.SUPABASE_URL && !C.SUPABASE_URL.includes("YOUR-PROJECT");
  window.NRC = window.NRC || {};
  NRC.configured = !!configured;
  NRC.sb = configured && window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

  // ---------- helpers ----------
  NRC.$ = (sel, root) => (root || document).querySelector(sel);
  NRC.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  NRC.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // calendar date in the viewer's time zone (toISOString would give the UTC date, a day ahead in the evening in the US)
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
  NRC.sanctionPill = (s) => `<span class="pill s-${s === "usath" ? "usath" : s === "international" ? "intl" : "club"}">${NRC.SANCTION[s] || "Club"}</span>`;
  NRC.datePill = (t) => t && t.date_status === "tentative" ? ' <span class="pill amber" title="Dates projected from the last edition; not announced by the organizer yet">Tentative dates</span>' : "";
  NRC.divisionPicker = (name, selected) => {
    const sel = new Set(selected || []);
    return `<div class="div-picker-wrap"><table class="div-picker"><thead><tr><th></th>${NRC.DIV_AGES.map(a => `<th>${a}</th>`).join("")}</tr></thead><tbody>` +
      NRC.DIV_GENDERS.map(([g, l]) => `<tr><th>${l}</th>${NRC.DIV_AGES.map(a => `<td><input type="checkbox" name="${name}" value="${a}-${g}" aria-label="${a} ${l}" ${sel.has(a + "-" + g) ? "checked" : ""}></td>`).join("")}</tr>`).join("") + "</tbody></table></div>";
  };
  NRC.divisionsFrom = (form, name) => NRC.$$(`input[name="${name}"]:checked`, form).map(i => i.value);
  // ---------- referee profile: tournament history and latest evaluations ----------
  // rows: [{name, start_date, divisions, games, sanction, region}] from referee_public_history or referee_tournament_history
  NRC.historyHtml = (rows) => {
    rows = (rows || []).slice().sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
    if (!rows.length) return '<p class="small muted">No tournament recorded yet.</p>';
    const yrs = {}; rows.forEach(h => { const y = String(h.start_date).slice(0, 4); yrs[y] = yrs[y] || { g: 0, t: 0 }; yrs[y].g += h.games || 0; yrs[y].t++; });
    return `<div class="hist-years">${Object.keys(yrs).sort().reverse().map(y => `<span class="chip"><strong>${y}</strong>: ${yrs[y].g} game${yrs[y].g === 1 ? "" : "s"}, ${yrs[y].t} tournament${yrs[y].t === 1 ? "" : "s"}</span>`).join("")}</div>` +
      `<ul class="hist-list">${rows.map(h => `<li><div><strong>${NRC.esc(h.name)}</strong> ${h.sanction ? NRC.sanctionPill(h.sanction) : ""} <span class="small muted">${new Date(h.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}${h.region ? ", " + NRC.esc(h.region) : ""}</span><div style="margin-top:4px">${NRC.divisionPills(h.divisions)}</div></div><div class="small" style="white-space:nowrap">${h.games != null ? h.games + " games" : '<span class="muted">games pending</span>'}</div></li>`).join("")}</ul>`;
  };
  NRC.EVAL_CRIT = ["score_rules_application", "score_game_management", "score_progressive_punishment", "score_positioning", "score_pair_cooperation", "score_communication"];
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
    if (e) { const sc = NRC.EVAL_CRIT.map(k => e[k]).filter(v => v != null); game = { date: e.evaluated_on, what: e.tournaments ? e.tournaments.name : "In game evaluation", result: sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1) + " / 5 average" : "", by: e.evaluator_name }; }
    return { physical: physical && { date: physical.tested_on, what: physical.test_name, result: physical.result, passed: physical.passed, by: physical.evaluator_name }, theory, game };
  };
  NRC.latestEvalsHtml = (L) => {
    const tile = (title, x) => `<div class="stat" style="text-align:left"><div class="l" style="margin:0 0 4px">${title}</div>` + (x ? `<div><strong>${NRC.esc(x.what || "")}</strong></div><div class="small">${NRC.esc(x.result || "")}${x.passed === true ? ' <span class="pill green">passed</span>' : x.passed === false ? ' <span class="pill red">not passed</span>' : ""}</div><div class="small muted">${NRC.fmtDate(x.date)}${x.by ? ", " + NRC.esc(x.by) : ""}</div>` : '<div class="small muted">None on file</div>') + "</div>";
    return `<div class="grid c3">${tile("Physical", L.physical)}${tile("Theory", L.theory)}${tile("In game", L.game)}</div>`;
  };
  NRC.notice = (el, msg, kind) => { if (!el) return; el.className = "notice " + (kind || ""); el.innerHTML = msg; el.classList.remove("hidden"); };
  NRC.shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- nav ----------
  NRC.renderNav = function (active) {
    const host = document.getElementById("site-nav");
    if (!host) return;
    const links = [
      ["index.html", "Home"], ["become-a-referee.html", "Become a referee"], ["training.html", "Training"],
      ["referees.html", "Referees"], ["request-referees.html", "Request referees for a tournament"]
    ];
    host.className = "nav";
    host.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html"><img src="assets/usath-logo.png" alt="USA Team Handball">
        <span class="word">National Referee Committee<small>Referee Hub</small></span></a>
      <button class="burger" id="burger" aria-label="Menu">&#9776;</button>
      <nav class="menu" id="menu">
        ${links.map(([h, t]) => `<a href="${h}" class="${active === h ? "active" : ""}">${t}</a>`).join("")}
        <a href="login.html" id="nav-login" class="cta">Sign in</a>
      </nav></div>`;
    NRC.$("#burger").onclick = () => NRC.$("#menu").classList.toggle("open");
    NRC.currentUser().then((u) => {
      const a = NRC.$("#nav-login");
      if (!a) return;
      if (u) { a.textContent = u.role === "admin" ? "Admin" : u.role === "organizer" ? "My tournaments" : "My profile"; a.href = u.role === "admin" ? "admin/index.html" : u.role === "organizer" ? "organizer.html" : "profile.html"; }
    });
  };

  NRC.renderFooter = function () {
    const host = document.getElementById("site-footer");
    if (!host) return;
    host.innerHTML = `<div class="wrap">
      <div>USA Team Handball, National Referee Committee. Questions: <a href="mailto:${NRC.esc(C.CONTACT_EMAIL)}">${NRC.esc(C.CONTACT_EMAIL)}</a> &middot; <a href="guide/index.html">How to use the hub</a></div>
      <img src="assets/usath-logo.png" alt="USA Team Handball"></div>`;
    NRC.renderFeedback();
  };

  // ---------- "Give feedback" button, every page. Goes straight to the hub owner by email. ----------
  NRC.renderFeedback = function () {
    if (document.getElementById("fb-btn")) return;
    document.body.insertAdjacentHTML("beforeend", `<button type="button" class="fb-btn" id="fb-btn" aria-haspopup="dialog">Give feedback</button>
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
      return { id: s.user.id, email: s.user.email, role: (p && p.role) || "referee", full_name: p && p.full_name };
    })();
    return _userPromise;
  };
  NRC.requireUser = async function (role) {
    const u = await NRC.currentUser();
    if (!u) { const inAdmin = location.pathname.includes("/admin/"); const prefix = inAdmin && !document.querySelector("base") ? "../" : ""; location.href = prefix + "login.html?next=" + encodeURIComponent(inAdmin ? "admin/index.html" : location.pathname.split("/").pop()); return null; }
    if (role === "admin" && u.role !== "admin") { document.body.innerHTML = '<div class="wrap" style="padding:40px"><h1>Admin access only</h1><p>Your account is not an NRC administrator. Write to ' + NRC.esc(C.CONTACT_EMAIL) + ' if you believe this is a mistake.</p><p><a href="../profile.html">Back to my profile</a></p></div>'; return null; }
    return u;
  };
  NRC.homeFor = (u) => !u ? "login.html" : u.role === "admin" ? "admin/index.html" : u.role === "organizer" ? "organizer.html" : "profile.html";
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

  document.addEventListener("DOMContentLoaded", () => {
    NRC.renderNav(document.body.dataset.page);
    NRC.renderFooter();
    if (!NRC.configured) { const b = document.getElementById("config-banner"); if (b) b.classList.remove("hidden"); }
  });
})();
