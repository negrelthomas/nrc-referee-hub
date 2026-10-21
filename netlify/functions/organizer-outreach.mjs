// Invitation to an event organizer to place their referee request on the hub. Sent from Events > Tournaments
// (Reach out). Admin only. Body: { tournament_id, to, name, subject, body, test }
//   test = true sends one copy to the signed in admin only; the event is not marked as contacted.
// The message is written in the admin dialog; {link} becomes the request form prefilled with this event.
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "./mailer.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, CONTACT_EMAIL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await admin.from("profiles").select("role,email,full_name").eq("id", who.user.id).maybeSingle();
  if (!prof || prof.role !== "admin") return json(403, { error: "Admin only" });

  let input; try { input = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const to = String(input.to || "").trim().toLowerCase();
  const subject = String(input.subject || "").trim().slice(0, 200);
  const body = String(input.body || "").trim().slice(0, 10000);
  if (!input.tournament_id || !subject || !body) return json(400, { error: "Event, subject and message are required" });
  if (!input.test && !EMAIL.test(to)) return json(400, { error: "Enter a valid email address for the organizer" });

  const { data: t } = await admin.from("tournaments").select("id,name,start_date,end_date,club_id,venue_city,venue_state,created_by_nrc").eq("id", input.tournament_id).maybeSingle();
  if (!t) return json(404, { error: "Event not found" });
  if (!t.created_by_nrc && !input.test) return json(409, { error: "The organizer already placed the request for this event." });

  const base = (SITE_URL || "").replace(/\/$/, "");
  const q = new URLSearchParams({ event: t.id, name: t.name, start_date: t.start_date, end_date: t.end_date });
  if (t.club_id) q.set("club_id", t.club_id);
  if (t.venue_city) q.set("venue_city", t.venue_city);
  if (t.venue_state) q.set("venue_state", t.venue_state);
  if (to) q.set("organizer_email", to);
  if (input.name) q.set("organizer_name", String(input.name).slice(0, 120));
  const link = `${base}/request-referees.html?${q.toString()}`;
  const html = body.split(/\n{2,}/).map(p => "<p>" + esc(p).replace(/\n/g, "<br>").replace(/\{link\}/g, `<a href="${link}">${esc(link.split("?")[0])}</a>`) + "</p>").join("");
  const replyTo = prof.email || CONTACT_EMAIL;

  if (input.test) {
    const r = await sendMail({ to: prof.email, subject: "[Test] " + subject, html: `<p style="color:#666;font-size:13px">Test copy. The real email goes to ${esc(to || "the organizer")}.</p>` + html, replyTo });
    return json(r.sent ? 200 : 502, { ok: r.sent, test: true, error: r.error });
  }
  const r = await sendMail({ to, subject, html, replyTo });
  await admin.from("email_log").insert({ to_email: to, subject, kind: "organizer_outreach", sent: r.sent, error: r.error });
  if (!r.sent) return json(502, { error: r.error || "Not sent" });
  await admin.from("tournaments").update({ outreach_email: to, outreach_name: input.name || null, outreach_sent_at: new Date().toISOString(), outreach_sent_to: to }).eq("id", t.id);
  return json(200, { ok: true });
};

export const config = { path: "/api/organizer-outreach" };
