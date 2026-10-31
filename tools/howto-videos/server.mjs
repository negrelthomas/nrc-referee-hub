// Local demo server for the NRC Referee Hub: serves site/, a small PostgREST compatible API over local Postgres,
// a fake GoTrue (any code works), local storage, and the real Netlify functions (emails are not sent).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import crypto from "node:crypto";
import pg from "pg";

const PORT = +process.env.PORT || 8080;
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SITE = process.env.SITE || path.join(REPO, "site");
const FUNCS = process.env.FUNCS || path.join(REPO, "netlify", "functions");
const STORE = process.env.STORE || path.join(HERE, "storage");
const BASE = `http://localhost:${PORT}`;
const pool = new pg.Pool({ host: process.env.PGHOST || "/tmp", port: +(process.env.PGPORT || 5433), user: "postgres", database: process.env.DB || "hub", max: 8 });
pool.on("error", () => {});
const DEMO = path.dirname(url.fileURLToPath(import.meta.url));

// ---------- JWT (unsigned, local only) ----------
const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export const jwt = (p) => b64u({ alg: "HS256", typ: "JWT" }) + "." + b64u(p) + "." + b64u("demo");
const claimsOf = (req) => {
  const h = req.headers.authorization || ""; const tok = h.replace(/^Bearer\s+/i, "") || req.headers.apikey || "";
  try { return JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()); } catch { return { role: "anon" }; }
};
process.env.SUPABASE_URL = BASE + "/sb";
process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: "service_role", iss: "supabase", exp: 4102444800 });
process.env.SUPABASE_ANON_KEY = jwt({ role: "anon", iss: "supabase", exp: 4102444800 });
process.env.SITE_URL = BASE;
process.env.CONTACT_EMAIL = process.env.CONTACT_EMAIL || "nrc@example.org";

// ---------- SQL helpers ----------
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const meta = { fk: null, cols: {}, pk: {}, fn: {} };
async function loadMeta(c) {
  const fk = await c.query(`select tc.relname as t, a.attname as c, rc.relname as rt, ra.attname as rcol
    from pg_constraint k join pg_class tc on tc.oid=k.conrelid join pg_class rc on rc.oid=k.confrelid
    join pg_namespace n on n.oid=tc.relnamespace and n.nspname='public' join pg_namespace rn on rn.oid=rc.relnamespace and rn.nspname='public'
    join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] join pg_attribute ra on ra.attrelid=k.confrelid and ra.attnum=k.confkey[1]
    where k.contype='f' and array_length(k.conkey,1)=1`);
  meta.fk = fk.rows;
  const cols = await c.query(`select c.relname t, a.attname c from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where a.attnum>0 and not a.attisdropped and c.relkind in ('r','v','m','p')`);
  meta.cols = {}; for (const r of cols.rows) (meta.cols[r.t] ||= []).push(r.c);
  const pk = await c.query(`select c.relname t, array_agg(a.attname order by a.attnum) cols from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' join pg_attribute a on a.attrelid=c.oid and a.attnum=any(i.indkey) where i.indisprimary group by c.relname`);
  meta.pk = {}; for (const r of pk.rows) meta.pk[r.t] = r.cols;
  const fn = await c.query(`select p.proname, p.proretset, t.typtype, t.typname, p.prorettype, coalesce(p.proargnames,'{}') names, coalesce(p.proargmodes::text[],'{}') modes,
    (select array_agg(format_type(x,null)) from unnest(p.proargtypes) x) types from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' join pg_type t on t.oid=p.prorettype`);
  meta.fn = {}; for (const r of fn.rows) meta.fn[r.proname] = r;
}

// split on commas at depth 0
function splitTop(s) { const out = []; let d = 0, cur = "", q = false; for (const ch of s) { if (ch === '"') q = !q; if (!q && ch === "(") d++; if (!q && ch === ")") d--; if (!q && d === 0 && ch === ",") { out.push(cur); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map(x => x.trim()).filter(Boolean); }
function parseSelect(s) {
  const items = []; for (const raw of splitTop(s || "*")) {
    const m = raw.match(/^(?:([\w]+):)?([\w]+)(?:!([\w]+))?(?:!([\w]+))?\((.*)\)$/s);
    if (m) { const hints = [m[3], m[4]].filter(Boolean); items.push({ embed: true, alias: m[1] || m[2], rel: m[2], inner: hints.includes("inner"), hint: hints.find(h => h !== "inner" && h !== "left"), sel: m[5] }); continue; }
    const c = raw.match(/^(?:([\w]+):)?([\w*]+)(?:->>?[\w'"]+)*(?:::(\w+))?$/);
    if (c) items.push({ col: c[2], alias: c[1], cast: c[3] }); else items.push({ col: raw });
  }
  return items;
}
function relFor(base, rel, hint) {
  const fks = meta.fk;
  let r = fks.find(f => f.t === base && f.rt === rel && (!hint || f.c === hint || hint.includes(f.c)));
  if (r) return { kind: "one", fkcol: r.c, refcol: r.rcol };
  r = fks.find(f => f.t === rel && f.rt === base && (!hint || f.c === hint || hint.includes(f.c)));
  if (r) return { kind: "many", fkcol: r.c, refcol: r.rcol };
  // views: guess by column name
  const sing = rel.replace(/ies$/, "y").replace(/s$/, ""); const cols = meta.cols[base] || [];
  const cand = [sing + "_id", sing.split("_").pop() + "_id"].find(x => cols.includes(x));
  if (cand) return { kind: "one", fkcol: cand, refcol: "id" };
  const rcols = meta.cols[rel] || []; const bs = base.replace(/ies$/, "y").replace(/s$/, "");
  const c2 = [bs + "_id", bs.split("_").pop() + "_id"].find(x => rcols.includes(x));
  if (c2) return { kind: "many", fkcol: c2, refcol: "id" };
  throw Object.assign(new Error(`Could not find a relationship between '${base}' and '${rel}'`), { code: "PGRST200", status: 400 });
}
function colList(items, alias) {
  const parts = [];
  for (const it of items) {
    if (it.embed) continue;
    if (it.col === "*") parts.push(`${alias}.*`);
    else parts.push(`${alias}.${qi(it.col)}${it.cast ? "::" + it.cast : ""}${it.alias ? " as " + qi(it.alias) : (it.cast ? " as " + qi(it.col) : "")}`);
  }
  return parts;
}
// filters: { key: [ "eq.x", ... ] }, may be prefixed with an embed name
function parseVal(op, v) { return v; }
function cond(alias, col, expr, P) {
  let neg = false; if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf("."); const op = expr.slice(0, i); let v = expr.slice(i + 1);
  const c = `${alias}.${qi(col)}`; let s;
  const add = (x) => { P.push(x); return "$" + P.length; };
  switch (op) {
    case "eq": s = `${c} = ${add(v)}`; break; case "neq": s = `${c} <> ${add(v)}`; break;
    case "gt": s = `${c} > ${add(v)}`; break; case "gte": s = `${c} >= ${add(v)}`; break;
    case "lt": s = `${c} < ${add(v)}`; break; case "lte": s = `${c} <= ${add(v)}`; break;
    case "like": s = `${c}::text like ${add(v.replace(/\*/g, "%"))}`; break; case "ilike": s = `${c}::text ilike ${add(v.replace(/\*/g, "%"))}`; break;
    case "is": s = `${c} is ${({ null: "null", true: "true", false: "false", unknown: "unknown" })[v] || "null"}`; break;
    case "in": { const arr = splitTop(v.replace(/^\(|\)$/g, "")).map(x => x.replace(/^"|"$/g, "")); s = arr.length ? `${c}::text = any(${add(arr)}::text[])` : "false"; break; }
    case "cs": s = v.startsWith("{") ? `${c} @> ${add(v)}` : `${c} @> ${add(v)}::jsonb`; break;
    case "cd": s = `${c} <@ ${add(v)}`; break; case "ov": s = `${c} && ${add(v.replace(/^\(/, "{").replace(/\)$/, "}"))}`; break;
    default: throw Object.assign(new Error("Unsupported operator " + op), { status: 400 });
  }
  return neg ? `not (${s})` : s;
}
function orCond(alias, expr, P) {
  const inner = expr.replace(/^\(|\)$/g, "");
  return "(" + splitTop(inner).map(p => {
    if (p.startsWith("and(")) return "(" + splitTop(p.slice(4, -1)).map(q => { const [col, ...r] = q.split("."); return cond(alias, col, r.join("."), P); }).join(" and ") + ")";
    const [col, ...r] = p.split("."); return cond(alias, col, r.join("."), P);
  }).join(" or ") + ")";
}
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"]);
function buildSelect(table, params, fromExpr, P) {
  const items = parseSelect(params.get("select"));
  const alias = "t";
  const filters = []; const embedFilters = {};
  for (const [k, v] of params) {
    if (RESERVED.has(k)) { if (k === "or") filters.push(orCond(alias, v, P)); continue; }
    if (k.endsWith(".or")) { (embedFilters[k.slice(0, -3)] ||= []).push({ or: v }); continue; }
    if (k.includes(".")) { const [e, c] = k.split("."); (embedFilters[e] ||= []).push({ col: c, expr: v }); continue; }
    filters.push(cond(alias, k, v, P));
  }
  const cols = colList(items, alias);
  for (const e of items.filter(x => x.embed)) {
    const r = relFor(table, e.rel, e.hint); const sub = parseSelect(e.sel); const ea = "e_" + e.alias;
    const ecols = colList(sub, ea).join(", ") || `${ea}.*`;
    const ef = (embedFilters[e.alias] || embedFilters[e.rel] || []).map(f => f.or ? orCond(ea, f.or, P) : cond(ea, f.col, f.expr, P));
    const join = r.kind === "one" ? `${ea}.${qi(r.refcol)} = ${alias}.${qi(r.fkcol)}` : `${ea}.${qi(r.fkcol)} = ${alias}.${qi(r.refcol)}`;
    const where = [join, ...ef].join(" and ");
    if (r.kind === "one") cols.push(`(select to_jsonb(s) from (select ${ecols} from public.${qi(e.rel)} ${ea} where ${where} limit 1) s) as ${qi(e.alias)}`);
    else cols.push(`coalesce((select jsonb_agg(to_jsonb(s)) from (select ${ecols} from public.${qi(e.rel)} ${ea} where ${where}) s), '[]'::jsonb) as ${qi(e.alias)}`);
    if (e.inner || (ef.length && r.kind === "one")) filters.push(`exists (select 1 from public.${qi(e.rel)} ${ea} where ${where})`);
  }
  let sql = `select ${cols.join(", ") || alias + ".*"} from ${fromExpr} ${alias}` + (filters.length ? " where " + filters.join(" and ") : "");
  const base = sql;
  const ord = params.get("order");
  if (ord) sql += " order by " + ord.split(",").map(o => { const [c, ...m] = o.split("."); if (c.includes("(")) return null; return `${alias}.${qi(c)} ${m.includes("desc") ? "desc" : "asc"}${m.includes("nullsfirst") ? " nulls first" : m.includes("nullslast") ? " nulls last" : ""}`; }).filter(Boolean).join(", ");
  if (params.get("limit")) sql += " limit " + (+params.get("limit"));
  if (params.get("offset")) sql += " offset " + (+params.get("offset"));
  return { sql, base };
}

async function withRole(claims, fn) {
  const c = await pool.connect();
  try {
    if (!meta.fk) await loadMeta(c);
    await c.query("begin");
    const role = ["anon", "authenticated", "service_role", "postgres"].includes(claims.role) ? claims.role : "anon";
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('role', $2, true)`, [JSON.stringify(claims), role]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
function pgErr(e) {
  const status = e.status || ({ "42501": 403, "23505": 409, "P0001": 400, "PGRST116": 406, "42P01": 404 })[e.code] || 400;
  return { status, body: { code: e.code || "PGRST000", message: e.message, details: e.detail || null, hint: e.hint || null } };
}

async function rest(req, res, u, body) {
  const claims = claimsOf(req);
  const parts = u.pathname.replace(/^\/sb\/rest\/v1\//, "").split("/");
  const prefer = String(req.headers.prefer || "");
  const wantObj = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  const params = u.searchParams;
  const send = (status, data, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(data === undefined ? "" : JSON.stringify(data)); };
  try {
    if (parts[0] === "rpc") {
      const name = parts[1]; const f = meta.fn[name] || (await withRole({ role: "service_role" }, async () => meta.fn[name]));
      if (!f) throw Object.assign(new Error(`Could not find the function public.${name}`), { code: "PGRST202", status: 404 });
      const args = body ? JSON.parse(body) : Object.fromEntries([...params].filter(([k]) => !RESERVED.has(k)));
      const P = []; const names = f.names || []; const types = f.types || []; const modes = f.modes || [];
      const inNames = names.filter((n, i) => !modes.length || ["i", "b"].includes(modes[i])).slice(0, types.length);
      const argSql = Object.entries(args).map(([k, v]) => {
        const idx = inNames.indexOf(k); const ty = types[idx] || "text";
        P.push(v === null ? null : (ty.includes("json") ? JSON.stringify(v) : (Array.isArray(v) ? v : (typeof v === "object" ? JSON.stringify(v) : String(v)))));
        return `${qi(k)} => $${P.length}::${ty}`;
      }).join(", ");
      const call = `public.${qi(name)}(${argSql})`;
      const r = await withRole(claims, async (c) => {
        if (f.typname === "void") { await c.query(`select ${call}`, P); return null; }
        if (f.proretset || f.typtype === "c" || f.typname === "record") {
          const q = await c.query(`select to_jsonb(r) j from ${call} r`, P); const rows = q.rows.map(x => x.j);
          return f.proretset ? rows : (rows[0] ?? null);
        }
        const q = await c.query(`select to_jsonb(${call}) j`, P); return q.rows[0].j;
      });
      return send(200, r);
    }
    const table = parts[0];
    const method = req.method;
    const out = await withRole(claims, async (c) => {
      const P = [];
      if (method === "GET" || method === "HEAD") {
        const { sql, base } = buildSelect(table, params, `public.${qi(table)}`, P);
        const rows = (await c.query(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) j from (${sql}) x`, P)).rows[0].j;
        let count = null; if (/count=(exact|planned|estimated)/.test(prefer)) count = +(await c.query(`select count(*) n from (${base}) x`, P)).rows[0].n;
        return { rows, count };
      }
      const data = body ? JSON.parse(body) : {};
      const arr = Array.isArray(data) ? data : [data];
      const keys = [...new Set(arr.flatMap(o => Object.keys(o)))].filter(k => (meta.cols[table] || []).includes(k));
      let mut;
      if (method === "POST") {
        const conflict = params.get("on_conflict") ? params.get("on_conflict").split(",") : (meta.pk[table] || ["id"]);
        let oc = "";
        if (/resolution=merge-duplicates/.test(prefer)) oc = ` on conflict (${conflict.map(qi).join(",")}) do update set ${keys.filter(k => !conflict.includes(k)).map(k => `${qi(k)} = excluded.${qi(k)}`).join(", ") || conflict.map(k => `${qi(k)} = excluded.${qi(k)}`).join(", ")}`;
        else if (/resolution=ignore-duplicates/.test(prefer)) oc = ` on conflict do nothing`;
        P.push(JSON.stringify(arr));
        mut = `insert into public.${qi(table)} as t (${keys.map(qi).join(",")}) select ${keys.map(qi).join(",")} from jsonb_populate_recordset(null::public.${qi(table)}, $1)${oc} returning t.*`;
        if (!keys.length) mut = `insert into public.${qi(table)} as t default values returning t.*`;
      } else if (method === "PATCH") {
        P.push(JSON.stringify(data));
        const f = []; for (const [k, v] of params) { if (RESERVED.has(k)) { if (k === "or") f.push(orCond("t", v, P)); continue; } f.push(cond("t", k, v, P)); }
        mut = `update public.${qi(table)} as t set ${keys.map(k => `${qi(k)} = r.${qi(k)}`).join(", ")} from jsonb_populate_record(null::public.${qi(table)}, $1) r${f.length ? " where " + f.join(" and ") : ""} returning t.*`;
      } else if (method === "DELETE") {
        const f = []; for (const [k, v] of params) { if (RESERVED.has(k)) { if (k === "or") f.push(orCond("t", v, P)); continue; } f.push(cond("t", k, v, P)); }
        mut = `delete from public.${qi(table)} as t${f.length ? " where " + f.join(" and ") : ""} returning t.*`;
      } else throw Object.assign(new Error("method"), { status: 405 });
      if (!/return=representation/.test(prefer)) { await c.query(mut, P); return { rows: null }; }
      const sp = new URLSearchParams(); if (params.get("select")) sp.set("select", params.get("select"));
      const P2 = P.slice(); const { sql } = buildSelect(table, sp, "m", P2);
      const rows = (await c.query(`with m as (${mut}) select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) j from (${sql}) x`, P2)).rows[0].j;
      return { rows };
    });
    const headers = {};
    if (out.count != null) headers["content-range"] = `0-${Math.max(0, (out.rows || []).length - 1)}/${out.count}`;
    if (out.rows === null) return send(method === "POST" ? 201 : 204, undefined, headers);
    if (wantObj) { if (out.rows.length !== 1) return send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${out.rows.length} rows`, hint: null }); return send(200, out.rows[0], headers); }
    if (method === "HEAD") return send(200, undefined, headers);
    return send(method === "POST" ? 201 : 200, out.rows, headers);
  } catch (e) { const { status, body } = pgErr(e); if (process.env.DEBUG) console.log("REST ERR", req.method, u.pathname + u.search, e.message); return send(status, body); }
}

// ---------- fake auth ----------
async function userByEmail(email) {
  return withRole({ role: "postgres" }, async (c) => {
    let r = await c.query("select * from auth.users where lower(email)=lower($1)", [email]);
    if (!r.rows[0]) r = await c.query("insert into auth.users (email) values (lower($1)) returning *", [email]);
    await c.query("update auth.users set last_sign_in_at=now() where id=$1", [r.rows[0].id]);
    return r.rows[0];
  });
}
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.email_confirmed_at, app_metadata: { provider: "email" }, user_metadata: u.raw_user_meta_data || {}, created_at: u.created_at, updated_at: u.updated_at, last_sign_in_at: u.last_sign_in_at });
export function session(u) {
  const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
  const access_token = jwt({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp, session_id: crypto.randomUUID(), iss: BASE + "/sb/auth/v1" });
  return { access_token, token_type: "bearer", expires_in: 86400 * 30, expires_at: exp, refresh_token: "r." + u.id, user: userJson(u) };
}
async function auth(req, res, u, body) {
  const p = u.pathname.replace(/^\/sb\/auth\/v1/, ""); const send = (s, d) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(d)); };
  const b = body ? JSON.parse(body) : {};
  try {
    if (p === "/otp" || p === "/magiclink") {
      if (process.env.ROSTER_CHECK !== "0") {
        const ok = await withRole({ role: "service_role" }, async (c) => (await c.query(`select 1 from public.referees where lower(email)=lower($1) union select 1 from public.admin_invites where lower(email)=lower($1) union select 1 from public.tournaments where lower(organizer_email)=lower($1) union select 1 from public.guest_officials where lower(email)=lower($1)`, [b.email])).rowCount);
        if (!ok) return send(422, { code: 422, error_code: "unexpected_failure", msg: "Signups not allowed: this email is not on the NRC referee roster" });
      }
      return send(200, {});
    }
    if (p === "/verify") { const email = b.email || (b.token_hash || "").split(":")[0]; const usr = await userByEmail(email); const s = session(usr); return send(200, s); }
    if (p === "/token") { const id = (b.refresh_token || "").slice(2); const r = await withRole({ role: "postgres" }, c => c.query("select * from auth.users where id=$1", [id])); if (!r.rows[0]) return send(400, { error: "invalid_grant" }); return send(200, session(r.rows[0])); }
    const cl = claimsOf(req);
    if (p === "/user" && req.method === "GET") { const r = await withRole({ role: "postgres" }, c => c.query("select * from auth.users where id=$1", [cl.sub])); if (!r.rows[0]) return send(401, { msg: "not signed in" }); return send(200, userJson(r.rows[0])); }
    if (p === "/user" && req.method === "PUT") { const r = await withRole({ role: "postgres" }, c => c.query("select * from auth.users where id=$1", [cl.sub])); return send(200, { ...userJson(r.rows[0]), new_email: b.email }); }
    if (p === "/logout") { res.writeHead(204); return res.end(); }
    if (p.startsWith("/admin/users")) return send(200, { users: [] });
    return send(200, {});
  } catch (e) { return send(400, { msg: e.message }); }
}

// ---------- storage ----------
async function storage(req, res, u, bodyBuf) {
  const p = decodeURIComponent(u.pathname.replace(/^\/sb\/storage\/v1/, ""));
  let m;
  if (((m = p.match(/^\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/)) || (m = p.match(/^\/object\/([^/]+)\/(.+)$/))) && req.method === "GET") {
    const f = path.join(STORE, m[1], m[2]); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": mime(f) }); return fs.createReadStream(f).pipe(res);
  }
  if ((m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ signedURL: `/object/sign/${m[1]}/${m[2]}?token=demo` })); }
  if ((m = p.match(/^\/object\/sign\/([^/]+)$/))) { const b = JSON.parse(bodyBuf.toString()); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(b.paths.map(x => ({ path: x, signedURL: `/object/sign/${m[1]}/${x}?token=demo`, error: null })))); }
  if ((m = p.match(/^\/object\/([^/]+)\/(.+)$/)) && (req.method === "POST" || req.method === "PUT")) {
    const f = path.join(STORE, m[1], m[2]); fs.mkdirSync(path.dirname(f), { recursive: true });
    let data = bodyBuf; const ct = req.headers["content-type"] || "";
    if (ct.startsWith("multipart/form-data")) { const bd = ct.split("boundary=")[1]; const s = data.toString("latin1"); const i = s.indexOf("\r\n\r\n") + 4; const j = s.lastIndexOf("\r\n--" + bd); data = Buffer.from(s.slice(i, j), "latin1"); }
    fs.writeFileSync(f, data); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ Key: m[1] + "/" + m[2], Id: crypto.randomUUID() }));
  }
  if ((m = p.match(/^\/object\/([^/]+)$/)) && req.method === "DELETE") { res.writeHead(200, { "content-type": "application/json" }); return res.end("[]"); }
  res.writeHead(200, { "content-type": "application/json" }); res.end("{}");
}

// ---------- Netlify functions ----------
const fnCache = {};
async function loadFns() {
  for (const f of fs.readdirSync(FUNCS).filter(x => x.endsWith(".mjs") && x !== "mailer.mjs")) {
    try { const mod = await import(path.join(FUNCS, f)); const p = mod.config && mod.config.path; if (p && mod.default) fnCache[Array.isArray(p) ? p[0] : p] = mod.default; } catch (e) { console.log("fn load fail", f, e.message); }
  }
}
export const mailLog = [];
async function fn(req, res, u, bodyBuf) {
  const h = fnCache[u.pathname];
  if (!h) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true })); }
  const r = await h(new Request(BASE + u.pathname + u.search, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : bodyBuf }), {});
  const txt = r ? await r.text() : ""; res.writeHead(r ? r.status : 200, Object.fromEntries(r ? r.headers : [])); res.end(txt);
}

// ---------- outside services: receipt reader and FX rates, answered locally ----------
// queued answers for the score sheet and flight readers: POST /__mock { sheets: [...], flights: [...] }
const MOCK = { sheets: [], flights: [] };
let NEXT_READ = { is_receipt: true, category: "airfare", merchant: "United Airlines", purchase_date: "2026-12-02", total_amount: 286.4, currency: "USD", nights: null, description: "SJC to DEN round trip, economy", confidence: "high" };
process.env.GEMINI_API_KEY = "demo";
process.env.RESEND_API_KEY = "demo";
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, opts) => {
  const s = String(u);
  if (s.includes("generativelanguage.googleapis.com") && opts && /handball score sheets|airline booking/.test(String(opts.body))) {
    await new Promise(r => setTimeout(r, 500));
    const sheet = /handball score sheets/.test(String(opts.body)), q = sheet ? MOCK.sheets : MOCK.flights;
    const out = q.length ? q.shift() : (sheet ? { is_score_sheet: false, confidence: "low" } : { is_itinerary: false, confidence: "low" });
    if (out.__status) return new Response(out.__body || "", { status: out.__status });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (s.includes("generativelanguage.googleapis.com")) { await new Promise(r => setTimeout(r, 1400)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(NEXT_READ) }] } }] }), { status: 200, headers: { "content-type": "application/json" } }); }
  if (s.includes("api.resend.com")) { try { const b = JSON.parse(opts.body); mailLog.push({ to: b.to, subject: b.subject }); if (process.env.DEBUG) console.log("MAIL", b.to, b.subject); } catch (e) {} return new Response(JSON.stringify({ id: "demo" }), { status: 200, headers: { "content-type": "application/json" } }); }
  if (s.includes("frankfurter")) { const rates = {}; for (let i = 0; i < 21; i++) rates["2026-11-" + String(i + 1).padStart(2, "0")] = { USD: 1.07 + (i % 5) * 0.004 }; return new Response(JSON.stringify({ rates }), { status: 200, headers: { "content-type": "application/json" } }); }
  return realFetch(u, opts);
};
// ---------- static ----------
const mime = (f) => ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".pdf": "application/pdf", ".ico": "image/x-icon" })[path.extname(f).toLowerCase()] || "application/octet-stream";
function fontsCss() {
  const out = []; for (const [fam, pkg] of [["Barlow", "barlow"], ["Barlow Condensed", "barlow-condensed"]]) for (const w of [400, 500, 600, 700]) {
    const f = `/__fonts/${pkg}/files/${pkg}-latin-${w}-normal.woff2`; out.push(`@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:swap;src:url(${f}) format('woff2')}`);
  } return out.join("\n");
}
function serveStatic(req, res, u) {
  let p = decodeURIComponent(u.pathname);
  if (p.startsWith("/__fonts/")) { const f = path.join(DEMO, "node_modules/@fontsource", p.slice(9)); if (fs.existsSync(f)) { res.writeHead(200, { "content-type": "font/woff2" }); return fs.createReadStream(f).pipe(res); } }
  if (p === "/__fonts.css") { res.writeHead(200, { "content-type": "text/css" }); return res.end(fontsCss()); }
  if (p === "/__sb.js") { res.writeHead(200, { "content-type": "text/javascript" }); return fs.createReadStream(path.join(DEMO, "node_modules/@supabase/supabase-js/dist/umd/supabase.js")).pipe(res); }
  let f = path.join(SITE, p); if (p.endsWith("/")) f = path.join(f, "index.html");
  if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (fs.existsSync(path.join(f, "index.html"))) f = path.join(f, "index.html"); else { res.writeHead(404); return res.end("not found"); } }
  if (f.endsWith(".html") || f.endsWith("config.js")) {
    let s = fs.readFileSync(f, "utf8");
    s = s.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2[^"']*/g, "/__sb.js")
      .replace(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/g, '<link rel="stylesheet" href="/__fonts.css">')
      .replace(/<link[^>]*rel="preconnect"[^>]*>/g, "")
      .replace(/https:\/\/ssdhgyikzdvqpglwacsq\.supabase\.co/g, BASE + "/sb");
    if (f.endsWith("config.js")) s = s.replace(/SUPABASE_ANON_KEY:\s*"[^"]*"/, `SUPABASE_ANON_KEY: "${process.env.SUPABASE_ANON_KEY}"`);
    res.writeHead(200, { "content-type": mime(f), "cache-control": "no-store" }); return res.end(s);
  }
  // byte ranges for video
  const st = fs.statSync(f); const range = req.headers.range;
  if (range) { const [a, b] = range.replace("bytes=", "").split("-"); const s = +a, e = b ? +b : st.size - 1; res.writeHead(206, { "content-type": mime(f), "content-range": `bytes ${s}-${e}/${st.size}`, "accept-ranges": "bytes", "content-length": e - s + 1 }); return fs.createReadStream(f, { start: s, end: e }).pipe(res); }
  res.writeHead(200, { "content-type": mime(f), "content-length": st.size, "accept-ranges": "bytes" }); fs.createReadStream(f).pipe(res);
}

const server = http.createServer((req, res) => {
  const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", async () => {
    const buf = Buffer.concat(chunks); const u = new URL(req.url, BASE);
    res.setHeader("access-control-allow-origin", "*"); res.setHeader("access-control-allow-headers", "*"); res.setHeader("access-control-allow-methods", "*"); res.setHeader("access-control-expose-headers", "content-range");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    try {
      if (u.pathname.startsWith("/sb/rest/v1/")) return await rest(req, res, u, buf.length ? buf.toString() : "");
      if (u.pathname.startsWith("/sb/auth/v1")) return await auth(req, res, u, buf.length ? buf.toString() : "");
      if (u.pathname.startsWith("/sb/storage/v1")) return await storage(req, res, u, buf);
      if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/.netlify/functions/")) return await fn(req, res, u, buf);
      if (u.pathname === "/__session" ) { const usr = await userByEmail(u.searchParams.get("email")); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(session(usr))); }
      if (u.pathname === "/__next_read") { NEXT_READ = JSON.parse(buf.toString()); res.writeHead(200); return res.end("ok"); }
      if (u.pathname === "/__mock" && req.method === "POST") { const b = JSON.parse(buf.toString() || "{}"); if (b.sheets) MOCK.sheets = b.sheets; if (b.flights) MOCK.flights = b.flights; res.writeHead(200); return res.end("ok"); }
      if (u.pathname === "/__reload") { meta.fk = null; res.writeHead(200); return res.end("ok"); }
      return serveStatic(req, res, u);
    } catch (e) { console.log("ERR", u.pathname, e); if (!res.headersSent) res.writeHead(500); res.end(String(e.message)); }
  });
});
await loadFns();
server.listen(PORT, () => console.log("demo on " + BASE + " fns: " + Object.keys(fnCache).join(" ")));
