// Shared helper: payout accounts an official has already been paid to (table payout_known).
// The key rule matches public.payout_key in supabase/expenses_v6_known_payouts.sql.
export const LABEL = { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" };

export function payoutKey(method, handle) {
  const h = String(handle == null ? "" : handle).trim();
  if (!h) return null;
  const m = String(method || "").toLowerCase();
  const digits = h.replace(/\D/g, "");
  if (m !== "venmo" && h.includes("@")) return h.toLowerCase();
  if (m !== "venmo" && digits.length >= 10) return digits.slice(-10);
  return h.toLowerCase().replace(/^@/, "");
}

export async function knownFor(sb, email) {
  if (!email) return [];
  const { data } = await sb.from("payout_known").select("method,handle,handle_key,source").eq("email", String(email).toLowerCase());
  return data || [];
}

// source of the matching known account, or null
export function matchKnown(rows, method, handle) {
  const k = payoutKey(method, handle);
  if (!k) return null;
  const r = (rows || []).find(x => x.method === method && x.handle_key === k);
  return r ? r.source : null;
}
