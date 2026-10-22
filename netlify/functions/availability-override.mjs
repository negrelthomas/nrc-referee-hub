// Admin override of a referee's declared availability for one tournament.
//   POST { action: "create", tournament_id, referee_id, reason, declared }  (admin): records the override and emails the referee
//   GET  ?token=                                                            : details for the referee's answer page
//   POST { action: "answer", token, answer: "accept" | "revert", note }    : the referee's answer, the NRC is told
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate } from "./mailer.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const UUID = /^[0-9a-f-]{36}$/i;

export default async (req) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, CONTACT_EMAIL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const base = (SITE_URL || "").replace(/\/$/, "");
  const contact = CONTACT_EMAIL || "referee@handballusa.org";
  const load = async (token) => {
    const { data: o } = await admin.from("availability_overrides").select("*, referees(first_name,last_name,email), tournaments(name,start_date,end_date,venue_city,venue_state)").eq("token", token).maybeSingle();
    return o;
  };

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token") || "";
    if (!UUID.test(token)) return json(400, { error: "This link is not valid." });
    const o = await load(token); if (!o) return json(404, { error: "This link is not valid." });
    return json(200, { first_name: o.referees.first_name, tournament: o.tournaments, reason: o.reason, declared: o.declared, by: o.created_by_label, status: o.status, responded_at: o.responded_at });
  }
  if (req.method !== "POST") return json(405, { error: "GET or POST" });
  let body; try { body = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }

  if (body.action === "answer") {
    const token = String(body.token || "");
    if (!UUID.test(token) || !["accept", "revert"].includes(body.answer)) return json(400, { error: "This link is not valid." });
    const o = await load(token); if (!o) return json(404, { error: "This link is not valid." });
    const status = body.answer === "accept" ? "accepted" : "reverted";
    const note = String(body.note || "").trim().slice(0, 1000) || null;
    await admin.from("availability_overrides").update({ status, responded_at: new Date().toISOString(), response_note: note }).eq("id", o.id);
    const name = o.referees.first_name + " " + o.referees.last_name;
    const subject = `${name} ${status === "accepted" ? "accepted" : "reverted"} the availability change for ${o.tournaments.name}`;
    const html = `<p>${esc(name)} ${status === "accepted" ? "<strong>accepted</strong> the change: they are available for" : "<strong>reverted</strong> the change: they are not available for"} <strong>${esc(o.tournaments.name)}</strong>, ${fmtDate(o.tournaments.start_date)} to ${fmtDate(o.tournaments.end_date)}.</p>${note ? `<p>Their note: ${esc(note)}</p>` : ""}<p>Reason you gave: ${esc(o.reason)}</p><p>${base}/admin/#staffing</p>`;
    const r = await sendMail({ to: contact, subject, html });
    await admin.from("email_log").insert({ to_email: contact, subject, kind: "override_answer", sent: r.sent, error: r.error });
    return json(200, { status });
  }

  if (body.action !== "create") return json(400, { error: "Unknown action" });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await admin.from("profiles").select("role,email,full_name").eq("id", who.user.id).maybeSingle();
  if (!prof || prof.role !== "admin") return json(403, { error: "Admin only" });
  const reason = String(body.reason || "").trim();
  if (reason.length < 15) return json(400, { error: "Give the reason in a full sentence (15 characters at least)." });
  if (!UUID.test(body.tournament_id || "") || !UUID.test(body.referee_id || "")) return json(400, { error: "Tournament and referee required" });
  const [{ data: t }, { data: ref }] = await Promise.all([
    admin.from("tournaments").select("id,name,start_date,end_date,venue_city,venue_state").eq("id", body.tournament_id).maybeSingle(),
    admin.from("referees").select("id,first_name,last_name,email").eq("id", body.referee_id).maybeSingle()]);
  if (!t || !ref) return json(404, { error: "Tournament or referee not found" });
  const by = (prof.full_name || prof.email) + " (NRC admin)";
  const { data: o, error } = await admin.from("availability_overrides").upsert({ tournament_id: t.id, referee_id: ref.id, reason, declared: String(body.declared || "").slice(0, 200) || null, status: "pending", token: crypto.randomUUID(), created_by: who.user.id, created_by_label: by, created_at: new Date().toISOString(), responded_at: null, response_note: null }, { onConflict: "tournament_id,referee_id" }).select("*").single();
  if (error) return json(400, { error: error.message });
  const link = a => `${base}/override.html?token=${o.token}&answer=${a}`;
  const when = `${fmtDate(t.start_date)} to ${fmtDate(t.end_date)}`;
  const subject = `Your availability for ${t.name}: please confirm a change by the NRC`;
  const html = `<p>Hi ${esc(ref.first_name)},</p>
<p>${esc(prof.full_name || "The NRC")} at the NRC has marked you as available for <strong>${esc(t.name)}</strong>, ${when}${t.venue_city ? ", " + esc(t.venue_city) + (t.venue_state ? ", " + esc(t.venue_state) : "") : ""}.</p>
<p>On the hub, your availability for these dates was: ${esc(o.declared || "not available")}.<br>Reason given: <em>${esc(reason)}</em></p>
<p>This change applies to ${esc(t.name)} only. Your other blocked dates and weekends stay as you entered them.</p>
<p><a href="${link("accept")}" style="display:inline-block;background:#04234F;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Accept the change</a>&nbsp;&nbsp;<a href="${link("revert")}" style="color:#C8102E;padding:10px 6px;text-decoration:underline">Revert: I am not available</a></p>
<p style="font-size:13px;color:#666">Both links open a page where you confirm your choice. Questions: reply to this email.</p><p>National Referee Committee</p>`;
  const r = await sendMail({ to: ref.email, subject, html, replyTo: prof.email });
  await admin.from("email_log").insert({ to_email: ref.email, subject, kind: "override", sent: r.sent, error: r.error });
  if (r.sent) await admin.from("availability_overrides").update({ emailed_at: new Date().toISOString() }).eq("id", o.id);
  return json(200, { id: o.id, sent: r.sent, error: r.error, email: ref.email });
};

export const config = { path: "/api/availability-override" };
