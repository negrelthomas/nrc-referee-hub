/* NRC Referee Hub: score sheets of an event, uploaded all at once and reconciled with the games recorded on the hub.
   Each sheet (an image, or each page of a PDF) is stored in the private score-sheets bucket and read by /api/read-document:
   game number, teams, final score. The hub then compares it with the game of the same number (or, without a number, the same teams).
   Used inside the game panel of games.js (admin tournament dialog and organizer page). */
(function () {
  const S = (window.NRC.Sheets = {});
  const esc = (s) => NRC.esc(s), $ = (s) => document.querySelector(s);
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(the|team|handball|club|hc|thc|th|u\d+|men|women|mens|womens)\b/g, "").replace(/[^a-z0-9]/g, "");
  const sameTeam = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
  const numKey = (n) => { const m = String(n || "").match(/\d+/); return m ? String(parseInt(m[0], 10)) : String(n || "").trim().toLowerCase(); };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  let rows = [], busy = false, stop = false;

  function inject() {
    if ($("#dlg-sheets")) return;
    document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-sheets" style="max-width:1000px;width:96vw"><div class="body">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:start"><h3 style="margin-top:0" id="sh-title">Score sheets</h3><button class="btn sm red" type="button" id="sh-x" title="Close">Close</button></div>
      <p class="small" style="margin-top:0">Upload every score sheet of the event at once: photos, scans, or one PDF with a sheet per page. The hub reads the game number, the teams and the final score of each sheet and compares them with the games recorded here. Only the score is checked: cards, suspensions and goals per player on the sheets are often incomplete.</p>
      <input type="file" id="sh-files" multiple accept="image/*,application/pdf">
      <div id="sh-status" class="small muted" style="margin:8px 0"></div>
      <div class="table-wrap"><table id="sh-table" class="hidden"><thead><tr><th>Sheet</th><th>Read from the sheet</th><th>On the hub</th><th>Result</th><th></th></tr></thead><tbody></tbody></table></div>
      <div id="sh-nosheet" class="small" style="margin-top:10px"></div>
      <p style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost hidden" type="button" id="sh-stop">Stop reading</button></p>
      <p class="small muted">The reader runs on a free Gemini quota: a few sheets a minute, and a daily cap. Sheets not read today stay stored; upload them again tomorrow, or enter the scores by hand.</p>
    </div></dialog>`);
    $("#sh-x").onclick = close; $("#sh-files").onchange = (e) => run([...e.target.files]); $("#sh-stop").onclick = () => { stop = true; };
    NRC.dialogCloses && NRC.dialogCloses();
  }
  function close() { stop = true; $("#dlg-sheets").close(); const c = NRC.Games.ctx(); if (c) NRC.Games.refresh(); }

  S.open = function () {
    inject(); const c = NRC.Games.ctx(); rows = []; stop = false;
    $("#sh-title").textContent = "Score sheets, " + c.tournament.name; $("#sh-files").value = ""; $("#sh-status").textContent = c.games.length + " games recorded on the hub.";
    $("#sh-table").classList.add("hidden"); $("#sh-table tbody").innerHTML = ""; $("#sh-nosheet").innerHTML = "";
    $("#dlg-sheets").showModal();
  };

  // PDF pages to JPEG with pdf.js (loaded on first use); one image per sheet
  let pdfjs = null;
  async function pdfPages(file) {
    if (!pdfjs) { pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs"; }
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise, out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i), vp = page.getViewport({ scale: 2 }), cv = document.createElement("canvas");
      cv.width = vp.width; cv.height = vp.height; await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
      out.push({ name: file.name + (doc.numPages > 1 ? ", page " + i : ""), blob: await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85)), ext: "jpg" });
    }
    return out;
  }
  async function token() { const { data } = await NRC.sb.auth.getSession(); return data.session ? data.session.access_token : ""; }

  async function run(files) {
    if (busy || !files.length) return; busy = true; stop = false;
    const c = NRC.Games.ctx(), tid = c.tournament.id; $("#sh-stop").classList.remove("hidden");
    $("#sh-status").textContent = "Preparing the files.";
    let items = [];
    for (const f of files) {
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) { try { items = items.concat(await pdfPages(f)); } catch (e) { items.push({ name: f.name, blob: f, ext: "pdf" }); } }
      else items.push({ name: f.name, blob: f, ext: (f.name.split(".").pop() || "jpg").toLowerCase() });
    }
    $("#sh-table").classList.remove("hidden");
    const start = rows.length; items.forEach(it => rows.push({ name: it.name, state: "waiting" })); paint();
    for (let k = 0; k < items.length; k++) {
      const it = items[k], row = rows[start + k];
      if (stop) { row.state = "not read"; continue; }
      row.state = "uploading"; paint();
      const path = `${tid}/${Date.now()}-${k}.${it.ext}`;
      const up = await NRC.sb.storage.from("score-sheets").upload(path, it.blob, { contentType: it.blob.type || (it.ext === "pdf" ? "application/pdf" : "image/jpeg") });
      if (up.error) { row.state = "error"; row.err = "Upload failed: " + up.error.message; paint(); continue; }
      row.path = path; row.state = "reading"; paint();
      let d = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch("/api/read-document", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + await token() }, body: JSON.stringify({ kind: "sheet", path }) });
        d = await res.json().catch(() => ({}));
        if (d.retry && !stop) { for (let s = 60; s > 0 && !stop; s--) { $("#sh-status").textContent = `Reader limit per minute reached. Next sheet in ${s} s.`; await wait(1000); } continue; }
        break;
      }
      if (!d || !d.read) { row.state = "error"; row.err = (d && d.error) || "Could not be read."; if (d && d.limit && !d.retry) stop = true; paint(); continue; }
      row.read = d.read; row.state = "read"; compare(row); await saveCheck(row); paint();
      $("#sh-status").textContent = `${k + 1} of ${items.length} sheets processed.`;
    }
    const left = rows.filter(r => r.state === "not read").length;
    $("#sh-status").textContent = `Done. ${rows.filter(r => r.status === "match").length} match, ${rows.filter(r => r.status === "differs").length} differ, ${rows.filter(r => r.status === "missing").length} not on the hub${rows.filter(r => r.state === "error").length ? ", " + rows.filter(r => r.state === "error").length + " not read" : ""}${left ? ", " + left + " stopped" : ""}.`;
    $("#sh-stop").classList.add("hidden"); busy = false; paint();
  }

  function compare(row) {
    const c = NRC.Games.ctx(), x = row.read;
    if (!x.is_score_sheet) { row.status = "not a sheet"; return; }
    let g = x.game_number ? c.games.find(gm => numKey(gm.game_number) === numKey(x.game_number)) : null;
    if (!g && x.team_a && x.team_b) g = c.games.find(gm => (sameTeam(gm.home_team, x.team_a) && sameTeam(gm.away_team, x.team_b)) || (sameTeam(gm.home_team, x.team_b) && sameTeam(gm.away_team, x.team_a)));
    row.game = g || null;
    if (!g) { row.status = "missing"; row.diffs = ["no game " + (x.game_number ? "number " + x.game_number : "with these teams") + " on the hub"]; return; }
    const swapped = sameTeam(g.home_team, x.team_b) && sameTeam(g.away_team, x.team_a) && !(sameTeam(g.home_team, x.team_a));
    const sa = swapped ? x.score_b : x.score_a, sbb = swapped ? x.score_a : x.score_b; row.oriented = { home: sa, away: sbb };
    const diffs = [];
    if (x.team_a && !(sameTeam(g.home_team, x.team_a) || sameTeam(g.home_team, x.team_b))) diffs.push(`team "${x.team_a}" on the sheet, "${g.home_team || "none"}" on the hub`);
    if (x.team_b && !(sameTeam(g.away_team, x.team_b) || sameTeam(g.away_team, x.team_a))) diffs.push(`team "${x.team_b}" on the sheet, "${g.away_team || "none"}" on the hub`);
    if (sa != null && sbb != null) { if (g.home_score == null || g.away_score == null) diffs.push(`score ${sa}:${sbb} on the sheet, none on the hub`); else if (g.home_score !== sa || g.away_score !== sbb) diffs.push(`score ${sa}:${sbb} on the sheet, ${g.home_score}:${g.away_score} on the hub`); }
    else diffs.push("score not readable on the sheet");
    if (x.game_number && g.game_number && numKey(x.game_number) !== numKey(g.game_number)) diffs.push(`game number ${x.game_number} on the sheet, ${g.game_number} on the hub`);
    row.diffs = diffs; row.status = diffs.length ? "differs" : "match";
  }
  async function saveCheck(row) {
    if (!row.game) return;
    const chk = { status: row.status, diffs: row.diffs, read: row.read, checked_at: new Date().toISOString() };
    const { error } = await NRC.sb.from("games").update({ sheet_check: chk, sheet_path: row.path }).eq("id", row.game.id);
    if (!error) { row.game.sheet_check = chk; row.game.sheet_path = row.path; }
  }

  function paint() {
    const c = NRC.Games.ctx(), conf = (x) => x && x.confidence && x.confidence !== "high" ? ` <span class="pill amber">${esc(x.confidence)} confidence</span>` : "";
    $("#sh-table tbody").innerHTML = rows.map((r, i) => { const x = r.read || {}, g = r.game;
      const read = r.read ? (x.is_score_sheet ? `<strong>#${esc(x.game_number || "?")}</strong> ${esc(x.team_a || "?")} <strong>${x.score_a ?? "?"} : ${x.score_b ?? "?"}</strong> ${esc(x.team_b || "?")}${x.half_a != null ? ` <span class="small muted">(HT ${x.half_a}:${x.half_b})</span>` : ""}${conf(x)}` : '<span class="muted">not a score sheet</span>') : `<span class="muted">${esc(r.state)}</span>`;
      const hub = g ? `<strong>#${esc(g.game_number || "?")}</strong> ${esc(g.home_team || "")} <strong>${g.home_score ?? "?"} : ${g.away_score ?? "?"}</strong> ${esc(g.away_team || "")}` : r.read && x.is_score_sheet ? '<span class="pill amber">not on the hub</span>' : "";
      const res = r.state === "error" ? `<span class="pill red">not read</span> <span class="small">${esc(r.err || "")}</span>` : r.status === "match" ? '<span class="pill green">same</span>' : r.status === "differs" ? `<span class="pill red">differs</span><div class="small">${r.diffs.map(esc).join("<br>")}</div>` : r.status === "missing" ? '<span class="pill amber">missing on the hub</span>' : "";
      const act = r.status === "differs" && g && r.oriented && r.oriented.home != null ? `<button class="btn sm" type="button" data-use="${i}" title="Replaces the score on the hub with the score read from the sheet">Use the sheet score</button>` : r.status === "missing" ? `<button class="btn sm" type="button" data-add="${i}" title="Opens a new game prefilled from the sheet; choose the pair and save">Add this game</button>` : "";
      return `<tr><td class="small">${esc(r.name)}</td><td>${read}</td><td>${hub}</td><td>${res}</td><td>${act}</td></tr>`; }).join("");
    NRC.$$("[data-use]", $("#sh-table")).forEach(b => b.onclick = async () => { const r = rows[+b.dataset.use]; const { error } = await NRC.sb.from("games").update({ home_score: r.oriented.home, away_score: r.oriented.away }).eq("id", r.game.id); if (error) { alert(error.message); return; } r.game.home_score = r.oriented.home; r.game.away_score = r.oriented.away; compare(r); await saveCheck(r); paint(); });
    NRC.$$("[data-add]", $("#sh-table")).forEach(b => b.onclick = () => { const r = rows[+b.dataset.add], x = r.read; $("#dlg-sheets").close(); NRC.Games.newGame(); const f = document.getElementById("form-g-game");
      if (x.game_number) f.game_number.value = x.game_number; if (x.game_date) f.game_date.value = x.game_date; f.home_team.value = x.team_a || ""; f.away_team.value = x.team_b || ""; if (x.score_a != null) f.home_score.value = x.score_a; if (x.score_b != null) f.away_score.value = x.score_b; });
    // games on the hub with no sheet among those processed in this session
    const seen = new Set(rows.filter(r => r.game).map(r => r.game.id)), done = rows.some(r => r.state !== "waiting" && r.state !== "uploading" && r.state !== "reading");
    const none = done ? c.games.filter(g => !seen.has(g.id) && !g.sheet_path) : [];
    $("#sh-nosheet").innerHTML = none.length ? `<strong>${none.length} game${none.length === 1 ? "" : "s"} on the hub without a sheet:</strong> ` + none.map(g => "#" + esc(g.game_number || "?") + " " + esc([g.home_team, g.away_team].filter(Boolean).join(" v "))).join(", ") : "";
  }
})();
