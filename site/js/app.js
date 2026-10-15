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
  NRC.fmtDate = (d) => (d ? new Date(d + (String(d).length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");
  NRC.levelLabel = (l) => ({ candidate: "Candidate", level_1: "Level 1", level_2: "Level 2", level_3: "Level 3 (National)", nachc: "NACHC Continental", ihf: "IHF International" }[l] || l || "");
  NRC.levelPill = (l) => {
    const cls = l === "candidate" ? "amber" : l === "level_1" ? "" : "green";
    return `<span class="pill ${cls}">${NRC.esc(NRC.levelLabel(l))}</span>`;
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
      if (u) { a.textContent = u.role === "admin" ? "Admin" : "My profile"; a.href = u.role === "admin" ? "admin/index.html" : "profile.html"; }
    });
  };

  NRC.renderFooter = function () {
    const host = document.getElementById("site-footer");
    if (!host) return;
    host.innerHTML = `<div class="wrap">
      <div>USA Team Handball, National Referee Committee. Questions: <a href="mailto:${NRC.esc(C.CONTACT_EMAIL)}">${NRC.esc(C.CONTACT_EMAIL)}</a></div>
      <img src="assets/usath-logo.png" alt="USA Team Handball"></div>`;
  };

  // ---------- auth ----------
  let _user = null, _userLoaded = false;
  NRC.currentUser = async function () {
    if (_userLoaded) return _user;
    _userLoaded = true;
    if (!NRC.sb) return null;
    const { data } = await NRC.sb.auth.getSession();
    const s = data && data.session;
    if (!s) return null;
    const { data: p } = await NRC.sb.from("profiles").select("id,email,role,full_name").eq("id", s.user.id).maybeSingle();
    _user = { id: s.user.id, email: s.user.email, role: (p && p.role) || "referee", full_name: p && p.full_name };
    return _user;
  };
  NRC.requireUser = async function (role) {
    const u = await NRC.currentUser();
    if (!u) { const inAdmin = location.pathname.includes("/admin/"); const prefix = inAdmin && !document.querySelector("base") ? "../" : ""; location.href = prefix + "login.html?next=" + encodeURIComponent(inAdmin ? "admin/index.html" : location.pathname.split("/").pop()); return null; }
    if (role === "admin" && u.role !== "admin") { document.body.innerHTML = '<div class="wrap" style="padding:40px"><h1>Admin access only</h1><p>Your account is not an NRC administrator. Write to ' + NRC.esc(C.CONTACT_EMAIL) + ' if you believe this is a mistake.</p><p><a href="../profile.html">Back to my profile</a></p></div>'; return null; }
    return u;
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
