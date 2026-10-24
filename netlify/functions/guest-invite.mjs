// Sign in link for referees from outside USATH (guest pairs named on an event). Admin, or the organizer of the event.
// Body: { guest_ids: [], tournament_id }
// The email links to the sign in page with the address filled in; the referee asks for a code there (no pre-fetched magic link).
// Referees who already have an account are skipped. Each send is logged and stamps guest_officials.invited_at.
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate, coverage } from "./mailer.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CONTACT_EMAIL, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await admin.from("profiles").select("role,email").eq("id", who.user.id).maybeSingle();

  let input; try { input = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const ids = Array.isArray(input.guest_ids) ? [...new Set(input.guest_ids)].slice(0, 20) : [];
  if (!ids.length || !input.tournament_id) return json(400, { error: "Guests and event are required" });
  const { data: t } = await admin.from("tournaments").select("*").eq("id", input.tournament_id).maybeSingle();
  if (!t) return json(404, { error: "Event not found" });
  const isOrganizer = t.organizer_user_id === who.user.id || (prof && t.organizer_email && prof.email && t.organizer_email.toLowerCase() === prof.email.toLowerCase());
  if (!(prof && prof.role === "admin") && !isOrganizer) return json(403, { error: "Only the NRC or the organizer of this event" });

  // only guests designated on this event
  const { data: rows, error } = await admin.from("assignments").select("guest_officials(id,first_name,last_name,email,user_id,federation)").eq("tournament_id", t.id).in("guest_official_id", ids);
  if (error) return json(500, { error: error.message });
  const base = (SITE_URL || "").replace(/\/$/, "");
  const contact = CONTACT_EMAIL || "referee@handballusa.org";
  const results = [];
  for (const r of rows || []) {
    const g = r.guest_officials; if (!g) continue;
    const name = g.first_name + " " + g.last_name;
    if (!g.email || /@demo\.nrc$/i.test(g.email)) { results.push({ name, sent: false, error: "no email" }); continue; }
    if (g.user_id) { results.push({ name, sent: false, error: "already has an account" }); continue; }
    const link = `${base}/login.html?next=profile.html&email=${encodeURIComponent(g.email)}`;
    const subject = `${t.name}: your page on the USA Team Handball Referee Hub`;
    const html = `<p>Hi ${esc(g.first_name)},</p>
      <p>${esc(t.organizer_name || "The organizer")} named you to referee at ${esc(t.name)}, ${esc(fmtDate(t.start_date))} to ${esc(fmtDate(t.end_date))}${t.venue_city ? ", " + esc([t.venue_city, t.venue_state].filter(Boolean).join(", ")) : ""}. The event has a page for you on the USA Team Handball Referee Hub:</p>
      <ul><li>Dates, venue, organizer contact and the officials on the event</li><li>What the organizer covers, your travel bookings and your expense claims</li><li>Practice quizzes and the rules assessment, if you want them. Optional: nothing is required of you on the hub</li></ul>
      <p><strong>What the organizer covers</strong><br>${coverage(t).map(esc).join("<br>")}</p>
      <p><a href="${link}" style="display:inline-block;background:#04234F;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open my page</a></p>
      <p style="font-size:13px;color:#666">No password: sign in with this email address (${esc(g.email)}) and the code we send you. At first sign in you are asked for a few details (phone, closest airport, how you are reimbursed); you can skip them and come back later. Questions: ${esc(t.organizer_email || contact)}.</p>
      <p>National Referee Committee, USA Team Handball</p>`;
    const m = await sendMail({ to: g.email, subject, html, replyTo: t.organizer_email || contact });
    await admin.from("email_log").insert({ to_email: g.email, subject, kind: "guest_invite", sent: m.sent, error: m.error });
    if (m.sent) await admin.from("guest_officials").update({ invited_at: new Date().toISOString() }).eq("id", g.id);
    results.push({ name, email: g.email, sent: m.sent, error: m.error });
  }
  return json(200, { results });
};

export const config = { path: "/api/guest-invite" };
