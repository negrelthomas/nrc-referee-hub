// Emails from the NRC to clubs, sent from the admin Clubs area and the action plan.
// One email per contact, personalised with the club's own numbers. Admin only.
// Body: { club_ids: [], subject, body, template, test: true|false }
//   test = true sends one preview (first selected club's figures) to the signed in admin only, nothing logged as a club send.
// Placeholders: {club} {first_name} {referees} {certified} {in_training} {pair_status} {prospects} {state} {hub_url} {contact_email}
import { createClient } from "@supabase/supabase-js";
import { sendMail } from "./mailer.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PROG = { none: "not started", nominated: "two members nominated", mentor_assigned: "mentor assigned", in_training: "in training", observed: "observed at a tournament", certified_pair: "certified pair" };
const CERTIFIED = ["level_1", "level_2", "level_3", "nachc", "ihf"];

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
  const clubIds = Array.isArray(input.club_ids) ? input.club_ids.slice(0, 200) : [];
  const subject = String(input.subject || "").trim().slice(0, 200);
  const body = String(input.body || "").trim().slice(0, 10000);
  if (!clubIds.length || !subject || !body) return json(400, { error: "Clubs, subject and message are required" });

  const [{ data: clubs }, { data: contacts }, { data: refs }, { data: inq }] = await Promise.all([
    admin.from("clubs").select("id,name,state,pair_program_status").in("id", clubIds),
    admin.from("club_contacts").select("*").in("club_id", clubIds).eq("receives_messages", true).not("email", "is", null),
    admin.from("referees").select("id,club_id,cert_level,active").in("club_id", clubIds),
    admin.from("referee_inquiries").select("club_id,status").in("club_id", clubIds).in("status", ["new", "contacted"])
  ]);
  const hub = (SITE_URL || "").replace(/\/$/, "");
  const contactEmail = CONTACT_EMAIL || "referee@handballusa.org";
  const figures = c => {
    const r = (refs || []).filter(x => x.club_id === c.id && x.active);
    return { club: c.name, referees: r.length, certified: r.filter(x => CERTIFIED.includes(x.cert_level)).length, in_training: r.filter(x => x.cert_level === "candidate").length, pair_status: PROG[c.pair_program_status] || "not started", prospects: (inq || []).filter(x => x.club_id === c.id).length, state: c.state || "your state", hub_url: hub ? hub + "/become-a-referee.html" : "the Become a referee page of the NRC Referee Hub", contact_email: contactEmail };
  };
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? String(vars[k]) : m);
  const toHtml = text => text.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

  if (input.test) {
    const c = (clubs || [])[0]; if (!c) return json(400, { error: "Club not found" });
    const first = (contacts || []).find(x => x.club_id === c.id);
    const vars = { ...figures(c), first_name: first && first.name ? first.name.split(" ")[0] : "there" };
    const r = await sendMail({ to: prof.email, subject: "[Test] " + fill(subject, vars), html: `<p style="color:#666;font-size:13px">Test copy. The real email goes to each contact of ${clubIds.length} club(s), with their own figures. Shown with ${esc(c.name)}.</p>` + toHtml(fill(body, vars)) });
    return json(200, { results: [{ email: prof.email, sent: r.sent, error: r.error }] });
  }

  const results = [];
  for (const c of clubs || []) {
    const list = (contacts || []).filter(x => x.club_id === c.id);
    if (!list.length) { results.push({ club: c.name, email: null, sent: false, error: "no contact with an email" }); continue; }
    for (const ct of list) {
      const vars = { ...figures(c), first_name: ct.name ? ct.name.split(" ")[0] : "there" };
      const subj = fill(subject, vars);
      const r = await sendMail({ to: ct.email, subject: subj, html: toHtml(fill(body, vars)) });
      await admin.from("email_log").insert({ to_email: ct.email, subject: subj, kind: "club", sent: r.sent, error: r.error });
      results.push({ club: c.name, email: ct.email, sent: r.sent, error: r.error });
    }
  }
  await admin.from("club_messages").insert({ subject, body, template: input.template || null, club_ids: clubIds, recipients: results.filter(r => r.email).length, sent: results.filter(r => r.sent).length, sent_by: who.user.id });
  return json(200, { results });
};

export const config = { path: "/api/club-message" };
