// Expense claims: read a receipt, convert to USD, record the claim.
// POST /api/expense-claim with the user's session token, body { action, ... }
//   action "read"   { receipt_path }  The receipt already uploaded to the private receipts bucket is sent to Gemini,
//                                     which returns category, merchant, date, total, currency and hotel nights.
//                                     Nothing is saved; the referee checks the fields before submitting.
//   action "fx"     { currency, date }  USD per unit: average of the ECB daily reference rates over the 30 calendar
//                                     days ending on the purchase date (Frankfurter). Preview for the form.
//   action "submit" { claim }         Validates, converts with the same rule, and inserts the claim (waiting for the
//                                     organizer). The rate, window and source are frozen on the claim.
// Settings: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, GEMINI_MODEL (default gemini-flash-latest).
// Netlify stops a function after 10 seconds, so the reader gives up after 9 and the form falls back to typing.
// Gemini free tier: Google may use submitted receipts to improve its products. Switch the key to a paid project to stop that.
import { createClient } from "@supabase/supabase-js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const KINDS_CLAIMANT = ["flight", "hotel", "transport", "car"];
const KINDS_ALL = ["flight", "hotel", "transport", "car", "per_diem", "mileage", "other"];
const CAT_TO_KIND = { airfare: "flight", hotel: "hotel", rideshare_taxi: "transport", car_rental: "car" };
const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(new Date(s + "T12:00:00"));
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

// 30 day average, window ending on the purchase date (or today if the date is later)
export async function fxRate(currency, date) {
  const cur = String(currency || "").toUpperCase();
  if (cur === "USD") return { rate: 1, start: date, end: date, source: "USD, no conversion", days: 0 };
  const end = date > today() ? today() : date, start = addDays(end, -29);
  // v1 serves the ECB reference rates (about 30 currencies, permanently available); v2 adds other central banks
  // (Serbian dinar and the like) and is used only when v1 has no rate for the currency.
  const urls = [
    [`https://api.frankfurter.dev/v1/${start}..${end}?base=${cur}&symbols=USD`, "ECB reference rates via Frankfurter"],
    [`https://api.frankfurter.app/${start}..${end}?from=${cur}&to=USD`, "ECB reference rates via Frankfurter"],
    [`https://api.frankfurter.dev/v2/rates?from=${start}&to=${end}&base=${cur}&quotes=USD`, "central bank rates via Frankfurter"]
  ];
  const values = d => {
    const list = Array.isArray(d) ? d : Array.isArray(d && d.rates) ? d.rates : null;
    if (list) return list.filter(x => !x.quote || String(x.quote).toUpperCase() === "USD").map(x => Number(x.rate != null ? x.rate : x.USD));
    return Object.values((d && d.rates) || {}).map(x => Number(x && (x.USD ?? x.usd)));
  };
  for (const [u, label] of urls) {
    try {
      const r = await fetch(u, { headers: { accept: "application/json" } });
      if (!r.ok) continue;
      const vals = values(await r.json()).filter(v => v > 0 && isFinite(v));
      if (!vals.length) continue;
      const rate = vals.reduce((a, b) => a + b, 0) / vals.length;
      return { rate: Math.round(rate * 1e8) / 1e8, start, end, days: vals.length, source: `${label}, average of ${vals.length} daily rates ${start} to ${end}` };
    } catch (e) { /* try the next endpoint */ }
  }
  return null;
}

export async function readReceipt(bytes, mime) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "Receipt reading is not set up (GEMINI_API_KEY missing). Enter the fields by hand." };
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const prompt = `You read travel expense receipts for a sports referee committee. Return the fields of this document.
category: airfare (airline ticket, baggage fee, seat), hotel (lodging), rideshare_taxi (Uber, Lyft, taxi, shuttle), car_rental (rental car, fuel, parking, tolls), food (restaurant, groceries), other.
merchant: the business name as printed.
purchase_date: the date of payment or purchase in YYYY-MM-DD. For a hotel folio use the check out or payment date; for a flight use the booking or payment date, not the travel date.
total_amount: the final total actually paid, taxes and tips included, as a number without currency symbol. Use the grand total, not a subtotal or a balance.
currency: ISO 4217 code of total_amount (USD, CAD, EUR, MXN...). Infer from the symbol and the country when needed.
nights: number of nights for a hotel, otherwise null.
description: at most 12 words, for example "SFO to BOS round trip, economy" or "2 nights, Hampton Inn Downtown".
is_receipt: false if the document is not a receipt, invoice or booking confirmation with a price.
confidence: high, medium or low for the amount and date.`;
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: Buffer.from(bytes).toString("base64") } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0, responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: {
        is_receipt: { type: "BOOLEAN" }, category: { type: "STRING", enum: ["airfare", "hotel", "rideshare_taxi", "car_rental", "food", "other"] },
        merchant: { type: "STRING", nullable: true }, purchase_date: { type: "STRING", nullable: true }, total_amount: { type: "NUMBER", nullable: true },
        currency: { type: "STRING", nullable: true }, nights: { type: "INTEGER", nullable: true }, description: { type: "STRING", nullable: true },
        confidence: { type: "STRING", enum: ["high", "medium", "low"] } }, required: ["is_receipt", "category", "confidence"] }
    }
  };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: ctl.signal });
    if (r.status === 429) return { error: "The receipt reader has reached its daily limit. Enter the fields by hand; the receipt is attached either way." };
    if (!r.ok) return { error: "The receipt reader did not answer (" + r.status + "). Enter the fields by hand." };
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    const out = JSON.parse(text);
    if (out.currency) out.currency = String(out.currency).toUpperCase().slice(0, 3);
    if (out.purchase_date && !isoDate(out.purchase_date)) out.purchase_date = null;
    out.kind = CAT_TO_KIND[out.category] || null;
    out.model = model;
    return { read: out };
  } catch (e) {
    return { error: e.name === "AbortError" ? "The receipt reader took too long. Enter the fields by hand." : "The receipt could not be read. Enter the fields by hand." };
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
  const uid = who.user.id;
  const { data: prof } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  const isAdmin = prof?.role === "admin";
  let input; try { input = await req.json(); } catch (e) { return json(400, { error: "bad json" }); }

  if (input.action === "fx") {
    if (!/^[A-Za-z]{3}$/.test(input.currency || "") || !isoDate(input.date)) return json(400, { error: "Currency and date required" });
    const fx = await fxRate(input.currency, input.date);
    return fx ? json(200, fx) : json(422, { error: "No published rate for " + String(input.currency).toUpperCase() + ". Enter the USD amount charged on your card statement." });
  }

  if (input.action === "read") {
    const path = String(input.receipt_path || "");
    if (!path || (!isAdmin && !path.startsWith(uid + "/"))) return json(403, { error: "Not your receipt" });
    const { data: file, error } = await sb.storage.from("receipts").download(path);
    if (error || !file) return json(404, { error: "Receipt not found" });
    if (file.size > 10 * 1024 * 1024) return json(413, { error: "Receipt larger than 10 MB. Enter the fields by hand." });
    const ext = path.split(".").pop().toLowerCase();
    const mime = file.type && file.type !== "application/octet-stream" ? file.type : ({ pdf: "application/pdf", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" }[ext] || "image/jpeg");
    const out = await readReceipt(await file.arrayBuffer(), mime);
    return json(200, out);
  }

  if (input.action === "submit") {
    const c = input.claim || {};
    const { data: asg } = await sb.from("assignments").select("id,tournament_id,referee_id,guest_official_id, referees(user_id), guest_officials(user_id), tournaments(name,start_date,end_date)").eq("id", c.assignment_id).maybeSingle();
    if (!asg) return json(404, { error: "Assignment not found" });
    const own = (asg.referees && asg.referees.user_id === uid) || (asg.guest_officials && asg.guest_officials.user_id === uid);
    if (!own && !isAdmin) return json(403, { error: "You can claim expenses only for events you are designated for" });
    const kinds = isAdmin ? KINDS_ALL : KINDS_CLAIMANT;
    if (!kinds.includes(c.kind)) return json(400, { error: "Choose a category: Airfare, Hotel, Rideshare and taxis, or Car rental and related." });
    const amountOriginal = Math.round(Number(c.amount_original) * 100) / 100;
    if (!(amountOriginal > 0) || amountOriginal > 50000) return json(400, { error: "Enter the total paid, as printed on the receipt." });
    const currency = String(c.currency || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return json(400, { error: "Currency must be a 3 letter code, for example USD or CAD." });
    if (!isoDate(c.purchase_date)) return json(400, { error: "Enter the date of payment or purchase." });
    if (c.purchase_date > addDays(today(), 1) || c.purchase_date < addDays(today(), -730)) return json(400, { error: "The date of purchase looks wrong." });
    const receipt = c.receipt_url ? String(c.receipt_url) : null;
    if (c.kind !== "per_diem" && c.kind !== "mileage" && !receipt) return json(400, { error: "Attach the receipt. Every claim except the food per diem needs one." });
    if (receipt && !isAdmin && !receipt.startsWith(uid + "/")) return json(403, { error: "Receipt not yours" });
    const nights = c.kind === "hotel" && c.nights != null && c.nights !== "" ? parseInt(c.nights, 10) : null;
    if (nights != null && (isNaN(nights) || nights < 0 || nights > 60)) return json(400, { error: "Number of nights looks wrong." });

    // USD conversion
    let fx = await fxRate(currency, c.purchase_date), usd;
    if (fx) usd = Math.round(amountOriginal * fx.rate * 100) / 100;
    else {
      const manual = Math.round(Number(c.usd_manual) * 100) / 100;
      if (!(manual > 0)) return json(422, { error: "No published rate for " + currency + ". Enter the USD amount charged on your card statement.", need_usd: true });
      usd = manual; fx = { rate: Math.round(manual / amountOriginal * 1e8) / 1e8, start: null, end: null, source: "USD amount from the card statement, entered by the claimant (no published rate for " + currency + ")" };
    }

    // duplicates
    if (!c.confirm_duplicate) {
      const { data: dup } = await sb.from("expense_claims").select("id").eq("assignment_id", asg.id).eq("kind", c.kind).eq("purchase_date", c.purchase_date).eq("amount_original", amountOriginal).neq("status", "rejected").limit(1);
      if (dup && dup.length) return json(409, { error: "A claim with the same category, date and amount is already on file for this event. Submit anyway only if it is a different expense.", duplicate: true });
    }

    const read = c.ai_read && typeof c.ai_read === "object" ? c.ai_read : null;
    const kept = read ? ["kind", "merchant", "purchase_date", "amount_original", "currency", "nights"].filter(k => {
      const v = { kind: read.kind, merchant: read.merchant, purchase_date: read.purchase_date, amount_original: read.total_amount, currency: read.currency, nights: read.nights }[k];
      const mine = { kind: c.kind, merchant: c.merchant, purchase_date: c.purchase_date, amount_original: amountOriginal, currency, nights }[k];
      return v != null && String(v) === String(mine);
    }) : null;
    const row = {
      assignment_id: asg.id, kind: c.kind, amount: usd, amount_original: amountOriginal, currency, purchase_date: c.purchase_date,
      merchant: c.merchant ? String(c.merchant).slice(0, 120) : null, description: c.description ? String(c.description).slice(0, 300) : null,
      nights, receipt_url: receipt, status: "submitted", reimbursed_by: "organizer", submitted_by: uid,
      fx_rate: fx.rate, fx_window_start: fx.start, fx_window_end: fx.end, fx_source: fx.source, ai_read: read, ai_fields: kept, claimant_notified_status: "submitted"
    };
    const { data: saved, error } = await sb.from("expense_claims").insert(row).select("id,amount,coverage,coverage_note").single();
    if (error) return json(500, { error: error.message });
    return json(200, { claim: saved, fx });
  }

  return json(400, { error: "Unknown action" });
};

export const config = { path: "/api/expense-claim" };
