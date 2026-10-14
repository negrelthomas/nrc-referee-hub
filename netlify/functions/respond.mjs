// Records a referee's answer from the email link (no sign in needed; the token is the secret).
import { createClient } from "@supabase/supabase-js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { token, answer, note } = await req.json();
  if (!token || !["accept", "decline"].includes(answer)) return json(400, { error: "token and answer required" });
  const { data: r } = await admin.from("assignment_requests").select("id,status,referee_id,tournament_id,tournaments(name,start_date,end_date,venue_city,venue_state),referees(first_name)").eq("token", token).maybeSingle();
  if (!r) return json(404, { error: "This link is not valid." });
  if (["confirmed", "cancelled"].includes(r.status)) return json(200, { already: true, status: r.status, tournament: r.tournaments, name: r.referees?.first_name });
  const status = answer === "accept" ? "accepted" : "declined";
  await admin.from("assignment_requests").update({ status, responded_at: new Date().toISOString(), response_note: note || null }).eq("id", r.id);
  return json(200, { status, tournament: r.tournaments, name: r.referees?.first_name });
};

export const config = { path: "/api/respond" };
