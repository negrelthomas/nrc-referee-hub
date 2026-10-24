-- Guest access (2026-10-24): referees from outside USATH named on an event get their own sign in.
-- They see the events they are designated for with every detail (dates, venue, organizer, what the organizer covers,
-- the officials on the event, their bookings and expenses), and may use training and the online tests like any referee.
-- Nothing is mandatory for them: no assessment deadline, no reminders, no evaluation, no ranking, no roster entry.
-- Their profile is completed by them at first sign in, or by the NRC or the organizer from the event.
-- Run once in the Supabase SQL editor, after guest_officials.sql. Safe to re-run.

-- 1. role for guest accounts (the literal is only used inside function bodies below, so this runs in one go)
alter type user_role add value if not exists 'guest';

-- 2. guest profile fields
alter table public.guest_officials add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.guest_officials add column if not exists photo_url text;
alter table public.guest_officials add column if not exists federation_level text;   -- regional | national | continental | ihf
alter table public.guest_officials add column if not exists country text;
alter table public.guest_officials add column if not exists onboarded_at timestamptz;
alter table public.guest_officials add column if not exists invited_at timestamptz;
alter table public.guest_officials add column if not exists updated_by uuid references auth.users(id);
alter table public.guest_officials drop constraint if exists guest_officials_level_check;
alter table public.guest_officials add constraint guest_officials_level_check
  check (federation_level is null or federation_level in ('regional','national','continental','ihf'));
create index if not exists guest_officials_user_idx on public.guest_officials (user_id);
create index if not exists guest_officials_email_idx on public.guest_officials (lower(email));

-- link accounts that already exist (a guest who signed up before this script, or shares an email with an admin test identity)
update public.guest_officials g set user_id = u.id from auth.users u
 where g.user_id is null and g.email is not null and lower(u.email) = lower(g.email)
   and not exists (select 1 from public.referees r where r.user_id = u.id);

-- 3. helpers (security definer, so policies do not re-enter each other's RLS)
create or replace function public.my_guest_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.guest_officials where user_id = auth.uid()
$$;
create or replace function public.my_guest_assignment_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.id from public.assignments a join public.guest_officials g on g.id = a.guest_official_id where g.user_id = auth.uid()
$$;
-- events a referee is on (USATH referee or guest): extends tournaments_read without touching the policy
create or replace function public.my_tournament_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tournament_id from public.assignments where referee_id = public.my_referee_id()
  union
  select tournament_id from public.assignment_requests where referee_id = public.my_referee_id()
  union
  select a.tournament_id from public.assignments a join public.guest_officials g on g.id = a.guest_official_id where g.user_id = auth.uid()
$$;
grant execute on function public.my_guest_ids(), public.my_guest_assignment_ids(), public.my_tournament_ids() to authenticated;

-- 4. sign in: an email named on a guest pair may sign in; a USATH referee record always wins
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare r_id uuid; r_name text; is_admin_invite boolean; is_org boolean; org_name text; ev_id uuid; ev_name text; g_name text;
begin
  select id, first_name || ' ' || last_name into r_id, r_name from public.referees where lower(email) = lower(new.email) limit 1;
  select exists (select 1 from public.admin_invites where lower(email) = lower(new.email)) into is_admin_invite;
  select exists (select 1 from public.tournaments where lower(organizer_email) = lower(new.email)) into is_org;
  if is_org then select organizer_name into org_name from public.tournaments where lower(organizer_email) = lower(new.email) order by created_at desc limit 1; end if;
  select id, first_name || ' ' || last_name into ev_id, ev_name from public.evaluators where lower(email) = lower(new.email) limit 1;
  select first_name || ' ' || last_name into g_name from public.guest_officials where lower(email) = lower(new.email) order by created_at desc limit 1;
  if r_id is null and not is_admin_invite and not is_org and ev_id is null and g_name is null then
    raise exception 'This email is not on the NRC roster and has not submitted a tournament request. Write to referee@handballusa.org to be invited.';
  end if;
  insert into public.profiles (id, email, role, full_name)
    values (new.id, new.email,
            case when is_admin_invite then 'admin'::user_role when r_id is not null then 'referee'::user_role
                 when is_org then 'organizer'::user_role when ev_id is not null then 'evaluator'::user_role
                 else 'guest'::user_role end,
            coalesce(r_name, org_name, ev_name, g_name))
  on conflict (id) do nothing;
  if r_id is not null then update public.referees set user_id = new.id where id = r_id and user_id is null; end if;
  if is_org then update public.tournaments set organizer_user_id = new.id where lower(organizer_email) = lower(new.email) and organizer_user_id is null; end if;
  if ev_id is not null then
    perform set_config('nrc.system', 'on', true);
    update public.evaluators set user_id = new.id where id = ev_id and user_id is null;
  end if;
  if r_id is null and g_name is not null then
    update public.guest_officials set user_id = new.id where lower(email) = lower(new.email) and user_id is null;
  end if;
  return new;
end $$;

-- a guest named after their account exists (second event, or email added later) is linked when named
create or replace function public.guest_link_account() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is null and new.email is not null then
    select u.id into new.user_id from auth.users u
     where lower(u.email) = lower(new.email) and not exists (select 1 from public.referees r where r.user_id = u.id) limit 1;
  end if;
  return new;
end $$;
drop trigger if exists guest_officials_link on public.guest_officials;
create trigger guest_officials_link before insert or update of email on public.guest_officials
  for each row execute function public.guest_link_account();

-- email change by the guest: keep the guest rows on the new address
create or replace function public.sync_user_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
    if not exists (select 1 from public.referees where lower(email) = lower(new.email) and user_id is distinct from new.id) then
      update public.referees set email = lower(new.email), updated_at = now() where user_id = new.id;
    end if;
    update public.guest_officials set email = lower(new.email), updated_at = now() where user_id = new.id;
  end if;
  return new;
end $$;

-- 5. once a guest has an account, only they change their sign in email (same rule as USATH referees)
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
      if not (is_admin() or exists (select 1 from assignments where guest_official_id = gid and tournament_id in (select organizer_tournament_ids()))) then
        raise exception 'You cannot edit this official.';
      end if;
      update guest_officials set first_name = trim(person->>'first_name'), last_name = trim(person->>'last_name'),
        email = case when user_id is null then lower(nullif(trim(person->>'email'), '')) else email end,
        phone = nullif(trim(person->>'phone'), ''),
        home_city = nullif(trim(person->>'home_city'), ''), home_airport_iata = upper(nullif(trim(person->>'home_airport_iata'), '')),
        federation_level = coalesce(nullif(person->>'federation_level', ''), federation_level),
        federation = trim(p_federation), payment_notes = nullif(trim(p_payment_notes), ''), notes = nullif(trim(p_notes), ''),
        pair_key = key, updated_at = now(), updated_by = auth.uid()
      where id = gid;
    else
      insert into guest_officials (first_name, last_name, email, phone, home_city, home_airport_iata, federation, federation_level, payment_notes, notes, pair_key, updated_by)
      values (trim(person->>'first_name'), trim(person->>'last_name'), lower(nullif(trim(person->>'email'), '')), nullif(trim(person->>'phone'), ''),
        nullif(trim(person->>'home_city'), ''), upper(nullif(trim(person->>'home_airport_iata'), '')), trim(p_federation),
        nullif(person->>'federation_level', ''), nullif(trim(p_payment_notes), ''), nullif(trim(p_notes), ''), key, auth.uid())
      returning id into gid;
    end if;
    insert into assignments (tournament_id, guest_official_id, role) values (p_tournament, gid, 'referee')
      on conflict (tournament_id, guest_official_id) do nothing;
  end loop;
  return key;
end $$;

-- 6. the guest edits their own profile (every guest row linked to their account), never pair, event or notes fields
create or replace function public.save_my_guest_profile(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare lvl text := nullif(p->>'federation_level', '');
begin
  if not exists (select 1 from guest_officials where user_id = auth.uid()) then raise exception 'No guest profile on this account.'; end if;
  if nullif(trim(p->>'first_name'), '') is null or nullif(trim(p->>'last_name'), '') is null then raise exception 'First and last name are required.'; end if;
  if lvl is not null and lvl not in ('regional','national','continental','ihf') then raise exception 'Unknown level.'; end if;
  update guest_officials set
    first_name = trim(p->>'first_name'), last_name = trim(p->>'last_name'),
    phone = nullif(trim(p->>'phone'), ''), home_city = nullif(trim(p->>'home_city'), ''),
    country = nullif(trim(p->>'country'), ''), home_airport_iata = upper(nullif(trim(p->>'home_airport_iata'), '')),
    federation_level = lvl,
    federation = coalesce(nullif(trim(p->>'federation'), ''), federation),
    payment_notes = nullif(trim(p->>'payment_notes'), ''),
    photo_url = coalesce(nullif(p->>'photo_url', ''), photo_url),
    onboarded_at = coalesce(onboarded_at, case when (p->>'onboarded')::boolean then now() end),
    updated_at = now(), updated_by = auth.uid()
  where user_id = auth.uid();
end $$;
revoke all on function public.save_my_guest_profile(jsonb) from public;
grant execute on function public.save_my_guest_profile(jsonb) to authenticated;

-- the NRC or the organizer marks that a sign in link was sent
create or replace function public.mark_guest_invited(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  update guest_officials g set invited_at = now()
   where g.id = any(p_ids) and (is_admin() or exists (select 1 from assignments a where a.guest_official_id = g.id and a.tournament_id in (select organizer_tournament_ids())));
end $$;
grant execute on function public.mark_guest_invited(uuid[]) to authenticated;

-- 7. what a guest reads: their own rows, their assignments, the events (via my_tournament_ids), bookings and claims
drop policy if exists guest_self_read on public.guest_officials;
create policy guest_self_read on public.guest_officials for select using (user_id = auth.uid());
drop policy if exists asg_guest_own on public.assignments;
create policy asg_guest_own on public.assignments for select using (id in (select public.my_guest_assignment_ids()));
drop policy if exists travel_guest on public.travel_bookings;
create policy travel_guest on public.travel_bookings for all
  using (assignment_id in (select public.my_guest_assignment_ids()))
  with check (assignment_id in (select public.my_guest_assignment_ids()));
drop policy if exists exp_guest on public.expense_claims;
create policy exp_guest on public.expense_claims for all
  using (assignment_id in (select public.my_guest_assignment_ids()))
  with check (status = 'submitted' and assignment_id in (select public.my_guest_assignment_ids()));

-- the officials on an event, for anyone designated on it (names, role, club or federation; no contact, no level)
create or replace function public.event_officials(p_tournament uuid)
returns table (first_name text, last_name text, role text, affiliation text, is_guest boolean, is_me boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(r.first_name, g.first_name), coalesce(r.last_name, g.last_name), a.role::text,
         coalesce(c.name, g.federation), g.id is not null,
         coalesce(r.user_id = auth.uid(), false) or coalesce(g.user_id = auth.uid(), false)
  from assignments a
  left join referees r on r.id = a.referee_id
  left join clubs c on c.id = r.club_id
  left join guest_officials g on g.id = a.guest_official_id
  where a.tournament_id = p_tournament
    and (is_admin() or p_tournament in (select organizer_tournament_ids())
         or exists (select 1 from assignments x where x.tournament_id = p_tournament
                    and (x.referee_id = my_referee_id() or x.guest_official_id in (select my_guest_ids()))))
  order by coalesce(r.last_name, g.last_name), coalesce(r.first_name, g.first_name)
$$;
grant execute on function public.event_officials(uuid) to authenticated;

-- 8. physical tests and theory exams recorded for a guest (optional, at a clinic or on site)
alter table public.referee_tests alter column referee_id drop not null;
alter table public.referee_tests add column if not exists guest_official_id uuid references public.guest_officials(id) on delete cascade;
alter table public.referee_tests drop constraint if exists referee_tests_one_person;
alter table public.referee_tests add constraint referee_tests_one_person check (num_nonnulls(referee_id, guest_official_id) = 1);
drop policy if exists referee_tests_guest on public.referee_tests;
create policy referee_tests_guest on public.referee_tests for select
  using (shared_with_referee and guest_official_id in (select public.my_guest_ids()));

-- 9. physical test in a fixed format (USATH Shuttle Run Test, also called the beep test; the only physical standard
--    published by USATH, no other test is recorded). Three scores kept separately: level, shuttle within the level,
--    total loops; plus the standard applied (gender and age band at the test). Pass is calculated, not typed.
--    Source: usateamhandball.org, Refereeing, General certification (women's second band published as "30 - 99", read as 30 to 39).
alter table public.referee_tests add column if not exists std_band text;
alter table public.referee_tests add column if not exists beep_level int;
alter table public.referee_tests add column if not exists beep_shuttle int;
alter table public.referee_tests add column if not exists beep_loops int;
alter table public.referee_tests drop constraint if exists referee_tests_std_band_check;
alter table public.referee_tests add constraint referee_tests_std_band_check
  check (std_band is null or std_band in ('M18','M30','M40','M50','W18','W30','W40','W50'));
alter table public.referee_tests drop constraint if exists referee_tests_beep_range;
alter table public.referee_tests add constraint referee_tests_beep_range
  check ((beep_level is null or beep_level between 1 and 21) and (beep_shuttle is null or beep_shuttle between 0 and 16) and (beep_loops is null or beep_loops between 0 and 300));
-- every new physical test carries the three scores and the standard (existing free text records stay as they are)
alter table public.referee_tests drop constraint if exists referee_tests_physical_format;
alter table public.referee_tests add constraint referee_tests_physical_format
  check (kind <> 'physical' or (std_band is not null and beep_level is not null and beep_shuttle is not null and beep_loops is not null)) not valid;

create or replace function public.beep_required(p_band text, out lvl int, out shuttle int) language sql immutable as $$
  select r.l, r.s from (values ('M18',9,5),('M30',8,0),('M40',7,0),('M50',6,0),('W18',7,0),('W30',6,0),('W40',5,0),('W50',4,0)) as r(b,l,s)
  where r.b = p_band
$$;
create or replace function public.referee_tests_physical() returns trigger language plpgsql as $$
declare req record;
begin
  if new.kind = 'physical' and new.std_band is not null and new.beep_level is not null then
    select * into req from public.beep_required(new.std_band);
    new.test_name := 'Shuttle Run Test (beep test)';
    new.result := 'Level ' || new.beep_level || '.' || coalesce(new.beep_shuttle, 0) || ', ' || coalesce(new.beep_loops, 0) || ' loops';
    new.passed := (new.beep_level > req.lvl) or (new.beep_level = req.lvl and coalesce(new.beep_shuttle, 0) >= req.shuttle);
  end if;
  return new;
end $$;
drop trigger if exists referee_tests_physical on public.referee_tests;
create trigger referee_tests_physical before insert or update on public.referee_tests
  for each row execute function public.referee_tests_physical();

-- checks
select (select count(*) from public.guest_officials) as guests,
       (select count(*) from public.guest_officials where user_id is not null) as guests_with_account,
       (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'user_role' and e.enumlabel = 'guest') as guest_role;
