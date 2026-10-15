/* Training module: practice quiz, timed challenge, flashcards, progress */
(function () {
  const $ = NRC.$;
  let ALL = [], user = null, tab = "practice", diff = "", rule = "", src = "";
  const TIMED_SECONDS = 20;
  const LKEY = "nrc_training_v1";

  // ---------- local progress (used when signed out, and as a cache) ----------
  const local = () => { try { return JSON.parse(localStorage.getItem(LKEY) || '{"sessions":[],"answers":{}}'); } catch (e) { return { sessions: [], answers: {} }; } };
  const saveLocal = (d) => { try { localStorage.setItem(LKEY, JSON.stringify(d)); } catch (e) { } };

  function pool(forCards) {
    return ALL.filter(q => (!diff || q.diff === diff) && (!rule || String(q.rule) === rule) && (!src || (src === "ihf" ? q.src === "ihf" : q.src !== "ihf")) && (forCards ? true : (q.options && q.options.length)));
  }
  function updatePoolCount() {
    const n = tab === "cards" ? pool(true).length : pool(false).length;
    $("#pool-count").textContent = n + (tab === "cards" ? " cards" : " questions") + " match these filters.";
  }

  // ---------- filters ----------
  function buildFilters() {
    const sel = $("#f-rule");
    const rules = [...new Set(ALL.map(q => q.rule).filter(Boolean))].sort((a, b) => a - b);
    rules.forEach(r => { const o = document.createElement("option"); o.value = r; o.textContent = "Rule " + r + ": " + (NRC.RULES[r] || ""); sel.appendChild(o); });
    sel.onchange = () => { rule = sel.value; updatePoolCount(); if (tab === "cards") startCards(); };
    NRC.$$("#chips-src .chip").forEach(c => c.onclick = () => { NRC.$$("#chips-src .chip").forEach(x => x.classList.remove("on")); c.classList.add("on"); src = c.dataset.v; updatePoolCount(); if (tab === "cards") startCards(); });
    NRC.$$("#chips-diff .chip").forEach(c => c.onclick = () => { NRC.$$("#chips-diff .chip").forEach(x => x.classList.remove("on")); c.classList.add("on"); diff = c.dataset.v; updatePoolCount(); if (tab === "cards") startCards(); });
  }

  // ---------- tabs ----------
  NRC.$$(".tabs button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
  function showTab(t) {
    tab = t; clearInterval(timerId);
    NRC.$$(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
    const quizTabs = t === "practice" || t === "timed";
    $("#filters").classList.toggle("hidden", t === "progress" || t === "program");
    $("#program-ui").classList.toggle("hidden", t !== "program");
    if (t === "program" && NRC.renderProgram) NRC.renderProgram();
    $("#quiz-start").classList.toggle("hidden", !quizTabs);
    $("#pool-count").classList.toggle("hidden", t === "program");
    $("#quiz").classList.add("hidden"); $("#quiz-result").classList.add("hidden");
    $("#cards-ui").classList.toggle("hidden", t !== "cards");
    $("#progress-ui").classList.toggle("hidden", t !== "progress");
    if (t === "practice") { $("#start-title").textContent = "Practice quiz"; $("#start-text").textContent = "Multiple choice, no clock, explanation after each answer with the rule reference."; }
    if (t === "timed") { $("#start-title").textContent = "Timed challenge"; $("#start-text").textContent = TIMED_SECONDS + " seconds per question, no second chance. The format used on the court."; }
    if (t === "cards") startCards();
    if (t === "progress") renderProgress();
    updatePoolCount();
  }

  // ---------- quiz ----------
  let session = null, timerId = null;
  $("#btn-start").onclick = startQuiz;
  $("#btn-again").onclick = startQuiz;
  $("#quiz-next").onclick = nextQuestion;
  $("#quiz-check").onclick = () => answer(-2);
  $("#quiz-stop").onclick = () => finish();

  function startQuiz() {
    const n = parseInt($("#n-q").value, 10);
    const qs = NRC.shuffle(pool(false)).slice(0, n);
    if (!qs.length) { alert("No questions match these filters."); return; }
    session = { mode: tab, qs, i: 0, correct: 0, missed: [], answers: [], started: Date.now() };
    $("#quiz-start").classList.add("hidden"); $("#quiz-result").classList.add("hidden"); $("#quiz").classList.remove("hidden");
    showQuestion();
  }
  function showQuestion() {
    const q = session.qs[session.i];
    $("#quiz-meta").textContent = `Question ${session.i + 1} of ${session.qs.length}` + (q.rule ? `, Rule ${q.rule}` : "") + `, ${NRC.levelLabel(q.diff).replace(" (National)", "")}`;
    $("#quiz-q").textContent = q.q;
    $("#quiz-explain").classList.add("hidden");
    $("#quiz-next").disabled = true;
    const opts = $("#quiz-opts"); opts.innerHTML = "";
    const multi = q.cis && q.cis.length > 1;
    $("#quiz-check").classList.toggle("hidden", !multi);
    $("#quiz-check").disabled = false;
    if (multi) $("#quiz-meta").textContent += ". Several answers are correct: select all that apply.";
    q.options.forEach((o, idx) => { const b = document.createElement("button"); b.textContent = (multi ? String.fromCharCode(97 + idx) + ") " : "") + o; b.dataset.idx = idx;
      b.onclick = () => { if (multi) b.classList.toggle("picked"); else answer(idx); }; opts.appendChild(b); });
    if (session.mode === "timed") {
      $("#timer").classList.remove("hidden");
      const bar = $("#timer > div"); let left = TIMED_SECONDS; bar.style.width = "100%";
      clearInterval(timerId);
      timerId = setInterval(() => { left -= 0.25; bar.style.width = Math.max(0, left / TIMED_SECONDS * 100) + "%"; if (left <= 0) { clearInterval(timerId); answer(-1); } }, 250);
    } else $("#timer").classList.add("hidden");
  }
  function answer(idx) {
    clearInterval(timerId);
    const q = session.qs[session.i];
    const multi = q.cis && q.cis.length > 1;
    const correctSet = multi ? q.cis : [q.ci];
    const picked = idx === -1 ? [] : multi ? NRC.$$("#quiz-opts button.picked").map(b => +b.dataset.idx) : [idx];
    const ok = picked.length === correctSet.length && picked.every(p => correctSet.includes(p));
    $("#quiz-check").classList.add("hidden");
    NRC.$$("#quiz-opts button").forEach((b, i) => { b.disabled = true; b.classList.remove("picked"); if (correctSet.includes(i)) b.classList.add("correct"); else if (picked.includes(i)) b.classList.add("wrong"); });
    if (ok) session.correct++; else session.missed.push(q);
    session.answers.push({ id: q.id, rule: q.rule, correct: ok });
    const ex = $("#quiz-explain");
    ex.className = "notice " + (ok ? "ok" : "error");
    ex.innerHTML = (ok ? "<strong>Correct.</strong> " : idx === -1 ? "<strong>Time is up.</strong> " : "<strong>Not this one.</strong> ") + NRC.esc(q.a) + (q.rr && !/Rule reference/i.test(q.a) ? ` <span class="small muted">(${NRC.esc(q.rr)})</span>` : "");
    ex.classList.remove("hidden");
    $("#quiz-next").disabled = false;
    $("#quiz-next").textContent = session.i + 1 >= session.qs.length ? "See results" : "Next";
    if (session.mode === "timed") setTimeout(nextQuestion, 1800);
  }
  function nextQuestion() { if (!session) return; session.i++; if (session.i >= session.qs.length) finish(); else showQuestion(); }
  async function finish() {
    clearInterval(timerId);
    if (!session) return;
    const s = session; session = null;
    const total = s.answers.length; if (!total) { showTab(tab); return; }
    const dur = Math.round((Date.now() - s.started) / 1000);
    $("#quiz").classList.add("hidden"); $("#quiz-result").classList.remove("hidden");
    $("#result-text").textContent = `${s.correct} of ${total} correct (${Math.round(s.correct / total * 100)}%) in ${dur} seconds.`;
    $("#result-missed").innerHTML = s.missed.length ? "<h3 style='margin-top:14px'>Review</h3>" + s.missed.map(q => `<div class="notice error" style="margin-bottom:8px"><strong>${NRC.esc(q.q)}</strong><br>${NRC.esc(q.a)} <span class="small muted">(${NRC.esc(q.rr || "")})</span></div>`).join("") : "<p>Nothing missed.</p>";
    // save
    const rec = { mode: s.mode, difficulty: diff || null, rule_number: rule ? parseInt(rule, 10) : null, total, correct: s.correct, duration_seconds: dur, created_at: new Date().toISOString() };
    const d = local(); d.sessions.unshift(rec); s.answers.forEach(a => { const k = a.rule || "0"; d.answers[k] = d.answers[k] || { n: 0, c: 0 }; d.answers[k].n++; if (a.correct) d.answers[k].c++; }); d.sessions = d.sessions.slice(0, 100); saveLocal(d);
    if (user && NRC.sb) {
      const { data: att } = await NRC.sb.from("quiz_attempts").insert({ ...rec, user_id: user.id, created_at: undefined }).select("id").single();
      if (att) { const rows = s.answers.filter(a => !String(a.id).startsWith("seed-")).map(a => ({ attempt_id: att.id, question_id: a.id, correct: a.correct })); if (rows.length) await NRC.sb.from("quiz_answers").insert(rows); }
    }
  }

  // ---------- flashcards ----------
  let deck = [], ci = 0, flipped = false, scores = {};
  function startCards(review) {
    const base = review ? pool(true).filter(q => scores[q.id] === false) : pool(true);
    deck = NRC.shuffle(base.slice()); ci = 0; flipped = false;
    if (!deck.length) { $("#fc-q").textContent = review ? "No missed cards to review." : "No cards match these filters."; $("#fc-a").textContent = ""; $("#fc-meta").textContent = ""; return; }
    showCard();
  }
  function showCard() {
    const q = deck[ci]; flipped = false; $("#flash").classList.remove("flipped");
    $("#fc-meta").textContent = `${ci + 1} / ${deck.length}` + (q.rule ? `, Rule ${q.rule}` : "") + `, ${q.cat}`;
    $("#fc-q").textContent = q.q; $("#fc-a").textContent = q.a; $("#fc-rule").textContent = q.rr || "";
    updateCardStats();
  }
  function updateCardStats() {
    const vals = Object.values(scores); const knew = vals.filter(v => v).length, missed = vals.filter(v => v === false).length;
    $("#c-knew").textContent = knew; $("#c-missed").textContent = missed; $("#c-seen").textContent = vals.length; $("#c-pct").textContent = vals.length ? Math.round(knew / vals.length * 100) + "%" : "0%";
  }
  $("#flash").onclick = () => { flipped = !flipped; $("#flash").classList.toggle("flipped", flipped); };
  function mark(v) { if (!deck.length) return; scores[deck[ci].id] = v; ci = (ci + 1) % deck.length; showCard(); }
  $("#fc-knew").onclick = () => mark(true);
  $("#fc-missed").onclick = () => mark(false);
  $("#fc-shuffle").onclick = () => startCards(false);
  $("#fc-review").onclick = () => startCards(true);

  // ---------- progress ----------
  async function renderProgress() {
    let sessions = local().sessions, byRule = local().answers;
    if (user && NRC.sb) {
      const { data } = await NRC.sb.from("quiz_attempts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
      if (data && data.length) sessions = data;
      const { data: ans } = await NRC.sb.from("quiz_answers").select("correct, quiz_questions(rule_number), quiz_attempts!inner(user_id)").eq("quiz_attempts.user_id", user.id);
      if (ans && ans.length) { byRule = {}; ans.forEach(a => { const k = (a.quiz_questions && a.quiz_questions.rule_number) || "0"; byRule[k] = byRule[k] || { n: 0, c: 0 }; byRule[k].n++; if (a.correct) byRule[k].c++; }); }
    }
    $("#progress-list").innerHTML = sessions.length ? sessions.map(s => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${NRC.fmtDate(s.created_at)} &middot; ${s.mode} &middot; ${s.rule_number ? "Rule " + s.rule_number : "all rules"}${s.difficulty ? ", " + NRC.levelLabel(s.difficulty).replace(" (National)", "") : ""} &middot; <strong>${s.correct}/${s.total}</strong></div>`).join("") : "No sessions yet." + (user ? "" : " Sign in to keep progress across devices.");
    const tb = $("#progress-rules tbody"); tb.innerHTML = "";
    Object.keys(byRule).map(Number).sort((a, b) => a - b).forEach(r => { const v = byRule[r]; const pct = Math.round(v.c / v.n * 100); tb.insertAdjacentHTML("beforeend", `<tr><td>Rule ${r}: ${NRC.esc(NRC.RULES[r] || "")}</td><td>${v.n}</td><td>${v.c}</td><td><span class="pill ${pct >= 80 ? "green" : pct >= 60 ? "amber" : "red"}">${pct}%</span></td></tr>`); });
    if (!Object.keys(byRule).length) tb.innerHTML = '<tr><td colspan="4">Answer a few questions first.</td></tr>';
  }

  document.addEventListener("DOMContentLoaded", async () => {
    user = await NRC.currentUser();
    ALL = await NRC.loadQuestions();
    buildFilters(); updatePoolCount();
  });
})();
