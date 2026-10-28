// Shared logic for "the event changed" emails (not a function endpoint: imported by send-invitations and pending-changes).
// Who is told: designated officials (USATH referees and guest pairs), referees with an open invitation (sent, accepted or
// tentative, not yet designated), the NRC contact address and the organizer.
// Successive edits of one field collapse into one line (first value to last value); the current coverage is always
// repeated in full, because what the organizer pays is what referees act on.
import { sendMail, fmtDate, coverage } from "./mailer.mjs";

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Fields officials and organizers see. Anything else in the change log (club, sanction, divisions...) stays internal.
export const LABEL = { name: "Name", start_date: "Start date", end_date: "End date", venue_name: "Venue", venue_address: "Address", venue_city: "City", venue_state: "State", nearest_airport_iata: "Nearest airport", pairs_total: "Total pairs required", pairs_needed: "Pairs the NRC staffs", pairs_organizer: "Pairs the organizer brings from outside USATH", organizer_pairs_note: "Organizer pairs from", games_expected: "Games expected", supervisor_needed: "Supervisor needed", supervisor_notes: "Supervisor notes", hotel_nights_covered: "Hotel nights covered", flights_covered: "Flights covered", airport_transfers_covered: "Airport transfers covered", airport_transfer_how: "Airport transfers", hotel_to_venue_transport: "Hotel to venue", food_stipend_per_day: "Food stipend per day", meals_provided: "Meals", earliest_return_last_day: "Earliest departure on the last day", travel_managed_by: "Travel booked by", notes: "Notes", organizer_name: "Organizer", organizer_email: "Organizer email", organizer_phone: "Organizer phone" };
export const isPublic = c => Object.keys((c && c.changes) || {}).some(f => LABEL[f]);

const TRAVEL = { nrc: "the NRC", organizer: "the organizer", referee: "the referees" };
function fmtVal(f, v) {
  if (v == null || v === "") return "none";
  if (v === "true" || v === true) return "yes";
  if (v === "false" || v === false) return "no";
  if (f === "start_date" || f === "end_date") return fmtDate(String(v).slice(0, 10));
  if (f === "travel_managed_by") return TRAVEL[v] || v;
  if (f === "food_stipend_per_day") return "$" + Number(v).toFixed(0);
  if (f === "earliest_return_last_day") return String(v).slice(0, 5);
  return String(v);
}

// One line per field: value before the first pending edit, value after the last. Fields back to where they started drop out.
export function netChanges(rows) {
  const net = {};
  for (const c of [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))))
    for (const [f, v] of Object.entries(c.changes || {})) {
      if (!LABEL[f]) continue;
      if (!net[f]) net[f] = { from: v.from, to: v.to }; else net[f].to = v.to;
    }
  return Object.entries(net).filter(([, v]) => String(v.from ?? "") !== String(v.to ?? ""))
    .map(([f, v]) => `<li>${esc(LABEL[f])}: ${esc(fmtVal(f, v.from))} to <strong>${esc(fmtVal(f, v.to))}</strong></li>`);
}

// Sends the notice for one tournament and marks the pending change rows as sent.
// kind: "changes" | "cancel". actor: who changed it, for the NRC copy. force: send even when no official is involved.
export async function sendChangeNotice(admin, t, { kind, agreed = "", actor = "", force = true } = {}) {
  const base = (process.env.SITE_URL || "").replace(/\/$/, "");
  const contact = process.env.CONTACT_EMAIL || "referee@handballusa.org";
  const { data: ch } = await admin.from("tournament_changes").select("*").eq("tournament_id", t.id).is("notified_at", null).order("created_at");
  const pending = ch || [];
  const markSent = async (extra = {}) => { if (pending.length) await admin.from("tournament_changes").update({ notified_at: new Date().toISOString(), ...extra }).in("id", pending.map(c => c.id)); };
  const rows = netChanges(pending);
  const cancelled = kind === "cancel" || t.status === "cancelled";
  if (!cancelled && !rows.length) { await markSent(); return { results: [], nothing: true }; }

  // designated officials, then referees still in the invitation stage
  const { data: asg } = await admin.from("assignments").select("referee_id, referees(id, first_name, email), guest_officials(id, first_name, email)").eq("tournament_id", t.id);
  const designated = (asg || []).map(a => a.guest_officials || a.referees).filter(p => p && p.email);
  const desIds = new Set((asg || []).map(a => a.referee_id).filter(Boolean));
  const { data: reqs } = await admin.from("assignment_requests").select("status, referee_id, referees(id, first_name, email)").eq("tournament_id", t.id).in("status", ["sent", "accepted", "tentative"]);
  const invited = (reqs || []).filter(r => r.referees && r.referees.email && !desIds.has(r.referee_id)).map(r => ({ ...r.referees, status: r.status }));
  if (!force && !designated.length && !invited.length && t.created_by_nrc) { await markSent(); return { results: [], nothing: true, reason: "no official involved" }; }

  const when = `${fmtDate(t.start_date)} to ${fmtDate(t.end_date)}`;
  const where = [t.venue_name, t.venue_city, t.venue_state].filter(Boolean).join(", ");
  const covers = `<p><strong>What the organizer covers now</strong><br>${coverage(t).map(esc).join("<br>")}<br>Travel booked by ${TRAVEL[t.travel_managed_by] || "the organizer"}.</p>`;
  const list = `<ul>${rows.join("")}</ul>`;
  const subject = cancelled ? `Cancelled: ${t.name}, ${fmtDate(t.start_date)}` : `Update: ${t.name}, ${fmtDate(t.start_date)}`;
  const results = [];
  const send = async (to, subj, html) => { const r = await sendMail({ to, subject: subj, html }); await admin.from("email_log").insert({ to_email: to, subject: subj, kind, sent: r.sent, error: r.error }); results.push({ email: to, sent: r.sent, error: r.error }); };
  const sign = "<p>National Referee Committee</p>";

  for (const p of designated) await send(p.email, subject, `<p>Hi ${esc(p.first_name)},</p>` + (cancelled
    ? `<p><strong>${esc(t.name)}</strong> (${when}, ${esc(where)}) is cancelled. Your assignment is void; the NRC cancels any booking it made and confirms by email.</p>`
    : `<p>The details of <strong>${esc(t.name)}</strong> (${when}, ${esc(where)}) changed:</p>${list}${covers}<p>Your assignment stands unless the NRC tells you otherwise. Your trip is on your referee home: <a href="${base}/profile.html">${base}/profile.html</a>.</p>`) + sign);
  for (const p of invited) await send(p.email, subject, `<p>Hi ${esc(p.first_name)},</p>` + (cancelled
    ? `<p><strong>${esc(t.name)}</strong> (${when}, ${esc(where)}) is cancelled, so the invitation you received for it is withdrawn.</p>`
    : `<p>You have an invitation for <strong>${esc(t.name)}</strong> (${when}, ${esc(where)}). Its details changed:</p>${list}${covers}<p>${p.status === "sent" ? "Your answer is still expected" : "Your answer stays as recorded"}; you can answer or change it on your referee home: <a href="${base}/profile.html">${base}/profile.html</a>.</p>`) + sign);
  const told = `${designated.length} designated official(s) and ${invited.length} invited referee(s) were told.`;
  await send(contact, `[NRC hub] ${subject}`, `<p>${esc(actor || "Someone")} ${cancelled ? "cancelled" : "changed"} ${esc(t.name)}.</p>${cancelled ? "" : list}${agreed ? "<p>Agreed with the organizer: " + esc(agreed) + "</p>" : ""}<p>${told}</p>`);
  if (t.organizer_email && t.organizer_email.toLowerCase() !== contact.toLowerCase()) await send(t.organizer_email, subject, `<p>Hi ${esc(t.organizer_name || "")},</p>` + (cancelled
    ? `<p>Your request for <strong>${esc(t.name)}</strong> is recorded as cancelled. The NRC confirms the cancellation of any booking it made.</p>`
    : `<p>This confirms the changes to <strong>${esc(t.name)}</strong>${agreed ? ", as agreed with you (" + esc(agreed) + ")" : ""}:</p>${list}<p>The officials involved were told. Your page: <a href="${base}/organizer.html">${base}/organizer.html</a>.</p>`) + sign);
  await markSent(agreed ? { agreed_note: agreed } : {});
  return { results };
}
