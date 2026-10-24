// Records a referee's answer from the email link (no sign in needed; the token is the secret).
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate } from "./mailer.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTACT_EMAIL, SITE_URL } = process.env;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { token, answer, note } = await req.json();
  if (!token || !["accept", "decline", "tentative", "withdraw"].includes(answer)) return json(400, { error: "token and answer required" });
  const { data: r } = await admin.from("assignment_requests").select("id,status,referee_id,tournament_id,tournaments(name,start_date,end_date,venue_city,venue_state),referees(first_name,last_name,email)").eq("token", token).maybeSingle();
  if (!r) return json(404, { error: "This link is not valid." });
  // A designated referee declines from the designation email: the designation is released and the NRC is told at once
  if (answer === "withdraw") {
    if (r.status !== "confirmed") return json(200, { already: true, status: r.status === "declined" ? "declined" : "not designated", tournament: r.tournaments, name: r.referees?.first_name });
    const now = new Date().toISOString();
    await admin.from("assignment_requests").update({ status: "declined", responded_at: now, response_note: "Declined after designation" + (note ? ": " + note : "") }).eq("id", r.id);
    await admin.from("assignments").delete().eq("tournament_id", r.tournament_id).eq("referee_id", r.referee_id);
    const t = r.tournaments || {}, who = [r.referees?.first_name, r.referees?.last_name].filter(Boolean).join(" ");
    const subject = `${who} declined after designation: ${t.name}, ${fmtDate(t.start_date)}`;
    const html = `<p>${who} (${r.referees?.email || ""}) declined <strong>${t.name}</strong>, ${fmtDate(t.start_date)} to ${fmtDate(t.end_date)}, from the designation email.</p>${note ? "<p>Note: " + String(note).replace(/[<>&]/g, "") + "</p>" : ""}<p>The referee is off the team and their weekend is free again on their calendar. Pick a replacement from Find referees: ${(SITE_URL || "https://nrc-referee-hub.netlify.app")}/admin/</p>`;
    const m = await sendMail({ to: CONTACT_EMAIL || "referee@handballusa.org", subject, html });
    await admin.from("email_log").insert({ to_email: CONTACT_EMAIL || "referee@handballusa.org", subject, kind: "withdraw", sent: m.sent, error: m.error });
    return json(200, { status: "withdrawn", tournament: t, name: r.referees?.first_name });
  }
  if (["confirmed", "cancelled"].includes(r.status)) return json(200, { already: true, status: r.status, tournament: r.tournaments, name: r.referees?.first_name });
  const status = answer === "accept" ? "accepted" : answer === "tentative" ? "tentative" : "declined";
  await admin.from("assignment_requests").update({ status, responded_at: new Date().toISOString(), response_note: note || null }).eq("id", r.id);
  return json(200, { status, tournament: r.tournaments, name: r.referees?.first_name });
};

export const config = { path: "/api/respond" };
