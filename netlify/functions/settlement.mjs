// Settlement of open expense claims before an official is removed from an event.
// POST /api/settlement (NRC admin only)
//   { action: "notice", tournament_id, assignment_ids }   emails the organizer the open claims of these officials with
//        15 days to decide and pay them on the hub, copied to the officials. Sending again resends the same deadline.
//   { action: "close", tournament_id, assignment_ids }    after the deadline: emails the organizer a handover of every
//        claim still open (details, payout details, receipts attached, CSV), copied to the officials and the NRC, then
//        removes the officials from the event. The NRC declines any further responsibility for those claims.
// An official with no open claim is removed directly from the admin page; the database refuses any other removal
// (see supabase/expenses_v5_settlement.sql).
// Settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, GMAIL_USER, GMAIL_APP_PASSWORD, CONTACT_EMAIL.
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate } from "./mailer.mjs";
import { payeeLine } from "./payment-request.mjs";

const CURE_DAYS = 15;
const MAX_ATTACH = 18 * 1024 * 1024;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const usd = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LBL = { flight: "Airfare", hotel: "Hotel", transport: "Rideshare and taxis", car: "Car rental and related", per_diem: "Food per diem", mileage: "Mileage", other: "Other" };
const due = c => Number(c.status === "approved" && c.approved_amount != null ? c.approved_amount : c.amount);
const stateOf = c => c.status === "approved" ? `Approved${c.approved_amount != null ? " for " + usd(c.approved_amount) : ""}, not paid${c.payment_request_sent_at ? " (payment requested " + fmtDate(String(c.payment_request_sent_at).slice(0, 10)) + ")" : ""}` : "Waiting for your decision";
const todayLA = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const isDemo = e => !e || /@demo\.nrc$/i.test(e);
const safe = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;

async function load(sb, tournamentId, ids) {
  const { data: t } = await sb.from("tournaments").select("id,name,start_date,end_date,organizer_name,organizer_email,payment_email").eq("id", tournamentId).maybeSingle();
  const { data: as } = await sb.from("assignments").select("id,tournament_id,referee_id,guest_official_id").in("id", ids).eq("tournament_id", tournamentId);
  const A = as || [];
  const rid = A.map(a => a.referee_id).filter(Boolean), gid = A.map(a => a.guest_official_id).filter(Boolean);
  const [{ data: rs }, { data: gs }, { data: cl }] = await Promise.all([
    rid.length ? sb.from("referees").select("id,user_id,first_name,last_name,email,phone").in("id", rid) : { data: [] },
    gid.length ? sb.from("guest_officials").select("id,user_id,first_name,last_name,email,phone,federation,payment_notes").in("id", gid) : { data: [] },
    A.length ? sb.from("expense_claims").select("*").in("assignment_id", A.map(a => a.id)).in("status", ["submitted", "approved"]).order("purchase_date") : { data: [] }]);
  const uids = [...(rs || []), ...(gs || [])].map(p => p.user_id).filter(Boolean);
  const { data: pm } = uids.length ? await sb.from("payout_methods").select("*").in("user_id", uids) : { data: [] };
  const people = A.map(a => {
    const p = (rs || []).find(r => r.id === a.referee_id) || (gs || []).find(g => g.id === a.guest_official_id) || {};
    const pay = (pm || []).find(m => m.user_id === p.user_id);
    return { a, p, name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Official", guest: !!a.guest_official_id,
      payout: payeeLine(pay) || null, notes: p.payment_notes || null, claims: (cl || []).filter(c => c.assignment_id === a.id) };
  });
  return { t, people };
}

function claimsTable(people, full) {
  const rows = people.flatMap(o => o.claims.map(c => `<tr><td style="padding:4px 8px">${esc(o.name)}</td><td style="padding:4px 8px">${esc(LBL[c.kind] || c.kind)}${c.merchant ? ", " + esc(c.merchant) : ""}${full && c.description ? "<br><span style='color:#666'>" + esc(c.description) + "</span>" : ""}</td><td style="padding:4px 8px">${c.purchase_date ? esc(fmtDate(c.purchase_date)) : ""}</td><td style="padding:4px 8px;text-align:right">${usd(due(c))}${c.currency && c.currency !== "USD" ? `<br><span style="color:#666">${esc(c.currency)} ${Number(c.amount_original).toFixed(2)} at ${Number(c.fx_rate).toFixed(4)}</span>` : ""}</td><td style="padding:4px 8px">${esc(stateOf(c))}${full ? `<br><span style="color:#666">${c.coverage === "covered" ? "Within the agreement" : "Outside the agreement"}${c.coverage_note ? ": " + esc(c.coverage_note) : ""}${c.review_note ? "; note: " + esc(c.review_note) : ""}${c.receipt_url ? "" : (c.kind === "per_diem" ? "; per diem, no receipt" : "; no receipt")}</span>` : ""}</td></tr>`)).join("");
  const total = people.reduce((n, o) => n + o.claims.reduce((m, c) => m + due(c), 0), 0);
  return `<table style="border-collapse:collapse;font-size:14px" border="1" cellspacing="0"><tr style="background:#f2f2f2"><th style="padding:4px 8px;text-align:left">Official</th><th style="padding:4px 8px;text-align:left">Claim</th><th style="padding:4px 8px;text-align:left">Date</th><th style="padding:4px 8px;text-align:right">USD</th><th style="padding:4px 8px;text-align:left">Status</th></tr>${rows}<tr><td colspan="3" style="padding:4px 8px"><strong>Total open</strong></td><td style="padding:4px 8px;text-align:right"><strong>${usd(total)}</strong></td><td></td></tr></table>`;
}

const snapshot = (people) => people.map(o => ({ assignment_id: o.a.id, name: o.name, email: o.p.email || null, phone: o.p.phone || null, federation: o.p.federation || (o.guest ? null : "USATH"), payout: o.payout, payment_notes: o.notes,
  claims: o.claims.map(c => ({ id: c.id, kind: c.kind, merchant: c.merchant, description: c.description, purchase_date: c.purchase_date, amount: c.amount, approved_amount: c.approved_amount, currency: c.currency, amount_original: c.amount_original, fx_rate: c.fx_rate, status: c.status, coverage: c.coverage, coverage_note: c.coverage_note, review_note: c.review_note, receipt_url: c.receipt_url, payment_request_sent_at: c.payment_request_sent_at })) }));

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, CONTACT_EMAIL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await sb.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
  if (prof?.role !== "admin") return json(403, { error: "NRC only" });
  let input; try { input = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const ids = [...new Set((input.assignment_ids || []).filter(Boolean))];
  if (!input.tournament_id || !ids.length) return json(400, { error: "tournament_id and assignment_ids required" });
  const base = (SITE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const nrc = CONTACT_EMAIL || "referee@handballusa.org";
  const { t, people } = await load(sb, input.tournament_id, ids);
  if (!t) return json(404, { error: "Event not found" });
  if (people.length !== ids.length) return json(404, { error: "Official not on this event" });
  const open = people.filter(o => o.claims.length);
  const to = (t.organizer_email || "").trim();
  const names = open.map(o => o.name).join(" and ");
  const ccOfficials = open.map(o => o.p.email).filter(e => e && !isDemo(e));
  const hello = `<p>Hello${t.organizer_name ? " " + esc(t.organizer_name.split(" ")[0]) : ""},</p>`;
  const sign = `<p>National Referee Committee<br>${esc(nrc)}</p>`;
  const event = `<strong>${esc(t.name)}</strong> (${esc(fmtDate(t.start_date))} to ${esc(fmtDate(t.end_date))})`;

  if (input.action === "notice") {
    if (!open.length) return json(400, { error: "No open claim: the official can be removed directly." });
    if (!to) return json(400, { error: "This event has no organizer email. Add it on the request first." });
    const { data: existing } = await sb.from("expense_settlements").select("*").in("assignment_id", open.map(o => o.a.id)).eq("status", "notice");
    const cure = (existing || []).length ? (existing.map(s => s.cure_until).sort()[0]) : addDays(todayLA(), CURE_DAYS);
    const subject = `Expense claims to settle by ${fmtDate(cure)}: ${names}, ${t.name}`;
    const html = hello + `<p>The NRC needs to remove ${esc(names)} from ${event} on the NRC Referee Hub. Before it does, the expense claims below must be settled. They are waiting for your decision or approved and not yet paid.</p>` + claimsTable(open, false) +
      `<p>Please decide each claim and record the payments on your page of the hub by <strong>${esc(fmtDate(cure))}</strong>: <a href="${base}/organizer.html">${base}/organizer.html</a>. The receipts and the payment details of each official are there.</p>` +
      `<p>After that date the NRC removes ${esc(names)} from the event on the hub. Any claim still open at that point is no longer tracked on the hub: you will receive a recap of it with the receipts and payment details, to settle directly with the official. USATH and the NRC take no responsibility for claims settled outside the hub.</p>` +
      `<p>${esc(names)} ${open.length > 1 ? "are" : "is"} copied on this email.</p>` + sign;
    const cc = [...ccOfficials, ...(t.payment_email && t.payment_email.toLowerCase() !== to.toLowerCase() ? [t.payment_email] : []), nrc];
    const m = isDemo(to) ? { sent: false, error: "demo address" } : await sendMail({ to, cc, subject, html, replyTo: nrc });
    await sb.from("email_log").insert({ to_email: to, subject, kind: "settlement_notice", sent: m.sent, error: m.error });
    if (!m.sent) return json(502, { error: "The notice could not be sent: " + (m.error || "unknown error") + ". Nothing was recorded." });
    const now = new Date().toISOString(), snap = snapshot(open);
    for (const o of open) {
      const ex = (existing || []).find(s => s.assignment_id === o.a.id);
      if (ex) await sb.from("expense_settlements").update({ notice_sent_at: now, notice_count: ex.notice_count + 1, notice_snapshot: snap.find(s => s.assignment_id === o.a.id) }).eq("id", ex.id);
      else await sb.from("expense_settlements").insert({ assignment_id: o.a.id, tournament_id: t.id, official_name: o.name, official_email: o.p.email || null, organizer_email: to, status: "notice", notice_sent_at: now, notice_count: 1, cure_until: cure, notice_snapshot: snap.find(s => s.assignment_id === o.a.id), created_by: who.user.id });
    }
    return json(200, { sent: true, to, cure_until: cure, open: open.length });
  }

  if (input.action === "close") {
    const today = todayLA();
    const { data: notices } = await sb.from("expense_settlements").select("*").in("assignment_id", ids).eq("status", "notice");
    for (const o of open) {
      const n = (notices || []).find(s => s.assignment_id === o.a.id);
      if (!n) return json(409, { error: `${o.name} has open claims and no settlement notice was sent. Send the notice first.` });
      if (n.cure_until >= today) return json(409, { error: `The organizer has until ${fmtDate(n.cure_until)} to settle ${o.name}'s claims. Removal is possible from ${fmtDate(addDays(n.cure_until, 1))}.` });
    }
    let final = null;
    if (open.length) {
      if (!to) return json(400, { error: "This event has no organizer email. Add it on the request first." });
      // receipts as attachments, within the size budget; the rest listed in the email
      const attachments = [], missing = []; let size = 0;
      for (const o of open) for (const c of o.claims) {
        if (!c.receipt_url) continue;
        const ext = (String(c.receipt_url).split(".").pop() || "jpg").toLowerCase();
        const filename = `${c.purchase_date || "nodate"}_${safe(o.name)}_${safe(LBL[c.kind] || c.kind)}_${due(c).toFixed(2)}USD.${ext}`;
        const { data: file } = await sb.storage.from("receipts").download(c.receipt_url);
        if (!file) { missing.push(filename); continue; }
        const buf = Buffer.from(await file.arrayBuffer());
        if (size + buf.length > MAX_ATTACH) { missing.push(filename); continue; }
        size += buf.length; attachments.push({ filename, content: buf, contentType: file.type || undefined });
      }
      const head = ["Official", "Email", "Phone", "Federation", "How to pay", "Category", "Merchant", "Description", "Date of purchase", "Original amount", "Currency", "FX rate", "USD claimed", "USD approved", "Status", "Within the agreement", "Agreement note", "Review note", "Payment requested"];
      const lines = [head.map(q).join(",")].concat(open.flatMap(o => o.claims.map(c => [o.name, o.p.email, o.p.phone, o.p.federation || (o.guest ? "" : "USATH"), [o.payout, o.notes].filter(Boolean).join("; "), LBL[c.kind] || c.kind, c.merchant, c.description, c.purchase_date, Number(c.amount_original ?? c.amount).toFixed(2), c.currency || "USD", c.fx_rate, Number(c.amount).toFixed(2), c.status === "approved" ? due(c).toFixed(2) : "", c.status === "approved" ? "Approved, not paid" : "Waiting for decision", c.coverage === "covered" ? "Yes" : "No", c.coverage_note, c.review_note, c.payment_request_sent_at ? String(c.payment_request_sent_at).slice(0, 10) : ""].map(q).join(","))));
      attachments.push({ filename: `open_claims_${safe(t.name)}_${t.start_date}.csv`, content: Buffer.from(lines.join("\n")), contentType: "text/csv" });
      const contacts = open.map(o => `<li><strong>${esc(o.name)}</strong>${o.p.federation ? ", " + esc(o.p.federation) : ""}: ${o.p.email ? esc(o.p.email) : "no email on file"}${o.p.phone ? ", " + esc(o.p.phone) : ""}. Pay to: ${esc([o.payout, o.notes].filter(Boolean).join("; ") || "no payout details on file, ask the official")}</li>`).join("");
      const subject = `Open expense claims handed over to you: ${names}, ${t.name}`;
      const html = hello + `<p>The settlement period for the expense claims of ${esc(names)} on ${event} ended on ${esc(fmtDate(notices.map(s => s.cure_until).sort().slice(-1)[0]))}. The NRC has removed ${open.length > 1 ? "them" : esc(names)} from the event on the NRC Referee Hub today.</p>` +
        `<p>The claims below were still open. From today they are no longer tracked on the hub, and USATH and the NRC take no responsibility for them. Please settle them directly with the official${open.length > 1 ? "s" : ""}.</p>` + claimsTable(open, true) +
        `<p><strong>Officials and payment details</strong></p><ul>${contacts}</ul>` +
        `<p>Attached: ${attachments.length - 1} receipt${attachments.length - 1 === 1 ? "" : "s"} and a CSV of the claims with every detail recorded on the hub.${missing.length ? " Not attached (too large or unavailable), to ask the official for: " + esc(missing.join(", ")) + "." : ""}</p>` +
        `<p>${esc(names)} ${open.length > 1 ? "are" : "is"} copied on this email.</p>` + sign;
      const cc = [...ccOfficials, ...(t.payment_email && t.payment_email.toLowerCase() !== to.toLowerCase() ? [t.payment_email] : []), nrc];
      const m = isDemo(to) ? { sent: false, error: "demo address" } : await sendMail({ to, cc, subject, html, replyTo: nrc, attachments });
      await sb.from("email_log").insert({ to_email: to, subject, kind: "settlement_handover", sent: m.sent, error: m.error });
      if (!m.sent) return json(502, { error: "The handover email could not be sent: " + (m.error || "unknown error") + ". Nobody was removed." });
      const now = new Date().toISOString(), snap = snapshot(open);
      for (const o of open) await sb.from("expense_settlements").update({ status: "closed", closed_at: now, final_sent_at: now, final_snapshot: snap.find(s => s.assignment_id === o.a.id) }).eq("assignment_id", o.a.id).eq("status", "notice");
      final = { to, receipts: attachments.length - 1, missing: missing.length };
    }
    const { error } = await sb.from("assignments").delete().in("id", ids);
    if (error) return json(500, { error: error.message });
    const refs = people.map(o => o.a.referee_id).filter(Boolean);
    if (refs.length) await sb.from("assignment_requests").update({ status: "declined", response_note: "Removed by the NRC after designation" }).eq("tournament_id", t.id).in("referee_id", refs);
    return json(200, { removed: ids.length, handover: final });
  }

  return json(400, { error: "Unknown action" });
};

export const config = { path: "/api/settlement" };
