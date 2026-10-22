// Emails from the NRC to referees, sent from Admin > Referees (tick the referees, then Email selected). Admin only.
// Body: { referee_ids: [], subject, body, test: true|false }
//   test = true sends one preview (first selected referee's fields) to the signed in admin only.
// Placeholders: {first_name} {last_name} {hub_url} {profile_url} {contact_email}
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "./mailer.mjs";

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
  if (!prof || prof.role !== "admin") return json(403, { error: "Admin only" });

  let input; try { input = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const ids = Array.isArray(input.referee_ids) ? [...new Set(input.referee_ids)].slice(0, 500) : [];
  const subject = String(input.subject || "").trim().slice(0, 200);
  const body = String(input.body || "").trim().slice(0, 10000);
  if (!ids.length || !subject || !body) return json(400, { error: "Referees, subject and message are required" });

  const { data: refs, error } = await admin.from("referees").select("id,first_name,last_name,email").in("id", ids);
  if (error) return json(500, { error: error.message });
  const hub = (SITE_URL || "").replace(/\/$/, "");
  const vars = r => ({ first_name: r.first_name || "", last_name: r.last_name || "", hub_url: hub || "the NRC Referee Hub", profile_url: hub ? hub + "/profile.html" : "your profile on the hub", contact_email: CONTACT_EMAIL || "referee@handballusa.org" });
  const fill = (text, v) => text.replace(/\{(\w+)\}/g, (m, k) => v[k] != null ? String(v[k]) : m);
  const toHtml = text => text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

  if (input.test) {
    const r = (refs || [])[0]; if (!r) return json(400, { error: "Referee not found" });
    const v = vars(r);
    const m = await sendMail({ to: prof.email, subject: "[Test] " + fill(subject, v), html: `<p style="color:#666;font-size:13px">Test copy. The real email goes to ${ids.length} referee(s), each with their own name. Shown with ${esc(r.first_name + " " + r.last_name)}.</p>` + toHtml(fill(body, v)) });
    return json(200, { results: [{ email: prof.email, sent: m.sent, error: m.error }] });
  }

  const results = [];
  for (const r of refs || []) {
    if (!r.email || /@demo\.nrc$/i.test(r.email)) { results.push({ name: r.first_name + " " + r.last_name, email: r.email, sent: false, error: "no usable email" }); continue; }
    const v = vars(r); const subj = fill(subject, v);
    const m = await sendMail({ to: r.email, subject: subj, html: toHtml(fill(body, v)) });
    await admin.from("email_log").insert({ to_email: r.email, subject: subj, kind: "referee_message", sent: m.sent, error: m.error });
    results.push({ name: r.first_name + " " + r.last_name, email: r.email, sent: m.sent, error: m.error });
  }
  await admin.from("referee_messages").insert({ subject, body, referee_ids: ids, recipients: results.filter(r => r.email).length, sent: results.filter(r => r.sent).length, sent_by: who.user.id });
  return json(200, { results });
};

export const config = { path: "/api/referee-message" };
