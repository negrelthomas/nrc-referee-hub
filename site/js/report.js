/* NRC Referee Hub: IHF pair observation report (21 items, six step scale), shared by the evaluator page, admin and the referee profile.
   Modes: report (evaluator writes), calibration (evaluator rates a reference game), reference (NRC sets the reference rating), view (read only). */
(function () {
  const R = (window.NRC.Report = {});
  const esc = (s) => NRC.esc(s);
  R.SCALE = [
    [-2, "--", "Not satisfactory", "Many mistakes, loss of control, influencing the game"],
    [-1, "-", "Poor", "Many mistakes, no influence, little control"],
    [0, "0", "Average", "Several mistakes, but regular control"],
    [1, "+", "Good", "Few mistakes and good control"],
    [2, "++", "Very good", "Almost no mistakes, very good control"],
    [3, "+++", "Excellent", "Practically perfect"]
  ];
  R.sym = (v) => { const s = R.SCALE.find(x => x[0] === Number(v)); return s ? s[1] : ""; };
  R.SUMMARY = [["positive", "Positive"], ["neutral", "Neutral"], ["negative", "Negative"]];
  R.MATCH = [["easy", "Easy"], ["normal", "Normal"], ["difficult", "Difficult"], ["very_difficult", "Very difficult"]];
  R.INFLUENCE = [["reducing", "Reducing difficulties"], ["none", "No influence"], ["increasing", "Increasing difficulties"]];
  R.label = (list, v) => (list.find(x => x[0] === v) || [, ""])[1];
  R.STATUS = { draft: ["Draft", ""], submitted: ["Submitted to the NRC", "amber"], released: ["Released to the referees", "green"], returned: ["Returned for changes", "red"] };
  R.statusPill = (s) => { const x = R.STATUS[s] || [s, ""]; return `<span class="pill ${x[1]}">${esc(x[0])}</span>`; };

  R.items = async function () {
    const all = await NRC.loadCriteria(true);
    return all.filter(c => c.scale === "ihf6" && c.active).sort((a, b) => a.sort - b.sort);
  };

  const radios = (name, list, val, ro) => `<div class="seg wide" role="radiogroup">${list.map(([v, l]) => `<label class="${val === v ? "on" : ""}"><input type="radio" name="${name}" value="${v}" ${val === v ? "checked" : ""} ${ro ? "disabled" : ""}>${esc(l)}</label>`).join("")}</div>`;
  const statInputs = (side, mi) => ["h1", "h2", "ot", "seven_m", "yellow", "red", "blue"].map(k => `<td><input type="number" min="0" inputmode="numeric" data-mi="${side}.${k}" value="${mi && mi[side] && mi[side][k] != null ? mi[side][k] : ""}"></td>`).join("");

  // el: container. o: { mode, game (evaluator_games row or similar), value (report or reference row), items }
  R.render = async function (el, o) {
    const items = o.items || await R.items();
    const v = o.value || {}, sc = v.scores || {}, ro = o.mode === "view", full = o.mode === "report" || o.mode === "view";
    const g = o.game || {}, mi = v.match_info || {};
    const teams = [g.home_team, g.away_team].filter(Boolean).join(" v ");
    let h = "";
    if (g.game_date || g.tournament) h += `<div class="rep-head"><div><strong>${esc(g.tournament || "")}</strong>${g.division ? " &middot; " + esc(NRC.divisionLabel(g.division)) : ""}</div><div class="small">${NRC.fmtDate(g.game_date)}${teams ? " &middot; " + esc(teams) : ""}${g.home_score != null && g.away_score != null ? " &middot; " + g.home_score + " : " + g.away_score : ""}</div>${g.referee_1_name ? `<div class="small">Referees: <strong>${esc(g.referee_1_name)}</strong>${g.referee_2_name ? " and <strong>" + esc(g.referee_2_name) + "</strong>" : ""}</div>` : ""}${(v.video_url || g.video_url) ? `<div class="small"><a href="${esc(v.video_url || g.video_url)}" target="_blank" rel="noopener">Open the game video</a></div>` : ""}</div>`;
    if (full) {
      h += `<details class="rep-sec" ${ro ? "" : "open"}><summary>Observation and match facts</summary>
        <div class="row"><div><label>Method</label>${radios("method", [["video", "Video review"], ["live", "Live at the game"]], v.method || (g.video_url ? "video" : "live"), ro)}</div>
        <div><label>Submitted as</label>${radios("submitted_as", [["delegate", "Delegate"], ["referee", "Referee"]], v.submitted_as || "delegate", ro)}</div></div>
        <div class="chips" style="margin:8px 0"><label class="chip"><input type="checkbox" data-mi="ko" ${mi.ko ? "checked" : ""} ${ro ? "disabled" : ""}> K.O. match</label><label class="chip"><input type="checkbox" data-mi="final" ${mi.final ? "checked" : ""} ${ro ? "disabled" : ""}> Final</label></div>
        <div class="table-wrap"><table class="rep-stats"><thead><tr><th></th><th>1st half</th><th>2nd half</th><th>OT/SO</th><th>7 m</th><th>Yellow</th><th>Red</th><th>Blue</th></tr></thead><tbody>
        <tr><th>${esc(g.home_team || "Home")}</th>${statInputs("home", mi)}</tr><tr><th>${esc(g.away_team || "Guest")}</th>${statInputs("away", mi)}</tr></tbody></table></div>
      </details>`;
    }
    h += `<div class="rep-scale small muted">${R.SCALE.map(s => `<span><strong>${s[1]}</strong> ${s[2]}</span>`).join("")}</div>
      <p class="small muted" style="margin:4px 0 8px">Decide each item on the definitions: number of mistakes and quality of match control. An item that did not occur is rated Average. Tap an item name for its definition.</p>
      <div class="rep-items">${items.map((c, i) => { const cur = sc[c.code]; const ref = o.compare && o.compare[c.code]; return `<div class="rep-item ${ref ? (ref.ok ? "ok" : "miss") : ""}" data-code="${c.code}">
        <details><summary><span class="n">${i + 1}</span> ${esc(c.label)}${ref ? ` <span class="small">reference <strong>${R.sym(ref.ref)}</strong></span>` : ""}</summary><div class="small muted">${esc(c.description || "")}</div></details>
        <div class="seg scale">${R.SCALE.map(s => `<button type="button" data-v="${s[0]}" class="${cur != null && Number(cur) === s[0] ? "on" : ""}" title="${esc(s[2] + ": " + s[3])}" ${ro ? "disabled" : ""}>${s[1]}</button>`).join("")}</div></div>`; }).join("")}</div>
      ${ro ? "" : '<p style="margin:8px 0"><button type="button" class="btn sm ghost" data-act="avg">Rate the remaining items Average</button> <span class="small muted" data-act="count"></span></p>'}
      <h3 style="margin-top:14px">Summary</h3>
      <label>Referees summary</label>${radios("summary", R.SUMMARY, v.summary, ro)}
      <label>Type of match</label>${radios("match_type", R.MATCH, v.match_type, ro)}
      <label>Referees' influence on the match</label>${radios("influence", R.INFLUENCE, v.influence, ro)}`;
    if (o.mode !== "calibration") {
      const ta = (k, label, ph) => `<label>${label}</label>${ro ? `<div class="rep-text">${esc(v[k] || "") || '<span class="muted">None</span>'}</div>` : `<textarea name="${k}" rows="3" placeholder="${esc(ph)}">${esc(v[k] || "")}</textarea>`}`;
      h += `<h3 style="margin-top:14px">Remarks</h3>
        ${ta("positive", "Positive remarks", "What the pair did well, with the situations that show it")}
        ${ta("negative", "Negative remarks", "Errors with their cause; key scenes rather than every mistake")}
        ${ta("suggestions", "Suggestions for improvement", "Two or three concrete points to work on before the next game")}`;
    }
    if (full) {
      const sc2 = v.key_scenes || [];
      h += `<label>Key scenes ${ro ? "" : '<span class="small muted">(video timestamp, item, what happened)</span>'}</label><div class="rep-scenes">${sc2.map(s => sceneRow(s, items, ro)).join("")}</div>${ro ? (sc2.length ? "" : '<div class="small muted">None</div>') : '<button type="button" class="btn sm ghost" data-act="scene">Add a key scene</button>'}
        <div class="row" style="margin-top:10px"><div>${ro ? `<label>Note for ${esc(g.referee_1_name || "referee 1")}</label><div class="rep-text">${esc(v.remark_ref1 || "") || '<span class="muted">None</span>'}</div>` : `<label>Individual note, ${esc(g.referee_1_name || "referee 1")}</label><textarea name="remark_ref1" rows="2">${esc(v.remark_ref1 || "")}</textarea>`}</div>
        <div>${g.referee_2 || g.referee_2_name ? (ro ? `<label>Note for ${esc(g.referee_2_name || "referee 2")}</label><div class="rep-text">${esc(v.remark_ref2 || "") || '<span class="muted">None</span>'}</div>` : `<label>Individual note, ${esc(g.referee_2_name || "referee 2")}</label><textarea name="remark_ref2" rows="2">${esc(v.remark_ref2 || "")}</textarea>`) : ""}</div></div>`;
    }
    el.innerHTML = `<div class="rep">${h}</div>`;
    if (ro) return { items };
    // interactions
    const count = () => { const n = NRC.$$(".rep-item .seg button.on", el).length, c = el.querySelector('[data-act="count"]'); if (c) c.textContent = n + " of " + items.length + " rated"; };
    NRC.$$(".rep-item .seg button", el).forEach(b => b.onclick = () => { NRC.$$("button", b.parentNode).forEach(x => x.classList.toggle("on", x === b)); count(); if (o.onChange) o.onChange(); });
    NRC.$$(".seg.wide input", el).forEach(i => i.onchange = () => { NRC.$$(`input[name="${i.name}"]`, el).forEach(x => x.parentNode.classList.toggle("on", x.checked)); if (o.onChange) o.onChange(); });
    const avg = el.querySelector('[data-act="avg"]'); if (avg) avg.onclick = () => { NRC.$$(".rep-item", el).forEach(r => { if (!r.querySelector("button.on")) r.querySelector('button[data-v="0"]').classList.add("on"); }); count(); };
    const sb = el.querySelector('[data-act="scene"]'); if (sb) sb.onclick = () => { el.querySelector(".rep-scenes").insertAdjacentHTML("beforeend", sceneRow({}, items, false)); };
    el.addEventListener("click", (e) => { const x = e.target.closest('[data-act="del-scene"]'); if (x) x.closest(".rep-scene").remove(); });
    count();
    return { items };
  };
  function sceneRow(s, items, ro) {
    if (ro) { const it = items.find(c => c.code === s.item); return `<div class="rep-scene small"><strong>${esc(s.t || "")}</strong> ${it ? esc(it.label) + ": " : ""}${esc(s.note || "")}</div>`; }
    return `<div class="rep-scene"><input data-k="t" placeholder="12:34" value="${esc(s.t || "")}"><select data-k="item"><option value="">Item</option>${items.map(c => `<option value="${c.code}" ${c.code === s.item ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select><input data-k="note" placeholder="What happened, what the call should be" value="${esc(s.note || "")}"><button type="button" class="btn sm ghost" data-act="del-scene" aria-label="Remove">&times;</button></div>`;
  }

  // read the form back
  R.read = function (el) {
    const out = { scores: {}, match_info: { home: {}, away: {} }, key_scenes: [] };
    NRC.$$(".rep-item", el).forEach(r => { const b = r.querySelector("button.on"); if (b) out.scores[r.dataset.code] = parseInt(b.dataset.v, 10); });
    ["summary", "match_type", "influence", "method", "submitted_as"].forEach(k => { const i = el.querySelector(`input[name="${k}"]:checked`); out[k] = i ? i.value : null; });
    ["positive", "negative", "suggestions", "remark_ref1", "remark_ref2"].forEach(k => { const t = el.querySelector(`textarea[name="${k}"]`); if (t) out[k] = t.value.trim() || null; });
    NRC.$$("[data-mi]", el).forEach(i => { const [a, b] = i.dataset.mi.split("."); if (i.type === "checkbox") out.match_info[a] = i.checked; else if (i.value !== "") out.match_info[a][b] = parseInt(i.value, 10); });
    NRC.$$(".rep-scene", el).forEach(r => { const q = (k) => { const x = r.querySelector(`[data-k="${k}"]`); return x ? x.value.trim() : ""; }; if (q("t") || q("note")) out.key_scenes.push({ t: q("t"), item: q("item") || null, note: q("note") }); });
    return out;
  };
  R.missing = function (el, items, needRemarks) {
    const v = R.read(el), miss = [];
    const n = items.filter(c => v.scores[c.code] == null).length;
    if (n) miss.push(n + " item" + (n === 1 ? "" : "s") + " not rated");
    if (!v.summary) miss.push("summary"); if (!v.match_type) miss.push("type of match"); if (!v.influence) miss.push("influence");
    if (needRemarks && !v.positive) miss.push("positive remarks"); if (needRemarks && !v.suggestions) miss.push("suggestions");
    return miss;
  };

  // calibration result: comparison with the reference
  R.resultHtml = function (res, items) {
    const d = res.details || {}, rm = d._remarks || {};
    const rows = items.filter(c => d[c.code]).map(c => { const x = d[c.code]; return `<tr class="${x.ok ? "" : "miss"}"><td>${esc(c.label)}</td><td>${R.sym(x.mine)}</td><td>${R.sym(x.ref)}</td><td>${x.ok ? '<span class="pill green">within ' + res.tolerance + '</span>' : '<span class="pill red">off by ' + Math.abs(x.mine - x.ref) + "</span>"}</td></tr>`; }).join("");
    const s = d._summary;
    return `<div class="notice ${res.passed ? "ok" : "error"}"><strong>${res.pct}%</strong> agreement with the NRC reference (pass mark ${res.pass_pct}%).${res.counts ? " This first attempt counts toward certification." : " Practice attempt: only the first attempt on a game counts."}</div>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>You</th><th>Reference</th><th></th></tr></thead><tbody>${rows}
      ${s ? `<tr class="${s.ok ? "" : "miss"}"><td><strong>Summary</strong></td><td>${esc(R.label(R.SUMMARY, s.mine))}</td><td>${esc(R.label(R.SUMMARY, s.ref))}</td><td>${s.ok ? '<span class="pill green">same</span>' : '<span class="pill red">different</span>'}</td></tr>` : ""}
      <tr><td>Type of match</td><td>${esc(R.label(R.MATCH, (d._match_type || {}).mine))}</td><td>${esc(R.label(R.MATCH, (d._match_type || {}).ref))}</td><td class="small muted">not scored</td></tr>
      <tr><td>Influence</td><td>${esc(R.label(R.INFLUENCE, (d._influence || {}).mine))}</td><td>${esc(R.label(R.INFLUENCE, (d._influence || {}).ref))}</td><td class="small muted">not scored</td></tr></tbody></table></div>
      ${rm.positive || rm.negative || rm.suggestions ? `<h3 style="margin-top:12px">Reference remarks${rm.rated_by ? ", " + esc(rm.rated_by) : ""}</h3>${rm.positive ? "<p><strong>Positive.</strong> " + esc(rm.positive) + "</p>" : ""}${rm.negative ? "<p><strong>Negative.</strong> " + esc(rm.negative) + "</p>" : ""}${rm.suggestions ? "<p><strong>Suggestions.</strong> " + esc(rm.suggestions) + "</p>" : ""}` : ""}`;
  };

  // read only dialog, used by admin, profile and the evaluator page
  R.openView = async function (reportId, extra) {
    if (!document.getElementById("dlg-rep-view")) document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-rep-view" style="max-width:820px"><div class="body"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3 style="margin:0">Observation report</h3><button class="btn sm ghost" type="button" onclick="this.closest('dialog').close()">Close</button></div><div id="rep-view-meta" class="small muted" style="margin:6px 0 10px"></div><div id="rep-view-body"></div><div id="rep-view-extra"></div></div></dialog>`);
    const { data: r, error } = await NRC.sb.from("observation_reports").select("*").eq("id", reportId).single();
    if (error) { alert(error.message); return null; }
    const { data: g } = await NRC.sb.from("games").select("*,tournaments(name)").eq("id", r.game_id).maybeSingle();
    const names = {}; const ids = [r.referee_1, r.referee_2].filter(Boolean);
    if (ids.length) { const { data: rf } = await NRC.sb.from("referees").select("id,first_name,last_name").in("id", ids); (rf || []).forEach(x => names[x.id] = x.first_name + " " + x.last_name); }
    const game = Object.assign({}, g || {}, { tournament: g && g.tournaments ? g.tournaments.name : "", referee_1_name: names[r.referee_1], referee_2_name: names[r.referee_2], referee_2: r.referee_2 });
    NRC.$("#rep-view-meta").innerHTML = `${R.statusPill(r.status)} ${esc(r.evaluator_name || "")} (${esc(r.evaluator_club || "")}), ${r.method === "live" ? "live" : "video review"}${r.submitted_at ? ", submitted " + NRC.fmtDate(r.submitted_at.slice(0, 10)) : ""}${r.overall != null ? " &middot; overall " + NRC.scoreHtml(r.overall) : ""}${r.nrc_note ? `<div class="notice" style="margin-top:6px"><strong>NRC note.</strong> ${esc(r.nrc_note)}</div>` : ""}`;
    await R.render(NRC.$("#rep-view-body"), { mode: "view", game, value: r });
    NRC.$("#rep-view-extra").innerHTML = "";
    if (extra) extra(NRC.$("#rep-view-extra"), r);
    NRC.$("#dlg-rep-view").showModal();
    return r;
  };
})();
