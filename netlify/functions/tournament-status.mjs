// Organizer view of a tournament: who is designated, with contact details. The organizer token in the link is the secret.
import { createClient } from "@supabase/supabase-js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  const url = new URL(req.url); const token = url.searchParams.get("token");
  if (!token) return json(400, { error: "token required" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: t } = await admin.from("tournaments").select("id,name,sanction,start_date,end_date,venue_name,venue_address,venue_city,venue_state,nearest_airport_iata,pairs_needed,pairs_organizer,organizer_pairs_note,travel_managed_by,games_expected,status,organizer_name,organizer_email,supervisor_needed,supervisor_notes,hotel_nights_covered,flights_covered,airport_transfers_covered,airport_transfer_how,hotel_to_venue_transport,food_stipend_per_day,meals_provided,earliest_return_last_day,organizer_notified_at").eq("organizer_token", token).maybeSingle();
  if (!t) return json(404, { error: "This link is not valid." });
  const { data: asg } = await admin.from("assignments").select("role,travel_notes,referees(first_name,last_name,email,phone,home_city,home_state,home_airport_iata,departure_airport_iata,photo_url,clubs(name))").eq("tournament_id", t.id);
  const { data: pending } = await admin.from("assignment_requests").select("status").eq("tournament_id", t.id).in("status", ["sent", "accepted", "tentative"]);
  return json(200, { tournament: t, designated: (asg || []).map(a => ({ role: a.role, travel_notes: a.travel_notes, ...a.referees, club: a.referees && a.referees.clubs ? a.referees.clubs.name : null })), in_progress: (pending || []).length });
};
export const config = { path: "/api/tournament-status" };
