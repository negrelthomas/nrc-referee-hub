/* Guest home: referees from outside USATH named on an event by the organizer or the NRC.
   They see the events they are designated for with every detail, complete their profile (asked at first sign in),
   and may use training and the online tests. Nothing is mandatory: no deadline, no reminder, no evaluation. */
(function () {
  const $ = NRC.$;
  const KIND = { flight: "Flight", hotel: "Hotel", car: "Car rental", train: "Train", other: "Other" };
  const CK = { flight: "Flight", hotel: "Hotel", car: "Car", mileage: "Mileage", transport: "Transport", per_diem: "Per diem", other: "Other" };
  const fmtDT = (d) => d ? new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  let G = null, ROWS = [], USER = null, PREVIEW = false;

  const coverage = (t) => [
    t.flights_covered ? "Flights covered" : "Flights not covered",
    (t.hotel_nights_covered || 0) + " hotel night" + (t.hotel_nights_covered === 1 ? "" : "s") + " covered",
    t.airport_transfers_covered ? "Airport transfers covered" + (t.airport_transfer_how ? " (" + t.airport_transfer_how + ")" : "") : "Airport transfers not covered",
    t.hotel_to_venue_transport ? "Hotel to venue: " + t.hotel_to_venue_transport : null,
    t.food_stipend_per_day ? "Food stipend: $" + t.food_stipend_per_day + " per day" : (t.meals_provided ? "Meals: " + t.meals_provided : null),
    t.earliest_return_last_day ? "Do not leave before " + String(t.earliest_return_last_day).slice(0, 5) + " on the last day" : null
  ].filter(Boolean);

  // ---------- page shell ----------
  function shell() {
    ["#stats", ".tabs", "#tab-home", "#tab-profile", "#tab-tournaments", "#tab-games", "#tab-evals", "#assess-banner"].forEach(s => { const e = $(s); if (e) e.classList.add("hidden"); });
    const links = $("#hello").parentElement.querySelector(".small"); if (links) links.innerHTML = '<a href="#" onclick="NRC.Guest.editProfile();return false">Edit my profile</a>';
    $("#msg").insertAdjacentHTML("afterend", `<div id="guest-root">
      <p class="muted" id="guest-sub" style="margin:6px 0 0"></p>
      <div class="gtabs tabs" style="margin-top:16px"><button data-g="events" class="active">My events</button><button data-g="profile">My profile</button><button data-g="training">Training and tests</button></div>
      <div id="g-events"></div><div id="g-profile" class="hidden"></div><div id="g-training" class="hidden"></div></div>`);
    NRC.$$(".gtabs button").forEach(b => b.onclick = () => { NRC.$$(".gtabs button").forEach(x => x.classList.toggle("active", x === b)); ["events", "profile", "training"].forEach(t => $("#g-" + t).classList.toggle("hidden", t !== b.dataset.g)); });
    document.body.insertAdjacentHTML("beforeend", `<dialog id="dlg-gprofile"><div class="body">
      <h3 style="margin-top:0" id="gp-title">Your profile</h3>
      <p class="small muted" id="gp-intro"></p>
      <form id="form-gprofile">
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:6px"><img id="gp-photo" class="avatar lg" alt=""><div><label style="margin-top:0">Photo</label><input type="file" name="photo" accept="image/*"><div class="help">Square headshot, shown to the NRC and the organizer.</div></div></div>
        <div class="row"><div><label>First name</label><input name="first_name" required></div><div><label>Last name</label><input name="last_name" required></div></div>
        <div class="row"><div><label>Email</label><input name="email" readonly style="background:#F0F3F8"><div class="help">Your sign in. <a href="#" onclick="openEmailChange();return false">Change email</a></div></div><div><label>Phone, with country code</label><input name="phone" autocomplete="tel" placeholder="+1 604 555 0100"></div></div>
        <div class="row"><div><label>Home city</label><input name="home_city"></div><div><label>Country you live in</label><input name="country" autocomplete="country-name"></div></div>
        <div class="row"><div><label>Closest airport to home (IATA)</label><input name="home_airport_iata" maxlength="3" placeholder="YVR" style="text-transform:uppercase"></div><div><label>Nation you referee for</label><input name="federation"></div></div>
        <div class="row"><div><label>Your refereeing level</label><select name="federation_level"><option value="">Choose</option>${Object.entries(NRC.GUEST_LEVEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select><div class="help">Sets the difficulty of the questions if you take a test.</div></div>
          <div><label>How the organizer pays you back</label><input name="payment_notes" placeholder="Bank transfer, Wise, paid to my federation"><div class="help">Method and payee only. No bank or card numbers on the hub.</div></div></div>
        <div id="gp-msg" class="notice hidden" style="margin-top:8px"></div>
        <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" id="gp-later">Later</button></p>
      </form></div></dialog>`);
    NRC.nationPicker($("#form-gprofile").federation);
    $("#form-gprofile").addEventListener("submit", saveProfile);
    NRC.dialogCloses();
    $("#gp-later").onclick = async () => { $("#dlg-gprofile").close(); if (!G.onboarded_at && !PREVIEW) { await NRC.sb.rpc("save_my_guest_profile", { p: { ...profilePayload(G), onboarded: true } }); G.onboarded_at = new Date().toISOString(); } };
  }

  const profilePayload = (g) => ({ first_name: g.first_name, last_name: g.last_name, phone: g.phone, home_city: g.home_city, country: g.country, home_airport_iata: g.home_airport_iata, federation_level: g.federation_level, federation: g.federation, payment_notes: g.payment_notes });

  // ---------- completion ----------
  function completion(asmt, tests, answers) {
    const phys = tests.find(t => t.kind === "physical");
    const edit = { label: "Add", onclick: "NRC.Guest.editProfile()" };
    return NRC.completionHtml("Your profile", [
      { label: "Photo", done: !!G.photo_url, kind: "you", action: edit },
      { label: "Phone", done: !!G.phone, kind: "you", detail: "So the organizer can reach you on site", action: edit },
      { label: "Home city", done: !!G.home_city, kind: "you", detail: [G.home_city, G.country].filter(Boolean).map(NRC.esc).join(", "), action: edit },
      { label: "Closest airport", done: !!G.home_airport_iata, kind: "you", detail: "Needed to plan your travel", action: edit },
      { label: "Your refereeing level", done: !!G.federation_level, kind: "you", detail: G.federation_level ? NRC.esc(NRC.GUEST_LEVEL[G.federation_level]) : "", action: edit },
      { label: "How the organizer pays you back", done: !!G.payment_notes, kind: "you", detail: G.payment_notes ? NRC.esc(G.payment_notes) : "Method and payee, for your expenses", action: edit },
      { label: "Rules assessment", done: !!asmt, kind: "optional", detail: asmt ? `${asmt.pct}% on ${NRC.fmtDate(asmt.created_at.slice(0, 10))}` : "50 questions on the IHF rules, 60 minutes", action: { label: "Take it", href: "training.html#program" } },
      { label: "Physical test", done: !!(phys && phys.passed), kind: "optional", info: NRC.physicalInfo(), detail: phys ? `${NRC.esc(NRC.physResult(phys))}, ${NRC.fmtDate(phys.tested_on)}` : "Taken in person, recorded by the NRC" },
      { label: "Practice quiz", done: answers > 0, kind: "optional", detail: answers ? answers + " questions answered" : "Short quizzes on the IHF rules", action: { label: "Open", href: "training.html" } }
    ]);
  }

  // ---------- events ----------
  async function renderEvents() {
    const ids = ROWS.map(r => r.id);
    const { data: asg } = await NRC.sb.from("assignments").select("id,tournament_id,role,travel_notes,guest_official_id").in("guest_official_id", ids);
    const A = asg || [];
    const tids = [...new Set(A.map(a => a.tournament_id))];
    const [{ data: tours }, { data: bk }, { data: cl }] = await Promise.all([
      tids.length ? NRC.sb.from("tournaments").select("*").in("id", tids) : { data: [] },
      A.length ? NRC.sb.from("travel_bookings").select("*").in("assignment_id", A.map(a => a.id)).neq("status", "cancelled").order("start_at") : { data: [] },
      A.length ? NRC.sb.from("expense_claims").select("*").in("assignment_id", A.map(a => a.id)).order("created_at") : { data: [] }]);
    const T = (tours || []).filter(t => t.status !== "cancelled");
    const today = NRC.localDate();
    const up = T.filter(t => t.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const past = T.filter(t => t.end_date < today).sort((a, b) => b.start_date.localeCompare(a.start_date));
    const officials = {};
    await Promise.all(T.map(async t => { const { data } = await NRC.sb.rpc("event_officials", { p_tournament: t.id }); officials[t.id] = data || []; }));
    window._gCal = {};
    const card = (t, open) => {
      const a = A.find(x => x.tournament_id === t.id) || {};
      const B = (bk || []).filter(b => b.assignment_id === a.id), C = (cl || []).filter(c => c.assignment_id === a.id);
      const venue = [t.venue_name, t.venue_address, t.venue_city, t.venue_state].filter(Boolean).join(", ");
      window._gCal[t.id] = () => {
        const ev = [{ title: "Refereeing: " + t.name, start: new Date(t.start_date + "T08:00:00"), end: new Date(t.end_date + "T20:00:00"), location: venue, desc: "Organizer: " + (t.organizer_name || "") + " " + (t.organizer_email || "") + ". Details on the NRC Referee Hub.", url: location.origin + "/profile.html" }];
        B.forEach(b => { if (b.start_at) ev.push({ title: KIND[b.kind] + (b.provider ? ": " + b.provider : "") + (b.reference ? " (" + b.reference + ")" : ""), start: new Date(b.start_at), end: b.end_at ? new Date(b.end_at) : null, location: [b.from_place, b.to_place].filter(Boolean).join(" to "), desc: b.notes || "", url: location.origin + "/profile.html" }); });
        NRC.downloadIcs((t.name || "event").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".ics", ev);
      };
      const O = officials[t.id] || [];
      const who = O.length ? `<ul class="plain small" style="margin:4px 0 0">${O.map(o => `<li>${NRC.esc(o.last_name + ", " + o.first_name)}${o.is_me ? " <strong>(you)</strong>" : ""} <span class="muted">${NRC.esc(o.role === "delegate" ? "supervisor" : o.role)}${o.affiliation ? ", " + NRC.esc(o.affiliation) : ""}</span></li>`).join("")}</ul>` : '<p class="small muted">Not published yet.</p>';
      const travelBy = t.travel_managed_by === "nrc" ? "The NRC books travel; bookings appear below with their references." : t.travel_managed_by === "referee" ? "You book your own travel within what the organizer covers. Record each booking and submit your expenses with receipts." : "The organizer books travel with you; what is confirmed appears below.";
      const bookings = B.map(b => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><strong>${KIND[b.kind]}</strong>${b.provider ? ", " + NRC.esc(b.provider) : ""}${b.reference ? " <span class='pill'>" + NRC.esc(b.reference) + "</span>" : ""} <span class="pill ${b.status === "booked" ? "green" : "amber"}">${b.status}</span><div class="small">${fmtDT(b.start_at)}${b.end_at ? " to " + fmtDT(b.end_at) : ""}${b.from_place || b.to_place ? "<br>" + NRC.esc([b.from_place, b.to_place].filter(Boolean).join(" to ")) : ""}${b.notes ? "<br>" + NRC.esc(b.notes) : ""}</div></div>`).join("");
      const claims = C.map(c => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">${CK[c.kind] || c.kind}${c.description ? ", " + NRC.esc(c.description) : ""}: <strong>$${Number(c.amount).toFixed(2)}</strong> <span class="pill ${c.status === "rejected" ? "red" : c.status === "submitted" ? "amber" : "green"}">${c.status}</span>${c.review_note ? " <span class='muted'>" + NRC.esc(c.review_note) + "</span>" : ""}</div>`).join("");
      const isUp = t.end_date >= today;
      return `<details class="card g-event" ${open ? "open" : ""}><summary><div class="next" style="margin:0;box-shadow:none;padding:0;background:transparent"><div class="d">${new Date(t.start_date + "T00:00:00").getDate()}<small>${new Date(t.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short" })}</small></div><div><h3 style="margin:0">${NRC.esc(t.name)}</h3><div class="m small muted">${NRC.fmtDate(t.start_date)} to ${NRC.fmtDate(t.end_date)}, ${NRC.esc([t.venue_city, t.venue_state].filter(Boolean).join(", "))} ${NRC.sanctionPill(t.sanction)}${isUp ? "" : ' <span class="pill">past</span>'}</div></div></div></summary>
        <div class="grid c2" style="margin-top:12px">
          <div><h4 style="margin:0 0 6px">Event</h4><dl class="prof-facts small"><dt>Dates</dt><dd>${NRC.fmtDate(t.start_date)} to ${NRC.fmtDate(t.end_date)}</dd><dt>Venue</dt><dd>${NRC.esc(venue || "To be announced")}</dd>${t.nearest_airport_iata ? `<dt>Nearest airport</dt><dd>${NRC.esc(t.nearest_airport_iata)}</dd>` : ""}<dt>Organizer</dt><dd>${NRC.esc(t.organizer_name || "")}${t.organizer_email ? `<br><a href="mailto:${NRC.esc(t.organizer_email)}">${NRC.esc(t.organizer_email)}</a>` : ""}${t.organizer_phone ? "<br>" + NRC.esc(t.organizer_phone) : ""}</dd><dt>Your role</dt><dd>${NRC.esc(a.role || "referee")}, invited by the organizer</dd>${t.divisions && t.divisions.length ? `<dt>Divisions</dt><dd>${NRC.divisionPills(t.divisions)}</dd>` : ""}</dl>
            <h4 style="margin:14px 0 6px">What the organizer covers</h4><ul class="plain small" style="margin:0">${coverage(t).map(x => "<li>" + NRC.esc(x) + "</li>").join("")}</ul></div>
          <div><h4 style="margin:0 0 6px">Officials on this event</h4>${who}</div></div>
        <h4 style="margin:16px 0 6px">Travel</h4><p class="small muted" style="margin:0 0 6px">${travelBy}</p>${bookings}${a.travel_notes ? '<p class="small"><strong>Travel notes:</strong> ' + NRC.esc(a.travel_notes) + "</p>" : ""}
        ${claims ? '<h4 style="margin:14px 0 6px">Expenses</h4>' + claims : ""}
        ${isUp && a.id ? `<div class="trip-actions" style="margin-top:12px"><button class="btn sm secondary" type="button" onclick="_gCal['${t.id}']()">Add to my calendar</button><button class="btn sm secondary" type="button" onclick="openMyBooking('${a.id}')">Add a booking I made</button><button class="btn sm secondary" type="button" onclick="openClaim('${a.id}')">Submit an expense</button></div>
        <p class="small" style="margin:10px 0 0"><a class="muted" href="mailto:${NRC.esc(t.organizer_email || "")}?cc=referee@handballusa.org&subject=${encodeURIComponent("Cannot officiate: " + t.name)}">I can no longer officiate at this event</a></p>` : a.id ? `<div class="trip-actions" style="margin-top:12px"><button class="btn sm secondary" type="button" onclick="openClaim('${a.id}')">Submit an expense</button></div>` : ""}</details>`;
    };
    $("#g-events").innerHTML = (up.length ? up.map((t, i) => card(t, i === 0)).join("") : `<div class="alert info"><div><div class="t">No upcoming event</div><div class="small">Events you are named for by an organizer appear here with the venue, the team, travel and expenses.</div></div></div>`)
      + (past.length ? `<h3 style="margin:22px 0 8px">Past events</h3>` + past.map(t => card(t, false)).join("") : "");
    const n = up.length;
    $("#guest-sub").innerHTML = `Referee from outside USATH${G.federation ? ", " + NRC.esc(G.federation) : ""}. ${n ? n + " upcoming event" + (n > 1 ? "s" : "") + " below." : ""}`;
  }

  // ---------- profile tab ----------
  function renderProfile() {
    const f = [["Name", G.first_name + " " + G.last_name], ["Email", G.email], ["Phone", G.phone], ["Home", [G.home_city, G.country].filter(Boolean).join(", ")], ["Closest airport", G.home_airport_iata], ["Nation", G.federation], ["Level", NRC.GUEST_LEVEL[G.federation_level]], ["Reimbursement", G.payment_notes]];
    $("#g-profile").innerHTML = `<div class="card"><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:10px">${G.photo_url ? `<img class="avatar lg" src="${NRC.esc(G.photo_url)}" alt="">` : ""}<div><h3 style="margin:0">${NRC.esc(G.first_name + " " + G.last_name)}</h3><div class="small muted">Visible to you, the NRC and the organizers of your events</div></div></div>
      <dl class="prof-facts">${f.map(([k, v]) => `<dt>${k}</dt><dd>${v ? NRC.esc(v) : '<span class="muted">not given</span>'}</dd>`).join("")}</dl>
      <p style="margin-top:14px"><button class="btn" type="button" onclick="NRC.Guest.editProfile()">Edit my profile</button></p></div>`;
  }

  // ---------- training tab ----------
  async function renderTraining() {
    const uid = USER.id;
    const [{ data: as }, { data: tests }, { data: ans }] = await Promise.all([
      NRC.sb.from("assessments").select("pct,correct,total,passed,kind,created_at").eq("user_id", uid).order("created_at", { ascending: false }),
      NRC.sb.from("referee_tests").select("*").in("guest_official_id", ROWS.map(r => r.id)).order("tested_on", { ascending: false }),
      NRC.sb.from("quiz_attempts").select("id").eq("user_id", uid)]);
    const A = as || [], Tt = tests || [];
    $("#g-training").innerHTML = `<div class="card"><h3 style="margin-top:0">Training and tests</h3>
      <ul class="small" style="padding-left:18px;margin:0 0 12px"><li>Open to you like any USATH referee: practice quizzes, flashcards, the rules assessment and a study program on the rules you miss</li><li>Optional: no deadline, no reminder, no evaluation</li><li>Results visible to you and the NRC only</li></ul>
      <div class="trip-actions"><a class="btn sm" href="training.html">Practice quizzes</a><a class="btn sm secondary" href="training.html#program">Rules assessment</a></div></div>
      <div class="grid c2"><div class="card"><h3 style="margin-top:0">Rules assessments</h3>${A.length ? A.map(a => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${NRC.fmtDate(a.created_at.slice(0, 10))}</strong>, ${a.kind === "retest" ? "re-test" : "assessment"}: ${a.pct}% (${a.correct}/${a.total}) ${a.passed ? '<span class="pill green">cleared</span>' : ""}</div>`).join("") : '<p class="small muted">None taken.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">Physical test ${NRC.physicalInfo()}</h3>${Tt.filter(t => t.kind === "physical").map(t => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><strong>${NRC.fmtDate(t.tested_on)}</strong>, ${NRC.esc(t.test_name)}: ${NRC.esc(NRC.physResult(t))}${t.passed === true ? ' <span class="pill green">passed</span>' : t.passed === false ? ' <span class="pill red">not passed</span>' : ""}</div>`).join("") || '<p class="small muted">None recorded. Taken in person; tell the NRC or the organizer if you want to take it during your event.</p>'}</div></div>`;
    return { asmt: A[0] || null, tests: Tt, answers: (ans || []).length };
  }

  // ---------- profile dialog ----------
  function editProfile(first) {
    const f = $("#form-gprofile");
    ["first_name", "last_name", "phone", "home_city", "country", "home_airport_iata", "federation", "federation_level", "payment_notes"].forEach(k => f[k].value = G[k] || "");
    f.email.value = G.email || USER.email || ""; f.photo.value = "";
    $("#gp-photo").src = G.photo_url || ""; $("#gp-photo").classList.toggle("hidden", !G.photo_url);
    $("#gp-title").textContent = first ? "Welcome, " + G.first_name : "Your profile";
    $("#gp-intro").textContent = first ? "You are named by the organizer for an event on the USA Team Handball Referee Hub. A few details help the organizer and the NRC plan your travel and reach you. Everything can be changed later." : "Visible to you, the NRC and the organizers of your events.";
    $("#gp-later").textContent = first ? "Later" : "Cancel";
    $("#gp-msg").classList.add("hidden");
    $("#dlg-gprofile").showModal();
  }
  async function saveProfile(e) {
    e.preventDefault(); if (PREVIEW) return;
    const f = e.target, btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const p = { onboarded: true };
      ["first_name", "last_name", "phone", "home_city", "country", "home_airport_iata", "federation", "federation_level", "payment_notes"].forEach(k => p[k] = f[k].value.trim());
      const file = f.photo.files[0];
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase(), path = `${USER.id}/photo.${ext}`;
        const up = await NRC.sb.storage.from("referee-photos").upload(path, file, { upsert: true, contentType: file.type });
        if (up.error) { NRC.notice($("#gp-msg"), "Photo upload failed: " + NRC.esc(up.error.message), "error"); return; }
        p.photo_url = NRC.sb.storage.from("referee-photos").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
      }
      const { error } = await NRC.sb.rpc("save_my_guest_profile", { p });
      if (error) { NRC.notice($("#gp-msg"), "Not saved: " + NRC.esc(error.message), "error"); return; }
      $("#dlg-gprofile").close(); NRC.notice($("#msg"), "Profile saved.", "ok"); await reload();
    } finally { btn.disabled = false; }
  }

  async function reload() {
    const { data } = PREVIEW ? await NRC.sb.from("guest_officials").select("*").eq("id", G.id) : await NRC.sb.from("guest_officials").select("*").eq("user_id", USER.id).order("created_at", { ascending: false });
    ROWS = data || ROWS; G = ROWS[0] || G;
    $("#hello").textContent = "Hello " + G.first_name;
    renderProfile();
    const [, tr] = await Promise.all([renderEvents(), renderTraining()]);
    const html = `<div id="g-complete" style="margin-top:14px">${completion(tr.asmt, tr.tests, tr.answers)}</div>`;
    if ($("#g-complete")) $("#g-complete").outerHTML = html; else $("#guest-root .gtabs").insertAdjacentHTML("beforebegin", html);
  }

  NRC.Guest = {
    // rows: guest_officials rows of this person (most recent first); preview: admin read only view
    async start(user, rows, preview) {
      USER = user; ROWS = rows; G = rows[0]; PREVIEW = !!preview;
      document.title = "My events | NRC Referee Hub";
      shell();
      window.reloadTrip = reload;
      await reload();
      if (!G.onboarded_at && !PREVIEW) editProfile(true);
    },
    editProfile: () => editProfile(false)
  };
})();
