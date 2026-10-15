// Sends staffing emails and records them. Called from the admin page.
// kinds: invite | reminder | confirm (to referees), organizer (to the tournament organizer with the designated referees)
// Env vars (Netlify > Site configuration > Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only), GMAIL_USER, GMAIL_APP_PASSWORD, MAIL_FROM, SITE_URL
import { createClient } from "@supabase/supabase-js";
import { sendMail, fmtDate, coverage } from "./mailer.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await admin.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
  if (!prof || prof.role !== "admin") return json(403, { error: "Admin only" });

  const { tournament_id, request_ids, kind } = await req.json();
  if (!tournament_id || !kind) return json(400, { error: "tournament_id and kind required" });
  const { data: t } = await admin.from("tournaments").select("*").eq("id", tournament_id).single();
  if (!t) return json(404, { error: "Tournament not found" });
  const base = (SITE_URL || "").replace(/\/$/, "");
  const when = `${fmtDate(t.start_date)} to ${fmtDate(t.end_date)}`;
  const where = `${t.venue_name || ""}${t.venue_address ? ", " + t.venue_address : ""}, ${t.venue_city}, ${t.venue_state}${t.nearest_airport_iata ? " (nearest airport " + t.nearest_airport_iata + ")" : ""}`;
  const covers = coverage(t);
  const contact = process.env.CONTACT_EMAIL || "referee@handballusa.org";

  // Designated referees (confirmed) with their partner, used by the organizer and confirmation emails
  const { data: confirmedRows } = await admin.from("assignments").select("role, referees(id, first_name, last_name, email, phone, cert_level, home_city, home_state, home_airport_iata, clubs(name))").eq("tournament_id", tournament_id);
  const designated = (confirmedRows || []).map(a => ({ role: a.role, ...a.referees }));
  const LEVEL = { candidate: "Candidate", level_1: "Level 1", level_2: "Level 2", level_3: "Level 3", nachc: "NACHC", ihf: "IHF" };

  if (kind === "organizer") {
    const link = `${base}/tournament.html?token=${t.organizer_token}`;
    const rows = designated.map(r => `<tr><td style="padding:4px 10px 4px 0">${esc(r.first_name + " " + r.last_name)}</td><td style="padding:4px 10px 4px 0">${LEVEL[r.cert_level] || ""}${r.role !== "referee" ? ", " + esc(r.role) : ""}</td><td style="padding:4px 10px 4px 0">${esc(r.clubs ? r.clubs.name : "")}</td><td style="padding:4px 0">${esc([r.home_city, r.home_state].filter(Boolean).join(", "))}${r.home_airport_iata ? " (" + esc(r.home_airport_iata) + ")" : ""}</td></tr>`).join("");
    const subject = `Referees designated for ${t.name}, ${fmtDate(t.start_date)}`;
    const html = `<p>Hi ${esc(t.organizer_name)},</p><p>The National Referee Committee has designated the referees for <strong>${esc(t.name)}</strong>, ${when}, at ${esc(where)}.</p>
      <table style="border-collapse:collapse;font-size:14px">${rows}</table>
      <p>Names, contact details and travel information are on your tournament page, which only you have the link to:<br><a href="${link}">${link}</a></p>
      <p>What the referees have been told you cover:<br>${covers.map(esc).join("<br>")}</p>
      <p>Questions or changes: ${contact}.</p><p>National Referee Committee</p>`;
    const r = await sendMail({ to: t.organizer_email, subject, html });
    await admin.from("email_log").insert({ to_email: t.organizer_email, subject, kind, sent: r.sent, error: r.error });
    if (r.sent) await admin.from("tournaments").update({ organizer_notified_at: new Date().toISOString() }).eq("id", t.id);
    return json(200, { results: [{ email: t.organizer_email, sent: r.sent, error: r.error }] });
  }

  if (!Array.isArray(request_ids) || !request_ids.length) return json(400, { error: "request_ids required" });
  const { data: reqs } = await admin.from("assignment_requests").select("*, referees(*)").in("id", request_ids).eq("tournament_id", tournament_id);
  const { data: pairs } = await admin.from("pairs").select("*").is("valid_until", null);
  const partnerOf = id => { const p = (pairs || []).find(p => p.referee_a === id || p.referee_b === id); if (!p) return null; const pid = p.referee_a === id ? p.referee_b : p.referee_a; return designated.find(d => d.id === pid) || null; };

  const results = [];
  for (const r of reqs || []) {
    const ref = r.referees; if (!ref) continue;
    const accept = `${base}/respond.html?token=${r.token}&answer=accept`;
    const tentative = `${base}/respond.html?token=${r.token}&answer=tentative`;
    const decline = `${base}/respond.html?token=${r.token}&answer=decline`;
    let subject, html;
    if (kind === "confirm") {
      const partner = partnerOf(ref.id);
      const others = designated.filter(d => d.id !== ref.id).map(d => esc(d.first_name + " " + d.last_name) + " (" + (LEVEL[d.cert_level] || "") + ")").join(", ");
      subject = `Confirmed: ${t.name}, ${fmtDate(t.start_date)}`;
      html = `<p>Hi ${esc(ref.first_name)},</p><p>You are confirmed as a referee for <strong>${esc(t.name)}</strong>.</p>
        <p><strong>When:</strong> ${when}${t.earliest_return_last_day ? "<br>Do not book a departure before " + String(t.earliest_return_last_day).slice(0, 5) + " on the last day." : ""}<br>
        <strong>Where:</strong> ${esc(where)}<br>
        ${t.games_expected ? "<strong>Games:</strong> about " + t.games_expected + " over the event<br>" : ""}
        ${partner ? "<strong>Your partner:</strong> " + esc(partner.first_name + " " + partner.last_name) + "<br>" : ""}
        ${others ? "<strong>Referee team:</strong> " + others + "<br>" : ""}
        <strong>Organizer:</strong> ${esc(t.organizer_name)}, ${esc(t.organizer_email)}${t.organizer_phone ? ", " + esc(t.organizer_phone) : ""}</p>
        <p><strong>What the organizer covers</strong><br>${covers.map(esc).join("<br>")}</p>
        ${t.notes ? "<p><strong>From the organizer:</strong> " + esc(t.notes) + "</p>" : ""}
        <p>Your assignment and travel notes are on your referee home: <a href="${base}/profile.html">${base}/profile.html</a>. Send travel details to the organizer and copy ${contact}.</p><p>National Referee Committee</p>`;
    } else {
      const again = kind === "reminder" ? "<p>This is a reminder; the NRC has not received your answer yet.</p>" : "";
      subject = `${kind === "reminder" ? "Reminder: " : ""}Referee invitation, ${t.name}, ${fmtDate(t.start_date)}`;
      html = `<p>Hi ${esc(ref.first_name)},</p>${again}<p>The NRC proposes you as a referee for <strong>${esc(t.name)}</strong>, ${when}, at ${esc(where)}. ${t.games_expected ? "About " + t.games_expected + " games over the event." : ""}</p>
        <p>What the organizer covers:<br>${covers.map(esc).join("<br>")}</p>
        <p><a href="${accept}" style="background:#C8102E;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Accept</a>&nbsp;&nbsp;<a href="${tentative}" style="background:#04234F;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Tentative</a>&nbsp;&nbsp;<a href="${decline}" style="color:#04234F;padding:12px 18px;text-decoration:underline">Decline</a></p>
        <p>The proposal is also on your referee home, where you can review the details and answer: <a href="${base}/login.html?next=profile.html">sign in</a>.</p>
        <p>Please answer within 7 days. Nothing to book until the NRC confirms the final selection. Questions: ${contact}.</p><p>National Referee Committee</p>`;
    }
    const r2 = await sendMail({ to: ref.email, subject, html });
    const patch = kind === "confirm" ? { status: "confirmed" } : kind === "reminder" ? { reminder_count: (r.reminder_count || 0) + 1 } : { status: "sent", sent_at: new Date().toISOString() };
    if (r2.sent) await admin.from("assignment_requests").update(patch).eq("id", r.id);
    await admin.from("email_log").insert({ request_id: r.id, to_email: ref.email, subject, kind, sent: r2.sent, error: r2.error });
    results.push({ request_id: r.id, email: ref.email, sent: r2.sent, error: r2.error });
  }
  return json(200, { results });
};

export const config = { path: "/api/send-invitations" };
