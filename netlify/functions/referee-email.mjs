// Admin changes a referee's email: updates the referee record, the sign in account (auth user) and the profile
// in one step, then tells the referee at the new address and at the old one.
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "./mailer.mjs";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await admin.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
  if (!prof || prof.role !== "admin") return json(403, { error: "Admin only" });

  let body; try { body = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const refereeId = body.referee_id;
  const newEmail = String(body.new_email || "").trim().toLowerCase();
  if (!refereeId || !EMAIL_RE.test(newEmail)) return json(400, { error: "A referee and a valid email are required." });

  const { data: ref } = await admin.from("referees").select("id, first_name, last_name, email, user_id").eq("id", refereeId).maybeSingle();
  if (!ref) return json(404, { error: "Referee not found" });
  const oldEmail = String(ref.email || "").toLowerCase();
  if (oldEmail === newEmail) return json(200, { ok: true, changed: false });

  const { data: clash } = await admin.from("referees").select("id, first_name, last_name").ilike("email", newEmail).neq("id", ref.id).maybeSingle();
  if (clash) return json(409, { error: `${newEmail} already belongs to ${clash.first_name} ${clash.last_name}.` });

  // Sign in account: change it when the referee has one; otherwise link an existing account on the new address, if any
  let account = "none";
  let userId = ref.user_id;
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { email: newEmail, email_confirm: true });
    if (error) return json(409, { error: "Sign in account not changed: " + error.message });
    await admin.from("profiles").update({ email: newEmail }).eq("id", userId);
    account = "updated";
  } else {
    const { data: p } = await admin.from("profiles").select("id").ilike("email", newEmail).maybeSingle();
    if (p) { userId = p.id; account = "linked"; }
  }
  const { error: upErr } = await admin.from("referees").update({ email: newEmail, user_id: userId || null, updated_at: new Date().toISOString() }).eq("id", ref.id);
  if (upErr) {
    if (account === "updated") await admin.auth.admin.updateUserById(userId, { email: oldEmail, email_confirm: true });
    return json(500, { error: "Referee record not changed: " + upErr.message });
  }

  const base = (SITE_URL || "").replace(/\/$/, "");
  const contact = process.env.CONTACT_EMAIL || "referee@handballusa.org";
  const name = esc(ref.first_name);
  const toNew = `<p>Hello ${name},</p>
<p>The National Referee Committee changed the email on your NRC Referee Hub profile to <strong>${esc(newEmail)}</strong>. From now on, sign in with this address: you receive a link and a code, no password.</p>
<p><a href="${base}/login.html">Sign in to the NRC Referee Hub</a></p>
<p>Invitations, tournament briefs and reminders now come to this address. If you did not expect this change, reply to ${esc(contact)}.</p>`;
  const toOld = `<p>Hello ${name},</p>
<p>The National Referee Committee changed the email on your NRC Referee Hub profile from ${esc(oldEmail)} to <strong>${esc(newEmail)}</strong>. This address no longer signs you in and will stop receiving hub emails.</p>
<p>If you did not expect this change, write to ${esc(contact)}.</p>`;
  const sent = [];
  for (const [to, html] of [[newEmail, toNew], [oldEmail, toOld]]) {
    if (!to) continue;
    const r = await sendMail({ to, subject: "Your NRC Referee Hub sign in email has changed", html, replyTo: contact });
    await admin.from("email_log").insert({ to_email: to, subject: "Sign in email changed", kind: "email_change", sent: r.sent, error: r.error });
    sent.push({ to, sent: r.sent, error: r.error || null });
  }
  return json(200, { ok: true, changed: true, account, sent });
};

export const config = { path: "/api/referee-email" };
