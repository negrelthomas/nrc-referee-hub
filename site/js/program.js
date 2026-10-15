/* My program: Level 1 course for candidates; baseline assessment, tailored program and re-test for certified referees.
   Renders into #program-ui on training.html. Uses the shared question bank (NRC.loadQuestions). */
(function () {
  const $ = NRC.$, esc = NRC.esc;
  let user = null, ref = null, ALL = [], host = null;
  let certTest = null, settings = null;
  const RANK = { candidate: 0, level_1: 1, level_2: 2, level_3: 3, nachc: 4, ihf: 5 };
  const DIFF_RANK = { level_1: 1, level_2: 2, level_3: 3 };

  // Level 1 course: six modules by rule group
  const L1_MODULES = [
    { key: "m1", title: "The court, the ball, playing time", rules: [1, 2, 3] },
    { key: "m2", title: "The team, substitutions, goalkeeper, goal area", rules: [4, 5, 6] },
    { key: "m3", title: "Playing the ball and passive play", rules: [7] },
    { key: "m4", title: "Fouls and unsportsmanlike conduct", rules: [8] },
    { key: "m5", title: "Scoring and the throws", rules: [9, 10, 11, 12, 13, 14, 15] },
    { key: "m6", title: "Punishments, referees, table officials", rules: [16, 17, 18] }
  ];

  // ---------- helpers ----------
  const byRules = (rules, maxDiff) => ALL.filter(q => rules.includes(q.rule) && (!maxDiff || (DIFF_RANK[q.diff] || 2) <= DIFF_RANK[maxDiff]) && q.options && q.options.length);
  const pickQuestions = (rules, maxDiff, n) => {
    let p = byRules(rules, maxDiff);
    if (p.length < n && maxDiff === "level_1") p = byRules(rules, "level_2"); // thin level 1 pool for some rules
    return NRC.shuffle(p.slice()).slice(0, n);
  };
  const pct = (c, n) => n ? Math.round(c / n * 100) : 0;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isoDate = (d) => d.toISOString().slice(0, 10);
  const notice = (kind, html) => `<div class="notice ${kind}">${html}</div>`;
  const levelForRef = () => ref ? ref.cert_level : "candidate";
  const maxDiffForLevel = (lvl) => RANK[lvl] >= 3 ? "level_3" : RANK[lvl] === 2 ? "level_2" : "level_1";

  // ---------- calendar export (.ics) ----------
  function downloadIcs(name, events) {
    const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NRC Referee Hub//EN", "CALSCALE:GREGORIAN"];
    events.forEach((e, i) => {
      lines.push("BEGIN:VEVENT", `UID:nrc-${Date.now()}-${i}@nrc-referee-hub`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(e.start)}`, `DTEND:${fmt(e.end)}`,
        `SUMMARY:${e.title.replace(/,/g, "\\,")}`, `DESCRIPTION:${e.desc.replace(/,/g, "\\,").replace(/\n/g, "\\n")}`, `URL:${e.url}`,
        "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Referee study session", "END:VALARM", "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  // Spread study sessions over the modules: sessionsPerWeek, starting next day at 7pm local, 45 minutes each.
  function planSessions(modules, startDate, sessionsPerWeek, weeks, urlBase) {
    const total = Math.max(modules.length, Math.min(sessionsPerWeek * weeks, modules.length * 2));
    const gap = 7 / sessionsPerWeek;
    const events = [];
    for (let i = 0; i < total; i++) {
      const m = modules[Math.min(modules.length - 1, Math.floor(i * modules.length / total))];
      const start = new Date(startDate); start.setDate(start.getDate() + Math.round(i * gap) + 1); start.setHours(19, 0, 0, 0);
      events.push({ start, end: new Date(start.getTime() + 45 * 60000), title: "Referee study: " + m.title, desc: "NRC Referee Hub, My program. Study the cards, then take the module test.", url: urlBase });
    }
    return events;
  }

  // ---------- generic quiz runner ----------
  function runQuiz(opts) {
    // opts: questions, title, timeLimitSeconds (total, optional), onDone(result)
    const qs = opts.questions; let i = 0, correct = 0; const answers = []; const started = Date.now(); let timer = null;
    host.innerHTML = `<div class="card"><div class="small muted" id="pq-meta"></div><div class="timer" id="pq-timer" style="${opts.timeLimitSeconds ? "" : "display:none"}"><div></div></div>
      <div class="quiz-q" id="pq-q"></div><div class="quiz-opts" id="pq-opts"></div><div id="pq-explain" class="notice hidden" style="margin-top:14px"></div>
      <p style="margin-top:14px"><button class="btn secondary hidden" id="pq-check">Check answer</button> <button class="btn" id="pq-next" disabled>Next</button></p></div>`;
    const show = () => {
      const q = qs[i]; const multi = q.cis && q.cis.length > 1;
      $("#pq-meta").textContent = `${opts.title}: question ${i + 1} of ${qs.length}` + (q.rule ? `, Rule ${q.rule}` : "") + (multi ? ". Several answers are correct: select all that apply." : "");
      $("#pq-q").textContent = q.q; $("#pq-explain").classList.add("hidden"); $("#pq-next").disabled = true;
      $("#pq-check").classList.toggle("hidden", !multi); $("#pq-check").disabled = false;
      const o = $("#pq-opts"); o.innerHTML = "";
      q.options.forEach((t, idx) => { const b = document.createElement("button"); b.textContent = (multi ? String.fromCharCode(97 + idx) + ") " : "") + t; b.dataset.idx = idx; b.onclick = () => { if (multi) b.classList.toggle("picked"); else answer(idx); }; o.appendChild(b); });
    };
    const answer = (idx) => {
      const q = qs[i]; const multi = q.cis && q.cis.length > 1; const correctSet = multi ? q.cis : [q.ci];
      const picked = idx === -1 ? [] : multi ? NRC.$$("#pq-opts button.picked").map(b => +b.dataset.idx) : [idx];
      const ok = picked.length === correctSet.length && picked.every(p => correctSet.includes(p));
      $("#pq-check").classList.add("hidden");
      NRC.$$("#pq-opts button").forEach((b, k) => { b.disabled = true; b.classList.remove("picked"); if (correctSet.includes(k)) b.classList.add("correct"); else if (picked.includes(k)) b.classList.add("wrong"); });
      if (ok) correct++;
      answers.push({ id: q.id, rule: q.rule, correct: ok });
      if (!opts.hideExplanations) { const ex = $("#pq-explain"); ex.className = "notice " + (ok ? "ok" : "error"); ex.innerHTML = (ok ? "<strong>Correct.</strong> " : "<strong>Not this one.</strong> ") + esc(q.a) + (q.rr ? ` <span class="small muted">(${esc(q.rr)})</span>` : ""); ex.classList.remove("hidden"); }
      $("#pq-next").disabled = false; $("#pq-next").textContent = i + 1 >= qs.length ? "See results" : "Next";
    };
    const finish = () => {
      clearInterval(timer);
      const byRule = {}; answers.forEach(a => { const k = a.rule || 0; byRule[k] = byRule[k] || { n: 0, c: 0 }; byRule[k].n++; if (a.correct) byRule[k].c++; });
      opts.onDone({ total: qs.length, answered: answers.length, correct, pct: pct(correct, qs.length), byRule, duration: Math.round((Date.now() - started) / 1000), answers });
    };
    $("#pq-check").onclick = () => answer(-2);
    $("#pq-next").onclick = () => { i++; if (i >= qs.length) finish(); else show(); };
    if (opts.timeLimitSeconds) {
      let left = opts.timeLimitSeconds; const bar = $("#pq-timer > div"); bar.style.width = "100%";
      timer = setInterval(() => { left--; bar.style.width = Math.max(0, left / opts.timeLimitSeconds * 100) + "%"; if (left <= 0) { clearInterval(timer); finish(); } }, 1000);
    }
    show();
  }

  // ---------- study cards for a module ----------
  function studyCards(rules, maxDiff, back) {
    const deck = NRC.shuffle(ALL.filter(q => rules.includes(q.rule) && (!maxDiff || (DIFF_RANK[q.diff] || 2) <= DIFF_RANK[maxDiff])).slice()).slice(0, 25);
    let ci = 0;
    host.innerHTML = `<div class="card"><div class="small muted" id="sc-meta"></div><div class="flash" id="sc-flash"><div class="face front"><div class="q" id="sc-q"></div><div class="hint">Tap to reveal</div></div><div class="face back"><div class="a" id="sc-a"></div><div class="rule" id="sc-r"></div></div></div>
      <p style="margin-top:14px"><button class="btn ghost" id="sc-prev">Previous</button> <button class="btn" id="sc-next">Next card</button> <button class="btn secondary" id="sc-done">Done studying, take the module test</button></p></div>`;
    const show = () => { const q = deck[ci]; $("#sc-flash").classList.remove("flipped"); $("#sc-meta").textContent = `Card ${ci + 1} of ${deck.length}` + (q.rule ? `, Rule ${q.rule}: ${NRC.RULES[q.rule] || ""}` : ""); $("#sc-q").textContent = q.q; $("#sc-a").textContent = q.a; $("#sc-r").textContent = q.rr || ""; };
    $("#sc-flash").onclick = () => $("#sc-flash").classList.toggle("flipped");
    $("#sc-next").onclick = () => { ci = (ci + 1) % deck.length; show(); };
    $("#sc-prev").onclick = () => { ci = (ci - 1 + deck.length) % deck.length; show(); };
    $("#sc-done").onclick = back;
    if (!deck.length) { host.innerHTML = notice("error", "No cards for these rules yet.") + `<p><button class="btn ghost" id="sc-back">Back</button></p>`; $("#sc-back").onclick = back; return; }
    show();
  }

  // ---------- progress persistence ----------
  async function loadProgress(course) {
    const { data } = await NRC.sb.from("course_progress").select("*").eq("user_id", user.id).eq("course", course);
    const m = {}; (data || []).forEach(r => m[r.module_key] = r); return m;
  }
  async function saveModuleResult(course, key, p, passPct) {
    const prev = (await loadProgress(course))[key];
    const row = { user_id: user.id, course, module_key: key, attempts: (prev ? prev.attempts : 0) + 1, best_pct: Math.max(prev ? prev.best_pct : 0, p), passed: (prev && prev.passed) || p >= passPct, updated_at: new Date().toISOString() };
    if (row.passed && !(prev && prev.completed_at)) row.completed_at = new Date().toISOString();
    await NRC.sb.from("course_progress").upsert(row, { onConflict: "user_id,course,module_key" });
  }

  // ================= LEVEL 1 COURSE (candidates) =================
  async function renderLevel1() {
    const course = "level_1";
    const prog = await loadProgress(course);
    const { data: plan } = await NRC.sb.from("course_plans").select("*").eq("user_id", user.id).eq("course", course).maybeSingle();
    const done = L1_MODULES.filter(m => prog[m.key] && prog[m.key].passed).length;
    const allDone = done === L1_MODULES.length;
    const { data: lastAtt } = await NRC.sb.from("certification_attempts").select("*").eq("user_id", user.id).eq("level", "level_1").order("created_at", { ascending: false }).limit(5);
    const passedAtt = (lastAtt || []).find(a => a.passed);
    let html = `<div class="card"><h3 style="margin-top:0">Level 1 online course</h3>
      <p>Six modules. For each: study the cards, then pass the module test (${certTest.module_question_count} questions, ${certTest.module_pass_pct}% to pass). When all six are done, the final test unlocks: ${certTest.question_count} questions, ${certTest.time_limit_minutes} minutes, ${certTest.pass_pct}% to pass. Pass it and Level 1 is recorded on your profile.</p>
      <div class="grid c3"><div class="stat"><div class="n">${done}/${L1_MODULES.length}</div><div class="l">Modules completed</div></div><div class="stat"><div class="n">${plan ? NRC.fmtDate(plan.start_date) : "none"}</div><div class="l">Study plan start</div></div><div class="stat ${passedAtt ? "good" : ""}"><div class="n">${passedAtt ? "Passed" : allDone ? "Open" : "Locked"}</div><div class="l">Final test</div></div></div></div>`;
    if (passedAtt) html += notice("ok", `<strong>Level 1 theory test passed</strong> on ${NRC.fmtDate(passedAtt.created_at)} with ${passedAtt.pct}%. ${passedAtt.awarded ? "The certification is on your profile." : "Recording the certification..."}`);
    html += `<div class="card"><h3 style="margin-top:0">Study plan</h3><p class="small">Pick a start date and the platform lays out two 45 minute sessions a week, one module per session, and gives you a calendar file with reminders. Course length: about three weeks.</p>
      <div class="row" style="align-items:end"><div><label>Start date</label><input type="date" id="l1-start" value="${plan ? plan.start_date : isoDate(addDays(new Date(), 1))}"></div><div><button class="btn sm" id="l1-plan">Save plan and download calendar</button></div></div></div>`;
    html += `<div class="card"><h3 style="margin-top:0">Modules</h3><div class="table-wrap"><table><thead><tr><th>Module</th><th>Rules</th><th>Best score</th><th>Status</th><th></th></tr></thead><tbody>` +
      L1_MODULES.map(m => { const p = prog[m.key]; return `<tr><td><strong>${esc(m.title)}</strong></td><td>${m.rules.join(", ")}</td><td>${p ? p.best_pct + "%" : ""}</td><td>${p && p.passed ? '<span class="pill green">Completed</span>' : p ? '<span class="pill amber">In progress</span>' : '<span class="pill">Not started</span>'}</td><td><button class="btn sm ghost" data-study="${m.key}">Study</button> <button class="btn sm" data-test="${m.key}">Module test</button></td></tr>`; }).join("") + `</tbody></table></div></div>`;
    html += `<div class="card"><h3 style="margin-top:0">Final test</h3><p class="small">${certTest.question_count} questions drawn from the Level 1 pool, ${certTest.time_limit_minutes} minutes, no explanations until the end. Pass mark ${certTest.pass_pct}%.</p>
      <p><button class="btn" id="l1-final" ${allDone && !passedAtt ? "" : "disabled"}>${passedAtt ? "Passed" : allDone ? "Start the final test" : "Complete all modules first"}</button></p>
      ${(lastAtt || []).length ? '<p class="small muted">Attempts: ' + lastAtt.map(a => NRC.fmtDate(a.created_at) + " " + a.pct + "%" + (a.passed ? " (passed)" : "")).join(", ") + "</p>" : ""}</div>`;
    host.innerHTML = html;
    NRC.$$("[data-study]").forEach(b => b.onclick = () => { const m = L1_MODULES.find(x => x.key === b.dataset.study); studyCards(m.rules, "level_1", renderLevel1); });
    NRC.$$("[data-test]").forEach(b => b.onclick = () => { const m = L1_MODULES.find(x => x.key === b.dataset.test); runQuiz({ title: m.title, questions: pickQuestions(m.rules, "level_1", certTest.module_question_count), onDone: async (r) => { await saveModuleResult(course, m.key, r.pct, certTest.module_pass_pct); host.innerHTML = notice(r.pct >= certTest.module_pass_pct ? "ok" : "error", `<strong>${r.correct} of ${r.total} (${r.pct}%).</strong> ${r.pct >= certTest.module_pass_pct ? "Module completed." : "Below the " + certTest.module_pass_pct + "% mark: study the cards again and retake."}`) + '<p><button class="btn" id="back">Back to the course</button></p>'; $("#back").onclick = renderLevel1; } }); });
    $("#l1-plan").onclick = async () => { const start = $("#l1-start").value; if (!start) return; await NRC.sb.from("course_plans").upsert({ user_id: user.id, course, start_date: start, sessions_per_week: 2 }, { onConflict: "user_id,course" }); downloadIcs("level1-study-plan.ics", planSessions(L1_MODULES, new Date(start + "T12:00:00"), 2, 3, location.origin + "/training.html#program")); };
    $("#l1-final").onclick = () => runQuiz({ title: "Level 1 final test", hideExplanations: true, timeLimitSeconds: certTest.time_limit_minutes * 60, questions: pickQuestions([...Array(18).keys()].map(x => x + 1), certTest.max_difficulty, certTest.question_count), onDone: async (r) => {
      const passed = r.pct >= certTest.pass_pct;
      const { data: att } = await NRC.sb.from("certification_attempts").insert({ user_id: user.id, level: "level_1", total: r.total, correct: r.correct, pct: r.pct, passed, duration_seconds: r.duration }).select("id").single();
      let award = null; if (passed && att) { const { data } = await NRC.sb.rpc("award_certification", { p_attempt_id: att.id }); award = data; }
      host.innerHTML = notice(passed ? "ok" : "error", `<strong>${r.correct} of ${r.total} (${r.pct}%).</strong> ` + (passed ? (award && award.ok ? "Level 1 passed and recorded on your profile. The NRC sees it on your record." : "Passed. The certification could not be recorded automatically (" + esc(award && award.reason || "unknown") + "); the NRC will record it.") : "Below the " + certTest.pass_pct + "% pass mark. Review the weakest rules below and retake when ready.")) + weakRulesTable(r.byRule) + '<p><button class="btn" id="back">Back to the course</button></p>'; $("#back").onclick = renderLevel1; } });
  }

  function weakRulesTable(byRule) {
    const rows = Object.keys(byRule).map(Number).sort((a, b) => pct(byRule[a].c, byRule[a].n) - pct(byRule[b].c, byRule[b].n));
    return '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Rule</th><th>Answered</th><th>Score</th></tr></thead><tbody>' + rows.map(r => { const v = byRule[r]; const p = pct(v.c, v.n); return `<tr><td>Rule ${r}: ${esc(NRC.RULES[r] || "")}</td><td>${v.n}</td><td><span class="pill ${p >= 80 ? "green" : p >= 60 ? "amber" : "red"}">${p}%</span></td></tr>`; }).join("") + "</tbody></table></div>";
  }

  // ================= CERTIFIED REFEREES: assessment, program, re-test =================
  async function renderProgram() {
    const S = settings;
    const { data: progs } = await NRC.sb.from("programs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1);
    const program = progs && progs[0];
    const { data: assessments } = await NRC.sb.from("assessments").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    const A = assessments || [];
    const maxDiff = maxDiffForLevel(levelForRef());
    const startAssessment = (kind) => runQuiz({ title: kind === "baseline" ? "Baseline assessment" : "Re-test", hideExplanations: true, timeLimitSeconds: S.time_limit_minutes * 60, questions: pickQuestions([...Array(18).keys()].map(x => x + 1), maxDiff, S.assessment_questions), onDone: async (r) => {
      const passed = r.pct >= S.assessment_pass_pct;
      const { data: a } = await NRC.sb.from("assessments").insert({ user_id: user.id, kind, total: r.total, correct: r.correct, pct: r.pct, passed, by_rule: r.byRule, duration_seconds: r.duration }).select("id").single();
      const weak = Object.keys(r.byRule).map(Number).filter(k => k && pct(r.byRule[k].c, r.byRule[k].n) < S.weak_rule_pct).sort((x, y) => pct(r.byRule[x].c, r.byRule[x].n) - pct(r.byRule[y].c, r.byRule[y].n));
      if (passed || !weak.length) {
        if (program && program.status !== "cleared") await NRC.sb.from("programs").update({ status: "cleared", cleared_on: isoDate(new Date()) }).eq("id", program.id);
        else if (!program) await NRC.sb.from("programs").insert({ user_id: user.id, assessment_id: a && a.id, weak_rules: [], due_on: isoDate(new Date()), status: "cleared", cleared_on: isoDate(new Date()) });
      } else {
        if (program && program.status !== "cleared") await NRC.sb.from("programs").update({ status: "expired" }).eq("id", program.id);
        await NRC.sb.from("programs").insert({ user_id: user.id, assessment_id: a && a.id, weak_rules: weak, due_on: isoDate(addDays(new Date(), S.program_weeks * 7)), status: "active" });
      }
      host.innerHTML = notice(passed ? "ok" : "amber", `<strong>${r.correct} of ${r.total} (${r.pct}%).</strong> ` + (passed ? "Hurdle cleared (" + S.assessment_pass_pct + "%). Nothing further required this season; keep practising." : "Below the " + S.assessment_pass_pct + "% hurdle. A program covering your " + weak.length + " weakest rules is ready, to complete within " + S.program_weeks + " weeks.")) + weakRulesTable(r.byRule) + '<p><button class="btn" id="back">Open my program</button></p>'; $("#back").onclick = renderProgram; } });

    if (!A.length) {
      host.innerHTML = `<div class="card"><h3 style="margin-top:0">Baseline assessment</h3><p>Every referee on the roster starts with a ${S.assessment_questions} question assessment at the level of their certification (${NRC.levelLabel(levelForRef())}), ${S.time_limit_minutes} minutes, no explanations until the end. It measures your strength rule by rule. Score ${S.assessment_pass_pct}% or more and you have cleared the hurdle; below that, the platform builds a program on the rules you missed, to complete within ${S.program_weeks} weeks, and you re-test at the end.</p><p><button class="btn" id="start">Start the assessment</button></p></div>`;
      $("#start").onclick = () => startAssessment("baseline"); return;
    }
    const last = A[0];
    if (!program || program.status === "cleared") {
      host.innerHTML = notice("ok", `<strong>Hurdle cleared</strong> on ${NRC.fmtDate((program && program.cleared_on) || last.created_at)} with ${last.pct}%. The NRC may ask for a new assessment next season.`) + weakRulesTable(last.by_rule) + `<div class="card"><p class="small">Want a fresh measure? <button class="btn sm ghost" id="again">Take the assessment again</button></p></div>`;
      $("#again").onclick = () => startAssessment("retest"); return;
    }
    const course = "program:" + program.id;
    const prog = await loadProgress(course);
    const modules = program.weak_rules.map(r => ({ key: String(r), title: "Rule " + r + ": " + (NRC.RULES[r] || ""), rules: [r] }));
    const done = modules.filter(m => prog[m.key] && prog[m.key].passed).length;
    const allDone = done === modules.length;
    const daysLeft = Math.ceil((new Date(program.due_on) - new Date()) / 864e5);
    const { data: plan } = await NRC.sb.from("course_plans").select("*").eq("user_id", user.id).eq("course", course).maybeSingle();
    let html = `<div class="card"><h3 style="margin-top:0">My program</h3><p>Built from your assessment of ${NRC.fmtDate(last.created_at)} (${last.pct}%). ${modules.length} rules to bring above ${S.weak_rule_pct}%, due ${NRC.fmtDate(program.due_on)}${daysLeft < 0 ? ' <span class="pill red">overdue</span>' : daysLeft <= 14 ? ' <span class="pill amber">' + daysLeft + ' days left</span>' : ""}. Each module: study the cards, then pass the test (${S.module_question_count} questions, ${S.module_pass_pct}%). When all are done, re-test on ${S.assessment_questions} questions; clear ${S.assessment_pass_pct}% and you are done.</p>
      <div class="grid c3"><div class="stat"><div class="n">${done}/${modules.length}</div><div class="l">Modules completed</div></div><div class="stat ${daysLeft < 0 ? "bad" : ""}"><div class="n">${Math.max(0, daysLeft)}</div><div class="l">Days to deadline</div></div><div class="stat ${allDone ? "good" : ""}"><div class="n">${allDone ? "Open" : "Locked"}</div><div class="l">Re-test</div></div></div></div>`;
    html += `<div class="card"><h3 style="margin-top:0">Study sessions in your calendar</h3><p class="small">${S.sessions_per_week} sessions a week of 45 minutes, weakest rule first, spread until the deadline. Download the calendar file and open it with Google Calendar, Outlook or Apple Calendar; each session has a reminder and a link back here.</p>
      <div class="row" style="align-items:end"><div><label>First session</label><input type="date" id="pg-start" value="${plan ? plan.start_date : isoDate(addDays(new Date(), 1))}"></div><div><button class="btn sm" id="pg-plan">Save plan and download calendar</button></div></div></div>`;
    html += `<div class="card"><h3 style="margin-top:0">Modules, weakest first</h3><div class="table-wrap"><table><thead><tr><th>Rule</th><th>Assessment</th><th>Best module score</th><th>Status</th><th></th></tr></thead><tbody>` +
      modules.map(m => { const p = prog[m.key]; const v = last.by_rule[m.key] || { n: 0, c: 0 }; return `<tr><td><strong>${esc(m.title)}</strong></td><td>${pct(v.c, v.n)}%</td><td>${p ? p.best_pct + "%" : ""}</td><td>${p && p.passed ? '<span class="pill green">Completed</span>' : p ? '<span class="pill amber">In progress</span>' : '<span class="pill">Not started</span>'}</td><td><button class="btn sm ghost" data-study="${m.key}">Study</button> <button class="btn sm" data-test="${m.key}">Module test</button></td></tr>`; }).join("") + `</tbody></table></div></div>`;
    html += `<div class="card"><h3 style="margin-top:0">Re-test</h3><p class="small">${S.assessment_questions} questions, ${S.time_limit_minutes} minutes, pass mark ${S.assessment_pass_pct}%. If you fall short, a new program is built from that result.</p><p><button class="btn" id="pg-retest" ${allDone ? "" : "disabled"}>${allDone ? "Start the re-test" : "Complete all modules first"}</button></p>
      <p class="small muted">History: ${A.map(a => NRC.fmtDate(a.created_at) + " " + a.kind + " " + a.pct + "%").join(", ")}</p></div>`;
    host.innerHTML = html;
    NRC.$$("[data-study]").forEach(b => b.onclick = () => studyCards([+b.dataset.study], maxDiff, renderProgram));
    NRC.$$("[data-test]").forEach(b => b.onclick = () => { const m = modules.find(x => x.key === b.dataset.test); runQuiz({ title: m.title, questions: pickQuestions(m.rules, maxDiff, S.module_question_count), onDone: async (r) => { await saveModuleResult(course, m.key, r.pct, S.module_pass_pct); const nowDone = allDone || (done + (r.pct >= S.module_pass_pct && !(prog[m.key] && prog[m.key].passed) ? 1 : 0)) === modules.length; if (nowDone && program.status === "active") await NRC.sb.from("programs").update({ status: "ready_for_retest" }).eq("id", program.id); host.innerHTML = notice(r.pct >= S.module_pass_pct ? "ok" : "error", `<strong>${r.correct} of ${r.total} (${r.pct}%).</strong> ${r.pct >= S.module_pass_pct ? "Module completed." : "Below the " + S.module_pass_pct + "% mark: study the cards again and retake."}`) + '<p><button class="btn" id="back">Back to my program</button></p>'; $("#back").onclick = renderProgram; } }); });
    $("#pg-plan").onclick = async () => { const start = $("#pg-start").value; if (!start) return; await NRC.sb.from("course_plans").upsert({ user_id: user.id, course, start_date: start, sessions_per_week: S.sessions_per_week }, { onConflict: "user_id,course" }); const weeks = Math.max(1, Math.ceil((new Date(program.due_on) - new Date(start)) / (7 * 864e5))); downloadIcs("referee-study-plan.ics", planSessions(modules, new Date(start + "T12:00:00"), S.sessions_per_week, weeks, location.origin + "/training.html#program")); };
    $("#pg-retest").onclick = () => startAssessment("retest");
  }

  // ---------- entry ----------
  async function render() {
    if (!NRC.sb) { host.innerHTML = notice("error", "The program needs the database connection."); return; }
    if (!user) { host.innerHTML = `<div class="card"><h3 style="margin-top:0">My program</h3><p>Candidates follow the Level 1 online course here and take the final test; certified referees take a ${settings.assessment_questions} question assessment at first sign in and get a tailored program on their weakest rules. Progress is saved on your profile.</p><p><a class="btn" href="login.html?next=training.html%23program">Sign in</a> &nbsp; <a class="btn ghost" href="become-a-referee.html">Not on the roster yet?</a></p></div>`; return; }
    if (ref && RANK[ref.cert_level] >= 1) await renderProgram(); else await renderLevel1();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    host = document.getElementById("program-ui"); if (!host) return;
    user = await NRC.currentUser();
    if (NRC.sb) {
      const [t, s] = await Promise.all([NRC.sb.from("certification_tests").select("*").eq("level", "level_1").maybeSingle(), NRC.sb.from("program_settings").select("*").eq("id", 1).maybeSingle()]);
      certTest = t.data || { question_count: 30, pass_pct: 80, time_limit_minutes: 30, max_difficulty: "level_1", module_pass_pct: 70, module_question_count: 10 };
      settings = s.data || { assessment_questions: 50, assessment_pass_pct: 80, weak_rule_pct: 80, program_weeks: 12, sessions_per_week: 2, module_question_count: 10, module_pass_pct: 80, time_limit_minutes: 60 };
      if (user) { const { data } = await NRC.sb.from("referees").select("id,cert_level,first_name").eq("user_id", user.id).maybeSingle(); ref = data; }
    }
    ALL = await NRC.loadQuestions();
    NRC.renderProgram = render;
    if (location.hash === "#program" || location.hash === "#level1") { const b = document.querySelector('.tabs button[data-tab="program"]'); if (b) b.click(); }
  });
})();
