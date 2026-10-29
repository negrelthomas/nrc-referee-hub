// Expenses: claims with receipts, USD conversion, organizer approval and payment.
// Used by the referee and guest pages (claim form, list, payout handles), the organizer page and the admin Expenses tab.
// The organizer of the event approves or declines every claim and pays it. The NRC can record a decision for the organizer.
(function () {
  const NRC = window.NRC; if (!NRC) return;
  const esc = NRC.esc;
  const KIND = { flight: "Airfare", hotel: "Hotel", transport: "Rideshare and taxis", car: "Car rental and related", per_diem: "Food per diem", mileage: "Mileage", other: "Other" };
  const ORDER = ["flight", "hotel", "transport", "car", "per_diem", "mileage", "other"];
  const RECEIPT_KINDS = ["flight", "hotel", "transport", "car"];
  const ST_REF = { submitted: ["Waiting for the organizer", "amber"], approved: ["Approved by the organizer", "green"], rejected: ["Declined by the organizer", "red"], reimbursed: ["Paid", "green"] };
  const ST_ORG = { submitted: ["To decide", "amber"], approved: ["Approved, to pay", "green"], rejected: ["Declined", "red"], reimbursed: ["Paid", ""] };
  const METHODS = ["Venmo", "PayPal", "Zelle", "Check", "Cash", "Bank transfer", "Other"];
  const CURRENCIES = ["USD", "CAD", "MXN", "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "JPY", "BRL", "AUD"];
  const usd = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sum = (a, f) => a.reduce((n, x) => n + Number(f(x) || 0), 0);
  const $ = s => document.querySelector(s);
  const token = async () => { const { data } = await NRC.sb.auth.getSession(); return data.session ? data.session.access_token : ""; };
  const api = async (body) => {
    const res = await fetch("/api/expense-claim", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + await token() }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({})); return { ok: res.ok, status: res.status, d };
  };
  const tip = (t, admin) => admin ? `data-tip="${esc(t)}"` : `title="${esc(t)}"`;
  const fileSafe = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const extOf = p => (String(p).split(".").pop() || "jpg").toLowerCase();
  const amountLine = c => `<strong>${usd(c.amount)}</strong>${c.currency && c.currency !== "USD" ? ` <span class="muted">(${esc(c.currency)} ${Number(c.amount_original).toFixed(2)} at ${Number(c.fx_rate).toFixed(4)})</span>` : ""}`;
  const coverageLine = (t) => [
    t.flights_covered ? "flights" : null,
    t.hotel_booked_by !== "none" && t.hotel_nights_covered ? t.hotel_nights_covered + " hotel night(s)" : null,
    t.airport_transfers_covered ? "airport transfers" : null,
    t.car_booked_by && t.car_booked_by !== "none" ? "rental car" : null,
    t.food_stipend_per_day ? "$" + t.food_stipend_per_day + " per day for food" : null
  ].filter(Boolean);

  // ---------- claimant: list of claims ----------
  function listHtml(claims, opts = {}) {
    if (!claims || !claims.length) return "";
    return claims.slice().sort((a, b) => String(a.purchase_date || a.created_at).localeCompare(String(b.purchase_date || b.created_at))).map(c => {
      const st = ST_REF[c.status] || [c.status, ""];
      return `<div class="small" style="padding:7px 0;border-bottom:1px solid var(--line)">
        <strong>${KIND[c.kind] || esc(c.kind)}</strong>${c.merchant ? ", " + esc(c.merchant) : ""}${c.purchase_date ? ", " + NRC.fmtDate(c.purchase_date) : ""}: ${amountLine(c)}
        <span class="pill ${st[1]}">${st[0]}</span>${c.coverage === "outside" ? ` <span class="pill amber" title="${esc(c.coverage_note || "")}">outside the agreement</span>` : ""}
        ${c.description ? `<div class="muted">${esc(c.description)}</div>` : ""}${c.review_note ? `<div>Organizer note: ${esc(c.review_note)}</div>` : ""}${c.status === "reimbursed" && c.paid_at ? `<div class="muted">Paid ${NRC.fmtDate(String(c.paid_at).slice(0, 10))}${c.paid_method ? " by " + esc(c.paid_method) : ""}</div>` : ""}
        ${opts.canDelete && c.status === "submitted" && c.kind !== "per_diem" ? `<button class="btn sm ghost" type="button" style="margin-top:4px" onclick="NRC.Exp.del('${c.id}')" title="Withdraws this claim. Possible only while the organizer has not decided.">Withdraw</button>` : ""}
      </div>`;
    }).join("") + (opts.total !== false ? `<div class="small" style="padding:7px 0"><strong>Total ${usd(sum(claims.filter(c => c.status !== "rejected"), c => c.amount))}</strong>, paid ${usd(sum(claims.filter(c => c.status === "reimbursed"), c => c.amount))}</div>` : "");
  }
  let _after = null;
  async function del(id) {
    if (!confirm("Withdraw this claim? The receipt stays in your files, not on the hub.")) return;
    const { data: c } = await NRC.sb.from("expense_claims").select("receipt_url").eq("id", id).maybeSingle();
    const { error } = await NRC.sb.from("expense_claims").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    if (c && c.receipt_url) await NRC.sb.storage.from("receipts").remove([c.receipt_url]);
    if (_after) _after(); else if (window.reloadTrip) window.reloadTrip();
  }

  // ---------- claimant: claim form ----------
  function ensureDialog() {
    if ($("#dlg-xclaim")) return;
    document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-xclaim" style="max-width:640px"><div class="body">
      <h3 style="margin-top:0">Submit an expense</h3>
      <div id="xc-agree" class="small" style="margin:0 0 8px"></div>
      <p class="small muted" style="margin:0 0 10px">The organizer of the event approves or declines each claim and pays it. One claim per receipt. Food per diem is added by the organizer; no receipt needed.</p>
      <form id="form-xclaim" novalidate>
        <div id="xc-who-wrap" class="hidden"><label>Official</label><select name="assignment_id"></select></div>
        <label>Receipt (photo or PDF)</label><input name="receipt" type="file" accept="image/*,application/pdf">
        <div id="xc-read" class="small" style="margin:6px 0 0"></div>
        <div class="row"><div><label>Category</label><select name="kind" required></select></div><div><label>Date of payment or purchase</label><input name="purchase_date" type="date" required></div></div>
        <div class="row"><div><label>Total paid, as on the receipt</label><input name="amount_original" type="number" step="0.01" min="0.01" required></div><div><label>Currency</label><input name="currency" list="xc-currencies" maxlength="3" value="USD" style="text-transform:uppercase" required><datalist id="xc-currencies">${CURRENCIES.map(c => `<option value="${c}">`).join("")}</datalist></div></div>
        <div id="xc-fx" class="small muted"></div>
        <div id="xc-usd-wrap" class="hidden"><label>USD amount charged on your card statement</label><input name="usd_manual" type="number" step="0.01" min="0.01"></div>
        <div class="row"><div><label>Merchant</label><input name="merchant" placeholder="Airline, hotel, Uber, rental company"></div><div id="xc-nights-wrap"><label>Hotel nights</label><input name="nights" type="number" min="0" max="60"></div></div>
        <label>Description</label><input name="description" placeholder="SFO to BOS round trip; 2 nights Hampton Inn">
        <p class="small muted" style="margin:8px 0 0">Foreign currency is converted to USD at the average ECB reference rate over the 30 days ending on the date of purchase, not your card's rate.</p>
        <p class="small" style="margin:6px 0 0"><a href="#" onclick="NRC.Exp.openPayout();return false">How I get paid</a> <span class="muted">(Venmo, PayPal or Zelle)</span></p>
        <div id="xc-msg" class="notice hidden" style="margin-top:10px"></div>
        <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn pos" type="submit">Submit to the organizer</button><button class="btn neg" type="button" id="xc-cancel">Cancel</button></p>
      </form></div></dialog>`);
    const f = $("#form-xclaim");
    const showNights = () => $("#xc-nights-wrap").classList.toggle("hidden", f.kind.value !== "hotel");
    f.kind.addEventListener("change", showNights);
    let fxTimer = null;
    const fxPreview = () => { clearTimeout(fxTimer); fxTimer = setTimeout(async () => {
      const cur = (f.currency.value || "").toUpperCase(), d = f.purchase_date.value, amt = parseFloat(f.amount_original.value);
      $("#xc-usd-wrap").classList.add("hidden");
      if (!cur || cur === "USD" || !/^[A-Z]{3}$/.test(cur) || !d) { $("#xc-fx").textContent = ""; return; }
      $("#xc-fx").textContent = "Looking up the rate...";
      const r = await api({ action: "fx", currency: cur, date: d });
      if (!r.ok) { $("#xc-fx").textContent = r.d.error || "No rate found."; $("#xc-usd-wrap").classList.remove("hidden"); return; }
      $("#xc-fx").innerHTML = `1 ${esc(cur)} = ${Number(r.d.rate).toFixed(4)} USD (average ${NRC.fmtDate(r.d.start)} to ${NRC.fmtDate(r.d.end)}).${amt > 0 ? " <strong>" + usd(Math.round(amt * r.d.rate * 100) / 100) + "</strong> will be claimed." : ""}`;
    }, 400); };
    ["currency", "purchase_date", "amount_original"].forEach(n => f[n].addEventListener("input", fxPreview));
    f.receipt.addEventListener("change", () => uploadAndRead(f));
    $("#xc-cancel").addEventListener("click", async () => { if (XC.path && !XC.saved) await NRC.sb.storage.from("receipts").remove([XC.path]); $("#dlg-xclaim").close(); });
    f.addEventListener("submit", (e) => { e.preventDefault(); submit(f, false); });
    XC.fxPreview = fxPreview; XC.showNights = showNights;
  }
  const XC = { path: null, read: null, saved: false, admin: false, onDone: null };

  async function uploadAndRead(f) {
    const file = f.receipt.files[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { $("#xc-read").innerHTML = '<span class="pill red">Larger than 10 MB</span> Take a photo at a lower resolution or export the PDF again.'; return; }
    const me = await NRC.currentUser();
    if (XC.path && !XC.saved) await NRC.sb.storage.from("receipts").remove([XC.path]);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
    const path = `${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    $("#xc-read").innerHTML = "Uploading the receipt...";
    const up = await NRC.sb.storage.from("receipts").upload(path, file, { contentType: file.type || undefined });
    if (up.error) { $("#xc-read").innerHTML = '<span class="pill red">Upload failed</span> ' + esc(up.error.message); return; }
    XC.path = path; XC.read = null;
    $("#xc-read").innerHTML = "Receipt attached. Reading it...";
    const r = await api({ action: "read", receipt_path: path });
    const x = r.ok && r.d.read;
    if (!x) { $("#xc-read").innerHTML = 'Receipt attached. <span class="muted">' + esc((r.d && r.d.error) || "It could not be read; fill in the fields.") + "</span>"; return; }
    if (!x.is_receipt) { $("#xc-read").innerHTML = '<span class="pill amber">Check the file</span> This does not look like a receipt with a price. Attach the receipt, invoice or booking confirmation.'; return; }
    XC.read = x;
    if (x.kind && [...f.kind.options].some(o => o.value === x.kind)) f.kind.value = x.kind;
    if (x.purchase_date) f.purchase_date.value = x.purchase_date;
    if (x.total_amount != null) f.amount_original.value = Number(x.total_amount).toFixed(2);
    if (x.currency) f.currency.value = x.currency;
    if (x.merchant) f.merchant.value = x.merchant;
    if (x.nights != null) f.nights.value = x.nights;
    if (x.description) f.description.value = x.description;
    XC.showNights(); XC.fxPreview();
    const warn = x.category === "food" ? " Meals are covered by the food per diem, not by receipt." : !x.kind ? " Category not recognised; choose one." : "";
    $("#xc-read").innerHTML = `<span class="pill ${x.confidence === "high" ? "green" : "amber"}">Read from the receipt${x.confidence !== "high" ? ", " + esc(x.confidence) + " confidence" : ""}</span> Check each field before submitting.${warn}`;
  }

  async function submit(f, confirmDuplicate) {
    const msg = $("#xc-msg"); msg.classList.add("hidden");
    const btn = f.querySelector("button[type=submit]");
    const claim = { assignment_id: f.assignment_id.value, kind: f.kind.value, purchase_date: f.purchase_date.value, amount_original: f.amount_original.value, currency: (f.currency.value || "USD").toUpperCase(), merchant: f.merchant.value.trim(), nights: f.kind.value === "hotel" ? f.nights.value : null, description: f.description.value.trim(), receipt_url: XC.path, ai_read: XC.read, usd_manual: f.usd_manual.value || null, confirm_duplicate: confirmDuplicate };
    if (!claim.receipt_url && claim.kind !== "per_diem") { NRC.notice(msg, "Attach the receipt first.", "error"); return; }
    btn.disabled = true;
    const r = await api({ action: "submit", claim });
    btn.disabled = false;
    if (r.status === 409 && r.d.duplicate) { if (confirm(r.d.error)) return submit(f, true); return; }
    if (r.status === 422 && r.d.need_usd) { $("#xc-usd-wrap").classList.remove("hidden"); NRC.notice(msg, r.d.error, "error"); return; }
    if (!r.ok) { NRC.notice(msg, r.d.error || "Could not submit.", "error"); return; }
    XC.saved = true;
    const cv = r.d.claim;
    $("#dlg-xclaim").close();
    const note = `Submitted: ${usd(cv.amount)}. ${cv.coverage === "outside" ? "Outside what the organizer agreed (" + cv.coverage_note + "); the organizer decides." : "Within what the organizer agreed."}`;
    if (XC.onDone) XC.onDone(note); else alert(note);
  }

  // opts: { onDone(note), officials: [{assignment_id,name}] (admin), admin: true }
  async function openClaim(assignmentId, opts = {}) {
    ensureDialog();
    const f = $("#form-xclaim"); f.reset(); f.currency.value = "USD";
    XC.path = null; XC.read = null; XC.saved = false; XC.admin = !!opts.admin; XC.onDone = opts.onDone || null; _after = opts.onDone ? () => opts.onDone() : _after;
    $("#xc-read").innerHTML = '<span class="muted">The hub reads the receipt and fills in the fields below.</span>'; $("#xc-fx").textContent = ""; $("#xc-usd-wrap").classList.add("hidden"); $("#xc-msg").classList.add("hidden");
    const kinds = opts.admin ? RECEIPT_KINDS.concat(["per_diem"]) : RECEIPT_KINDS;
    f.kind.innerHTML = kinds.map(k => `<option value="${k}">${KIND[k]}</option>`).join("");
    if (opts.officials) {
      $("#xc-who-wrap").classList.remove("hidden");
      f.assignment_id.innerHTML = opts.officials.map(o => `<option value="${o.assignment_id}">${esc(o.name)}</option>`).join("");
      if (assignmentId) f.assignment_id.value = assignmentId;
    } else { $("#xc-who-wrap").classList.add("hidden"); f.assignment_id.innerHTML = `<option value="${assignmentId}"></option>`; }
    XC.showNights();
    const { data: a } = await NRC.sb.from("assignments").select("tournaments(name,start_date,end_date,flights_covered,hotel_nights_covered,hotel_booked_by,airport_transfers_covered,car_booked_by,food_stipend_per_day,organizer_name)").eq("id", f.assignment_id.value).maybeSingle();
    const t = a && a.tournaments;
    $("#xc-agree").innerHTML = t ? `<strong>${esc(t.name)}</strong>. Agreed by the organizer: ${esc(coverageLine(t).join(", ") || "nothing recorded")}. Approval and payment: ${esc(t.organizer_name || "the organizer")}.` : "";
    $("#dlg-xclaim").showModal();
  }

  // ---------- payout handles ----------
  async function openPayout() {
    if (!$("#dlg-payout")) {
      document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-payout" style="max-width:520px"><div class="body">
        <h3 style="margin-top:0">How I get paid</h3>
        <p class="small muted" style="margin:0 0 8px">Organizers who owe you a reimbursement see these handles, and only for their event. No bank account or card numbers on the hub: for a bank transfer, agree it directly with the organizer.</p>
        <form id="form-payout">
          <label>Venmo username</label><input name="venmo" placeholder="@first-last" maxlength="60">
          <label>PayPal email or phone</label><input name="paypal" maxlength="120">
          <label>Zelle email or US phone</label><input name="zelle" maxlength="120">
          <label>Preferred</label><select name="preferred"><option value="">No preference</option><option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="zelle">Zelle</option></select>
          <div id="po-msg" class="notice hidden" style="margin-top:10px"></div>
          <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn pos" type="submit">Save</button><button class="btn neg" type="button" onclick="document.getElementById('dlg-payout').close()">Cancel</button></p>
        </form></div></dialog>`);
      $("#form-payout").addEventListener("submit", async (e) => {
        e.preventDefault(); const f = e.target, me = await NRC.currentUser();
        const v = k => f[k].value.trim() || null;
        const digits = x => (x || "").replace(/[\s()+.-]/g, "");
        const looksLikeAccount = x => x && !x.includes("@") && /^\d+$/.test(digits(x)) && digits(x).length > 11;
        if (/\d{8,}/.test(v("venmo") || "") || looksLikeAccount(v("paypal")) || looksLikeAccount(v("zelle"))) { NRC.notice($("#po-msg"), "That looks like an account number. Enter a username, an email or a phone number only.", "error"); return; }
        const row = { user_id: me.id, venmo: v("venmo"), paypal: v("paypal"), zelle: v("zelle"), preferred: f.preferred.value || null, updated_at: new Date().toISOString() };
        const { error } = await NRC.sb.from("payout_methods").upsert(row, { onConflict: "user_id" });
        if (error) { NRC.notice($("#po-msg"), error.message, "error"); return; }
        $("#dlg-payout").close();
      });
    }
    const f = $("#form-payout"); f.reset(); $("#po-msg").classList.add("hidden");
    const me = await NRC.currentUser();
    const { data } = await NRC.sb.from("payout_methods").select("*").eq("user_id", me.id).maybeSingle();
    if (data) ["venmo", "paypal", "zelle"].forEach(k => f[k].value = data[k] || ""), f.preferred.value = data.preferred || "";
    $("#dlg-payout").showModal();
  }

  // ---------- referee home: expenses for recent and upcoming events ----------
  async function mountClaimant(el, opts) {
    const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
    const { data: asg } = await NRC.sb.from("assignments").select("id,tournament_id,tournaments(name,start_date,end_date,status)").eq("referee_id", opts.refereeId);
    const A = (asg || []).filter(a => a.tournaments && a.tournaments.status !== "cancelled" && a.tournaments.end_date >= since).sort((x, y) => x.tournaments.start_date.localeCompare(y.tournaments.start_date));
    if (!A.length) { el.innerHTML = ""; return; }
    const { data: cl } = await NRC.sb.from("expense_claims").select("*").in("assignment_id", A.map(a => a.id)).order("created_at");
    const reload = () => mountClaimant(el, opts); _after = reload;
    window._xcDone = (note) => { reload(); if (note) NRC.notice(document.getElementById("xc-home-msg"), esc(note), "ok"); };
    el.innerHTML = `<div class="card" style="margin-top:10px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><h3 style="margin:0">Expenses</h3><button class="btn sm ghost" type="button" onclick="NRC.Exp.openPayout()" title="Your Venmo, PayPal or Zelle handle, shown to the organizer who reimburses you">How I get paid</button></div>
      <p class="small muted" style="margin:6px 0 4px">One claim per receipt. The organizer of the event approves and pays.</p><div id="xc-home-msg" class="notice hidden"></div>
      ${A.map(a => { const C = (cl || []).filter(c => c.assignment_id === a.id); return `<div style="margin-top:12px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><strong>${esc(a.tournaments.name)}</strong><button class="btn sm secondary" type="button" onclick="NRC.Exp.openClaim('${a.id}',{onDone:window._xcDone})" title="Attach a receipt; the hub reads it and fills in the claim">Submit an expense</button></div>${listHtml(C, { canDelete: true }) || '<p class="small muted" style="margin:4px 0 0">No claim yet.</p>'}</div>`; }).join("")}</div>`;
  }

  // ---------- organizer and NRC: reimbursements panel ----------
  // opts: { tournament, mode: "organizer" | "nrc" }
  async function mountPanel(el, opts) {
    const t = opts.tournament, admin = opts.mode === "nrc";
    el.innerHTML = '<p class="muted small">Loading reimbursements.</p>';
    const [{ data: des }, { data: pay }, { data: fin }] = await Promise.all([
      NRC.sb.from("organizer_designations").select("*").eq("tournament_id", t.id),
      NRC.sb.rpc("event_payees", { p_tournament: t.id }),
      NRC.sb.from("tournament_finance").select("*").eq("tournament_id", t.id).maybeSingle()]);
    const D = des || []; const ids = D.map(d => d.assignment_id);
    const { data: cl } = ids.length ? await NRC.sb.from("expense_claims").select("*").in("assignment_id", ids).order("purchase_date") : { data: [] };
    const C = cl || [], P = {}; (pay || []).forEach(p => P[p.assignment_id] = p);
    const name = aid => { const d = D.find(x => x.assignment_id === aid); return d ? d.last_name + ", " + d.first_name : "Official"; };
    const S = { el, opts, t, admin, D, C, P, fin: fin || {}, name, filter: (el._xfilter || "all") };
    el._x = S; renderPanel(S);
  }
  function renderPanel(S) {
    const { t, admin, C, D, P, fin, name } = S;
    const live = admin ? C : C.filter(c => c.reimbursed_by !== "nrc");
    const wait = live.filter(c => c.status === "submitted"), due = live.filter(c => c.status === "approved"), paid = live.filter(c => c.status === "reimbursed"), dec = live.filter(c => c.status === "rejected");
    const kinds = ORDER.filter(k => live.some(c => c.kind === k) || RECEIPT_KINDS.includes(k) || k === "per_diem");
    const row = k => { const x = live.filter(c => c.kind === k); return `<tr><td>${KIND[k]}</td><td>${usd(sum(x.filter(c => c.status === "submitted"), c => c.amount))}</td><td><strong>${usd(sum(x.filter(c => c.status === "approved"), c => c.amount))}</strong></td><td>${usd(sum(x.filter(c => c.status === "reimbursed"), c => c.amount))}</td><td>${usd(sum(x.filter(c => ["approved", "reimbursed"].includes(c.status)), c => c.amount))}</td></tr>`; };
    const perDiemMissing = t.food_stipend_per_day && D.some(d => !C.some(c => c.assignment_id === d.assignment_id && c.kind === "per_diem" && c.status !== "rejected"));
    const FILTERS = [["all", "All", live.length], ["submitted", "To decide", wait.length], ["approved", "To pay", due.length], ["reimbursed", "Paid", paid.length], ["rejected", "Declined", dec.length]];
    const shown = S.filter === "all" ? live : live.filter(c => c.status === S.filter);
    const officials = [...new Set(live.map(c => c.assignment_id))].sort((a, b) => name(a).localeCompare(name(b)));
    const handle = aid => { const p = P[aid]; if (!p) return '<span class="muted">no handle on file</span>'; const h = [p.venmo ? "Venmo " + p.venmo : null, p.paypal ? "PayPal " + p.paypal : null, p.zelle ? "Zelle " + p.zelle : null].filter(Boolean); return (h.length ? esc(h.join(", ")) + (p.preferred ? ` <span class="muted">(prefers ${esc(p.preferred)})</span>` : "") : "") + (p.payment_notes ? (h.length ? "<br>" : "") + esc(p.payment_notes) : "") || '<span class="muted">no handle on file</span>'; };
    const T = (s) => tip(s, admin);
    S.el.innerHTML = `
      <div class="notice" style="margin:0 0 10px">${admin ? "The organizer approves, declines and pays each claim. A decision recorded here is marked as made by the NRC for the organizer." : "You approve or decline each claim and mark it paid. The NRC does not approve expenses for your event."}</div>
      <div class="grid c4">
        <div class="stat ${wait.length ? "" : "good"}"><div class="n" style="font-size:26px">${usd(sum(wait, c => c.amount))}</div><div class="l">To decide (${wait.length})</div></div>
        <div class="stat"><div class="n" style="font-size:26px">${usd(sum(due, c => c.amount))}</div><div class="l">Approved, to pay (${due.length})</div></div>
        <div class="stat"><div class="n" style="font-size:26px">${usd(sum(paid, c => c.amount))}</div><div class="l">Paid (${paid.length})</div></div>
        <div class="stat"><div class="n" style="font-size:26px">${usd(sum(due.concat(paid), c => c.amount))}</div><div class="l">Total approved</div></div>
      </div>
      <h4 style="margin:16px 0 6px">By category, USD</h4>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th>To decide</th><th>To pay</th><th>Paid</th><th>Total approved</th></tr></thead><tbody>${kinds.map(row).join("")}
        <tr><td><strong>Total</strong></td><td>${usd(sum(wait, c => c.amount))}</td><td><strong>${usd(sum(due, c => c.amount))}</strong></td><td>${usd(sum(paid, c => c.amount))}</td><td><strong>${usd(sum(due.concat(paid), c => c.amount))}</strong></td></tr></tbody></table></div>
      <p class="small muted" style="margin:6px 0 0">Not included above: bookings ${admin ? "the organizer" : "you"} paid directly ${usd(fin.organizer_paid_bookings)}${Number(fin.nrc_paid_bookings) ? `; bookings the NRC paid, to reimburse to the NRC ${usd(fin.nrc_paid_bookings)}` : ""}${!admin && C.some(c => c.reimbursed_by === "nrc") ? `; claims the NRC reimburses itself ${usd(sum(C.filter(c => c.reimbursed_by === "nrc" && c.status !== "rejected"), c => c.amount))}` : ""}. Foreign currency at the 30 day average ECB rate to the date of purchase.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        ${wait.some(c => c.coverage === "covered") ? `<button class="btn sm pos" type="button" onclick="NRC.Exp._bulkApprove(this)" ${T("Approves every waiting claim that falls within what was agreed on the request. Claims outside the agreement stay to decide one by one.")}>Approve all within the agreement (${wait.filter(c => c.coverage === "covered").length})</button>` : ""}
        ${perDiemMissing ? `<button class="btn sm secondary" type="button" onclick="NRC.Exp._perDiems(this)" ${T("Adds the agreed food per diem for each designated official ($" + t.food_stipend_per_day + " per day x event days), to approve like any other claim.")}>Add the food per diems</button>` : ""}
        <button class="btn sm secondary" type="button" onclick="NRC.Exp._zip(this)" ${T("Downloads the receipts of the claims listed below in one zip, with a CSV summary. Change the filter to choose which ones.")}>Download receipts (${shown.filter(c => c.receipt_url).length})</button>
        <button class="btn sm ghost" type="button" onclick="NRC.Exp._csv(this)" ${T("Downloads the claims listed below as a spreadsheet (CSV).")}>Download summary (CSV)</button>
      </div>
      <h4 style="margin:6px 0 6px">By official</h4>
      ${officials.length ? `<div class="table-wrap"><table><thead><tr><th>Official</th><th>How to pay</th><th>To decide</th><th>To pay</th><th>Paid</th><th></th></tr></thead><tbody>${officials.map(aid => { const x = live.filter(c => c.assignment_id === aid), toPay = sum(x.filter(c => c.status === "approved"), c => c.amount); return `<tr><td><strong>${esc(name(aid))}</strong></td><td class="small">${handle(aid)}</td><td>${usd(sum(x.filter(c => c.status === "submitted"), c => c.amount))}</td><td><strong>${usd(toPay)}</strong></td><td>${usd(sum(x.filter(c => c.status === "reimbursed"), c => c.amount))}</td><td>${toPay ? `<button class="btn sm pos" type="button" onclick="NRC.Exp._pay('${aid}')" ${T("Records that you paid this official every approved claim, with the method and reference.")}>Mark paid</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : '<p class="small muted">No claim yet. Officials submit them from their page, one per receipt.</p>'}
      <h4 style="margin:16px 0 6px">Claims</h4>
      <div class="chips" style="margin-bottom:8px">${FILTERS.map(([k, l, n]) => `<button type="button" class="chip ${S.filter === k ? "on" : ""}" onclick="NRC.Exp._filter('${k}',this)">${l} (${n})</button>`).join("")}</div>
      ${shown.length ? shown.map(c => claimCard(c, S)).join("") : '<p class="small muted">Nothing here.</p>'}`;
    window._xPanel = S;
  }
  function claimCard(c, S) {
    const st = ST_ORG[c.status] || [c.status, ""], T = s => tip(s, S.admin);
    const acts = c.status === "submitted"
      ? `<button class="btn sm pos" type="button" onclick="NRC.Exp._set('${c.id}','approved')" ${T("Approves this claim for payment.")}>Approve</button><button class="btn sm neg" type="button" onclick="NRC.Exp._set('${c.id}','rejected')" ${T("Declines this claim. You give the reason; the official sees it.")}>Decline</button>`
      : c.status === "approved" ? `<button class="btn sm pos" type="button" onclick="NRC.Exp._pay('${c.assignment_id}','${c.id}')" ${T("Records that this claim is paid.")}>Mark paid</button><button class="btn sm ghost" type="button" onclick="NRC.Exp._set('${c.id}','submitted')" ${T("Puts the claim back to decide.")}>Undo</button>`
      : c.status === "rejected" ? `<button class="btn sm ghost" type="button" onclick="NRC.Exp._set('${c.id}','submitted')" ${T("Puts the claim back to decide.")}>Undo</button>`
      : `<button class="btn sm ghost" type="button" onclick="NRC.Exp._set('${c.id}','approved')" ${T("Clears the payment record; the claim goes back to approved, to pay.")}>Undo payment</button>`;
    return `<div class="card" style="padding:12px 14px;margin:0 0 8px;box-shadow:none">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline"><div><strong>${esc(S.name(c.assignment_id))}</strong> &middot; ${KIND[c.kind] || esc(c.kind)}${c.merchant ? ", " + esc(c.merchant) : ""}${c.purchase_date ? " &middot; " + NRC.fmtDate(c.purchase_date) : ""}</div><div>${amountLine(c)} <span class="pill ${st[1]}">${st[0]}</span>${c.reimbursed_by === "nrc" ? ' <span class="pill">NRC reimburses</span>' : ""}</div></div>
      <div class="small" style="margin-top:4px"><span class="pill ${c.coverage === "covered" ? "green" : "amber"}">${c.coverage === "covered" ? "Within the agreement" : "Outside the agreement"}</span> <span class="muted">${esc(c.coverage_note || "")}</span>${c.nights != null ? ` &middot; ${c.nights} night(s)` : ""}</div>
      ${c.description ? `<div class="small muted" style="margin-top:2px">${esc(c.description)}</div>` : ""}
      ${c.currency && c.currency !== "USD" ? `<div class="small muted">${esc(c.fx_source || "")}</div>` : ""}
      ${c.review_note ? `<div class="small" style="margin-top:2px">Note: ${esc(c.review_note)}</div>` : ""}
      ${c.decided_by_role ? `<div class="small muted">${c.status === "rejected" ? "Declined" : "Approved"} by ${c.decided_by_role === "nrc" ? "the NRC for the organizer" : "the organizer"}${c.reviewed_at ? ", " + NRC.fmtDate(String(c.reviewed_at).slice(0, 10)) : ""}${c.status === "reimbursed" && c.paid_at ? `; paid ${NRC.fmtDate(String(c.paid_at).slice(0, 10))}${c.paid_method ? " by " + esc(c.paid_method) : ""}${c.paid_reference ? " (" + esc(c.paid_reference) + ")" : ""}` : ""}</div>` : ""}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${c.receipt_url ? `<button class="btn sm ghost" type="button" onclick="NRC.Exp._receipt('${c.id}',false)" ${T("Opens the receipt in a new tab.")}>View receipt</button><button class="btn sm ghost" type="button" onclick="NRC.Exp._receipt('${c.id}',true)" ${T("Downloads this receipt, named by date, official, category and amount.")}>Download</button>` : `<span class="small muted" style="align-self:center">${c.kind === "per_diem" ? "Per diem, no receipt" : "No receipt"}</span>`}${acts}</div>
    </div>`;
  }
  const S0 = () => window._xPanel;
  const reloadPanel = () => { const S = S0(); S.el._xfilter = S.filter; return mountPanel(S.el, S.opts); };
  const receiptName = (c, S) => `${c.purchase_date || "nodate"}_${fileSafe(S.name(c.assignment_id))}_${fileSafe(KIND[c.kind] || c.kind)}_${Number(c.amount).toFixed(2)}USD_${c.id.slice(0, 6)}.${extOf(c.receipt_url)}`;

  async function setStatus(id, status) {
    const S = S0(), c = S.C.find(x => x.id === id); if (!c) return;
    const patch = { status };
    if (status === "rejected") { const why = prompt("Reason for declining (the official sees it):", c.review_note || ""); if (why === null) return; if (!why.trim()) { alert("Give a reason so the official understands the decision."); return; } patch.review_note = why.trim(); }
    if (S.admin && ["approved", "rejected"].includes(status) && c.status === "submitted" && !confirm("The organizer approves expenses. Record this decision for the organizer?")) return;
    if (c.status === "reimbursed") { patch.paid_at = null; patch.paid_method = null; patch.paid_reference = null; }
    const { error } = await NRC.sb.from("expense_claims").update(patch).eq("id", id);
    if (error) { alert(error.message); return; }
    reloadPanel();
  }
  async function bulkApprove(btn) {
    const S = S0(), ids = S.C.filter(c => c.status === "submitted" && c.coverage === "covered" && c.reimbursed_by !== "nrc").map(c => c.id);
    if (!ids.length || !confirm(`Approve ${ids.length} claim(s) within the agreement, ${usd(sum(S.C.filter(c => ids.includes(c.id)), c => c.amount))} in total?${S.admin ? " The decision is recorded as made by the NRC for the organizer." : ""}`)) return;
    btn.disabled = true;
    const { error } = await NRC.sb.from("expense_claims").update({ status: "approved" }).in("id", ids);
    btn.disabled = false; if (error) { alert(error.message); return; } reloadPanel();
  }
  async function perDiems(btn) {
    const S = S0(); btn.disabled = true;
    const { data, error } = await NRC.sb.rpc("add_per_diems", { p_tournament: S.t.id });
    btn.disabled = false; if (error) { alert(error.message); return; }
    alert(data + " per diem claim(s) added, waiting for approval."); reloadPanel();
  }
  async function pay(aid, oneId) {
    const S = S0(); const list = S.C.filter(c => c.assignment_id === aid && c.status === "approved" && (!oneId || c.id === oneId));
    if (!list.length) return;
    if (!$("#dlg-xpay")) {
      document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-xpay" style="max-width:480px"><div class="body"><h3 style="margin-top:0">Mark paid</h3><p id="xp-what" class="small"></p>
        <form id="form-xpay"><div class="row"><div><label>Paid by</label><select name="method">${METHODS.map(m => `<option>${m}</option>`).join("")}</select></div><div><label>Date paid</label><input name="paid_on" type="date" required></div></div>
        <label>Reference (optional)</label><input name="ref" placeholder="Transaction ID, check number">
        <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn pos" type="submit">Mark paid</button><button class="btn neg" type="button" onclick="document.getElementById('dlg-xpay').close()">Cancel</button></p></form></div></dialog>`);
      $("#form-xpay").addEventListener("submit", async (e) => {
        e.preventDefault(); const f = e.target, ids = JSON.parse(f.dataset.ids);
        const { error } = await NRC.sb.from("expense_claims").update({ status: "reimbursed", paid_at: new Date(f.paid_on.value + "T12:00:00").toISOString(), paid_method: f.method.value, paid_reference: f.ref.value.trim() || null }).in("id", ids);
        if (error) { alert(error.message); return; }
        $("#dlg-xpay").close(); reloadPanel();
      });
    }
    const f = $("#form-xpay"); f.reset(); f.dataset.ids = JSON.stringify(list.map(c => c.id)); f.paid_on.value = NRC.localDate();
    const p = S.P[aid]; if (p && p.preferred) f.method.value = { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" }[p.preferred];
    $("#xp-what").innerHTML = `${esc(S.name(aid))}: ${list.length} claim(s), <strong>${usd(sum(list, c => c.amount))}</strong>.${p && (p.venmo || p.paypal || p.zelle) ? "<br>" + esc([p.venmo ? "Venmo " + p.venmo : null, p.paypal ? "PayPal " + p.paypal : null, p.zelle ? "Zelle " + p.zelle : null].filter(Boolean).join(", ")) : ""}`;
    $("#dlg-xpay").showModal();
  }
  async function receipt(id, download) {
    const S = S0(), c = S.C.find(x => x.id === id); if (!c || !c.receipt_url) return;
    const w = download ? null : window.open("", "_blank");
    const { data, error } = await NRC.sb.storage.from("receipts").createSignedUrl(c.receipt_url, 300, download ? { download: receiptName(c, S) } : undefined);
    if (error) { if (w) w.close(); alert("Could not open the receipt: " + error.message); return; }
    if (w) w.location = data.signedUrl; else { const a = document.createElement("a"); a.href = data.signedUrl; a.download = receiptName(c, S); document.body.appendChild(a); a.click(); a.remove(); }
  }
  function rowsFor(S) {
    const base0 = S.admin ? S.C : S.C.filter(c => c.reimbursed_by !== "nrc"); const shown = S.filter === "all" ? base0 : base0.filter(c => c.status === S.filter);
    return shown.sort((a, b) => S.name(a.assignment_id).localeCompare(S.name(b.assignment_id)) || String(a.purchase_date).localeCompare(String(b.purchase_date)));
  }
  function csvText(S, rows) {
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["Official", "Category", "Merchant", "Description", "Purchase date", "Amount paid", "Currency", "FX rate (USD per unit)", "FX source", "USD", "Agreement", "Agreement note", "Status", "Decided by", "Decided on", "Note", "Paid on", "Paid by", "Payment reference", "Receipt file"];
    const lines = [head.map(q).join(",")].concat(rows.map(c => [S.name(c.assignment_id), KIND[c.kind] || c.kind, c.merchant, c.description, c.purchase_date, Number(c.amount_original ?? c.amount).toFixed(2), c.currency || "USD", c.fx_rate, c.fx_source, Number(c.amount).toFixed(2), c.coverage === "covered" ? "Within" : "Outside", c.coverage_note, (ST_ORG[c.status] || [c.status])[0], c.decided_by_role === "nrc" ? "NRC for the organizer" : c.decided_by_role || "", c.reviewed_at ? String(c.reviewed_at).slice(0, 10) : "", c.review_note, c.paid_at ? String(c.paid_at).slice(0, 10) : "", c.paid_method, c.paid_reference, c.receipt_url ? receiptName(c, S) : ""].map(q).join(",")));
    lines.push(["Total", "", "", "", "", "", "", "", "", sum(rows.filter(c => c.status !== "rejected"), c => c.amount).toFixed(2)].map(q).join(","));
    return "\ufeff" + lines.join("\r\n");
  }
  const base = S => `${fileSafe(S.t.name)}_${S.t.start_date}_${S.filter === "all" ? "all" : fileSafe((ST_ORG[S.filter] || [S.filter])[0])}`;
  function saveBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  function csv() { const S = S0(), rows = rowsFor(S); if (!rows.length) { alert("Nothing to export with this filter."); return; } saveBlob(new Blob([csvText(S, rows)], { type: "text/csv" }), `expenses_${base(S)}.csv`); }
  const loadZip = () => window.JSZip ? Promise.resolve() : new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; s.onload = ok; s.onerror = () => ko(new Error("Could not load the zip tool")); document.head.appendChild(s); });
  async function zip(btn) {
    const S = S0(), rows = rowsFor(S), withR = rows.filter(c => c.receipt_url);
    if (!withR.length) { alert("No receipt with this filter."); return; }
    const label = btn.textContent; btn.disabled = true;
    try {
      await loadZip();
      const z = new JSZip(); const failed = [];
      const { data: urls, error } = await NRC.sb.storage.from("receipts").createSignedUrls(withR.map(c => c.receipt_url), 600);
      if (error) throw error;
      let i = 0;
      for (const c of withR) {
        i++; btn.textContent = `Downloading ${i}/${withR.length}`;
        const u = (urls || []).find(x => x.path === c.receipt_url);
        try { const r = await fetch(u.signedUrl); if (!r.ok) throw new Error(r.status); z.file(receiptName(c, S), await r.blob()); } catch (e) { failed.push(receiptName(c, S)); }
      }
      z.file(`summary_${base(S)}.csv`, csvText(S, rows));
      if (failed.length) z.file("missing.txt", "These receipts could not be downloaded:\r\n" + failed.join("\r\n"));
      btn.textContent = "Building the zip";
      saveBlob(await z.generateAsync({ type: "blob" }), `receipts_${base(S)}.zip`);
      if (failed.length) alert(failed.length + " receipt(s) could not be downloaded; see missing.txt in the zip.");
    } catch (e) { alert("Download failed: " + (e.message || e)); }
    finally { btn.disabled = false; btn.textContent = label; }
  }
  function setFilter(k) { const S = S0(); S.filter = k; S.el._xfilter = k; renderPanel(S); }

  NRC.Exp = { KIND, listHtml, del, openClaim, openPayout, mountClaimant, mountPanel, coverageLine,
    _set: setStatus, _bulkApprove: bulkApprove, _perDiems: perDiems, _pay: pay, _receipt: receipt, _zip: zip, _csv: csv, _filter: setFilter };
})();
