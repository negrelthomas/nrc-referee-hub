/* Training module: practice quiz, timed challenge, flashcards, progress */
(function () {
  const $ = NRC.$;
  let ALL = [], user = null, custom = null, tab = "path", mode = "practice", diff = "", rule = "", src = "";
  const secsPerQ = () => Math.min(30, Math.max(10, parseInt(($("#secs") || {}).value, 10) || 20));
  const SKEY = "nrc_quiz_secs";
  const LKEY = "nrc_training_v1";

  // ---------- local progress (used when signed out, and as a cache) ----------
  const local = () => { try { return JSON.parse(localStorage.getItem(LKEY) || '{"sessions":[],"answers":{}}'); } catch (e) { return { sessions: [], answers: {} }; } };
  const saveLocal = (d) => { try { localStorage.setItem(LKEY, JSON.stringify(d)); } catch (e) { } };

  function pool(forCards) {
    return ALL.filter(q => (!diff || q.diff === diff) && (!rule || String(q.rule) === rule) && (!src || (src === "ihf" ? q.src === "ihf" : src === "nrc_level1" ? q.src === "nrc_level1" : (q.src !== "ihf" && q.src !== "nrc_level1"))) && (forCards ? true : (q.options && q.options.length)));
  }
  function updatePoolCount() {
    const n = pool(false).length;
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
    const quizTabs = t === "practice";
    if (t !== "path") custom = null;
    $("#path-ui").classList.toggle("hidden", t !== "path");
    if (t === "path" && NRC.Path) NRC.Path.render();
    $("#filters").classList.toggle("hidden", t === "progress" || t === "program" || t === "board" || t === "path");
    $("#program-ui").classList.toggle("hidden", t !== "program");
    if (t === "program" && NRC.renderProgram) NRC.renderProgram();
    $("#quiz-start").classList.toggle("hidden", !quizTabs);
    $("#pool-count").classList.toggle("hidden", t === "program" || t === "board" || t === "path");
    $("#board-ui").classList.toggle("hidden", t !== "board");
    if (t === "board") renderBoard();
    $("#quiz").classList.add("hidden"); $("#quiz-result").classList.add("hidden");
    $("#cards-ui").classList.toggle("hidden", t !== "cards");
    $("#progress-ui").classList.toggle("hidden", t !== "progress");
    if (t === "cards") startCards();
    if (t === "progress") renderProgress();
    updatePoolCount();
  }

  // ---------- quiz mode: practice or timed ----------
  function setMode(m) {
    mode = m;
    NRC.$$("#mode-switch .mode").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
    $("#secs-wrap").classList.toggle("hidden", m !== "timed");
    $("#btn-start").textContent = m === "timed" ? "Start the timed challenge" : "Start the practice";
    try { localStorage.setItem("nrc_quiz_mode", m); } catch (e) { }
  }
  NRC.$$("#mode-switch .mode").forEach(b => b.onclick = () => setMode(b.dataset.mode));

  // ---------- quiz ----------
  let session = null, timerId = null;
  $("#btn-start").onclick = startQuiz;
  $("#btn-again").onclick = () => { if (custom && custom.restart) custom.restart(); else startQuiz(); };
  $("#btn-path").onclick = () => showTab("path");
  // a themed quiz from the learning path: same engine, no clock, saved as mode "lesson:<key>"
  NRC.Training = { startLesson(o) {
    if (!o.questions.length) { alert("No questions for this quiz yet."); return; }
    custom = o; clearInterval(timerId);
    session = { mode: "practice", qs: o.questions, i: 0, correct: 0, missed: [], answers: [], started: Date.now(), secs: 20, clock: false };
    $("#path-ui").classList.add("hidden"); $("#quiz-start").classList.add("hidden"); $("#quiz-result").classList.add("hidden"); $("#filters").classList.add("hidden");
    $("#quiz").classList.remove("hidden"); $("#quiz").style.borderTop = "6px solid " + (o.color || "var(--navy)");
    showQuestion(); window.scrollTo({ top: $("#quiz").offsetTop - 80, behavior: "smooth" });
  } };
  $("#quiz-next").onclick = nextQuestion;
  $("#quiz-check").onclick = () => answer(-2);
  $("#quiz-stop").onclick = () => finish();

  function startQuiz() {
    const n = parseInt($("#n-q").value, 10);
    const qs = NRC.shuffle(pool(false)).slice(0, n);
    if (!qs.length) { alert("No questions match these filters."); return; }
    session = { mode, qs, i: 0, correct: 0, missed: [], answers: [], started: Date.now(), secs: secsPerQ(), clock: mode === "timed" };
    try { localStorage.setItem(SKEY, String(session.secs)); } catch (e) { }
    $("#quiz-start").classList.add("hidden"); $("#quiz-result").classList.add("hidden"); $("#quiz").classList.remove("hidden");
    showQuestion();
  }
  function showQuestion() {
    const q = session.qs[session.i];
    $("#quiz-meta").textContent = (custom ? custom.title + ". " : "") + `Question ${session.i + 1} of ${session.qs.length}` + (q.rule ? `, Rule ${q.rule}` : "") + `, ${NRC.levelLabel(q.diff).replace(" (National)", "")}`;
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
    if (session.clock) {
      $("#timer").classList.remove("hidden");
      const bar = $("#timer > div"); const total = session.secs; let left = total; bar.style.width = "100%";
      clearInterval(timerId);
      // the clock runs only while the question is open; answer() clears it, so reading the explanation is untimed
      timerId = setInterval(() => { left -= 0.25; bar.style.width = Math.max(0, left / total * 100) + "%"; if (left <= 0) { clearInterval(timerId); answer(-1); } }, 250);
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
    ex.innerHTML = (ok ? "<strong>Correct.</strong> " : idx === -1 ? "<strong>Time is up.</strong> " : "<strong>Not this one.</strong> ") + NRC.explain(q);
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
    $("#result-text").textContent = `${s.correct} of ${total} correct (${Math.round(s.correct / total * 100)}%) in ${dur} seconds.` + (s.mode === "timed" ? (user ? (total >= 10 ? ` ${s.correct} points added to your season on the leaderboard.` : " Sessions of fewer than 10 questions do not count for the leaderboard.") : " Sign in for timed sessions to count on the leaderboard.") : "");
    $("#result-missed").innerHTML = s.missed.length ? "<h3 style='margin-top:14px'>Review</h3>" + s.missed.map(q => `<div class="notice error" style="margin-bottom:8px"><strong>${NRC.esc(q.q)}</strong><br>${NRC.explain(q, true)}</div>`).join("") : "<p>Nothing missed.</p>";
    // save
    const lesson = custom;
    $("#btn-path").classList.toggle("hidden", !lesson); $("#quiz").style.borderTop = "";
    if (lesson) { const pct = Math.round(s.correct / total * 100); $("#result-text").innerHTML = `<span class="lesson-score ${pct >= 80 ? "pass" : ""}" style="--tc:${lesson.color}">${pct}%</span> <strong>${NRC.esc(lesson.title)}</strong>: ${s.correct} of ${total} correct. ${pct >= 80 ? "Complete. The card on your path shows this score and today's date." : "80% completes the quiz. Review the answers below and try again."}`; }
    const rec = { mode: lesson ? "lesson:" + lesson.key : s.mode, difficulty: lesson ? lesson.difficulty : (diff || null), rule_number: lesson ? null : (rule ? parseInt(rule, 10) : null), total, correct: s.correct, duration_seconds: dur, created_at: new Date().toISOString() };
    const d = local(); d.sessions.unshift(rec); s.answers.forEach(a => { const k = a.rule || "0"; d.answers[k] = d.answers[k] || { n: 0, c: 0 }; d.answers[k].n++; if (a.correct) d.answers[k].c++; }); d.sessions = d.sessions.slice(0, 100); saveLocal(d);
    if (user && NRC.sb) {
      const { data: att } = await NRC.sb.from("quiz_attempts").insert({ ...rec, user_id: user.id, created_at: undefined }).select("id").single();
      if (att) { const rows = s.answers.filter(a => !String(a.id).startsWith("seed-")).map(a => ({ attempt_id: att.id, question_id: a.id, correct: a.correct })); if (rows.length) await NRC.sb.from("quiz_answers").insert(rows); }
    }
    if (lesson && lesson.onDone) lesson.onDone();
  }

  // ---------- flashcards ----------
  let deck = [], ci = 0, flipped = false, scores = {};
  function startCards(review) {
    const base = review ? pool(false).filter(q => scores[q.id] === false) : pool(false);
    deck = NRC.shuffle(base.slice()); ci = 0; flipped = false;
    if (!deck.length) { $("#fc-q").textContent = review ? "No missed cards to review." : "No cards match these filters."; $("#fc-opts").innerHTML = ""; $("#fc-ans").textContent = ""; $("#fc-a").textContent = ""; $("#fc-meta").textContent = ""; return; }
    showCard();
  }
  function showCard() {
    const q = deck[ci]; flipped = false; $("#flash").classList.remove("flipped");
    $("#fc-meta").textContent = `${ci + 1} / ${deck.length}` + (q.rule ? `, Rule ${q.rule}` : "") + `, ${q.cat}`;
    const correct = q.cis && q.cis.length ? q.cis : [q.ci];
    const letter = (i) => String.fromCharCode(97 + i) + ")";
    $("#fc-q").textContent = q.q;
    $("#fc-opts").innerHTML = q.options.map((o, i) => `<li><span class="fc-l">${letter(i)}</span>${NRC.esc(o)}</li>`).join("");
    $("#fc-ans").innerHTML = (correct.length > 1 ? "Correct answers: " : "Correct answer: ") + correct.map(i => `<strong>${letter(i)} ${NRC.esc(q.options[i] || "")}</strong>`).join(", ");
    $("#fc-a").textContent = q.a; $("#fc-rule").textContent = q.rr || "";
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

  // ---------- leaderboard ----------
  async function renderBoard() {
    const season = new Date().getFullYear(); $("#board-season").textContent = season;
    const tb = $("#board tbody");
    if (!user || !NRC.sb) { tb.innerHTML = '<tr><td colspan="7">The leaderboard is for signed in referees. <a href="login.html?next=training.html%23board">Sign in</a> to see it, and to have your timed sessions count.</td></tr>'; return; }
    tb.innerHTML = '<tr><td colspan="7" class="muted">Loading.</td></tr>';
    const { data, error } = await NRC.sb.from("quiz_leaderboard").select("*").eq("season", season).order("points", { ascending: false }).order("accuracy", { ascending: false }).order("last_played", { ascending: true });
    if (error) { tb.innerHTML = '<tr><td colspan="7">The leaderboard could not be loaded.</td></tr>'; return; }
    const rows = data || [];
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="7">No timed session yet this season. Play a timed challenge of 10 questions or more to open the ranking.</td></tr>`; return; }
    const me = await myRefereeId();
    tb.innerHTML = rows.map((r, i) => `<tr${r.referee_id === me ? ' style="background:#FFF9D6"' : ""}><td><strong>${i + 1}</strong></td><td style="white-space:nowrap"><img class="avatar" src="${r.photo_url ? NRC.esc(r.photo_url) : "assets/avatar.svg"}" alt="" style="width:32px;height:32px;vertical-align:middle;margin-right:8px"><strong>${NRC.esc(r.first_name + " " + r.last_name)}</strong>${r.referee_id === me ? ' <span class="pill amber">you</span>' : ""}</td><td>${NRC.esc([r.home_city, r.home_state].filter(Boolean).join(", "))}</td><td><strong>${r.points}</strong></td><td>${r.sessions}</td><td>${r.accuracy}%</td><td>${r.best_pct}%</td></tr>`).join("");
  }
  let myRef = null;
  async function myRefereeId() {
    if (myRef !== null) return myRef;
    const { data } = await NRC.sb.from("referees").select("id").eq("user_id", user.id).maybeSingle();
    myRef = data ? data.id : "";
    return myRef;
  }

  // ---------- progress ----------
  async function renderProgress() {
    let sessions = local().sessions, byRule = local().answers;
    if (user && NRC.sb) {
      const { data } = await NRC.sb.from("quiz_attempts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
      if (data && data.length) sessions = data;
      const { data: ans } = await NRC.sb.from("quiz_answers").select("correct, quiz_questions(rule_number), quiz_attempts!inner(user_id)").eq("quiz_attempts.user_id", user.id);
      if (ans && ans.length) { byRule = {}; ans.forEach(a => { const k = (a.quiz_questions && a.quiz_questions.rule_number) || "0"; byRule[k] = byRule[k] || { n: 0, c: 0 }; byRule[k].n++; if (a.correct) byRule[k].c++; }); }
    }
    $("#progress-list").innerHTML = sessions.length ? sessions.map(s => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${NRC.fmtDate(s.created_at)} &middot; ${String(s.mode).startsWith("lesson:") ? "path: " + NRC.esc(((NRC.THEMES || []).concat(NRC.TABLE_THEMES || []).find(t => s.mode.slice(7).startsWith(t.key + "-")) || {}).title || "theme") : s.mode + " &middot; " + (s.rule_number ? "Rule " + s.rule_number : "all rules")}${s.difficulty ? ", " + NRC.levelLabel(s.difficulty).replace(" (National)", "") : ""} &middot; <strong>${s.correct}/${s.total}</strong></div>`).join("") : "No sessions yet." + (user ? "" : " Sign in to keep progress across devices.");
    const tb = $("#progress-rules tbody"); tb.innerHTML = "";
    Object.keys(byRule).map(Number).sort((a, b) => a - b).forEach(r => { const v = byRule[r]; const pct = Math.round(v.c / v.n * 100); tb.insertAdjacentHTML("beforeend", `<tr><td>Rule ${r}: ${NRC.esc(NRC.RULES[r] || "")}</td><td>${v.n}</td><td>${v.c}</td><td><span class="pill ${pct >= 80 ? "green" : pct >= 60 ? "amber" : "red"}">${pct}%</span></td></tr>`); });
    if (!Object.keys(byRule).length) tb.innerHTML = '<tr><td colspan="4">Answer a few questions first.</td></tr>';
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const sl = $("#secs"), out = $("#secs-out");
    if (sl) { try { const v = parseInt(localStorage.getItem(SKEY), 10); if (v >= 10 && v <= 30) sl.value = v; } catch (e) { } out.textContent = sl.value + " s"; sl.oninput = () => out.textContent = sl.value + " s"; }
    user = await NRC.currentUser();
    if (!user) { const b = $("#signin-banner"); b.classList.remove("hidden"); b.style.display = "flex"; }
    ALL = await NRC.loadQuestions();
    buildFilters(); updatePoolCount();
    let m = "practice"; try { m = localStorage.getItem("nrc_quiz_mode") || "practice"; } catch (e) { }
    setMode(m === "timed" ? "timed" : "practice");
    if (NRC.Path) await NRC.Path.init(user, ALL);
    const h = location.hash.slice(1);
    showTab(["board", "practice", "cards", "progress", "program"].includes(h) ? h : "path");
  });
})();
