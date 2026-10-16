// "Give feedback" button on every page: stores the note and emails it straight to FEEDBACK_EMAIL
// (falls back to CONTACT_EMAIL). No sign in required; the sender's email is whatever they typed or their session email.
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "./mailer.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FEEDBACK_EMAIL, CONTACT_EMAIL } = process.env;
  const to = FEEDBACK_EMAIL || CONTACT_EMAIL || "referee@handballusa.org";
  let body; try { body = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const message = String(body.message || "").trim().slice(0, 4000);
  if (message.length < 3) return json(400, { error: "Write a few words first." });
  const email = String(body.email || "").trim().slice(0, 200) || null;
  const page = String(body.page || "").slice(0, 300) || null;
  const role = String(body.role || "").slice(0, 40) || null;
  const ua = (req.headers.get("user-agent") || "").slice(0, 300);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: row } = await admin.from("site_feedback").insert({ email, role, page, message, user_agent: ua }).select("id").single();
  const html = `<p><strong>Feedback on the NRC Referee Hub</strong></p>
<p style="white-space:pre-wrap">${esc(message)}</p>
<p style="color:#666;font-size:13px">From: ${esc(email || "not given")}${role ? " (" + esc(role) + ")" : ""}<br>Page: ${esc(page || "")}<br>Browser: ${esc(ua)}</p>`;
  const r = await sendMail({ to, subject: "Hub feedback" + (email ? " from " + email : ""), html, replyTo: email || undefined });
  await admin.from("email_log").insert({ to_email: to, subject: "Hub feedback", kind: "feedback", sent: r.sent, error: r.error });
  return json(200, { ok: true, id: row && row.id, sent: r.sent });
};

export const config = { path: "/api/feedback" };
