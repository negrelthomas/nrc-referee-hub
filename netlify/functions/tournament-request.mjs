// Organizer request form: stores the request (the database guard refuses a request without a USATH registered club
// and a second request for the same event), emails the NRC straight away and acknowledges to the organizer.
// A request for an event the NRC already placed on the calendar takes over that event (claim_id from the outreach link).
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate } from "./mailer.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FIELDS = ["name", "sanction", "region", "divisions", "club_id", "organizer_name", "organizer_email", "organizer_phone", "venue_name", "venue_address", "venue_city", "venue_state", "nearest_airport_iata",
  "start_date", "end_date", "pairs_needed", "games_expected", "hotel_nights_covered", "flights_covered", "airport_transfers_covered", "airport_transfer_how", "hotel_to_venue_transport",
  "food_stipend_per_day", "meals_provided", "earliest_return_last_day", "budget_owner", "notes", "supervisor_needed", "supervisor_notes", "travel_managed_by", "pairs_organizer", "organizer_pairs_note"];

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let body; try { body = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const row = {};
  FIELDS.forEach(k => { if (body[k] !== undefined && body[k] !== "") row[k] = body[k]; });
  if (!row.name || !row.organizer_email || !row.start_date || !row.end_date) return json(400, { error: "Name, organizer email and dates are required." });
  if (row.end_date < row.start_date) return json(400, { error: "The end date is before the start date." });
  row.pairs_organizer = Math.max(0, Math.min(20, parseInt(row.pairs_organizer, 10) || 0));
  if (row.pairs_organizer && !String(row.organizer_pairs_note || "").trim()) return json(400, { error: "Give the country or federation of the pairs you bring. Only pairs based outside the United States can be brought by the organizer." });
  if (!row.pairs_organizer) row.organizer_pairs_note = null;
  if (row.travel_managed_by && !["organizer", "nrc", "referee"].includes(row.travel_managed_by)) row.travel_managed_by = "organizer";
  row.organizer_email = String(row.organizer_email).trim().toLowerCase();
  row.status = "submitted";
  // a signed in organizer owns the request
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token) { const { data: who } = await admin.auth.getUser(token); if (who && who.user) row.organizer_user_id = who.user.id; }

  // An event the NRC pre-positioned on the calendar (from the outreach link, or the same event name within two months,
  // or the same club on overlapping dates) is claimed by this request instead of being refused as a duplicate.
  const norm = s => String(s || "").toLowerCase().replace(/20\d\d/g, "").replace(/[^a-z0-9]/g, "");
  const shift = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  let claimId = null;
  if (body.claim_id) {
    const { data: c } = await admin.from("tournaments").select("id,created_by_nrc,status").eq("id", body.claim_id).maybeSingle();
    if (c && c.created_by_nrc && c.status !== "cancelled") claimId = c.id;
  }
  if (!claimId) {
    const { data: ph } = await admin.from("tournaments").select("id,name,club_id,start_date,end_date").eq("created_by_nrc", true).neq("status", "cancelled")
      .gte("start_date", shift(row.start_date, -60)).lte("start_date", shift(row.end_date, 60));
    const m = (ph || []).find(x => norm(x.name) === norm(row.name) || (row.club_id && x.club_id === row.club_id && x.start_date <= row.end_date && x.end_date >= row.start_date));
    if (m) claimId = m.id;
  }
  let t, error;
  if (claimId) {
    Object.assign(row, { created_by_nrc: false, date_status: "confirmed", nrc_staffs: true });
    ({ data: t, error } = await admin.from("tournaments").update(row).eq("id", claimId).select("*, clubs(name)").single());
  } else {
    ({ data: t, error } = await admin.from("tournaments").insert(row).select("*, clubs(name)").single());
  }
  if (error) return json(error.code === "P0001" ? 409 : 400, { error: error.message });

  const base = (SITE_URL || "").replace(/\/$/, "");
  const { data: st } = await admin.from("staffing_settings").select("*").eq("id", 1).maybeSingle();
  const contact = (st && st.remind_to) || process.env.CONTACT_EMAIL || "referee@handballusa.org";
  const when = `${fmtDate(t.start_date)} to ${fmtDate(t.end_date)}`;
  const nrcHtml = `<p>New tournament request on the hub.</p>
<p><strong>${esc(t.name)}</strong><br>${when}<br>${esc([t.venue_name, t.venue_city, t.venue_state].filter(Boolean).join(", "))}<br>Club: ${esc(t.clubs ? t.clubs.name : "none")}<br>
${t.pairs_needed} pair(s) for the NRC to staff${t.pairs_organizer ? ", plus " + t.pairs_organizer + " international pair(s) brought by the organizer (" + esc(t.organizer_pairs_note || "") + ")" : ""}${t.supervisor_needed ? " and a supervisor" : ""}<br>Travel booked by: ${t.travel_managed_by === "nrc" ? "the NRC" : t.travel_managed_by === "referee" ? "each referee" : "the organizer"}, ${(t.divisions || []).join(", ") || "divisions not given"}<br>
Organizer: ${esc(t.organizer_name)} (${esc(t.organizer_email)})<br>Staff by: <strong>${fmtDate(t.staff_by)}</strong></p>
<p><a href="${base}/admin/#staffing">Open the Staffing page</a></p>`;
  const r1 = await sendMail({ to: contact, subject: `New tournament request: ${t.name}`, html: nrcHtml, replyTo: t.organizer_email });
  await admin.from("email_log").insert({ to_email: contact, subject: `New tournament request: ${t.name}`, kind: "new_request", sent: r1.sent, error: r1.error });
  const orgHtml = `<p>Hello ${esc(t.organizer_name)},</p><p>The NRC received your request for <strong>${esc(t.name)}</strong>, ${when}. You will hear from the NRC by email as referees are designated.</p>
<p>Follow the request, see who is designated and their travel details on your organizer page: <a href="${base}/login.html?next=organizer.html">sign in with ${esc(t.organizer_email)}</a> (link and code, no password).</p>`;
  const r2 = await sendMail({ to: t.organizer_email, subject: `Request received: ${t.name}`, html: orgHtml, replyTo: contact });
  await admin.from("email_log").insert({ to_email: t.organizer_email, subject: `Request received: ${t.name}`, kind: "request_ack", sent: r2.sent, error: r2.error });
  await admin.from("reminder_log").insert({ kind: "staffing", target_id: t.id, sent_to: contact });
  return json(200, { ok: true, id: t.id, staff_by: t.staff_by });
};

export const config = { path: "/api/tournament-request" };
