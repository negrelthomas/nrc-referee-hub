// Scheduled job, every 15 minutes: sends event changes nobody sent.
// The admin window and the organizer page send their update straight away; this catches the edits left behind when a
// page reloads, a tab closes or the window is never closed. An event is picked up once its last pending edit is 30 minutes
// old, so a run of edits goes out as one email. Edits older than 48 hours are not sent automatically: the admin sees them
// on the tournament list ("Update not sent") and sends or dismisses them.
import { createClient } from "@supabase/supabase-js";
import { sendChangeNotice, isPublic } from "./change-notice.mjs";

const QUIET_MIN = 30, MAX_AGE_H = 48;

export default async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return new Response("missing settings", { status: 500 });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const since = new Date(Date.now() - MAX_AGE_H * 36e5).toISOString();
  const { data: ch, error } = await admin.from("tournament_changes").select("tournament_id, changes, created_at, changed_by_role, changed_by_label").is("notified_at", null).gte("created_at", since);
  if (error) return new Response(error.message, { status: 500 });
  const byTour = {};
  for (const c of ch || []) (byTour[c.tournament_id] = byTour[c.tournament_id] || []).push(c);
  const today = new Date().toISOString().slice(0, 10), quietBefore = Date.now() - QUIET_MIN * 6e4, done = [];
  for (const [id, rows] of Object.entries(byTour)) {
    if (rows.some(r => new Date(r.created_at).getTime() > quietBefore)) continue; // still being edited
    const cancelledNow = rows.some(r => r.changes && r.changes.status && r.changes.status.to === "cancelled");
    if (!cancelledNow && !rows.some(isPublic)) continue; // internal only: left for the admin log, nothing to send
    const { data: t } = await admin.from("tournaments").select("*").eq("id", id).maybeSingle();
    if (!t || t.end_date < today) continue;
    const names = [...new Set(rows.map(r => r.changed_by_label || r.changed_by_role).filter(Boolean))].join(", ");
    const r = await sendChangeNotice(admin, t, { kind: cancelledNow && t.status === "cancelled" ? "cancel" : "changes", actor: (names || "Someone") + " (sent automatically, the update was not sent at the time)", force: false });
    done.push(`${t.name}: ${r.nothing ? "nothing to send" : r.results.filter(x => x.sent).length + " sent"}`);
  }
  return new Response(done.join("\n") || "nothing pending");
};

export const config = { schedule: "*/15 * * * *" };
