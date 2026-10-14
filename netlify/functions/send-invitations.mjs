// Sends assignment invitations by email and records them. Called from the admin page.
// Env vars (Netlify > Site configuration > Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only, never in the site), RESEND_API_KEY,
//   MAIL_FROM (e.g. "NRC Referee Hub <referee@handballusa.org>"), SITE_URL (e.g. https://nrc-referee-hub.netlify.app)
import { createClient } from "@supabase/supabase-js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, MAIL_FROM, SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });

  // Caller must be a signed in admin: verify the user's token with the anon client, then act with the service role.
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: "Invalid session" });
  const { data: prof } = await admin.from("profiles").select("role").eq("id", who.user.id).maybeSingle();
  if (!prof || prof.role !== "admin") return json(403, { error: "Admin only" });

  const { tournament_id, request_ids, kind } = await req.json(); // kind: invite | reminder | confirm
  if (!tournament_id || !Array.isArray(request_ids) || !request_ids.length) return json(400, { error: "tournament_id and request_ids required" });

  const { data: t } = await admin.from("tournaments").select("*").eq("id", tournament_id).single();
  if (!t) return json(404, { error: "Tournament not found" });
  const { data: reqs } = await admin.from("assignment_requests").select("*, referees(*)").in("id", request_ids).eq("tournament_id", tournament_id);

  const fmt = d => new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const covers = [
    t.flights_covered ? "Flights covered" : "Flights not covered",
    (t.hotel_nights_covered || 0) + " hotel night" + (t.hotel_nights_covered === 1 ? "" : "s") + " covered",
    t.airport_transfers_covered ? "Airport transfers covered" + (t.airport_transfer_how ? " (" + t.airport_transfer_how + ")" : "") : "Airport transfers not covered",
    t.hotel_to_venue_transport ? "Hotel to venue: " + t.hotel_to_venue_transport : null,
    t.food_stipend_per_day ? "Food stipend: $" + t.food_stipend_per_day + " per day" : (t.meals_provided ? "Meals: " + t.meals_provided : null),
    t.earliest_return_last_day ? "Earliest departure on the last day: " + String(t.earliest_return_last_day).slice(0, 5) : null
  ].filter(Boolean);

  const results = [];
  for (const r of reqs || []) {
    const ref = r.referees; if (!ref) continue;
    const base = (SITE_URL || "").replace(/\/$/, "");
    const accept = `${base}/respond.html?token=${r.token}&answer=accept`;
    const decline = `${base}/respond.html?token=${r.token}&answer=decline`;
    let subject, html;
    if (kind === "confirm") {
      subject = `Confirmed: ${t.name}, ${fmt(t.start_date)}`;
      html = `<p>Hi ${ref.first_name},</p><p>You are confirmed as a referee for <strong>${t.name}</strong>, ${fmt(t.start_date)} to ${fmt(t.end_date)}, at ${t.venue_name || ""}, ${t.venue_city}, ${t.venue_state}.</p><p>${covers.join("<br>")}</p><p>Organizer contact: ${t.organizer_name}, ${t.organizer_email}${t.organizer_phone ? ", " + t.organizer_phone : ""}.</p><p>Your assignments and travel notes are on your referee home: ${base}/profile.html</p><p>National Referee Committee</p>`;
    } else {
      const again = kind === "reminder" ? "<p>This is a reminder; we have not received your answer yet.</p>" : "";
      subject = `${kind === "reminder" ? "Reminder: " : ""}Referee invitation, ${t.name}, ${fmt(t.start_date)}`;
      html = `<p>Hi ${ref.first_name},</p>${again}<p>The NRC invites you to referee <strong>${t.name}</strong>, ${fmt(t.start_date)} to ${fmt(t.end_date)}, at ${t.venue_name || ""}, ${t.venue_city}, ${t.venue_state}${t.nearest_airport_iata ? " (nearest airport " + t.nearest_airport_iata + ")" : ""}. ${t.games_expected ? "About " + t.games_expected + " games over the event." : ""}</p><p>What the organizer covers:<br>${covers.join("<br>")}</p><p><a href="${accept}" style="background:#C8102E;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Accept</a>&nbsp;&nbsp;<a href="${decline}" style="color:#04234F;padding:12px 18px;text-decoration:underline">Decline</a></p><p>Please answer within 7 days. Questions: ${process.env.CONTACT_EMAIL || "referee@handballusa.org"}.</p><p>National Referee Committee</p>`;
    }
    let sent = false, error = null;
    if (RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ from: MAIL_FROM || "NRC Referee Hub <onboarding@resend.dev>", to: [ref.email], subject, html }) });
      sent = res.ok; if (!res.ok) error = await res.text();
    } else error = "RESEND_API_KEY not set; email not sent";
    const patch = kind === "confirm" ? { status: "confirmed" } : kind === "reminder" ? { reminder_count: (r.reminder_count || 0) + 1 } : { status: "sent", sent_at: new Date().toISOString() };
    if (sent) await admin.from("assignment_requests").update(patch).eq("id", r.id);
    await admin.from("email_log").insert({ request_id: r.id, to_email: ref.email, subject, kind, sent, error });
    results.push({ request_id: r.id, email: ref.email, sent, error });
  }
  return json(200, { results });
};

export const config = { path: "/api/send-invitations" };
