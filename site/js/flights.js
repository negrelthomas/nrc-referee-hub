/* NRC Referee Hub: flight details read from an airline confirmation.
   Attached to the booking forms of the referee (profile), the organizer page and the admin travel dialog.
   The file goes to the private receipts bucket under the uploader's id; /api/read-document returns every flight leg.
   One leg fills the form; several legs can be saved as one booking per flight. Everything is shown for checking first. */
(function () {
  const F = (window.NRC.Flights = {}), esc = (s) => NRC.esc(s);
  const local = (s) => (s && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : "");
  const iso = (s) => (s ? new Date(s).toISOString() : null);
  async function token() { const { data } = await NRC.sb.auth.getSession(); return data.session ? data.session.access_token : ""; }

  // form: the booking <form>. o.base(form) -> fields common to every row (assignment_id, status, paid_by, entered_by...); o.onSaved()
  F.attach = function (form, o) {
    if (!form || form.dataset.flights) return; form.dataset.flights = "1";
    form.insertAdjacentHTML("afterbegin", `<div class="flight-read notice" style="margin:0 0 10px">
      <label style="margin-top:0">Airline confirmation <span class="small muted">(optional, PDF or screenshot)</span></label>
      <input type="file" data-fr="file" accept="image/*,application/pdf">
      <div class="small muted" data-fr="out" style="margin-top:6px">The hub reads every flight on the confirmation and fills in the booking. Check each field before saving.</div></div>`);
    const out = form.querySelector('[data-fr="out"]'), file = form.querySelector('[data-fr="file"]');
    form.addEventListener("reset", () => { delete form.dataset.doc; out.innerHTML = "The hub reads every flight on the confirmation and fills in the booking. Check each field before saving."; });
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 10 * 1024 * 1024) { out.innerHTML = '<span class="pill red">Too large</span> The file must be under 10 MB.'; return; }
      const { data: s } = await NRC.sb.auth.getSession(); const uid = s.session && s.session.user.id; if (!uid) { out.textContent = "Sign in first."; return; }
      const ext = (f.name.split(".").pop() || "pdf").toLowerCase(), path = `${uid}/bookings/${Date.now()}.${ext}`;
      out.textContent = "Uploading the confirmation.";
      const up = await NRC.sb.storage.from("receipts").upload(path, f, { contentType: f.type || undefined });
      if (up.error) { out.innerHTML = '<span class="pill red">Upload failed</span> ' + esc(up.error.message); return; }
      form.dataset.doc = path; out.textContent = "Reading the flights.";
      const res = await fetch("/api/read-document", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + await token() }, body: JSON.stringify({ kind: "flight", path }) });
      const d = await res.json().catch(() => ({})), x = d.read;
      if (!x) { out.innerHTML = 'Confirmation attached. <span class="muted">' + esc(d.error || "It could not be read; fill in the fields.") + "</span>"; return; }
      if (!x.is_itinerary || !(x.legs || []).length) { out.innerHTML = '<span class="pill amber">Check the file</span> No flight found on this document. Attach the airline confirmation or e-ticket.'; return; }
      const legs = x.legs;
      const set = (k, v) => { if (form[k] && v != null && v !== "") form[k].value = v; };
      set("kind", "flight"); const l = legs[0];
      set("provider", [l.airline, l.flight_number].filter(Boolean).join(" ")); set("reference", x.airline_reference);
      set("start_at", local(l.depart)); set("end_at", local(l.arrive)); set("from_place", l.from); set("to_place", l.to);
      if (x.total_amount != null && (!x.currency || x.currency === "USD")) set("cost", x.total_amount);
      const conf = x.confidence !== "high" ? ` <span class="pill amber">${esc(x.confidence)} confidence</span>` : "";
      const list = legs.map((g, i) => `<li>${esc([g.airline, g.flight_number].filter(Boolean).join(" "))}, ${esc(g.from || "?")} to ${esc(g.to || "?")}, ${esc((g.depart || "").replace("T", " "))}${g.arrive ? " → " + esc(g.arrive.slice(11, 16)) : ""}</li>`).join("");
      out.innerHTML = `<span class="pill green">Read</span>${conf} ${legs.length} flight${legs.length === 1 ? "" : "s"}${x.airline_reference ? ", reference " + esc(x.airline_reference) : ""}${x.total_amount != null ? ", total " + (x.currency && x.currency !== "USD" ? esc(x.currency) + " " : "$") + Number(x.total_amount).toFixed(2) + (x.currency && x.currency !== "USD" ? " (enter the USD amount charged)" : "") : ""}.<ol style="margin:6px 0 0;padding-left:18px">${list}</ol>` +
        (legs.length > 1 ? `<p style="margin:8px 0 0"><button class="btn sm pos" type="button" data-fr="all">Save the ${legs.length} flights as ${legs.length} bookings</button> <span class="small muted">or save only the first one with the form below.</span></p>` : "<p class=\"small\" style=\"margin:6px 0 0\">The form below is filled in. Check it and save.</p>");
      const all = out.querySelector('[data-fr="all"]');
      if (all) all.onclick = async () => {
        const base = o.base(form), cost = form.cost && form.cost.value !== "" ? parseFloat(form.cost.value) : null;
        const rows = legs.map((g, i) => Object.assign({}, base, { kind: "flight", provider: [g.airline, g.flight_number].filter(Boolean).join(" ") || null, reference: x.airline_reference || null, start_at: iso(local(g.depart)), end_at: iso(local(g.arrive)), from_place: g.from || null, to_place: g.to || null, cost: i === 0 ? cost : null, document_path: path, notes: i === 0 && legs.length > 1 ? "Fare for the whole booking (" + legs.length + " flights)" + (base.notes ? ". " + base.notes : "") : base.notes || null }));
        const { error } = await NRC.sb.from("travel_bookings").insert(rows);
        if (error) { out.insertAdjacentHTML("beforeend", '<div class="notice error">Could not save: ' + esc(error.message) + "</div>"); return; }
        o.onSaved && o.onSaved(rows.length);
      };
    };
  };
})();
