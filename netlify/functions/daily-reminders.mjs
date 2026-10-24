// Daily job (Netlify scheduled function): reminders that nobody has to remember to send.
//  1. Invitations unanswered for 7 days: reminder to the referee (once more after 14 days), then a digest to the NRC.
//  2. Events within 21 days where the NRC books travel and a designated official has no booked flight or hotel: NRC digest.
//  3. Organizer report missing 3 days after the event: reminder to the organizer (once).
//  4. Programs overdue: reminder to the referee (once), listed in the NRC digest.
//  5. Tournaments not fully staffed: staffing reminder to the NRC at the cadence set on the admin Staffing page.
//  6. Initial assessment: certified referees who have signed in but not taken the baseline assessment get a reminder
//     every 48 hours (first one the day after their first sign in), with a link straight to the test. Due 7 days after
//     the first sign in; overdue referees are listed in the NRC digest.
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
  const { data: soon } = await admin.from("tournaments").select("id,name,start_date,travel_managed_by").in("travel_managed_by", ["nrc", "referee"]).gte("start_date", inDays(0)).lte("start_date", inDays(21)).neq("status", "cancelled");
  for (const t of soon || []) {
    const { data: asg } = await admin.from("assignments").select("id, referees(first_name,last_name), guest_officials(first_name,last_name)").eq("tournament_id", t.id);
    for (const a of asg || []) {
      const { data: bk } = await admin.from("travel_bookings").select("kind,status").eq("assignment_id", a.id).eq("status", "booked");
      const kinds = new Set((bk || []).map(b => b.kind));
      const missing = ["flight", "hotel"].filter(k => !kinds.has(k));
      if (missing.length) digest.push(`${t.name} (${fmtDate(t.start_date)}): ${(a.referees || a.guest_officials).first_name} ${(a.referees || a.guest_officials).last_name}${a.guest_officials ? " (guest)" : ""} has no booked ${missing.join(" or ")}`);
    }
  }

  // 3. organizer report missing
  const { data: ended } = await admin.from("tournaments").select("id,name,end_date,organizer_name,organizer_email,status").lte("end_date", inDays(-3)).gte("end_date", inDays(-60)).neq("status", "cancelled").eq("date_status", "confirmed");
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

  // 5. Tournaments not fully staffed: admin reminder at the cadence set on the Staffing page
  //    (every N days after the request, daily in the last M days before the deadline to staff, daily once overdue)
  const { data: st } = await admin.from("staffing_settings").select("*").eq("id", 1).maybeSingle();
  if (st) {
    const today = inDays(0);
    const { data: open } = await admin.from("tournament_overview_service").select("*").in("status", ["submitted", "reviewing"]).gte("start_date", today).order("staff_by");
    const due = [];
    for (const t of open || []) {
      if (t.confirmed >= t.referees_needed) continue;
      const sinceReq = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 864e5);
      const toDeadline = Math.round((new Date(t.staff_by + "T12:00:00") - new Date(today + "T12:00:00")) / 864e5);
      const { data: last } = await admin.from("reminder_log").select("created_at").eq("kind", "staffing").eq("target_id", t.id).order("created_at", { ascending: false }).limit(1);
      const sinceLast = last && last.length ? Math.floor((Date.now() - new Date(last[0].created_at).getTime()) / 864e5) : sinceReq;
      const isDue = toDeadline <= st.remind_daily_within_days ? sinceLast >= 1 : sinceLast >= st.remind_every_days;
      if (isDue) due.push({ ...t, toDeadline });
    }
    if (due.length) {
      const to = st.remind_to || contact;
      const cell = 'style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:left"';
      const rows = due.map(t => `<tr><td ${cell}><strong>${esc(t.name)}</strong><br>${esc(t.club_name || "")}</td><td ${cell}>${fmtDate(t.start_date)}</td><td ${cell}>${fmtDate(t.staff_by)}<br>${t.toDeadline < 0 ? `<strong style="color:#C8102E">${-t.toDeadline} days late</strong>` : t.toDeadline + " days left"}</td><td ${cell}>${t.confirmed}/${t.referees_needed}</td><td ${cell}>${t.available}</td><td ${cell}>${t.contacted}</td><td ${cell}>${t.accepted}</td><td ${cell}>${t.tentative}</td><td ${cell}>${t.declined}</td></tr>`).join("");
      const html = `<p>${due.length} tournament(s) still to staff.</p><table style="border-collapse:collapse;font-size:14px"><tr><th ${cell}>Tournament</th><th ${cell}>Starts</th><th ${cell}>Staff by</th><th ${cell}>Designated</th><th ${cell}>Available</th><th ${cell}>Contacted</th><th ${cell}>Accepted</th><th ${cell}>Tentative</th><th ${cell}>Declined</th></tr>${rows}</table><p><a href="${base}/admin/#tournaments">Open Tournaments in the admin</a></p>`;
      const res = await sendMail({ to, subject: `NRC hub: ${due.length} tournament(s) to staff`, html });
      await admin.from("email_log").insert({ to_email: to, subject: `NRC hub: ${due.length} tournament(s) to staff`, kind: "staffing_reminder", sent: res.sent, error: res.error });
      if (res.sent) for (const t of due) await log("staffing", t.id, to);
    }
  }

  // 6. Initial assessment within 7 days of the first sign in, reminder every 48 hours until taken
  {
    const { data: rs } = await admin.from("referees").select("id,first_name,email,user_id,cert_level").eq("active", true).neq("cert_level", "candidate").not("user_id", "is", null);
    const list = (rs || []).filter(r => r.email && !/@demo\.nrc$/i.test(r.email));
    if (list.length) {
      const uids = list.map(r => r.user_id);
      const [{ data: done }, { data: profs }] = await Promise.all([
        admin.from("assessments").select("user_id").in("user_id", uids),
        admin.from("profiles").select("id,created_at").in("id", uids)]);
      const took = new Set((done || []).map(a => a.user_id));
      const firstAt = {}; (profs || []).forEach(p => firstAt[p.id] = p.created_at);
      const link = `${base}/login.html?next=${encodeURIComponent("training.html#program")}`;
      for (const r of list) {
        if (took.has(r.user_id) || !firstAt[r.user_id]) continue;
        const first = new Date(firstAt[r.user_id]).getTime();
        if (Date.now() - first < 20 * 3600e3) continue;               // give a day after the first sign in
        const due = new Date(first + 7 * 864e5);
        const late = Date.now() > due.getTime();
        if (late) digest.push(`Initial assessment overdue: ${r.first_name} (${r.email}), due ${fmtDate(due.toISOString().slice(0, 10))}`);
        const { data: last } = await admin.from("reminder_log").select("created_at").eq("kind", "assessment").eq("target_id", r.id).order("created_at", { ascending: false }).limit(1);
        if (last && last.length && Date.now() - new Date(last[0].created_at).getTime() < 47 * 3600e3) continue;   // every 48 hours (job runs daily)
        const subject = late ? "Your initial rules assessment is overdue" : `Your initial rules assessment, due ${fmtDate(due.toISOString().slice(0, 10))}`;
        const html = `<p>Hi ${esc(r.first_name)},</p><p>${late ? "Your initial assessment on the NRC Referee Hub was due on " + fmtDate(due.toISOString().slice(0, 10)) + " and is not done yet." : "Please take your initial assessment on the NRC Referee Hub by " + fmtDate(due.toISOString().slice(0, 10)) + "."} It gives the NRC a first picture of where every referee stands on the rules, and builds your own study program on the rules you miss.</p><ul><li>50 questions on the IHF rules at your level</li><li>60 minutes, in one sitting</li><li>Results by rule right after, visible to you and the NRC only</li></ul><p><a href="${link}" style="display:inline-block;background:#04234F;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Take the assessment</a></p><p style="font-size:13px;color:#666">The link signs you in if needed, then opens the assessment. Questions: ${esc(contact)}. This reminder repeats every two days until the assessment is done.</p><p>National Referee Committee</p>`;
        const res = await sendMail({ to: r.email, subject, html });
        await admin.from("email_log").insert({ to_email: r.email, subject, kind: "assessment_reminder", sent: res.sent, error: res.error });
        if (res.sent) await log("assessment", r.id, r.email);
      }
    }
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
