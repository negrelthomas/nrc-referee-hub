// Sends staffing emails and records them. Called from the admin page.
// kinds: invite | reminder | confirm (to referees), organizer (to the tournament organizer with the designated referees)
// Env vars (Netlify > Site configuration > Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only), GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM, SITE_URL
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate, coverage } from "./mailer.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await admin.from("profiles").select("role,email").eq("id", who.user.id).maybeSingle();
  const { tournament_id, request_ids, assignment_ids, kind } = await req.json();
  if (!tournament_id || !kind) return json(400, { error: "tournament_id and kind required" });
  const { data: t } = await admin.from("tournaments").select("*").eq("id", tournament_id).single();
  if (!t) return json(404, { error: "Tournament not found" });
  const isAdmin = prof && prof.role === "admin";
  const isOwner = prof && (t.organizer_user_id === who.user.id || (t.organizer_email || "").toLowerCase() === (prof.email || "").toLowerCase());
  if (!isAdmin && !(isOwner && ["changes", "cancel"].includes(kind))) return json(403, { error: "Admin only" });
  const base = (SITE_URL || "").replace(/\/$/, "");
  const when = `${fmtDate(t.start_date)} to ${fmtDate(t.end_date)}`;
  const where = `${t.venue_name || ""}${t.venue_address ? ", " + t.venue_address : ""}, ${t.venue_city}, ${t.venue_state}${t.nearest_airport_iata ? " (nearest airport " + t.nearest_airport_iata + ")" : ""}`;
  const covers = coverage(t);
  const contact = process.env.CONTACT_EMAIL || "referee@handballusa.org";

  // Designated referees (confirmed) with their partner, used by the organizer and confirmation emails
  const { data: confirmedRows } = await admin.from("assignments").select("id, role, referees(id, first_name, last_name, email, phone, cert_level, home_city, home_state, home_airport_iata, clubs(name))").eq("tournament_id", tournament_id);
  const designated = (confirmedRows || []).map(a => ({ assignment_id: a.id, role: a.role, ...a.referees }));
  const LEVEL = { candidate: "Candidate", level_1: "Level 1", level_2: "Level 2", level_3: "Level 3", nachc: "NACHC", ihf: "IHF" };

  const LABEL = { name: "Name", start_date: "Start date", end_date: "End date", venue_name: "Venue", venue_address: "Address", venue_city: "City", venue_state: "State", nearest_airport_iata: "Nearest airport", pairs_needed: "Pairs the NRC staffs", pairs_organizer: "International pairs brought by the organizer", organizer_pairs_note: "Organizer pairs from", games_expected: "Games expected", supervisor_needed: "Supervisor needed", supervisor_notes: "Supervisor notes", hotel_nights_covered: "Hotel nights covered", flights_covered: "Flights covered", airport_transfers_covered: "Airport transfers covered", airport_transfer_how: "Airport transfers", hotel_to_venue_transport: "Hotel to venue", food_stipend_per_day: "Food stipend per day", meals_provided: "Meals", earliest_return_last_day: "Earliest departure last day", travel_managed_by: "Travel booked by", notes: "Notes", status: "Status", organizer_name: "Organizer", organizer_email: "Organizer email", organizer_phone: "Organizer phone" };
  const logAndSend = async (to, subject, html, kindLabel) => { const r = await sendMail({ to, subject, html }); await admin.from("email_log").insert({ to_email: to, subject, kind: kindLabel, sent: r.sent, error: r.error }); return { email: to, sent: r.sent, error: r.error }; };
  const recipients = () => { const list = designated.map(d => ({ email: d.email, name: d.first_name })); return list; };

  if (kind === "changes" || kind === "cancel") {
    const { data: ch } = await admin.from("tournament_changes").select("*").eq("tournament_id", tournament_id).is("notified_at", null).order("created_at");
    const rows = (ch || []).flatMap(c => Object.entries(c.changes || {}).map(([f, v]) => `<li>${esc(LABEL[f] || f)}: ${esc(v.from == null ? "none" : v.from)} to ${esc(v.to == null ? "none" : v.to)}</li>`));
    const cancelled = kind === "cancel" || t.status === "cancelled";
    const subject = cancelled ? `Cancelled: ${t.name}, ${fmtDate(t.start_date)}` : `Update: ${t.name}, ${fmtDate(t.start_date)}`;
    const body = cancelled ? `<p><strong>${esc(t.name)}</strong> (${when}, ${esc(t.venue_city)}, ${esc(t.venue_state)}) is cancelled by the organizer. Any assignment for this event is void; the NRC cancels bookings it made and will confirm by email.</p>` : `<p>The details of <strong>${esc(t.name)}</strong> (${when}, ${esc(where)}) changed:</p><ul>${rows.join("") || "<li>See the event page for the current details.</li>"}</ul><p>Your assignment stands unless the NRC tells you otherwise. Check your trip on your referee home: <a href="${base}/profile.html">${base}/profile.html</a>.</p>`;
    const results = [];
    for (const r of recipients()) results.push(await logAndSend(r.email, subject, `<p>Hi ${esc(r.name)},</p>${body}<p>National Referee Committee</p>`, kind));
    results.push(await logAndSend(contact, `[NRC hub] ${subject}`, `<p>${isOwner ? "The organizer" : "An administrator"} ${isOwner ? esc(t.organizer_name) : ""} ${cancelled ? "cancelled" : "changed"} ${esc(t.name)}.</p>${cancelled ? "" : "<ul>" + rows.join("") + "</ul>"}<p>${designated.length} designated official(s) were notified.</p>`, kind));
    if (!isAdmin || true) results.push(await logAndSend(t.organizer_email, subject, `<p>Hi ${esc(t.organizer_name)},</p>${cancelled ? `<p>Your request for <strong>${esc(t.name)}</strong> is recorded as cancelled. The NRC confirms the cancellation of any booking it made.</p>` : `<p>This confirms the changes to <strong>${esc(t.name)}</strong>:</p><ul>${rows.join("")}</ul><p>The designated officials were told. Your page: <a href="${base}/organizer.html">${base}/organizer.html</a>.</p>`}<p>National Referee Committee</p>`, kind));
    if (ch && ch.length) await admin.from("tournament_changes").update({ notified_at: new Date().toISOString() }).in("id", ch.map(c => c.id));
    return json(200, { results });
  }

  if (kind === "brief") {
    if (!Array.isArray(assignment_ids) || !assignment_ids.length) return json(400, { error: "assignment_ids required" });
    const results = [];
    for (const a of designated.filter(d => assignment_ids.includes(d.assignment_id))) {
      const roleWord = a.role === "referee" ? "referee" : a.role === "delegate" ? "supervisor" : a.role;
      const others = designated.filter(d => d.id !== a.id).map(d => esc(d.first_name + " " + d.last_name) + (d.role && d.role !== "referee" ? " (" + (d.role === "delegate" ? "supervisor" : d.role) + ")" : "")).join(", ");
      const duties = a.role === "referee" ? "" : `<p><strong>Your role:</strong> you oversee the referee pairs, handle protests with the organizer, and record an evaluation for each pair on the hub after the event.${t.supervisor_notes ? " Organizer notes: " + esc(t.supervisor_notes) : ""}</p>`;
      const subject = `Confirmed as ${roleWord}: ${t.name}, ${fmtDate(t.start_date)}`;
      const html = `<p>Hi ${esc(a.first_name)},</p><p>You are confirmed as <strong>${roleWord}</strong> for <strong>${esc(t.name)}</strong>.</p>
        <p><strong>When:</strong> ${when}${t.earliest_return_last_day ? "<br>Do not book a departure before " + String(t.earliest_return_last_day).slice(0, 5) + " on the last day." : ""}<br><strong>Where:</strong> ${esc(where)}<br>${t.games_expected ? "<strong>Games:</strong> about " + t.games_expected + "<br>" : ""}${others ? "<strong>Officials:</strong> " + others + "<br>" : ""}<strong>Organizer:</strong> ${esc(t.organizer_name)}, ${esc(t.organizer_email)}${t.organizer_phone ? ", " + esc(t.organizer_phone) : ""}</p>${duties}
        <p><strong>What the organizer covers</strong><br>${covers.map(esc).join("<br>")}<br>Travel booked by: ${t.travel_managed_by === "nrc" ? "the NRC" : t.travel_managed_by === "referee" ? "you (keep your receipts and record your bookings on the hub)" : "the organizer"}.</p>
        <p>Your trip and bookings are on your referee home: <a href="${base}/profile.html">${base}/profile.html</a>.</p><p>National Referee Committee</p>`;
      results.push(await logAndSend(a.email, subject, html, "brief"));
    }
    return json(200, { results });
  }

  if (kind === "organizer") {
    const link = `${base}/tournament.html?token=${t.organizer_token}`;
    const rows = designated.map(r => `<tr><td style="padding:4px 10px 4px 0">${esc(r.first_name + " " + r.last_name)}</td><td style="padding:4px 10px 4px 0">${esc(r.role === "delegate" ? "supervisor" : r.role)}</td><td style="padding:4px 10px 4px 0">${esc(r.clubs ? r.clubs.name : "")}</td><td style="padding:4px 0">${esc([r.home_city, r.home_state].filter(Boolean).join(", "))}${r.home_airport_iata ? " (" + esc(r.home_airport_iata) + ")" : ""}</td></tr>`).join("");
    const subject = `Referees designated for ${t.name}, ${fmtDate(t.start_date)}`;
    const html = `<p>Hi ${esc(t.organizer_name)},</p><p>The National Referee Committee has designated the referees for <strong>${esc(t.name)}</strong>, ${when}, at ${esc(where)}.</p>
      <table style="border-collapse:collapse;font-size:14px">${rows}</table>
      <p>Names, contact details, travel bookings and expenses are on your organizer page: <a href="${base}/login.html?next=organizer.html">${base}/organizer.html</a> (sign in with this email address, link and code, no password). You can also edit the request, report after the event and duplicate it for next year from there.</p>
      <p>No account needed for a quick look: <a href="${link}">${link}</a> (keep this link private).</p>
      <p>What the referees have been told you cover:<br>${covers.map(esc).join("<br>")}</p>
      <p>Questions or changes: ${contact}.</p><p>National Referee Committee</p>`;
    const r = await sendMail({ to: t.organizer_email, subject, html });
    await admin.from("email_log").insert({ to_email: t.organizer_email, subject, kind, sent: r.sent, error: r.error });
    if (r.sent) await admin.from("tournaments").update({ organizer_notified_at: new Date().toISOString() }).eq("id", t.id);
    return json(200, { results: [{ email: t.organizer_email, sent: r.sent, error: r.error }] });
  }

  if (!Array.isArray(request_ids) || !request_ids.length) return json(400, { error: "request_ids required" });
  const { data: reqs } = await admin.from("assignment_requests").select("*, referees(*)").in("id", request_ids).eq("tournament_id", tournament_id);
  const { data: pairs } = await admin.from("pairs").select("*").is("valid_until", null);
  if (kind === "confirm") (reqs || []).forEach(r => { if (r.referees && !designated.find(d => d.id === r.referees.id)) designated.push({ role: "referee", ...r.referees }); });
  const partnerOf = id => { const p = (pairs || []).find(p => p.referee_a === id || p.referee_b === id); if (!p) return null; const pid = p.referee_a === id ? p.referee_b : p.referee_a; return designated.find(d => d.id === pid) || null; };
  const travelLine = t.travel_managed_by === "nrc"
    ? `The NRC books your flights and hotel and you see each booking on your referee home as it is made; do not book anything yourself unless the NRC asks you to.`
    : t.travel_managed_by === "referee"
    ? `You book your own travel within what the organizer covers above, and the organizer reimburses it. Record each booking on your referee home (Add a booking I made) and submit your expenses with receipts there, so the NRC and the organizer see them.`
    : `The organizer books travel directly with you within what they cover above; send them your travel details and copy ${contact}. Record what gets booked on your referee home so the NRC sees it.`;

  // Availability for the tournament dates, per referee: blocked dates, weekend declarations (Saturday keys)
  const sat = d => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + ((6 - x.getUTCDay() + 7) % 7)); return x.toISOString().slice(0, 10); };
  const wk = []; for (let d = new Date(t.start_date + "T12:00:00Z"); d <= new Date(t.end_date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) { const k = sat(d.toISOString().slice(0, 10)); if (!wk.includes(k)) wk.push(k); }
  const ids = new Set(); (reqs || []).forEach(r => { if (r.referees) ids.add(r.referees.id); });
  (pairs || []).forEach(p => { if (ids.has(p.referee_a)) ids.add(p.referee_b); if (ids.has(p.referee_b)) ids.add(p.referee_a); });
  const [{ data: blocks }, { data: weekends }, { data: pairRefs }, { data: overrides }] = await Promise.all([
    admin.from("availability_blocks").select("referee_id,start_date,end_date").in("referee_id", [...ids]).lte("start_date", t.end_date).gte("end_date", t.start_date),
    admin.from("weekend_availability").select("referee_id,weekend,status").in("referee_id", [...ids]).in("weekend", wk),
    admin.from("referees").select("id,first_name,last_name").in("id", [...ids]),
    admin.from("availability_overrides").select("referee_id,status").eq("tournament_id", t.id).neq("status", "reverted")]);
  const availOf = id => { if ((overrides || []).some(o => o.referee_id === id)) return { ok: true, word: "available (NRC override)" }; const b = (blocks || []).find(x => x.referee_id === id); if (b) return { ok: false, word: `blocked dates from ${fmtDate(b.start_date)} to ${fmtDate(b.end_date)} on the hub` };
    const w = (weekends || []).filter(x => x.referee_id === id); if (!w.length) return { ok: false, word: "not declared on the hub" };
    if (w.some(x => x.status === "unavailable")) return { ok: false, word: "marked unavailable on the hub" };
    if (w.every(x => x.status === "available")) return { ok: true, word: "available" }; return { ok: false, word: "marked tentative on the hub" }; };
  const pairPartner = id => { const p = (pairs || []).find(p => p.referee_a === id || p.referee_b === id); if (!p) return null; const pid = p.referee_a === id ? p.referee_b : p.referee_a; return (pairRefs || []).find(x => x.id === pid) || null; };

  const results = [];
  for (const r of reqs || []) {
    const ref = r.referees; if (!ref) continue;
    const accept = `${base}/respond.html?token=${r.token}&answer=accept`;
    const tentative = `${base}/respond.html?token=${r.token}&answer=tentative`;
    const decline = `${base}/respond.html?token=${r.token}&answer=decline`;
    let subject, html;
    if (kind === "confirm") {
      const partner = partnerOf(ref.id);
      const others = designated.filter(d => d.id !== ref.id).map(d => esc(d.first_name + " " + d.last_name)).join(", ");
      subject = `Confirmed: ${t.name}, ${fmtDate(t.start_date)}`;
      const recorded = /^Recorded by /.test(r.response_note || "") ? `<p>You accepted this assignment outside the hub (${esc(String(r.response_note).replace(/^Recorded by [^:]*:\s*/, ""))}). The NRC has recorded it so the hub shows you as confirmed. If this is not right, reply to this email.</p>` : "";
      html = `<p>Hi ${esc(ref.first_name)},</p><p>You are confirmed as a referee for <strong>${esc(t.name)}</strong>.</p>${recorded}
        <p><strong>When:</strong> ${when}${t.earliest_return_last_day ? "<br>Do not book a departure before " + String(t.earliest_return_last_day).slice(0, 5) + " on the last day." : ""}<br>
        <strong>Where:</strong> ${esc(where)}<br>
        ${t.games_expected ? "<strong>Games:</strong> about " + t.games_expected + " over the event<br>" : ""}
        ${partner ? "<strong>Your partner:</strong> " + esc(partner.first_name + " " + partner.last_name) + "<br>" : ""}
        ${others ? "<strong>Referee team:</strong> " + others + "<br>" : ""}
        <strong>Organizer:</strong> ${esc(t.organizer_name)}, ${esc(t.organizer_email)}${t.organizer_phone ? ", " + esc(t.organizer_phone) : ""}</p>
        <p><strong>What the organizer covers</strong><br>${covers.map(esc).join("<br>")}</p>
        ${t.notes ? "<p><strong>From the organizer:</strong> " + esc(t.notes) + "</p>" : ""}
        <p><strong>Travel:</strong> ${travelLine}</p>
        <p>Your assignment, trip details and the calendar file are on your referee home: <a href="${base}/profile.html">${base}/profile.html</a>.</p><p>National Referee Committee</p>`;
    } else if (kind === "release") {
      subject = `${t.name}: the referee team is complete`;
      html = `<p>Hi ${esc(ref.first_name)},</p><p>Thank you for considering <strong>${esc(t.name)}</strong>, ${when}. The NRC has completed the referee team for this event, so your invitation is closed and nothing is expected from you.</p><p>Your availability stays on file for the next events. Questions: ${contact}.</p><p>National Referee Committee</p>`;
    } else {
      const again = kind === "reminder" ? "<p>This is a reminder; the NRC has not received your answer yet.</p>" : "";
      const mine = availOf(ref.id), mate = pairPartner(ref.id), mateAv = mate ? availOf(mate.id) : null;
      const pairP = mate ? `<p>You are invited as a pair with <strong>${esc(mate.first_name + " " + mate.last_name)}</strong>, who receives the same invitation. The pair is confirmed only once both of you accept.${mateAv && !mateAv.ok ? " " + esc(mate.first_name) + "'s availability for these dates is " + mateAv.word + "; please check with them." : ""}</p>` : "";
      const checkP = !mine.ok ? `<p><strong>Please confirm your availability.</strong> Your availability for ${when} is ${mine.word}. If you can officiate on these dates, press Accept; if you are not sure yet, press Tentative and let us know when you will know; if you cannot, press Decline.</p>` : "";
      subject = `${kind === "reminder" ? "Reminder: " : ""}Referee invitation, ${t.name}, ${fmtDate(t.start_date)}`;
      html = `<p>Hi ${esc(ref.first_name)},</p>${again}<p>The NRC proposes you as a referee for <strong>${esc(t.name)}</strong>, ${when}, at ${esc(where)}. ${t.games_expected ? "About " + t.games_expected + " games over the event." : ""}</p>
        ${pairP}${checkP}
        <p>What the organizer covers:<br>${covers.map(esc).join("<br>")}</p>
        <p><a href="${accept}" style="background:#C8102E;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Accept</a>&nbsp;&nbsp;<a href="${tentative}" style="background:#04234F;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Tentative</a>&nbsp;&nbsp;<a href="${decline}" style="color:#04234F;padding:12px 18px;text-decoration:underline">Decline</a></p>
        <p>The proposal is also on your referee home, where you can review the details and answer: <a href="${base}/login.html?next=profile.html">sign in</a>.</p>
        <p>Please answer within 7 days. Nothing to book until the NRC confirms the final selection. Questions: ${contact}.</p><p>National Referee Committee</p>`;
    }
    const r2 = await sendMail({ to: ref.email, subject, html });
    const patch = kind === "confirm" ? { status: "confirmed" } : kind === "release" ? { status: "cancelled" } : kind === "reminder" ? { reminder_count: (r.reminder_count || 0) + 1 } : { status: "sent", sent_at: new Date().toISOString() };
    if (r2.sent) await admin.from("assignment_requests").update(patch).eq("id", r.id);
    await admin.from("email_log").insert({ request_id: r.id, to_email: ref.email, subject, kind, sent: r2.sent, error: r2.error });
    results.push({ request_id: r.id, email: ref.email, sent: r2.sent, error: r2.error });
  }
  return json(200, { results });
};

export const config = { path: "/api/send-invitations" };
