#!/bin/bash
# Builds hub_base (schema and migrations from ../../supabase, no seed) once, then DB (default hub) = hub_base + seed.sql.
# Pass "base" to rebuild hub_base after a new migration. Needs a local Postgres (PGHOST, PGPORT; default /tmp and 5433).
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
P0="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U postgres -q"
if [ "$1" = "base" ] || ! $P0 -tAc "select 1 from pg_database where datname='hub_base'" | grep -q 1; then
  $P0 -c "drop database if exists hub_base"; $P0 -c "create database hub_base"
  $P0 -d hub_base -f "$HERE/shim.sql" 2>/dev/null
  $P0 -d hub_base -c "create type public.user_role as enum ('referee','admin','organizer')" -c "alter type public.user_role add value 'evaluator'" 2>/dev/null
  $P0 -d hub_base -f "$REPO/supabase/schema.sql" >/dev/null 2>&1
  while read f; do $P0 -d hub_base -f "$REPO/supabase/$f" 2>&1 | grep ERROR | grep -v leaderboard.sql; done < "$HERE/migrations.txt"
fi
$P0 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('${DB:-hub}') and pid<>pg_backend_pid()" >/dev/null
$P0 -c "drop database if exists ${DB:-hub}" -c "create database ${DB:-hub} template hub_base"
$P0 -d ${DB:-hub} -v ON_ERROR_STOP=1 -1 -f "$HERE/seed.sql" 2>&1 | grep -E "ERROR|DETAIL" | head -5
mkdir -p "$HERE/storage/receipts/demo" && cp "$HERE/receipt-flight.jpg" "$HERE/storage/receipts/demo/flight-jordan.jpg" && cp "$HERE/receipt-flight.jpg" "$HERE/storage/receipts/demo/flight-sam.jpg"
curl -s localhost:${PORT:-8080}/__reload >/dev/null
