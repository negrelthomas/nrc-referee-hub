// Reads an uploaded document with Gemini and returns its fields. Nothing is saved here; the page shows the result for checking.
// POST /api/read-document with the user's session token, body { kind, path }
//   kind "sheet"   path in the private score-sheets bucket, "<tournament_id>/<file>". Admins, or the organizer of that event.
//                  Returns { read: { is_score_sheet, game_number, game_date, team_a, team_b, score_a, score_b, half_a, half_b, confidence } }
//   kind "flight"  path in the private receipts bucket, "<user_id>/bookings/<file>" (admins: any). An airline confirmation or e-ticket.
//                  Returns { read: { is_itinerary, airline_reference, total_amount, currency, legs: [{ airline, flight_number, from, to, depart, arrive }] } }
// Settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, GEMINI_DOC_MODEL (default gemini-flash-lite-latest:
// the lighter model has a larger free daily quota, and these documents are short). Netlify stops a function after 10 seconds.
import { createClient } from "@supabase/supabase-js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MIME = { pdf: "application/pdf", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", jpg: "image/jpeg", jpeg: "image/jpeg" };

const SHEET_PROMPT = `You read handball score sheets (match reports) from a tournament. Return the fields of this sheet.
game_number: the match or game number printed or written on the sheet, as text (for example "12"). Null if none.
game_date: the date of the game in YYYY-MM-DD if written, else null.
team_a: the first team named (home, left side or team A), as written.
team_b: the second team named (guest, right side or team B), as written.
score_a, score_b: the final score of team A and team B (after overtime or shoot-out if any). Integers.
half_a, half_b: the half-time score if written, else null.
is_score_sheet: false if the document is not a handball score sheet.
confidence: high, medium or low, for the game number, team names and final score taken together. Use low when handwriting is hard to read.
Read only what is written. Do not guess a value that is not on the sheet.`;

const SHEET_SCHEMA = { type: "OBJECT", properties: {
  is_score_sheet: { type: "BOOLEAN" }, game_number: { type: "STRING", nullable: true }, game_date: { type: "STRING", nullable: true },
  team_a: { type: "STRING", nullable: true }, team_b: { type: "STRING", nullable: true },
  score_a: { type: "INTEGER", nullable: true }, score_b: { type: "INTEGER", nullable: true },
  half_a: { type: "INTEGER", nullable: true }, half_b: { type: "INTEGER", nullable: true },
  confidence: { type: "STRING", enum: ["high", "medium", "low"] } }, required: ["is_score_sheet", "confidence"] };

const FLIGHT_PROMPT = `You read airline booking confirmations and e-tickets for a sports referee committee. Return the flight itinerary.
legs: one entry per flight segment, in travel order. airline: the operating or marketing airline name. flight_number: carrier code and number, for example "UA 1234".
from, to: 3 letter IATA airport codes. depart, arrive: local date and time as YYYY-MM-DDTHH:MM, as printed (local time at each airport).
airline_reference: the booking reference or record locator (PNR), usually 6 letters and digits.
total_amount: the total fare paid for the whole booking, taxes included, as a number. Null if not shown. currency: ISO 4217 code of total_amount.
passenger: the passenger name as printed.
is_itinerary: false if the document is not a flight booking, e-ticket or itinerary.
confidence: high, medium or low for the legs.`;

const FLIGHT_SCHEMA = { type: "OBJECT", properties: {
  is_itinerary: { type: "BOOLEAN" }, airline_reference: { type: "STRING", nullable: true }, passenger: { type: "STRING", nullable: true },
  total_amount: { type: "NUMBER", nullable: true }, currency: { type: "STRING", nullable: true },
  legs: { type: "ARRAY", items: { type: "OBJECT", properties: { airline: { type: "STRING", nullable: true }, flight_number: { type: "STRING", nullable: true },
    from: { type: "STRING", nullable: true }, to: { type: "STRING", nullable: true }, depart: { type: "STRING", nullable: true }, arrive: { type: "STRING", nullable: true } } } },
  confidence: { type: "STRING", enum: ["high", "medium", "low"] } }, required: ["is_itinerary", "confidence"] };

export async function readDoc(bytes, mime, kind) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "Document reading is not set up (GEMINI_API_KEY missing). Enter the fields by hand." };
  const model = process.env.GEMINI_DOC_MODEL || "gemini-flash-lite-latest";
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: Buffer.from(bytes).toString("base64") } }, { text: kind === "sheet" ? SHEET_PROMPT : FLIGHT_PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: kind === "sheet" ? SHEET_SCHEMA : FLIGHT_SCHEMA }
  };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: ctl.signal });
    if (r.status === 429) { const t = await r.text(); return { error: /per ?day|PerDay/i.test(t) ? "The reader has reached its daily limit. The rest can be read tomorrow, or entered by hand." : "The reader is busy (limit per minute). Waiting before the next one.", retry: !/per ?day|PerDay/i.test(t), limit: true }; }
    if (!r.ok) return { error: "The reader did not answer (" + r.status + ")." };
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const out = JSON.parse(text);
    if (kind === "flight") {
      out.legs = (out.legs || []).map(l => ({ ...l, from: l.from ? String(l.from).toUpperCase().slice(0, 3) : null, to: l.to ? String(l.to).toUpperCase().slice(0, 3) : null }));
      if (out.currency) out.currency = String(out.currency).toUpperCase().slice(0, 3);
    } else if (out.game_date && !/^\d{4}-\d{2}-\d{2}$/.test(out.game_date)) out.game_date = null;
    out.model = model;
    return { read: out };
  } catch (e) {
    return { error: e.name === "AbortError" ? "The reader took too long on this file." : "The file could not be read." };
  } finally { clearTimeout(timer); }
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: "Server is missing Supabase settings" });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sign in required" });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: who } = await sb.auth.getUser(token);
  if (!who?.user) return json(401, { error: "Invalid session" });
  const uid = who.user.id, email = String(who.user.email || "").toLowerCase();
  const { data: prof } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  const isAdmin = prof?.role === "admin";
  let input; try { input = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }
  const kind = input.kind, path = String(input.path || "");
  if (!["sheet", "flight"].includes(kind) || !path || path.includes("..")) return json(400, { error: "kind and path required" });

  let bucket;
  if (kind === "sheet") {
    bucket = "score-sheets";
    const tid = path.split("/")[0];
    if (!isAdmin) {
      const { data: t } = await sb.from("tournaments").select("organizer_user_id,organizer_email").eq("id", tid).maybeSingle();
      if (!t || !(t.organizer_user_id === uid || String(t.organizer_email || "").toLowerCase() === email)) return json(403, { error: "Only the NRC or the organizer of this event can read its score sheets" });
    }
  } else {
    bucket = "receipts";
    if (!isAdmin && !path.startsWith(uid + "/")) return json(403, { error: "Not your file" });
  }
  const { data: file, error } = await sb.storage.from(bucket).download(path);
  if (error || !file) return json(404, { error: "File not found" });
  if (file.size > 10 * 1024 * 1024) return json(413, { error: "File larger than 10 MB." });
  const ext = path.split(".").pop().toLowerCase();
  const mime = file.type && file.type !== "application/octet-stream" ? file.type : (MIME[ext] || "image/jpeg");
  return json(200, await readDoc(await file.arrayBuffer(), mime, kind));
};
export const config = { path: "/api/read-document" };
