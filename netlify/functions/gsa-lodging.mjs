// Hotel benchmark for the request form: the federal (GSA) lodging rate for the venue city and the month of the event.
// The GSA rate excludes taxes, so the form compares the organizer's fully loaded figure with the GSA rate plus a
// typical 15% for hotel taxes and fees. The check is a prompt, never a block (group rates can be lower).
// GET /api/gsa-lodging?city=Fremont&state=CA&date=2027-01-29
// Setting: GSA_API_KEY (free key from api.data.gov); DEMO_KEY is used without one (low hourly limit).
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "public, max-age=86400" } });
export const TAX_UPLIFT = 0.15;

async function fetchYear(city, state, fy, key) {
  const u = `https://api.gsa.gov/travel/perdiem/v2/rates/city/${encodeURIComponent(city.replace(/['.-]/g, " ").replace(/\s+/g, " ").trim())}/state/${state}/year/${fy}`;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(u, { headers: { "x-api-key": key, accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) return null;
    const d = await r.json();
    const list = (d.rates || []).flatMap(x => x.rate || []);
    return list.length ? list : null;
  } catch (e) { return null; } finally { clearTimeout(timer); }
}

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const city = String(q.get("city") || "").trim(), state = String(q.get("state") || "").trim().toUpperCase(), date = String(q.get("date") || "");
  if (!city || !/^[A-Z]{2}$/.test(state) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: "city, state and date are required" });
  const y = +date.slice(0, 4), m = +date.slice(5, 7), fy = m >= 10 ? y + 1 : y;     // federal fiscal year starts October 1
  const key = process.env.GSA_API_KEY || "DEMO_KEY";
  let list = null, used = fy;
  for (const yr of [fy, fy - 1, fy - 2]) { list = await fetchYear(city, state, yr, key); if (list) { used = yr; break; } }
  if (!list) return json(404, { error: "No federal lodging rate found for this city" });
  const lc = city.toLowerCase(), isStd = r => r.standardRate === true || String(r.standardRate).toLowerCase() === "true";
  const pick = list.find(r => String(r.city || "").toLowerCase().split(/\s*\/\s*/).includes(lc)) || list.find(r => !isStd(r)) || list[0];
  const month = (pick.months && pick.months.month || []).find(x => +x.number === m);
  const lodging = Number(month ? month.value : 0);
  if (!lodging) return json(404, { error: "No federal lodging rate found for this month" });
  return json(200, { lodging, benchmark: Math.round(lodging * (1 + TAX_UPLIFT)), uplift: TAX_UPLIFT, area: pick.city || city, county: pick.county || null, standard: isStd(pick), fiscal_year: used, same_year: used === fy, month: m });
};

export const config = { path: "/api/gsa-lodging" };
