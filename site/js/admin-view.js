/* NRC Referee Hub: admin console on phones.
   Two layouts for the same console: Laptop (side menu, wide tables) and Phone (section picker,
   one card per table row, full screen windows). Auto picks Phone under 820px; the choice is kept
   per device. */
(function () {
  const KEY = "nrc_admin_view";
  const get = () => { try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; } };
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { } };
  const narrow = () => window.matchMedia("(max-width: 820px)").matches;
  const isPhone = () => { const v = get(); return v === "phone" || (v === "auto" && narrow()); };
  let observer = null, queued = false;

  function label() { if (NRC.labelTables) NRC.labelTables(document.getElementById("panes") || document); document.querySelectorAll("dialog").forEach(d => NRC.labelTables && NRC.labelTables(d)); }
  function watch(on) {
    if (on && !observer) {
      observer = new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; label(); }); });
      observer.observe(document.body, { childList: true, subtree: true }); label();
    } else if (!on && observer) { observer.disconnect(); observer = null; }
  }

  function buildPicker() {
    const nav = document.querySelector(".admin-nav"); if (!nav || document.getElementById("admin-jump")) return;
    const sel = document.createElement("select"); sel.id = "admin-jump"; sel.setAttribute("aria-label", "Admin section");
    let html = "";
    const top = nav.querySelector(':scope > a[href^="#"]'); if (top) html += `<option value="${top.getAttribute("href")}">${top.textContent.trim()}</option>`;
    nav.querySelectorAll(".nav-sec").forEach(s => {
      html += `<optgroup label="${s.querySelector(".sec-top").textContent.trim()}">`;
      s.querySelectorAll(".sub a").forEach(a => html += `<option value="${a.getAttribute("href")}">${a.childNodes[0].textContent.trim()}</option>`);
      html += "</optgroup>";
    });
    html += '<optgroup label="More">';
    nav.querySelectorAll('.nav-foot a[href^="#"]:not([href="#"])').forEach(a => html += `<option value="${a.getAttribute("href")}">${a.textContent.trim()}</option>`);
    html += "</optgroup>";
    sel.innerHTML = html;
    sel.onchange = () => { location.hash = sel.value; };
    const bar = document.getElementById("admin-viewbar");
    bar.insertBefore(sel, bar.firstChild);
    const sync = () => { const h = (location.hash || "#dashboard").split("/")[0]; const p = h === "#club" ? "#clubs" : h === "#referee" ? "#referees" : h; if ([...sel.options].some(o => o.value === p)) sel.value = p; };
    window.addEventListener("hashchange", sync); sync();
  }

  function apply() {
    const phone = isPhone();
    document.body.classList.toggle("admin-phone", phone);
    document.querySelectorAll("#admin-viewbar [data-view]").forEach(b => { const on = b.dataset.view === (phone ? "phone" : "laptop"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    watch(phone);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const layout = document.querySelector(".admin-layout"); if (!layout) return;
    const bar = document.createElement("div"); bar.id = "admin-viewbar"; bar.className = "admin-viewbar";
    bar.innerHTML = '<div class="seg view-switch" role="group" aria-label="Layout"><button type="button" data-view="laptop">Laptop</button><button type="button" data-view="phone">Phone</button></div>';
    layout.parentNode.insertBefore(bar, layout);
    bar.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { set(b.dataset.view); apply(); window.scrollTo(0, 0); });
    buildPicker();
    apply();
    window.matchMedia("(max-width: 820px)").addEventListener("change", () => { if (get() === "auto") apply(); });
  });
})();
