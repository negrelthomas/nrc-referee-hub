/* NRC Referee Hub: custom quizzes.
   Builder (Training > Build a quiz): pick rules, levels, number of questions, time limit, feedback; start, share a link or print a PDF.
   Runner (quiz.html): ?id=<saved quiz> or #c=<encoded quiz>. Same questions for everyone who opens the link.
   Scoring as everywhere on the hub: NRC.grade (+1 per correct option, -1 per wrong or missed option, never below 0 on a question). */
(function () {
  const $ = (s, r) => (r || document).querySelector(s), esc = (s) => NRC.esc(s);
  const Q = (NRC.CustomQuiz = {});
  const LEVELS = [["level_1", "Level 1"], ["level_2", "Level 2"], ["level_3", "Level 3"]];
  const nCorrect = (q) => (q.cis && q.cis.length > 1 ? q.cis.length : 1);
  const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  const tips = (root) => (root || document).querySelectorAll("[data-tip]").forEach(b => { if (!b.title) b.title = b.dataset.tip; });

  // Spread the questions across the chosen rules, then fill from the rest of the pool
  Q.pick = function (all, cfg) {
    const pool = all.filter(q => q.options && q.options.length)
      .filter(q => (!cfg.rules.length || cfg.rules.includes(q.rule)) && (!cfg.levels.length || cfg.levels.includes(q.diff)));
    const by = {}; pool.forEach(q => { (by[q.rule] = by[q.rule] || []).push(q); });
    Object.values(by).forEach(a => NRC.shuffle(a));
    const keys = NRC.shuffle(Object.keys(by)); const out = [];
    while (out.length < cfg.n && keys.some(k => by[k].length)) keys.forEach(k => { if (out.length < cfg.n && by[k].length) out.push(by[k].shift()); });
    return { questions: NRC.shuffle(out), pool: pool.length };
  };

  // ================= builder =================
  Q.renderBuilder = async function (host, all, user) {
    const rules = Object.keys(NRC.RULES).map(Number);
    host.innerHTML = `<div class="card">
      <h3 style="margin-top:0">Build a quiz</h3>
      <p class="small muted" style="margin-top:0">For your own practice or for a clinic. Everyone who opens the link gets the same questions. Questions come from the IHF Catalogue of Rules Questions.</p>
      <label>Title</label><input id="qb-title" placeholder="For example: Clinic, Rule 8 and Rule 16" maxlength="80">
      <label style="margin-top:12px">Rules</label>
      <div class="small" style="margin-bottom:6px"><a href="#" id="qb-all">All</a> · <a href="#" id="qb-none">None</a> · <a href="#" id="qb-pun">Fouls and punishments (8, 16)</a> · <a href="#" id="qb-thr">Throws (10 to 15)</a></div>
      <div class="qb-rules" id="qb-rules" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 14px">${rules.map(r => `<label style="font-weight:500;margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" value="${r}" style="width:auto"> Rule ${r}: ${esc(NRC.RULES[r])}</label>`).join("")}</div>
      <label style="margin-top:12px">Levels</label>
      <div id="qb-levels" style="display:flex;gap:14px;flex-wrap:wrap">${LEVELS.map(([v, l]) => `<label style="font-weight:500;margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" value="${v}" checked style="width:auto"> ${l}</label>`).join("")}</div>
      <div class="row" style="margin-top:6px">
        <div><label>Number of questions</label><input id="qb-n" type="number" min="5" max="80" value="30"></div>
        <div><label>Time limit in minutes (0 for none)</label><input id="qb-min" type="number" min="0" max="180" value="60"></div>
      </div>
      <label>Feedback</label>
      <div class="seg" id="qb-fb" style="display:flex;gap:14px;flex-wrap:wrap"><label style="font-weight:500;margin:0;display:flex;gap:6px;align-items:center"><input type="radio" name="qb-fb" value="now" checked style="width:auto"> After each question</label><label style="font-weight:500;margin:0;display:flex;gap:6px;align-items:center"><input type="radio" name="qb-fb" value="end" style="width:auto"> At the end only, as in an exam</label></div>
      <p class="small muted" id="qb-count" style="margin:10px 0 0"></p>
      <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" type="button" id="qb-start" data-tip="Draws the questions and starts the quiz on this device.">Start now</button>
        <button class="btn secondary" type="button" id="qb-share" data-tip="Draws the questions once and gives you a link. Everyone who opens it takes the same quiz.">Get a link to share</button>
        <button class="btn ghost" type="button" id="qb-pdf" data-tip="Draws the questions and opens a print layout with tick boxes and the answer key on a separate page. Choose Save as PDF.">PDF for in person training</button>
      </p>
      <div id="qb-out" class="notice hidden" style="margin-top:10px"></div>
      <div id="qb-mine"></div>
    </div>`;
    tips(host);
    const boxes = () => [...host.querySelectorAll("#qb-rules input")];
    const setRules = (arr) => { boxes().forEach(b => b.checked = arr === "all" || arr.includes(+b.value)); count(); };
    $("#qb-all", host).onclick = (e) => { e.preventDefault(); setRules("all"); };
    $("#qb-none", host).onclick = (e) => { e.preventDefault(); setRules([]); };
    $("#qb-pun", host).onclick = (e) => { e.preventDefault(); setRules([8, 16]); };
    $("#qb-thr", host).onclick = (e) => { e.preventDefault(); setRules([10, 11, 12, 13, 14, 15]); };
    const cfg = () => ({ title: $("#qb-title", host).value.trim() || "Custom quiz", rules: boxes().filter(b => b.checked).map(b => +b.value), levels: [...host.querySelectorAll("#qb-levels input")].filter(b => b.checked).map(b => b.value), n: Math.max(5, Math.min(80, parseInt($("#qb-n", host).value, 10) || 30)), minutes: Math.max(0, Math.min(180, parseInt($("#qb-min", host).value, 10) || 0)), feedback: (host.querySelector('input[name="qb-fb"]:checked') || {}).value || "now" });
    const count = () => { const c = cfg(); const { pool } = Q.pick(all, { ...c, n: 0 }); $("#qb-count", host).textContent = `${pool} questions match these rules and levels.` + (pool < c.n ? ` The quiz will have ${pool}.` : ""); };
    host.addEventListener("change", count); host.addEventListener("input", (e) => { if (e.target.id === "qb-n") count(); });
    setRules("all");
    const draw = () => { const c = cfg(); const { questions } = Q.pick(all, c); if (!questions.length) { alert("No question matches these rules and levels."); return null; } return { t: c.title, ids: questions.map(q => q.id), m: c.minutes, f: c.feedback }; };
    const out = (html) => { const o = $("#qb-out", host); o.className = "notice ok"; o.innerHTML = html; o.classList.remove("hidden"); };
    $("#qb-start", host).onclick = () => { const d = draw(); if (d) location.href = "quiz.html#c=" + enc(d); };
    $("#qb-pdf", host).onclick = () => { const d = draw(); if (d) window.open("quiz.html?print=1#c=" + enc(d), "_blank"); };
    $("#qb-share", host).onclick = async () => {
      const d = draw(); if (!d) return; let url;
      if (user && NRC.sb) {
        const { data, error } = await NRC.sb.from("custom_quizzes").insert({ created_by: user.id, title: d.t, question_ids: d.ids, time_limit_minutes: d.m || null, feedback: d.f }).select("id").single();
        if (error) { alert("The quiz could not be saved: " + error.message); return; }
        url = location.origin + location.pathname.replace(/[^/]*$/, "") + "quiz.html?id=" + data.id;
      } else url = location.origin + location.pathname.replace(/[^/]*$/, "") + "quiz.html#c=" + enc(d);
      try { await navigator.clipboard.writeText(url); } catch (e) { }
      out(`<strong>Link copied.</strong> <a href="${esc(url)}" target="_blank" rel="noopener" style="word-break:break-all">${esc(url)}</a><br><span class="small">${d.ids.length} questions${d.m ? ", " + d.m + " minutes" : ", no time limit"}, feedback ${d.f === "end" ? "at the end" : "after each question"}. Anyone with the link can take it; results are saved only for referees signed in.</span>`);
      renderMine();
    };
    async function renderMine() {
      const el = $("#qb-mine", host); if (!user || !NRC.sb) { el.innerHTML = ""; return; }
      const { data } = await NRC.sb.from("custom_quizzes").select("id,title,question_ids,time_limit_minutes,feedback,created_at").eq("created_by", user.id).order("created_at", { ascending: false }).limit(10);
      el.innerHTML = (data || []).length ? '<h3 style="margin-top:16px">Your shared quizzes</h3>' + data.map(x => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span><strong>${esc(x.title)}</strong>, ${x.question_ids.length} questions${x.time_limit_minutes ? ", " + x.time_limit_minutes + " min" : ""}, ${NRC.fmtDate(x.created_at)}</span><span><a href="quiz.html?id=${x.id}">Open</a> · <a href="quiz.html?id=${x.id}&print=1" target="_blank" rel="noopener">PDF</a> · <a href="#" data-copy="${x.id}">Copy link</a></span></div>`).join("") : "";
      el.querySelectorAll("[data-copy]").forEach(a => a.onclick = async (e) => { e.preventDefault(); const u = location.origin + location.pathname.replace(/[^/]*$/, "") + "quiz.html?id=" + a.dataset.copy; try { await navigator.clipboard.writeText(u); a.textContent = "Copied"; } catch (x) { prompt("Copy the link", u); } });
    }
    renderMine();
  };

  // ================= runner (quiz.html) =================
  async function loadQuiz() {
    const p = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
    if (p.get("id")) {
      if (!NRC.sb) throw new Error("This quiz needs the database connection.");
      const { data, error } = await NRC.sb.from("custom_quizzes").select("*").eq("id", p.get("id")).maybeSingle();
      if (error || !data) throw new Error("This quiz link is not valid or the quiz was removed.");
      return { id: data.id, t: data.title, ids: data.question_ids, m: data.time_limit_minutes || 0, f: data.feedback };
    }
    if (h.get("c")) return dec(h.get("c"));
    throw new Error("No quiz in this link. Build one under Training, Build a quiz.");
  }
  async function runner() {
    const msg = $("#cq-msg"); const print = new URLSearchParams(location.search).get("print") === "1";
    let def, all, user;
    try { [def, all, user] = await Promise.all([loadQuiz(), NRC.loadQuestions(), NRC.currentUser()]); }
    catch (e) { msg.className = "notice error"; msg.innerHTML = esc(e.message) + ' <a href="training.html#build">Build a quiz</a>'; msg.classList.remove("hidden"); return; }
    const byId = {}; all.forEach(q => byId[q.id] = q);
    const qs = def.ids.map(id => byId[id]).filter(Boolean);
    const lost = def.ids.length - qs.length;
    if (!qs.length) { msg.className = "notice error"; msg.textContent = "The questions of this quiz are no longer in the question bank."; msg.classList.remove("hidden"); return; }
    const maxPts = qs.reduce((t, q) => t + nCorrect(q), 0);
    document.title = def.t + " | NRC Referee Hub"; $("#cq-title").textContent = def.t;
    $("#cq-sub").textContent = `${qs.length} questions from the IHF Catalogue${def.m ? ", " + def.m + " minutes" : ", no time limit"}, feedback ${def.f === "end" ? "at the end" : "after each question"}.`;
    if (print) { printSheet(def, qs, maxPts); return; }
    const intro = $("#cq-intro");
    $("#cq-intro-body").innerHTML = `<h3 style="margin-top:0">How it works</h3><ul class="small" style="margin:0;padding-left:18px"><li>Each correct option ticked is worth 1 point. Each wrong option ticked or correct option missed takes 1 point off. A question never scores below 0.</li><li>${def.f === "end" ? "Answers are shown at the end, with your score by rule." : "The answer and the rule reference show after each question."}</li><li>${def.m ? `The clock gives ${def.m} minutes for the whole quiz. When it runs out, the quiz is scored as it stands.` : "No time limit."}</li><li>${user ? "Signed in: the result is saved to My progress and the NRC sees it on your record." : "Not signed in: the result stays on this page."}</li></ul>${lost ? `<p class="small muted">${lost} question${lost === 1 ? " was" : "s were"} removed from the bank since this quiz was made.</p>` : ""}`;
    intro.classList.remove("hidden"); tips(intro);
    $("#cq-print").onclick = () => { const u = new URL(location.href); u.searchParams.set("print", "1"); window.open(u.toString(), "_blank"); };
    $("#cq-copy").onclick = async (e) => { try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Link copied"; } catch (x) { prompt("Copy the link", location.href); } };
    $("#cq-go").onclick = () => { intro.classList.add("hidden"); start(def, qs, maxPts, user); };
  }

  function start(def, qs, maxPts, user) {
    const box = $("#cq-quiz"); box.classList.remove("hidden"); tips(box);
    const deferred = def.f === "end"; const st = { i: 0, picked: qs.map(() => null), graded: qs.map(() => null), started: Date.now(), done: false };
    let timer = null;
    if (def.m) {
      const end = Date.now() + def.m * 60000, clk = $("#cq-clock"); clk.classList.remove("hidden");
      const tick = () => { const left = Math.max(0, Math.round((end - Date.now()) / 1000)); clk.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0"); clk.classList.toggle("low", left < 120); if (!left) finish(true); };
      tick(); timer = setInterval(tick, 1000);
    }
    const multi = (q) => q.cis && q.cis.length > 1;
    function show() {
      const q = qs[st.i], picked = st.picked[st.i] || [], g = st.graded[st.i], locked = !deferred && !!g;
      $("#cq-meta").textContent = `Question ${st.i + 1} of ${qs.length}` + (q.rule ? `, Rule ${q.rule}` : "") + (multi(q) ? ". Several answers are correct: select all that apply." : "");
      $("#cq-q").textContent = q.q;
      const o = $("#cq-opts"); o.innerHTML = "";
      q.options.forEach((t, k) => { const b = document.createElement("button"); b.type = "button"; b.textContent = String.fromCharCode(97 + k) + ") " + t; if (picked.includes(k)) b.classList.add("picked");
        if (locked) { b.disabled = true; b.classList.remove("picked"); if (g.correct.includes(k)) b.classList.add("correct"); else if (picked.includes(k)) b.classList.add("wrong"); }
        b.onclick = () => { let p = (st.picked[st.i] || []).slice(); if (multi(q)) { p = p.includes(k) ? p.filter(x => x !== k) : p.concat(k); } else p = [k]; st.picked[st.i] = p; if (!deferred && !multi(q)) grade(); else show(); };
        o.appendChild(b); });
      $("#cq-check").classList.toggle("hidden", deferred || !multi(q) || locked);
      const ex = $("#cq-explain");
      if (locked) { ex.className = "notice " + (g.ok ? "ok" : "error"); ex.innerHTML = (g.ok ? "<strong>Correct.</strong> " : g.points ? `<strong>Partly right: ${g.points} of ${g.max} points.</strong> ` : "<strong>Not this one.</strong> ") + NRC.explain(q); ex.classList.remove("hidden"); } else ex.classList.add("hidden");
      $("#cq-prev").disabled = st.i === 0;
      $("#cq-next").textContent = st.i + 1 >= qs.length ? "Finish and score" : "Next";
      $("#cq-next").disabled = !deferred && !locked;
      $("#cq-dots").innerHTML = qs.map((x, k) => `<span class="${k === st.i ? "cur" : st.picked[k] && st.picked[k].length ? "done" : ""}" data-k="${k}" title="Question ${k + 1}">${k + 1}</span>`).join("");
      $("#cq-dots").querySelectorAll("span").forEach(s => s.onclick = () => { st.i = +s.dataset.k; show(); });
    }
    function grade() { st.graded[st.i] = NRC.grade(qs[st.i], st.picked[st.i] || []); show(); }
    $("#cq-check").onclick = grade;
    $("#cq-prev").onclick = () => { if (st.i > 0) { st.i--; show(); } };
    $("#cq-next").onclick = () => { if (st.i + 1 >= qs.length) finish(false); else { st.i++; show(); } };
    $("#cq-end").onclick = () => { const left = st.picked.filter(p => !p || !p.length).length; if (!left || confirm(`${left} question${left === 1 ? " is" : "s are"} not answered and will score 0. Finish now?`)) finish(false); };
    async function finish(timeUp) {
      if (st.done) return; st.done = true; clearInterval(timer);
      const answers = qs.map((q, k) => { const g = NRC.grade(q, st.picked[k] || []); return { id: q.id, q, rule: q.rule, ok: g.ok, correct: g.ok, points: g.points, max: g.max, answered: !!(st.picked[k] && st.picked[k].length) }; });
      const points = answers.reduce((t, a) => t + a.points, 0), full = answers.filter(a => a.ok).length, pct = maxPts ? Math.round(points / maxPts * 100) : 0;
      const dur = Math.round((Date.now() - st.started) / 1000), missed = answers.filter(a => !a.ok);
      box.classList.add("hidden");
      const res = $("#cq-result"); res.classList.remove("hidden");
      res.innerHTML = `<h3 style="margin-top:0">${timeUp ? "Time is up" : "Quiz complete"}</h3><p><span class="lesson-score ${pct >= 80 ? "pass" : ""}">${pct}%</span> <strong>${points} of ${maxPts} points</strong>, ${full} of ${qs.length} questions fully correct, in ${Math.floor(dur / 60)} min ${dur % 60} s.</p><p class="small muted" id="cq-saved"></p>` +
        NRC.statsHtml(answers) +
        (missed.length ? `<p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="cq-retry">Retry the ${missed.length} missed question${missed.length === 1 ? "" : "s"}</button><a class="btn ghost" href="training.html#build">Build another quiz</a></p><h3 style="margin-top:14px">Review</h3>` + missed.map(a => `<div class="notice error" style="margin-bottom:8px"><strong>${esc(a.q.q)}</strong><br>${a.answered ? `Your answer: ${(st.picked[qs.indexOf(a.q)] || []).map(k => String.fromCharCode(97 + k)).join(", ")}, ${a.points} of ${a.max} points. ` : "Not answered. "}${NRC.explain(a.q, true)}</div>`).join("") : '<p>Nothing missed.</p><p><a class="btn ghost" href="training.html#build">Build another quiz</a></p>');
      const rb = $("#cq-retry"); if (rb) rb.onclick = () => { res.classList.add("hidden"); const again = NRC.shuffle(missed.map(a => a.q)); start({ t: "Retry", m: 0, f: def.f, retry: true }, again, again.reduce((t, q) => t + nCorrect(q), 0), user); };
      if (user && NRC.sb && !def.retry) {
        const { data: att, error } = await NRC.sb.from("quiz_attempts").insert({ user_id: user.id, mode: "custom:" + (def.id || "link"), total: qs.length, correct: full, points, max_points: maxPts, duration_seconds: dur }).select("id").single();
        if (att) { const rows = answers.map(a => ({ attempt_id: att.id, question_id: a.id, correct: a.ok, points: a.points, max_points: a.max })).filter(r => !String(r.question_id).startsWith("ihf-")); if (rows.length) await NRC.sb.from("quiz_answers").insert(rows); }
        $("#cq-saved").textContent = error ? "The result could not be saved: " + error.message : "Saved to My progress; the NRC sees it on your record.";
      } else if (def.retry) $("#cq-saved").textContent = "Retry: practice only, not recorded.";
      else $("#cq-saved").textContent = "Not signed in: the result is not saved.";
      res.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    show();
  }

  function printSheet(def, qs, maxPts) {
    const L = (k) => String.fromCharCode(97 + k);
    $("#print-sheet").innerHTML = `<div class="ps-head"><h1>${esc(def.t)}</h1><div class="ps-meta"><span>NRC Referee Hub, IHF Catalogue of Rules Questions</span><span>${qs.length} questions, ${maxPts} points${def.m ? ", " + def.m + " minutes" : ""}</span></div></div>
      <div class="ps-name">Name: ______________________________ &nbsp; Date: ______________ &nbsp; Score: ______ / ${maxPts}</div>
      <p style="font-size:9.5pt;margin:0 0 10px">Tick every correct option. Each correct option ticked: +1. Each wrong option ticked or correct option missed: −1. A question never scores below 0. Questions marked (several) have more than one correct option.</p>
      ${qs.map((q, i) => `<div class="ps-q"><span class="n">${i + 1}.</span> ${esc(q.q)}${nCorrect(q) > 1 ? " <em>(several)</em>" : ""}<ol>${q.options.map((o, k) => `<li>${L(k)}) ${esc(o)}</li>`).join("")}</ol></div>`).join("")}
      <div class="ps-key"><div class="ps-head"><h1>Answer key</h1><div class="ps-meta"><span>${esc(def.t)}</span><span>IHF Rules of the Game, edition 1 July 2025</span></div></div>
      <table><thead><tr><th>#</th><th>Correct</th><th>Points</th><th>Rule reference</th></tr></thead><tbody>${qs.map((q, i) => `<tr><td>${i + 1}</td><td>${(nCorrect(q) > 1 ? q.cis : [q.ci]).map(L).join(", ")}</td><td>${nCorrect(q)}</td><td>${esc(q.rr || "")}</td></tr>`).join("")}</tbody></table>
      <div class="ps-foot">Rules: ${esc(NRC.IHF_RULES_URL.replace(/%20/g, " "))}</div></div>`;
    const m = $("#cq-msg"); m.className = "notice"; m.innerHTML = 'The print window opens by itself. Choose <strong>Save as PDF</strong> as the printer. <button class="btn sm" type="button" onclick="window.print()">Print again</button>'; m.classList.remove("hidden");
    setTimeout(() => window.print(), 600);
  }

  if (document.getElementById("cq-quiz")) document.addEventListener("DOMContentLoaded", runner);
})();
