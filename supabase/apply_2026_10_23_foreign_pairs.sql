-- Run in the Supabase SQL editor (2026-10-23). Applies pairs_total.sql, guest_officials.sql and agreed_note.sql
-- in one transaction: if any statement fails, nothing is applied. Safe to re-run.
begin;

-- Referee pairs: the organizer gives the total pairs the tournament requires and the pairs sourced outside USATH
-- (for example Canada or Europe). The pairs USATH staffs (pairs_needed) are always calculated: total minus organizer pairs.
-- pairs_needed stays the column every page, email and view reads; it is no longer an input.
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table public.tournaments add column if not exists pairs_total int;

-- existing events: total = USATH pairs + organizer pairs
update public.tournaments set pairs_total = coalesce(pairs_needed, 0) + coalesce(pairs_organizer, 0) where pairs_total is null;

alter table public.tournaments alter column pairs_total set not null;
alter table public.tournaments drop constraint if exists tournaments_pairs_total_check;
alter table public.tournaments add constraint tournaments_pairs_total_check check (pairs_total >= 0);
alter table public.tournaments drop constraint if exists tournaments_pairs_split_check;
alter table public.tournaments add constraint tournaments_pairs_split_check check (pairs_needed = pairs_total - coalesce(pairs_organizer, 0));

create or replace function public.tournament_pairs_derive()
returns trigger language plpgsql as $$
declare org int := coalesce(new.pairs_organizer, 0);
begin
  new.pairs_organizer := org;
  if new.pairs_total is null then
    -- a writer that only knows the old fields (NRC placeholder, old script): keep its USATH count, derive the total
    new.pairs_total := coalesce(new.pairs_needed, 0) + org;
  elsif tg_op = 'UPDATE' and new.pairs_total is not distinct from old.pairs_total
        and new.pairs_needed is distinct from old.pairs_needed then
    -- an old page edited the USATH count directly: treat it as a change of the total
    new.pairs_total := coalesce(new.pairs_needed, 0) + org;
  end if;
  if org > new.pairs_total then
    raise exception 'The pairs sourced outside USATH (%) exceed the total pairs the tournament requires (%).', org, new.pairs_total;
  end if;
  new.pairs_needed := new.pairs_total - org;
  return new;
end $$;

-- the name sorts before tournament_guard and tournament_guard_and_log, so the change log records the derived figures
drop trigger if exists tournament_a_pairs on public.tournaments;
create trigger tournament_a_pairs before insert or update on public.tournaments
  for each row execute function public.tournament_pairs_derive();

-- check: no row where the split does not add up
select count(*) as rows_out_of_balance from public.tournaments where pairs_needed <> pairs_total - pairs_organizer;


-- Guest officials: referee pairs from outside USATH (Canada, Europe...) designated for an event.
-- Rule (NRC, 2026-10-23): a pair from outside USATH is always the organizer's pair. USATH may recommend one informally
-- but designates USATH pairs only. The organizer or the NRC records the pair, within the pairs the organizer declared
-- outside USATH (tournaments.pairs_organizer). Raising that number is a change to the request, logged and notified.
-- Guests sit on the same assignments as USATH referees so bookings, expense claims and the finance totals cover them,
-- but they have no referee record: no login, no invitation, no evaluation, no history, no ranking.
-- Run once in the Supabase SQL editor, after pairs_total.sql. Safe to re-run.

create table if not exists public.guest_officials (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  federation text not null,          -- country or federation, e.g. Canada (CHF), France (FFHB)
  email text,
  phone text,
  home_city text,
  home_airport_iata text,
  pair_key uuid,                     -- the two guests of a pair share it; reused when the pair comes back
  payment_notes text,                -- how to reimburse (method, payee); no bank or card numbers
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guest_officials_pair_idx on public.guest_officials (pair_key);
alter table public.guest_officials enable row level security;
drop policy if exists guest_admin on public.guest_officials;
create policy guest_admin on public.guest_officials for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists guest_organizer_read on public.guest_officials;
create policy guest_organizer_read on public.guest_officials for select
  using (id in (select guest_official_id from public.assignments where tournament_id in (select public.organizer_tournament_ids())));
grant select, insert, update, delete on public.guest_officials to authenticated;

-- An assignment is either a USATH referee or a guest, never both
alter table public.assignments alter column referee_id drop not null;
alter table public.assignments add column if not exists guest_official_id uuid references public.guest_officials(id) on delete cascade;
alter table public.assignments drop constraint if exists assignments_one_person;
alter table public.assignments add constraint assignments_one_person check (num_nonnulls(referee_id, guest_official_id) = 1);
alter table public.assignments drop constraint if exists assignments_tournament_guest_key;
alter table public.assignments add constraint assignments_tournament_guest_key unique (tournament_id, guest_official_id);

-- Guests are referee pairs only, and named pairs never exceed the pairs the organizer declared outside USATH
alter table public.assignments drop constraint if exists assignments_guest_referee;
alter table public.assignments add constraint assignments_guest_referee check (guest_official_id is null or role = 'referee');

create or replace function public.guest_pairs_named(p_tournament uuid) returns int language sql stable as $$
  select ceil(count(*) / 2.0)::int from public.assignments where tournament_id = p_tournament and guest_official_id is not null;
$$;

create or replace function public.tournament_guest_cap() returns trigger language plpgsql as $$
declare named int;
begin
  if tg_op = 'UPDATE' and new.pairs_organizer is distinct from old.pairs_organizer then
    named := public.guest_pairs_named(new.id);
    if coalesce(new.pairs_organizer, 0) < named then
      raise exception '% pair(s) from outside USATH are already named for this event. Remove a pair before lowering the number below %.', named, named;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tournament_b_guest_cap on public.tournaments;
create trigger tournament_b_guest_cap before update on public.tournaments for each row execute function public.tournament_guest_cap();

-- One save path for the NRC and the organizer: creates or updates the two guests of a pair and designates them
create or replace function public.save_guest_pair(p_tournament uuid, p_people jsonb, p_federation text,
  p_payment_notes text default null, p_notes text default null, p_pair_key uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t record; person jsonb; gid uuid; key uuid := coalesce(p_pair_key, gen_random_uuid()); is_new_pair boolean;
begin
  select id, pairs_organizer, status into t from tournaments where id = p_tournament;
  if t.id is null then raise exception 'Unknown tournament.'; end if;
  if not (is_admin() or p_tournament in (select organizer_tournament_ids())) then
    raise exception 'Only the NRC or the organizer of this event can name its pairs from outside USATH.';
  end if;
  if t.status = 'cancelled' then raise exception 'This event is cancelled.'; end if;
  if jsonb_array_length(coalesce(p_people, '[]'::jsonb)) <> 2 then raise exception 'A pair has two referees.'; end if;
  if nullif(trim(p_federation), '') is null then raise exception 'Give the federation or country of the pair.'; end if;
  is_new_pair := not exists (select 1 from assignments a join guest_officials g on g.id = a.guest_official_id
                             where a.tournament_id = p_tournament and g.pair_key = key);
  if is_new_pair and public.guest_pairs_named(p_tournament) + 1 > coalesce(t.pairs_organizer, 0) then
    raise exception 'This event has % pair(s) declared from outside USATH and all are named. Raise that number in the request first; the pairs USATH staffs go down by the same number.', coalesce(t.pairs_organizer, 0);
  end if;
  for person in select * from jsonb_array_elements(p_people) loop
    if nullif(trim(person->>'first_name'), '') is null or nullif(trim(person->>'last_name'), '') is null then
      raise exception 'First and last name are required for both referees.';
    end if;
    gid := nullif(person->>'id', '')::uuid;
    if gid is not null then
      -- an existing guest: the caller must be the NRC or organize an event this guest is on
      if not (is_admin() or exists (select 1 from assignments where guest_official_id = gid and tournament_id in (select organizer_tournament_ids()))) then
        raise exception 'You cannot edit this official.';
      end if;
      update guest_officials set first_name = trim(person->>'first_name'), last_name = trim(person->>'last_name'),
        email = lower(nullif(trim(person->>'email'), '')), phone = nullif(trim(person->>'phone'), ''),
        home_city = nullif(trim(person->>'home_city'), ''), home_airport_iata = upper(nullif(trim(person->>'home_airport_iata'), '')),
        federation = trim(p_federation), payment_notes = nullif(trim(p_payment_notes), ''), notes = nullif(trim(p_notes), ''),
        pair_key = key, updated_at = now()
      where id = gid;
    else
      insert into guest_officials (first_name, last_name, email, phone, home_city, home_airport_iata, federation, payment_notes, notes, pair_key)
      values (trim(person->>'first_name'), trim(person->>'last_name'), lower(nullif(trim(person->>'email'), '')), nullif(trim(person->>'phone'), ''),
        nullif(trim(person->>'home_city'), ''), upper(nullif(trim(person->>'home_airport_iata'), '')), trim(p_federation),
        nullif(trim(p_payment_notes), ''), nullif(trim(p_notes), ''), key)
      returning id into gid;
    end if;
    insert into assignments (tournament_id, guest_official_id, role) values (p_tournament, gid, 'referee')
      on conflict (tournament_id, guest_official_id) do nothing;
  end loop;
  return key;
end $$;
revoke all on function public.save_guest_pair(uuid, jsonb, text, text, text, uuid) from public;
grant execute on function public.save_guest_pair(uuid, jsonb, text, text, text, uuid) to authenticated;

-- Remove a guest pair from an event (both referees); their bookings and claims on that event go with the designation
create or replace function public.remove_guest_pair(p_tournament uuid, p_pair_key uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_admin() or p_tournament in (select organizer_tournament_ids())) then
    raise exception 'Only the NRC or the organizer of this event can remove its pairs from outside USATH.';
  end if;
  delete from assignments a using guest_officials g
   where a.guest_official_id = g.id and a.tournament_id = p_tournament and coalesce(g.pair_key, g.id) = p_pair_key;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.remove_guest_pair(uuid, uuid) from public;
grant execute on function public.remove_guest_pair(uuid, uuid) to authenticated;

-- A claim created from a booking the official paid keeps the link, so the booking is not claimed twice
alter table public.expense_claims add column if not exists booking_id uuid references public.travel_bookings(id) on delete set null;
create unique index if not exists expense_claims_booking_key on public.expense_claims (booking_id) where booking_id is not null;

-- Staffing counts: USATH referees only; guests counted on their own
create or replace view public.tournament_overview_service as
SELECT t.id, t.name, t.sanction, t.region, t.divisions, t.start_date, t.end_date, t.venue_city, t.venue_state, t.status,
    t.pairs_needed, t.pairs_organizer, t.organizer_pairs_note, t.supervisor_needed, t.travel_managed_by, t.organizer_name,
    t.organizer_email, t.organizer_notified_at, t.created_at, t.created_by_nrc, t.staff_by, c.name AS club_name, t.date_status,
    (t.pairs_needed * 2) AS referees_needed,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.role = 'referee' AND a.referee_id IS NOT NULL) AS confirmed,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.role <> 'referee' AND a.referee_id IS NOT NULL) AS officials,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status <> 'draft'::request_status) AS contacted,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = ANY (ARRAY['sent'::request_status, 'tentative'::request_status])) AS waiting,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = 'sent'::request_status) AS no_answer,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = 'tentative'::request_status) AS tentative,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = ANY (ARRAY['accepted'::request_status, 'confirmed'::request_status])) AS accepted,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = ANY (ARRAY['declined'::request_status, 'no_response'::request_status])) AS declined,
    (SELECT count(*) FROM referees r WHERE r.active AND r.cert_level <> 'candidate'::cert_level
       AND EXISTS (SELECT 1 FROM weekend_availability w WHERE w.referee_id = r.id AND w.status = 'available' AND w.weekend = (date_trunc('week', t.start_date::timestamptz)::date + 5))
       AND NOT EXISTS (SELECT 1 FROM availability_blocks x WHERE x.referee_id = r.id AND x.start_date <= t.end_date AND x.end_date >= t.start_date)) AS available,
    (SELECT count(*) FROM travel_bookings b JOIN assignments a ON a.id = b.assignment_id WHERE a.tournament_id = t.id AND b.status = 'booked') AS bookings_done,
    (SELECT count(*) FROM travel_bookings b JOIN assignments a ON a.id = b.assignment_id WHERE a.tournament_id = t.id AND b.status = 'pending') AS bookings_pending,
    (SELECT max(l.created_at) FROM reminder_log l WHERE l.kind = 'staffing' AND l.target_id = t.id) AS last_reminder_at,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.guest_official_id IS NOT NULL) AS guests
FROM tournaments t LEFT JOIN clubs c ON c.id = t.club_id
WHERE t.date_status = 'confirmed' AND t.nrc_staffs;

create or replace view public.tournament_staffing as
SELECT t.id, t.name, t.start_date, t.end_date, t.venue_city, t.venue_state, t.status, t.pairs_needed, t.supervisor_needed,
    t.travel_managed_by, t.organizer_name, t.organizer_notified_at,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = ANY (ARRAY['sent'::request_status, 'tentative'::request_status])) AS waiting,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = 'accepted'::request_status) AS accepted,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.role = 'referee' AND a.referee_id IS NOT NULL) AS confirmed,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.role <> 'referee' AND a.referee_id IS NOT NULL) AS officials,
    (SELECT count(*) FROM travel_bookings b JOIN assignments a ON a.id = b.assignment_id WHERE a.tournament_id = t.id AND b.status = 'booked') AS bookings_done,
    (SELECT count(*) FROM travel_bookings b JOIN assignments a ON a.id = b.assignment_id WHERE a.tournament_id = t.id AND b.status = 'pending') AS bookings_pending,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.guest_official_id IS NOT NULL) AS guests
FROM tournaments t
WHERE is_admin();

-- Organizer page: designated officials, guests included (club column carries the guest's federation)
create or replace view public.organizer_designations as
SELECT a.id AS assignment_id, a.tournament_id, a.role, a.travel_notes,
    r.id AS referee_id,
    coalesce(r.first_name, g.first_name) AS first_name,
    coalesce(r.last_name, g.last_name) AS last_name,
    coalesce(r.email, g.email) AS email,
    coalesce(r.phone, g.phone) AS phone,
    CASE WHEN is_admin() AND r.id IS NOT NULL THEN r.cert_level::text ELSE NULL::text END AS cert_level,
    coalesce(r.home_city, g.home_city) AS home_city,
    r.home_state,
    coalesce(r.home_airport_iata, g.home_airport_iata) AS home_airport_iata,
    r.departure_airport_iata,
    r.photo_url,
    coalesce(c.name, g.federation) AS club_name,
    g.id AS guest_official_id,
    (g.id IS NOT NULL) AS is_guest
FROM assignments a
  LEFT JOIN referees r ON r.id = a.referee_id
  LEFT JOIN guest_officials g ON g.id = a.guest_official_id
  LEFT JOIN clubs c ON c.id = r.club_id
WHERE is_admin() OR a.tournament_id IN (SELECT organizer_tournament_ids());
grant select on public.organizer_designations to authenticated;

-- checks
select (select count(*) from public.assignments where num_nonnulls(referee_id, guest_official_id) <> 1) as assignments_invalid,
       (select count(*) from public.guest_officials) as guests;


-- How a change to a tournament request was agreed with the organizer (phone, WhatsApp, email), written by the admin
-- and quoted in the update email. Kept on the change log rows sent in that update (2026-10-23). Safe to re-run.
alter table public.tournament_changes add column if not exists agreed_note text;

commit;

-- checks: expect 0, 0, 4 (CalCup USATH referees designated), 1
select (select count(*) from public.tournaments where pairs_needed <> pairs_total - pairs_organizer) as rows_out_of_balance,
       (select count(*) from public.assignments where num_nonnulls(referee_id, guest_official_id) <> 1) as assignments_invalid,
       (select count(*) from public.assignments a join public.tournaments t on t.id = a.tournament_id where t.name ilike 'CalCup 2027%' and a.role = 'referee' and a.referee_id is not null) as calcup_designated,
       (select count(*) from information_schema.columns where table_name = 'tournament_changes' and column_name = 'agreed_note') as agreed_note_ok;
