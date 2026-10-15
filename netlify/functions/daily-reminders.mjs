// Daily job (Netlify scheduled function): reminders that nobody has to remember to send.
//  1. Invitations unanswered for 7 days: reminder to the referee (once more after 14 days), then a digest to the NRC.
//  2. Events within 21 days where the NRC books travel and a designated official has no booked flight or hotel: NRC digest.
//  3. Organizer report missing 3 days after the event: reminder to the organizer (once).
//  4. Programs overdue: reminder to the referee (once), listed in the NRC digest.
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate } from "./mailer.mjs";

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();
const inDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export default async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return new Response("missing settings", { status: 500 });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const base = (SITE_URL || "").replace(/\/$/, "");
  const contact = process.env.CONTACT_EMAIL || "referee@handballusa.org";
  const digest = [];
  const already = async (kind, id) => { const { data } = await admin.from("reminder_log").select("id").eq("kind", kind).eq("target_id", id).limit(1); return !!(data && data.length); };
  const log = (kind, id, to) => admin.from("reminder_log").insert({ kind, target_id: id, sent_to: to });

  // 1. unanswered invitations
  const { data: waiting } = await admin.from("assignment_requests").select("id, token, sent_at, reminder_count, referees(first_name,email), tournaments(id,name,start_date,end_date,venue_city,venue_state)").eq("status", "sent").lte("sent_at", daysAgo(7));
  for (const r of waiting || []) {
    const kind = r.reminder_count >= 1 ? "invitation2" : "invitation";
    if (r.reminder_count >= 2 || await already(kind, r.id)) { digest.push(`Still no answer from ${r.referees.first_name} for ${r.tournaments.name}`); continue; }
    const t = r.tournaments;
    const html = `<p>Hi ${esc(r.referees.first_name)},</p><p>The NRC is waiting for your answer on <strong>${esc(t.name)}</strong>, ${fmtDate(t.start_date)} to ${fmtDate(t.end_date)}, ${esc(t.venue_city)}, ${esc(t.venue_state)}.</p><p><a href="${base}/respond.html?token=${r.token}&answer=accept">Accept</a> &nbsp; <a href="${base}/respond.html?token=${r.token}&answer=tentative">Tentative</a> &nbsp; <a href="${base}/respond.html?token=${r.token}&answer=decline">Decline</a></p><p>Or answer from your referee home: ${base}/profile.html</p><p>National Referee Committee</p>`;
    const res = await sendMail({ to: r.referees.email, subject: `Reminder: your answer for ${t.name}`, html });
    await admin.from("email_log").insert({ request_id: r.id, to_email: r.referees.email, subject: `Reminder: your answer for ${t.name}`, kind: "reminder_auto", sent: res.sent, error: res.error });
    if (res.sent) { await admin.from("assignment_requests").update({ reminder_count: (r.reminder_count || 0) + 1 }).eq("id", r.id); await log(kind, r.id, r.referees.email); }
    digest.push(`Reminder sent to ${r.referees.first_name} for ${t.name}`);
  }

  // 2. travel not booked, NRC books, event within 21 days
  const { data: soon } = await admin.from("tournaments").select("id,name,start_date,travel_managed_by").eq("travel_managed_by", "nrc").gte("start_date", inDays(0)).lte("start_date", inDays(21)).neq("status", "cancelled");
  for (const t of soon || []) {
    const { data: asg } = await admin.from("assignments").select("id, referees(first_name,last_name)").eq("tournament_id", t.id);
    for (const a of asg || []) {
      const { data: bk } = await admin.from("travel_bookings").select("kind,status").eq("assignment_id", a.id).eq("status", "booked");
      const kinds = new Set((bk || []).map(b => b.kind));
      const missing = ["flight", "hotel"].filter(k => !kinds.has(k));
      if (missing.length) digest.push(`${t.name} (${fmtDate(t.start_date)}): ${a.referees.first_name} ${a.referees.last_name} has no booked ${missing.join(" or ")}`);
    }
  }

  // 3. organizer report missing
  const { data: ended } = await admin.from("tournaments").select("id,name,end_date,organizer_name,organizer_email,status").lte("end_date", inDays(-3)).gte("end_date", inDays(-60)).neq("status", "cancelled");
  for (const t of ended || []) {
    const { data: rep } = await admin.from("tournament_reports").select("tournament_id").eq("tournament_id", t.id).maybeSingle();
    if (rep || await already("report", t.id)) continue;
    const html = `<p>Hi ${esc(t.organizer_name)},</p><p>Thank you for using NRC referees at <strong>${esc(t.name)}</strong>. Two minutes on your organizer page close the loop: games played, games per official, how the team did, anything to report. It feeds each referee's record.</p><p><a href="${base}/login.html?next=organizer.html">Open my tournaments</a> (sign in with this email, link and code, no password).</p><p>National Referee Committee</p>`;
    const res = await sendMail({ to: t.organizer_email, subject: `After ${t.name}: your two minute report`, html });
    await admin.from("email_log").insert({ to_email: t.organizer_email, subject: `After ${t.name}: your two minute report`, kind: "report_reminder", sent: res.sent, error: res.error });
    if (res.sent) await log("report", t.id, t.organizer_email);
    digest.push(`Report reminder sent to the organizer of ${t.name}`);
  }

  // 4. programs overdue
  const { data: overdue } = await admin.from("programs").select("id,user_id,due_on,status").in("status", ["active", "ready_for_retest"]).lt("due_on", inDays(0));
  for (const p of overdue || []) {
    const { data: prof } = await admin.from("profiles").select("email,full_name").eq("id", p.user_id).maybeSingle();
    if (!prof) continue;
    digest.push(`Program overdue: ${prof.full_name || prof.email} (due ${fmtDate(p.due_on)})`);
    if (await already("program", p.id)) continue;
    const html = `<p>Hi ${esc((prof.full_name || "").split(" ")[0] || "")},</p><p>Your training program on the hub was due on ${fmtDate(p.due_on)}. Finish the remaining modules and take the re-test when ready: <a href="${base}/training.html#program">${base}/training.html#program</a>. Questions: ${contact}.</p><p>National Referee Committee</p>`;
    const res = await sendMail({ to: prof.email, subject: "Your referee training program is overdue", html });
    await admin.from("email_log").insert({ to_email: prof.email, subject: "Your referee training program is overdue", kind: "program_reminder", sent: res.sent, error: res.error });
    if (res.sent) await log("program", p.id, prof.email);
  }

  // NRC digest
  if (digest.length) {
    const html = `<p>Daily reminders from the hub:</p><ul>${digest.map(d => "<li>" + esc(d) + "</li>").join("")}</ul><p>${base}/admin/</p>`;
    const res = await sendMail({ to: contact, subject: `NRC hub: ${digest.length} item(s) today`, html });
    await admin.from("email_log").insert({ to_email: contact, subject: `NRC hub: ${digest.length} item(s) today`, kind: "digest", sent: res.sent, error: res.error });
  }
  return new Response(JSON.stringify({ items: digest.length }), { headers: { "content-type": "application/json" } });
};

export const config = { schedule: "0 15 * * *" }; // 15:00 UTC, 8am Pacific
