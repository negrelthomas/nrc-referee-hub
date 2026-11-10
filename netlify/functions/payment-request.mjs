// Payment requests: once the organizer approves claims, the hub emails the club's payment address (or the organizer)
// the amount to pay each official and how to pay them, with a copy to the official, and a single use link to record
// the payment without signing in.
// POST /api/payment-request
//   { action: "send", tournament_id, manual }   signed in organizer of the event or NRC admin. Sends one email per
//                                               official for every approved claim not yet requested. When the
//                                               organizer chose to send requests by hand, only manual: true sends.
//   { action: "view", token }                   no sign in: what the link covers, for the pay page
//   { action: "paid", token, method, paid_on, reference }   no sign in: records the payment once
// Settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, GMAIL_USER, GMAIL_APP_PASSWORD, CONTACT_EMAIL.
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate } from "./mailer.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usd = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LBL = { flight: "Airfare", hotel: "Hotel", transport: "Rideshare and taxis", car: "Car rental and related", per_diem: "Food per diem", mileage: "Mileage", other: "Other" };
const METHODS = ["Venmo", "PayPal", "Zelle", "Check", "Cash", "Bank transfer", "Other"];
const due = c => Number(c.approved_amount ?? c.amount);
const isDemo = e => !e || /@demo\.nrc$/i.test(e);
const plain = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
export function payRef(tourName, lastName) {
  // short event code: the name if it fits in 12 characters, else the initials of its words plus its numbers (RMC2027)
  const words = plain(String(tourName || "").replace(/\(.*?\)/g, "")).split(/[^A-Z0-9]+/).filter(Boolean);
  const full = words.join("");
  const t = (full.length <= 12 ? full : words.map(w => /^\d+$/.test(w) ? w : w[0]).join("").slice(0, 12)) || "EVENT";
  return t + "-" + (plain(lastName).replace(/[^A-Z0-9]/g, "").slice(0, 14) || "OFFICIAL");
}
export function payeeLine(p) {
  if (!p) return null;
  const h = [p.venmo ? "Venmo " + p.venmo : null, p.paypal ? "PayPal " + p.paypal : null, p.zelle ? "Zelle " + p.zelle : null].filter(Boolean);
  const pref = p.preferred ? { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" }[p.preferred] : null;
  return h.length ? h.join(", ") + (pref && h.length > 1 ? ` (prefers ${pref})` : "") : null;
}

// first name, last name and email of each official (USATH referee or guest), by assignment
async function officials(sb, ids) {
  const out = {}; if (!ids.length) return out;
  const { data: as } = await sb.from("assignments").select("id,referee_id,guest_official_id").in("id", ids);
  const rid = (as || []).map(a => a.referee_id).filter(Boolean), gid = (as || []).map(a => a.guest_official_id).filter(Boolean);
  const [{ data: rs }, { data: gs }] = await Promise.all([
    rid.length ? sb.from("referees").select("id,first_name,last_name,email").in("id", rid) : { data: [] },
    gid.length ? sb.from("guest_officials").select("id,first_name,last_name,email").in("id", gid) : { data: [] }]);
  for (const a of as || []) out[a.id] = (rs || []).find(r => r.id === a.referee_id) || (gs || []).find(g => g.id === a.guest_official_id) || {};
  return out;
}

async function loadTour(sb, id) {
  const { data } = await sb.from("tournaments").select("id,name,start_date,end_date,organizer_name,organizer_email,organizer_user_id,payment_email,payment_requests_auto,status").eq("id", id).maybeSingle();
  return data;
}

async function send(sb, t, base, by) {
  const { data: rows } = await sb.from("expense_claims")
    .select("id,kind,merchant,purchase_date,amount,approved_amount,review_note,assignment_id,payee_snapshot,reimbursed_by, assignments!inner(id,tournament_id)")
    .eq("assignments.tournament_id", t.id).eq("status", "approved").is("payment_request_sent_at", null).neq("reimbursed_by", "nrc");
  const people = await officials(sb, [...new Set((rows || []).map(c => c.assignment_id))]);
  const groups = {};
  for (const c of rows || []) (groups[c.assignment_id] = groups[c.assignment_id] || []).push(c);
  const to = (t.payment_email || t.organizer_email || "").trim();
  if (!to) return { sent: 0, failed: 0, error: "No payment email or organizer email on the event." };
  const out = { sent: 0, failed: 0, officials: [] };
  for (const [aid, list] of Object.entries(groups)) {
    const p = people[aid] || {};
    const name = `${p.first_name || ""} ${p.last_name || ""}`.trim() || "the official";
    const total = list.reduce((n, c) => n + due(c), 0);
    const ref = payRef(t.name, p.last_name);
    const snap = list.find(c => c.payee_snapshot && Object.keys(c.payee_snapshot).length)?.payee_snapshot || null;
    const how = payeeLine(snap);
    const { data: link, error: le } = await sb.from("pay_links").insert({ tournament_id: t.id, assignment_id: aid, claim_ids: list.map(c => c.id), amount: total, sent_to: to }).select("token,expires_at").single();
    if (le) { out.failed++; continue; }
    const url = `${base}/pay.html?t=${link.token}`;
    const partial = list.some(c => c.approved_amount != null);
    const table = `<table cellpadding="6" style="border-collapse:collapse;font-size:14px"><tr style="background:#f2f4f7"><th align="left">Category</th><th align="left">Merchant</th><th align="left">Date</th>${partial ? '<th align="right">Claimed</th>' : ""}<th align="right">To pay</th></tr>${list.map(c => `<tr style="border-top:1px solid #e5e7eb"><td>${esc(LBL[c.kind] || c.kind)}</td><td>${esc(c.merchant || "")}</td><td>${c.purchase_date ? esc(new Date(c.purchase_date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })) : ""}</td>${partial ? `<td align="right">${usd(c.amount)}</td>` : ""}<td align="right">${usd(due(c))}${c.approved_amount != null && c.review_note ? `<div style="font-size:12px;color:#666">${esc(c.review_note)}</div>` : ""}</td></tr>`).join("")}<tr style="border-top:2px solid #04234F"><td colspan="${partial ? 4 : 3}"><strong>Total</strong></td><td align="right"><strong>${usd(total)}</strong></td></tr></table>`;
    const copied = !isDemo(p.email);
    const html = `<p>Hello,</p>
<p>${esc(t.organizer_name || "The organizer")} approved the expenses below for ${esc(name)}, who officiated at <strong>${esc(t.name)}</strong> (${esc(fmtDate(t.start_date))}). Please pay <strong>${usd(total)}</strong>.</p>
<p>${how ? `Pay to: <strong>${esc(how)}</strong>.` : `${esc(p.first_name || name)} has no Venmo, PayPal or Zelle handle on the hub${snap && snap.notes ? ` (note: ${esc(snap.notes)})` : ""}. Please agree the payment details directly${copied ? ` with ${esc(p.first_name || "the official")}, who is copied on this email` : ""}.`} Reference for the payment memo: <strong>${esc(ref)}</strong>.</p>
${table}
<p style="margin-top:18px"><a href="${url}" style="display:inline-block;background:#04234F;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Record the payment</a></p>
<p style="font-size:13px;color:#666">Once paid, use this button to record the date, the method and the transaction reference. No sign in is needed, the link works once and expires on ${esc(fmtDate(String(link.expires_at).slice(0, 10)))}. ${copied ? esc(p.first_name || "The official") + " is copied on this email and is told when the payment is recorded." : ""} The receipts are on the hub; ${esc(t.organizer_name || "the organizer")} can download them for your records.</p>
<p>National Referee Committee</p>`;
    const subject = `${t.name}: please pay ${usd(total)} to ${name} (referee expenses)`;
    const res = await sendMail({ to, cc: copied && p.email.toLowerCase() !== to.toLowerCase() ? p.email : undefined, subject, html, replyTo: t.organizer_email || undefined });
    await sb.from("email_log").insert({ to_email: to, subject, kind: "payment_request", sent: res.sent, error: res.error });
    if (!res.sent) { out.failed++; await sb.from("pay_links").delete().eq("token", link.token); out.error = res.error; continue; }
    await sb.from("expense_claims").update({ payment_request_sent_at: new Date().toISOString(), payment_request_to: to, payment_ref: ref, claimant_notified_status: "approved" }).in("id", list.map(c => c.id));
    out.sent++; out.officials.push({ name, total, to });
  }
  return out;
}

async function linkInfo(sb, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ""))) return { err: [400, "This link is not valid."] };
  const { data: l } = await sb.from("pay_links").select("*").eq("token", token).maybeSingle();
  if (!l) return { err: [404, "This link is not valid."] };
  const t = await loadTour(sb, l.tournament_id);
  const p = (await officials(sb, [l.assignment_id]))[l.assignment_id] || {};
  const { data: cl } = await sb.from("expense_claims").select("id,kind,merchant,purchase_date,amount,approved_amount,status,payee_snapshot,payment_ref,paid_at,paid_method,paid_reference").in("id", l.claim_ids);
  return { l, t, p, C: cl || [] };
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const base = (SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
  let input; try { input = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }

  if (input.action === "send") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { error: "Sign in required" });
    const { data: who } = await sb.auth.getUser(token);
    if (!who?.user) return json(401, { error: "Invalid session" });
    const t = await loadTour(sb, input.tournament_id);
    if (!t) return json(404, { error: "Event not found" });
    const { data: prof } = await sb.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
    const isOrg = t.organizer_user_id === who.user.id || (t.organizer_email && who.user.email && t.organizer_email.toLowerCase() === who.user.email.toLowerCase());
    if (!isOrg && prof?.role !== "admin") return json(403, { error: "Not your event" });
    if (!t.payment_requests_auto && !input.manual) return json(200, { skipped: true, sent: 0 });
    const out = await send(sb, t, base, who.user.id);
    return json(200, out);
  }

  if (input.action === "view") {
    const r = await linkInfo(sb, input.token); if (r.err) return json(r.err[0], { error: r.err[1] });
    const { l, t, p, C } = r;
    return json(200, {
      tournament: t ? { name: t.name, start_date: t.start_date, organizer_name: t.organizer_name } : null,
      official: `${p.first_name || ""} ${p.last_name || ""}`.trim(), amount: l.amount, used_at: l.used_at, expired: new Date(l.expires_at) < new Date(), expires_at: l.expires_at,
      payee: payeeLine(C.find(c => c.payee_snapshot)?.payee_snapshot), ref: C.find(c => c.payment_ref)?.payment_ref || null,
      claims: C.map(c => ({ kind: LBL[c.kind] || c.kind, merchant: c.merchant, date: c.purchase_date, amount: due(c), status: c.status, paid_at: c.paid_at, paid_method: c.paid_method, paid_reference: c.paid_reference })),
      methods: METHODS
    });
  }

  if (input.action === "paid") {
    const r = await linkInfo(sb, input.token); if (r.err) return json(r.err[0], { error: r.err[1] });
    const { l, t, p, C } = r;
    if (l.used_at) return json(409, { error: "This payment was already recorded on " + fmtDate(String(l.used_at).slice(0, 10)) + "." });
    if (new Date(l.expires_at) < new Date()) return json(410, { error: "This link has expired. The organizer can record the payment on the hub." });
    const method = METHODS.includes(input.method) ? input.method : null;
    if (!method) return json(400, { error: "Choose how the official was paid." });
    const d = String(input.paid_on || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > new Date(Date.now() + 864e5).toISOString().slice(0, 10)) return json(400, { error: "Enter the date of payment." });
    const open = C.filter(c => c.status === "approved");
    if (!open.length) { await sb.from("pay_links").update({ used_at: new Date().toISOString() }).eq("token", l.token); return json(409, { error: "These claims are no longer waiting for payment (already paid, or the organizer changed the decision)." }); }
    const reference = String(input.reference || "").trim().slice(0, 120) || null;
    const { error } = await sb.from("expense_claims").update({ status: "reimbursed", paid_at: new Date(d + "T12:00:00Z").toISOString(), paid_method: method, paid_reference: reference, paid_via: "link" }).in("id", open.map(c => c.id)).eq("status", "approved");
    if (error) return json(500, { error: error.message });
    await sb.from("pay_links").update({ used_at: new Date().toISOString() }).eq("token", l.token);
    const amt = open.reduce((n, c) => n + due(c), 0), name = `${p.first_name || ""} ${p.last_name || ""}`.trim();
    if (t && t.organizer_email && t.organizer_email.toLowerCase() !== String(l.sent_to || "").toLowerCase()) {
      const subject = `${t.name}: ${usd(amt)} paid to ${name}`;
      const res = await sendMail({ to: t.organizer_email, subject, html: `<p>Hi ${esc(t.organizer_name || "")},</p><p>The payment of ${usd(amt)} to ${esc(name)} for ${esc(t.name)} was recorded through the payment link sent to ${esc(l.sent_to)}: ${esc(method)}, ${esc(fmtDate(d))}${reference ? ", reference " + esc(reference) : ""}.</p><p>National Referee Committee</p>` });
      await sb.from("email_log").insert({ to_email: t.organizer_email, subject, kind: "payment_recorded", sent: res.sent, error: res.error });
    }
    return json(200, { ok: true, amount: amt, partial: open.length < C.length });
  }

  return json(400, { error: "Unknown action" });
};

export const config = { path: "/api/payment-request" };
