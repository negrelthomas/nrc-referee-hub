/* NRC Referee Hub: AI assisted reviews.
   An AI pass logs the game from its video and flags moments for review (outside the hub). The NRC loads the log on the game
   (Admin, tournament Games tab) and checks the match facts against the official score sheet. Certified evaluators see the
   flags next to the video while writing the IHF report, confirm or dismiss each one, and confirmed flags become key scenes.
   The AI never rates the referees. */
(function () {
  const A = (window.NRC.AI = {});
  const esc = (s) => NRC.esc(s);
  const FACT_KEYS = [["h1", "1st half"], ["h2", "2nd half"], ["seven_m", "7 m"], ["yellow", "Yellow"], ["two_min", "2 min"], ["red", "Red"], ["blue", "Blue"], ["timeouts", "Timeouts"]];
  const CATS = { punishment: "Punishment", seven_m: "7 m", foul: "Foul", passive_play: "Passive play", mechanics: "Mechanics", possible_miss: "Possible miss", sheet_mismatch: "Differs from score sheet", other: "Other" };
  A.CATS = CATS;

  // ---------- parsing ----------
  A.parseCsv = function (text) {
    const rows = []; let row = [], cell = "", q = false;
    text = String(text || "").replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x.trim() !== "")) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x.trim() !== "")) rows.push(row);
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s*\(.*\)$/, "").replace(/[\s-]+/g, "_"));
    return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  };
  A.toSeconds = function (s) {
    const m = String(s || "").trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?$/); if (!m) return null;
    return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
  };
  A.fmt = function (sec) { sec = Math.max(0, sec | 0); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  const norm = (s) => String(s || "").toLowerCase().replace(/[_-]+/g, " ").trim();
  function kind(type) {
    const t = norm(type);
    if (/half ?time|end of (the )?first half/.test(t)) return "half";
    if (/7 ?m|seven/.test(t)) return "seven_m";
    if (/warning|yellow/.test(t)) return "yellow";
    if (/2 ?min|two min|suspension/.test(t)) return "two_min";
    if (/blue/.test(t)) return "blue";
    if (/disqualif|red card|^red/.test(t)) return "red";
    if (/team time ?out/.test(t)) return "timeout";
    if (/^goal$|goal scored/.test(t)) return "goal";
    if (/passive/.test(t)) return "passive_play";
    return "other";
  }
  // log rows to events; rows with a "flag" column become flags; punishments and 7 m decisions optionally flagged too
  A.fromCsv = function (text, opts) {
    const rows = A.parseCsv(text), events = [], flags = [];
    rows.forEach(r => {
      const t = A.toSeconds(r.video_time || r.time || r.t); if (t == null) return;
      const e = { t, clock: r.game_clock || "", score: r.score || "", type: r.event_type || r.type || "", team: r.team || "", player: r.player_number || r.player || "", referee: r.referee || "", whistle: r.whistle_heard || "", signal: r.signal_shown || "", confidence: (r.confidence || "").toLowerCase(), note: r.note || "" };
      events.push(e);
      const k = kind(e.type), why = r.flag || r.flag_reason || "";
      const cat = r.category && CATS[r.category] ? r.category : (["yellow", "two_min", "red", "blue"].includes(k) ? "punishment" : k === "seven_m" ? "seven_m" : k === "passive_play" ? "passive_play" : why ? "possible_miss" : "other");
      if (why || ((opts || {}).flagDecisions && (cat === "punishment" || cat === "seven_m"))) {
        flags.push({ t_seconds: t, t_label: A.fmt(t), category: cat, reason: why || [e.type, e.team, e.player && e.player !== "unclear" ? "#" + e.player : "", e.note].filter(Boolean).join(", "), confidence: ["high", "medium", "low"].includes(e.confidence) ? e.confidence : null });
      }
    });
    events.sort((a, b) => a.t - b.t); flags.sort((a, b) => a.t_seconds - b.t_seconds);
    const teams = [...new Set(events.map(e => e.team).filter(x => x && !/^(both|unclear|none)$/i.test(x)))];
    return { events, flags, teams };
  };
  // match facts in the shape of the report's match facts, from the log and the team labels
  A.facts = function (events, home, away) {
    const f = { home: {}, away: {} }; FACT_KEYS.forEach(([k]) => { f.home[k] = 0; f.away[k] = 0; });
    const half = (events.find(e => kind(e.type) === "half") || {}).t;
    const side = (team) => { const t = norm(team); if (home && t.startsWith(norm(home))) return "home"; if (away && t.startsWith(norm(away))) return "away"; return null; };
    events.forEach(e => {
      const s = side(e.team), k = kind(e.type); if (!s) return;
      if (k === "goal") f[s][half != null && e.t > half ? "h2" : "h1"]++;
      else if (k === "timeout") f[s].timeouts++;
      else if (["seven_m", "yellow", "two_min", "red", "blue"].includes(k)) f[s][k]++;
    });
    return f;
  };

  // ---------- admin: load and check a log on a game ----------
  function injectAdmin() {
    if (document.getElementById("dlg-ai-log")) return;
    document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-ai-log" style="max-width:860px"><div class="body">
  <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3 style="margin:0">AI log</h3><button class="btn sm ghost" type="button" onclick="this.closest('dialog').close()">Close</button></div>
  <div class="small muted" id="ai-sub" style="margin:4px 0 10px"></div>
  <div id="ai-msg" class="notice hidden"></div>
  <p class="small" style="margin-top:0">Load the log produced by the AI pass on this game's video: a CSV with one row per event (video_time, game_clock, score, event_type, team, player_number, referee, whistle_heard, signal_shown, confidence, note) and an optional <strong>flag</strong> column giving the reason a moment should be reviewed. The AI never rates the referees; evaluators decide.</p>
  <div class="row"><div><label>CSV file</label><input type="file" id="ai-file" accept=".csv,text/csv,text/plain"></div><div><label>Model and settings</label><input id="ai-model" placeholder="gemini-3.8-flash, high resolution, 2 fps"></div></div>
  <label>Or paste the CSV</label><textarea id="ai-text" rows="5" placeholder="video_time,game_clock,score,event_type,team,..."></textarea>
  <label class="chip" style="display:inline-flex;gap:6px;margin-top:8px"><input type="checkbox" id="ai-auto" checked style="width:auto"> Also flag every punishment and 7 m decision for review</label>
  <p style="margin:10px 0"><button class="btn sm" type="button" id="ai-parse">Read the log</button></p>
  <div id="ai-preview"></div>
  <div id="ai-facts-wrap" class="hidden">
    <h3 style="margin-top:14px">Match facts</h3>
    <p class="small muted" style="margin-top:0">Counted from the log. The AI pass reconciles them with the official score sheet: the score must match the sheet; cards, suspensions and 7 m throws are often missed at the table, so a difference there comes in as a flag (Differs from score sheet) for the evaluator, not as a correction.</p>
    <div class="row"><div><label>Home team in the log</label><select id="ai-home"></select></div><div><label>Away team in the log</label><select id="ai-away"></select></div></div>
    <div class="table-wrap"><table class="rep-stats"><thead><tr><th></th>${FACT_KEYS.map(([, l]) => "<th>" + l + "</th>").join("")}</tr></thead><tbody id="ai-facts"></tbody></table></div>
    <label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:8px"><input type="checkbox" id="ai-checked" style="width:auto"> Reconciled with the official score sheet (score matches)</label>
    <label>Notes</label><input id="ai-notes" placeholder="Corrections made, footage quality, anything the evaluator should know">
    <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="ai-save">Save the log on this game</button><button class="btn ghost hidden" type="button" id="ai-del">Remove the log</button></p>
  </div>
</div></dialog>`);
  }
  A.openAdmin = async function (game, onDone) {
    injectAdmin();
    const D = NRC.$("#dlg-ai-log"), sb = NRC.sb; let parsed = null, existing = null;
    ["#ai-text", "#ai-model", "#ai-notes"].forEach(s => NRC.$(s).value = ""); NRC.$("#ai-file").value = ""; NRC.$("#ai-preview").innerHTML = ""; NRC.$("#ai-msg").classList.add("hidden");
    NRC.$("#ai-sub").textContent = [game.home_team, game.away_team].filter(Boolean).join(" v ") + (game.game_number ? " · match " + game.game_number : "") + " · " + NRC.fmtDate(game.game_date);
    const { data: log } = await sb.from("game_ai_logs").select("*").eq("game_id", game.id).maybeSingle();
    existing = log;
    const paintFacts = (f) => { NRC.$("#ai-facts").innerHTML = ["home", "away"].map(s => `<tr><th>${esc(s === "home" ? (game.home_team || "Home") : (game.away_team || "Away"))}</th>${FACT_KEYS.map(([k]) => `<td><input type="number" min="0" data-f="${s}.${k}" value="${f && f[s] && f[s][k] != null ? f[s][k] : ""}"></td>`).join("")}</tr>`).join(""); };
    const teamSelects = (teams, h, a) => { const o = (sel) => '<option value="">Not in the log</option>' + teams.map(t => `<option ${t === sel ? "selected" : ""}>${esc(t)}</option>`).join(""); NRC.$("#ai-home").innerHTML = o(h); NRC.$("#ai-away").innerHTML = o(a); };
    const refacts = () => { if (!parsed) return; paintFacts(A.facts(parsed.events, NRC.$("#ai-home").value, NRC.$("#ai-away").value)); };
    if (log) {
      parsed = { events: log.events || [], flags: null, teams: [...new Set((log.events || []).map(e => e.team).filter(x => x && !/^(both|unclear|none)$/i.test(x)))] };
      NRC.$("#ai-model").value = log.model || ""; NRC.$("#ai-notes").value = log.notes || ""; NRC.$("#ai-checked").checked = !!log.facts_checked;
      const { count } = await sb.from("game_ai_flags").select("id", { count: "exact", head: true }).eq("log_id", log.id);
      NRC.$("#ai-preview").innerHTML = `<div class="notice ok">A log is on this game: ${(log.events || []).length} events, ${count || 0} flags, loaded ${NRC.fmtDate(log.created_at.slice(0, 10))}${log.facts_checked ? ", reconciled with the score sheet" : ", not reconciled with the score sheet yet"}. Load a new file to replace it, or correct the facts below.</div>`;
      teamSelects(parsed.teams, log.home_label, log.away_label); paintFacts(log.facts);
      NRC.$("#ai-facts-wrap").classList.remove("hidden"); NRC.$("#ai-del").classList.remove("hidden");
    } else { NRC.$("#ai-facts-wrap").classList.add("hidden"); NRC.$("#ai-del").classList.add("hidden"); NRC.$("#ai-checked").checked = false; }
    NRC.$("#ai-file").onchange = async (e) => { const f = e.target.files[0]; if (f) NRC.$("#ai-text").value = await f.text(); };
    NRC.$("#ai-parse").onclick = () => {
      parsed = A.fromCsv(NRC.$("#ai-text").value, { flagDecisions: NRC.$("#ai-auto").checked });
      if (!parsed.events.length) { NRC.notice(NRC.$("#ai-msg"), "No event found. The first row must hold the column names and video_time must read like 53:54 or 1:02:03.", "error"); return; }
      NRC.$("#ai-msg").classList.add("hidden");
      const counts = {}; parsed.flags.forEach(f => counts[f.category] = (counts[f.category] || 0) + 1);
      NRC.$("#ai-preview").innerHTML = `<div class="notice">${parsed.events.length} events from ${A.fmt(parsed.events[0].t)} to ${A.fmt(parsed.events[parsed.events.length - 1].t)}; ${parsed.flags.length} flags${parsed.flags.length ? " (" + Object.entries(counts).map(([k, n]) => n + " " + CATS[k].toLowerCase()).join(", ") + ")" : ""}. Teams in the log: ${parsed.teams.map(esc).join(", ") || "none"}.</div>`;
      const guess = (name) => parsed.teams.find(t => name && norm(t).startsWith(norm(name).split(" ")[0]));
      teamSelects(parsed.teams, guess(game.home_team) || parsed.teams[0], guess(game.away_team) || parsed.teams[1]);
      refacts(); NRC.$("#ai-checked").checked = false; NRC.$("#ai-facts-wrap").classList.remove("hidden");
    };
    NRC.$("#ai-home").onchange = refacts; NRC.$("#ai-away").onchange = refacts;
    NRC.$("#ai-save").onclick = async () => {
      if (!parsed) return;
      const facts = { home: {}, away: {} };
      NRC.$$("[data-f]", D).forEach(i => { const [s, k] = i.dataset.f.split("."); facts[s][k] = i.value === "" ? null : parseInt(i.value, 10); });
      const me = (await NRC.sb.auth.getUser()).data.user, checked = NRC.$("#ai-checked").checked;
      const row = { game_id: game.id, model: NRC.$("#ai-model").value.trim() || null, notes: NRC.$("#ai-notes").value.trim() || null, home_label: NRC.$("#ai-home").value || null, away_label: NRC.$("#ai-away").value || null, events: parsed.events, facts, facts_checked: checked };
      if (checked && !(existing && existing.facts_checked)) { row.facts_checked_by = (me && me.email) || "NRC"; row.facts_checked_at = new Date().toISOString(); }
      if (!checked) { row.facts_checked_by = null; row.facts_checked_at = null; }
      if (parsed.events.length) { row.video_start = parsed.events[0].t; row.video_end = parsed.events[parsed.events.length - 1].t; }
      if (!existing) row.created_by = me && me.id;
      const res = await sb.from("game_ai_logs").upsert(row, { onConflict: "game_id" }).select().single();
      if (res.error) { NRC.notice(NRC.$("#ai-msg"), esc(res.error.message), "error"); return; }
      if (parsed.flags) {
        await sb.from("game_ai_flags").delete().eq("log_id", res.data.id);
        if (parsed.flags.length) { const ins = await sb.from("game_ai_flags").insert(parsed.flags.map(f => Object.assign({ log_id: res.data.id, game_id: game.id }, f))); if (ins.error) { NRC.notice(NRC.$("#ai-msg"), "Log saved, flags not saved: " + esc(ins.error.message), "error"); return; } }
      }
      D.close(); if (onDone) onDone();
    };
    NRC.$("#ai-del").onclick = async () => {
      if (!existing || !confirm("Remove the AI log and its flags from this game? Reports already written keep their key scenes.")) return;
      const { error } = await sb.from("game_ai_logs").delete().eq("id", existing.id);
      if (error) { NRC.notice(NRC.$("#ai-msg"), esc(error.message), "error"); return; }
      D.close(); if (onDone) onDone();
    };
    D.showModal();
  };

  // ---------- evaluator: flags beside the report ----------
  // el: container; o: { game (evaluator_games row), decisions, form (report form element), onChange }
  A.panel = async function (el, o) {
    const sb = NRC.sb, gid = o.game.game_id || o.game.id;
    const [{ data: log }, { data: flags }] = await Promise.all([
      sb.from("game_ai_logs").select("id,model,facts,facts_checked,facts_checked_by,notes,home_label,away_label").eq("game_id", gid).maybeSingle(),
      sb.from("game_ai_flags").select("*").eq("game_id", gid).order("t_seconds")
    ]);
    if (!log) { el.innerHTML = ""; return null; }
    const dec = Object.assign({}, o.decisions || {});
    const done = () => Object.values(dec).filter(x => x && x.d).length;
    const f = log.facts || {};
    const factRow = (s, name) => `<tr><th>${esc(name)}</th>${FACT_KEYS.map(([k]) => `<td>${f[s] && f[s][k] != null ? f[s][k] : ""}</td>`).join("")}</tr>`;
    el.innerHTML = `<details class="rep-sec ai-panel" open><summary>AI log and flagged moments <span class="small muted">(${(flags || []).length} flags, <span data-ai="done">${done()}</span> reviewed)</span></summary>
      <p class="small" style="margin-top:6px">An AI pass logged this game from the video and flagged moments worth a look. It does not rate the referees and it misses things: watch enough of the game to judge positioning, cooperation and consistency yourself. Confirm a flag to add it to your key scenes; dismiss it if nothing is wrong. Where the video and the score sheet differ on a card, suspension or 7 m, trust what you see: the table often misses them. Your decisions help the NRC see which flags are worth an evaluator's time.</p>
      <div class="table-wrap"><table class="rep-stats"><thead><tr><th></th>${FACT_KEYS.map(([, l]) => "<th>" + l + "</th>").join("")}</tr></thead><tbody>${factRow("home", o.game.home_team || "Home")}${factRow("away", o.game.away_team || "Away")}</tbody></table></div>
      <p class="small" style="margin:6px 0">${log.facts_checked ? '<span class="pill green">Score matches the score sheet</span>' : '<span class="pill amber">Not reconciled with the score sheet</span>'} <button type="button" class="btn sm ghost" data-ai="fill">Use these match facts in my report</button>${log.notes ? ' <span class="small muted">' + esc(log.notes) + "</span>" : ""}</p>
      <div class="ai-flags">${(flags || []).map(fl => { const d = dec[fl.id] || {}; return `<div class="ai-flag ${d.d || ""}" data-id="${fl.id}"><button type="button" class="btn sm ghost" data-ai="seek" data-t="${fl.t_seconds}" title="Play the video from here">&#9654; ${esc(fl.t_label || A.fmt(fl.t_seconds))}</button> <span class="pill">${esc(CATS[fl.category] || fl.category)}</span>${fl.confidence ? ' <span class="small muted">' + esc(fl.confidence) + "</span>" : ""}<div class="small" style="margin:4px 0">${esc(fl.reason)}</div><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button type="button" class="btn sm ${d.d === "confirmed" ? "" : "ghost"}" data-ai="confirm">Confirm, add as key scene</button><button type="button" class="btn sm ${d.d === "dismissed" ? "" : "ghost"}" data-ai="dismiss">Dismiss</button><input data-ai="note" placeholder="Optional note" value="${esc(d.note || "")}" style="flex:1;min-width:160px"></div></div>`; }).join("") || '<p class="small muted">No flagged moment on this game.</p>'}</div>
    </details>`;
    const seek = (t) => { const fr = document.querySelector(".video-embed iframe"); if (fr) { const u = new URL(fr.src); u.searchParams.set("start", Math.max(0, t - 5)); u.searchParams.set("autoplay", "1"); fr.src = u.toString(); fr.scrollIntoView({ behavior: "smooth", block: "center" }); } else if (o.game.video_url) window.open(o.game.video_url.replace(/([?&])t=\d+s?/, "$1").replace(/[?&]$/, "") + (o.game.video_url.includes("?") ? "&" : "?") + "t=" + Math.max(0, t - 5), "_blank", "noopener"); };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ai]"); if (!b) return;
      const act = b.dataset.ai;
      if (act === "seek") return seek(parseInt(b.dataset.t, 10));
      if (act === "fill") {
        if (!o.form) return;
        ["home", "away"].forEach(s => ["h1", "h2", "seven_m", "yellow", "red", "blue"].forEach(k => { const i = o.form.querySelector(`[data-mi="${s}.${k}"]`); if (i && f[s] && f[s][k] != null) i.value = f[s][k]; }));
        const det = o.form.querySelector("details.rep-sec"); if (det) det.open = true;
        if (o.onChange) o.onChange(); return;
      }
      const card = b.closest(".ai-flag"); if (!card) return;
      const id = card.dataset.id, fl = (flags || []).find(x => x.id === id), note = card.querySelector('[data-ai="note"]').value.trim();
      if (act === "confirm" || act === "dismiss") {
        const d = act === "confirm" ? "confirmed" : "dismissed";
        dec[id] = { d, note: note || null };
        card.classList.remove("confirmed", "dismissed"); card.classList.add(d);
        NRC.$$('[data-ai="confirm"],[data-ai="dismiss"]', card).forEach(x => x.classList.toggle("ghost", x.dataset.ai !== act));
        if (d === "confirmed" && o.form && NRC.Report.addScene) NRC.Report.addScene(o.form, { t: fl.t_label || A.fmt(fl.t_seconds), item: fl.item || "", note: note || fl.reason });
        el.querySelector('[data-ai="done"]').textContent = done();
        if (o.onChange) o.onChange();
      }
    });
    el.addEventListener("input", (e) => { const n = e.target.closest('[data-ai="note"]'); if (!n) return; const id = n.closest(".ai-flag").dataset.id; if (dec[id]) { dec[id].note = n.value.trim() || null; if (o.onChange) o.onChange(); } });
    return { decisions: () => dec, count: (flags || []).length, done };
  };
})();
