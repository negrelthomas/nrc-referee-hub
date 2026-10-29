/* How to section: one renderer for the How to page, the FAQ page and the role guides.
   Data: guide/howto-data.js (window.HOWTO). Markup hooks:
     <div id="ht-hub"></div>                       How to page (user type picker, videos, questions)
     <div id="ht-faq"></div>                       FAQ page (search, user type filter, theme index, all questions, all videos)
     <div data-ht-videos="referee"></div>          videos of one user type, inside a role guide
     <div data-ht-faq="referee"></div>             questions of one user type, inside a role guide
   Deep links: ?v=<video id> opens a video, #q-<question id> opens a question, #u=<user type> picks a user type. */
(function () {
  const H = window.HOWTO;
  if (!H) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MEDIA = "guide/videos/";
  const vid = Object.fromEntries(H.videos.map(v => [v.id, v]));
  const role = Object.fromEntries(H.roles.map(r => [r.id, r]));
  const theme = Object.fromEntries(H.themes.map(t => [t.id, t]));
  const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ");
  const qsFor = (v) => H.faq.filter(q => q.video === v.id);

  // ---------- video card and player ----------
  const card = (v) => `<button type="button" class="ht-card ${v.layout}" data-play="${v.id}" aria-label="Play: ${esc(v.title)}">
      <span class="ht-thumb"><img src="${MEDIA + v.id}.webp" alt="" loading="lazy"><span class="ht-play" aria-hidden="true"></span><span class="ht-dur">${mmss(v.dur)}</span></span>
      <span class="ht-cap"><strong>${esc(v.title)}</strong><span>${esc(v.steps)}</span></span></button>`;
  let dlg;
  function player() {
    if (dlg) return dlg;
    document.body.insertAdjacentHTML("beforeend", `<dialog class="ht-player" id="ht-player" aria-labelledby="ht-p-title"><div class="ht-p-head"><div><div class="ht-p-role" id="ht-p-role"></div><h3 id="ht-p-title"></h3></div><button type="button" class="btn sm red ht-x" data-close aria-label="Close">Close</button></div>
      <div class="ht-p-body"><div class="ht-p-stage"><video id="ht-p-video" controls muted playsinline preload="auto"></video></div>
      <div class="ht-p-side"><p class="ht-p-steps" id="ht-p-steps"></p><div id="ht-p-qs"></div><p class="small muted" style="margin:14px 0 0">No sound. The people and events shown are examples.</p></div></div>
      <div class="ht-p-foot"><button type="button" class="btn sm red" data-close>Close</button></div></dialog>`);
    dlg = document.getElementById("ht-player");
    dlg.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === dlg) close(); const q = e.target.closest("[data-goq]"); if (q) { close(); openQ(q.dataset.goq); } });
    dlg.addEventListener("close", () => { const v = document.getElementById("ht-p-video"); v.pause(); v.removeAttribute("src"); v.load(); const u = new URL(location.href); u.searchParams.delete("v"); history.replaceState(null, "", u); });
    return dlg;
  }
  function close() { if (dlg && dlg.open) dlg.close(); }
  function play(id) {
    const v = vid[id]; if (!v) return;
    const d = player();
    d.className = "ht-player " + v.layout;
    d.querySelector("#ht-p-role").textContent = v.roles.map(r => role[r].label).join(", ");
    d.querySelector("#ht-p-title").textContent = v.title;
    d.querySelector("#ht-p-steps").textContent = v.steps;
    const qs = qsFor(v);
    d.querySelector("#ht-p-qs").innerHTML = qs.length ? `<div class="lbl">Related questions</div><ul class="plain ht-p-ql">${qs.map(q => `<li><a href="guide/faq.html#q-${q.id}" data-goq="${q.id}">${esc(q.q)}</a></li>`).join("")}</ul>` : "";
    const el = d.querySelector("#ht-p-video"); el.poster = MEDIA + v.id + ".webp"; el.src = MEDIA + v.id + ".mp4";
    if (!d.open) d.showModal();
    el.play().catch(() => {});
    const u = new URL(location.href); u.searchParams.set("v", id); history.replaceState(null, "", u);
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-play]"); if (b) { e.preventDefault(); play(b.dataset.play); } });

  // ---------- questions ----------
  const qItem = (q, opts = {}) => {
    const v = q.video && vid[q.video];
    const who = opts.showRoles ? `<span class="ht-who">${q.roles.map(r => role[r].short).join(" · ")}</span>` : "";
    return `<details class="ht-q" id="q-${q.id}" data-q="${q.id}"><summary><span>${esc(q.q)}</span>${v ? '<span class="ht-has-v" title="Has a video">Video</span>' : ""}</summary>
      <div class="ht-a">${q.a}${v ? `<div class="ht-a-v">${card(v)}</div>` : ""}${who}</div></details>`;
  };
  function openQ(id) {
    const el = document.getElementById("q-" + id);
    if (!el) { location.href = "guide/faq.html#q-" + id; return; }
    el.open = true; el.scrollIntoView({ behavior: "smooth", block: "start" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
  }
  const groupByTheme = (list) => H.themes.map(t => [t, list.filter(q => q.theme === t.id)]).filter(([, l]) => l.length);

  // ---------- role guide hooks ----------
  document.querySelectorAll("[data-ht-videos]").forEach(host => {
    const r = host.dataset.htVideos;
    const list = H.videos.filter(v => v.roles.includes(r)).sort((a, b) => (a.roles[0] !== r) - (b.roles[0] !== r));
    host.innerHTML = `<div class="ht-grid">${list.map(card).join("")}</div>`;
  });
  document.querySelectorAll("[data-ht-faq]").forEach(host => {
    const r = host.dataset.htFaq;
    const list = H.faq.filter(q => q.roles.includes(r));
    host.innerHTML = groupByTheme(list).map(([t, l]) => `<h3 class="ht-theme-h">${esc(t.label)}</h3>${l.map(q => qItem(q)).join("")}`).join("") +
      `<p class="small" style="margin-top:14px"><a href="guide/faq.html#u=${r}">All common questions</a></p>`;
  });

  // ---------- How to page ----------
  const hub = document.getElementById("ht-hub");
  if (hub) {
    const pick = (location.hash.match(/u=(\w+)/) || [])[1];
    let cur = role[pick] ? pick : null;
    let stored = null; try { stored = localStorage.getItem("nrc-howto-role"); } catch (e) {}
    if (!cur && role[stored]) cur = stored;
    if (!cur) cur = H.roles[0].id;
    const draw = () => {
      const r = role[cur];
      const vids = H.videos.filter(v => v.roles.includes(cur)).sort((a, b) => (a.roles[0] !== cur) - (b.roles[0] !== cur));
      const qs = H.faq.filter(q => q.roles.includes(cur));
      hub.innerHTML = `
        <div class="ht-roles" role="tablist" aria-label="Who are you">${H.roles.map(x => `<button type="button" role="tab" class="ht-role ${x.id === cur ? "on" : ""}" aria-selected="${x.id === cur}" data-role="${x.id}"><strong>${esc(x.label)}</strong><span>${esc(x.blurb)}</span></button>`).join("")}</div>
        <div class="ht-search"><input type="search" id="ht-q" placeholder="Search a task or a question" aria-label="Search the How to section"><div id="ht-res" class="ht-res hidden"></div></div>
        <section class="ht-sec"><div class="ht-sec-h"><h2>Videos for ${esc(r.label)}</h2><span class="small muted">${vids.length} videos, 10 to 40 seconds each, no sound</span></div>
          <div class="ht-grid">${vids.map(card).join("")}</div></section>
        <section class="ht-sec"><div class="ht-sec-h"><h2>Common questions</h2><a class="small" href="guide/faq.html#u=${cur}">All ${qs.length} on the FAQ page</a></div>
          <div class="ht-themes">${groupByTheme(qs).map(([t, l]) => `<a href="#th-${t.id}" class="chip">${esc(t.label)} <span class="muted">${l.length}</span></a>`).join("")}</div>
          ${groupByTheme(qs).map(([t, l]) => `<h3 class="ht-theme-h" id="th-${t.id}">${esc(t.label)}</h3>${l.map(q => qItem(q)).join("")}`).join("")}</section>
        ${r.guide ? `<p class="cta-row"><a class="btn secondary" href="${r.guide}">Read the full ${esc(r.guideLabel || "guide")}</a></p>` : ""}`;
      hub.querySelectorAll("[data-role]").forEach(b => b.onclick = () => { cur = b.dataset.role; try { localStorage.setItem("nrc-howto-role", cur); } catch (e) {} history.replaceState(null, "", "#u=" + cur); draw(); });
      wireSearch(hub.querySelector("#ht-q"), hub.querySelector("#ht-res"));
    };
    draw();
  }

  // search over videos and questions, results with links
  function wireSearch(input, out) {
    if (!input) return;
    input.oninput = () => {
      const t = norm(input.value).trim();
      if (t.length < 2) { out.classList.add("hidden"); out.innerHTML = ""; return; }
      const words = t.split(/\s+/);
      const hit = (s) => words.every(w => norm(s).includes(w));
      const vs = H.videos.filter(v => hit(v.title + " " + v.steps + " " + v.roles.map(r => role[r].label).join(" ")));
      const qs = H.faq.filter(q => hit(q.q + " " + strip(q.a)));
      out.classList.remove("hidden");
      out.innerHTML = (vs.length ? `<div class="lbl">Videos</div><ul class="plain">${vs.slice(0, 8).map(v => `<li><a href="#" data-play="${v.id}">${esc(v.title)}</a> <span class="small muted">${v.roles.map(r => role[r].short).join(", ")}</span></li>`).join("")}</ul>` : "") +
        (qs.length ? `<div class="lbl">Questions</div><ul class="plain">${qs.slice(0, 12).map(q => `<li><a href="guide/faq.html#q-${q.id}" data-goq="${q.id}">${esc(q.q)}</a></li>`).join("")}</ul>` : "") +
        (!vs.length && !qs.length ? `<p class="small muted" style="margin:0">Nothing found. Write to the NRC or use the Feedback button.</p>` : "");
      out.querySelectorAll("[data-goq]").forEach(a => a.onclick = (e) => { if (document.getElementById("q-" + a.dataset.goq)) { e.preventDefault(); openQ(a.dataset.goq); } });
    };
  }

  // ---------- FAQ page ----------
  const faq = document.getElementById("ht-faq");
  if (faq) {
    let cur = (location.hash.match(/u=(\w+)/) || [])[1] || "all";
    const draw = () => {
      const list = H.faq.filter(q => cur === "all" || q.roles.includes(cur));
      const vids = H.videos.filter(v => cur === "all" || v.roles.includes(cur));
      const groups = groupByTheme(list);
      faq.innerHTML = `
        <div class="ht-search"><input type="search" id="ht-q" placeholder="Search the questions and videos" aria-label="Search the questions"><div id="ht-res" class="ht-res hidden"></div></div>
        <div class="ht-filter"><span class="lbl">I am</span><div class="chips">${[["all", "Everyone"]].concat(H.roles.map(r => [r.id, r.label])).map(([id, l]) => `<button type="button" class="chip ${cur === id ? "on" : ""}" data-u="${id}">${esc(l)}</button>`).join("")}</div></div>
        <div class="ht-index"><div class="lbl">Questions by theme</div><div class="ht-index-grid">${groups.map(([t, l]) => `<a href="#th-${t.id}"><strong>${esc(t.label)}</strong><span>${l.length} question${l.length === 1 ? "" : "s"}</span></a>`).join("")}<a href="#videos"><strong>All videos</strong><span>${vids.length} videos</span></a></div></div>
        ${groups.map(([t, l]) => `<section class="ht-sec"><h2 class="ht-theme-h2" id="th-${t.id}">${esc(t.label)}</h2>${l.map(q => qItem(q, { showRoles: cur === "all" })).join("")}</section>`).join("")}
        <section class="ht-sec" id="videos"><h2 class="ht-theme-h2">All videos</h2>
          ${H.roles.filter(r => cur === "all" || r.id === cur).map(r => { const l = H.videos.filter(v => v.roles[0] === r.id || (cur !== "all" && v.roles.includes(r.id))); return l.length ? `<h3 class="ht-theme-h">${esc(r.label)}</h3><div class="ht-grid">${l.map(card).join("")}</div>` : ""; }).join("")}</section>`;
      faq.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { cur = b.dataset.u; history.replaceState(null, "", cur === "all" ? location.pathname : "#u=" + cur); draw(); });
      wireSearch(faq.querySelector("#ht-q"), faq.querySelector("#ht-res"));
    };
    draw();
    const m = location.hash.match(/^#q-([\w-]+)/); if (m) setTimeout(() => openQ(m[1]), 150);
  }

  const pv = new URLSearchParams(location.search).get("v");
  if (pv) setTimeout(() => play(pv), 200);
})();
