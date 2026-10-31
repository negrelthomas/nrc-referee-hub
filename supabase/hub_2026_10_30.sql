-- NRC Referee Hub, 2026-10-30: point scoring, custom quizzes, 30 question baseline, airports, games and evaluations,
-- score sheet reconciliation, technical delegates separate from table officials, flight confirmations.
-- Safe to run more than once.

-- ---------- 1. Point scoring ----------
-- +1 per correct option ticked, -1 per wrong option ticked or correct option missed, never below 0 on a question.
-- Rows saved before this keep points null and are read as 1 or 0 per question.
alter table public.quiz_attempts add column if not exists points int;
alter table public.quiz_attempts add column if not exists max_points int;
alter table public.quiz_answers add column if not exists points smallint;
alter table public.quiz_answers add column if not exists max_points smallint;
alter table public.assessments add column if not exists points int;
alter table public.assessments add column if not exists max_points int;
alter table public.certification_attempts add column if not exists points int;
alter table public.certification_attempts add column if not exists max_points int;

-- ---------- 2. Baseline assessment in the IHF format: 30 questions, 60 minutes (results already recorded stay as they are) ----------
update public.program_settings set assessment_questions = 30, time_limit_minutes = 60 where id = 1;
alter table public.program_settings alter column assessment_questions set default 30;

-- ---------- 3. Custom quizzes: same questions for everyone who opens the link ----------
create table if not exists public.custom_quizzes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  question_ids uuid[] not null,
  time_limit_minutes int check (time_limit_minutes is null or time_limit_minutes between 1 and 180),
  feedback text not null default 'now' check (feedback in ('now','end')),
  created_at timestamptz not null default now()
);
alter table public.custom_quizzes enable row level security;
drop policy if exists cq_read on public.custom_quizzes;
create policy cq_read on public.custom_quizzes for select using (true);   -- anyone with the link
drop policy if exists cq_insert on public.custom_quizzes;
create policy cq_insert on public.custom_quizzes for insert with check (auth.uid() is not null and created_by = auth.uid());
drop policy if exists cq_own on public.custom_quizzes;
create policy cq_own on public.custom_quizzes for delete using (created_by = auth.uid() or public.is_admin());
grant select on public.custom_quizzes to anon, authenticated;
grant insert, delete on public.custom_quizzes to authenticated;

-- ---------- 4. Up to three airports per referee ----------
-- home_airport_iata = airport 1 (closest to home), departure_airport_iata = airport 2, airport_3_iata = airport 3
alter table public.referees add column if not exists airport_3_iata text;
alter table public.guest_officials add column if not exists departure_airport_iata text;
alter table public.guest_officials add column if not exists airport_3_iata text;

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
    departure_airport_iata = case when p ? 'departure_airport_iata' then upper(nullif(trim(p->>'departure_airport_iata'), '')) else departure_airport_iata end,
    airport_3_iata = case when p ? 'airport_3_iata' then upper(nullif(trim(p->>'airport_3_iata'), '')) else airport_3_iata end,
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

-- ---------- 5. Games: every game recorded with its pair, organizer pairs included ----------
alter table public.games add column if not exists guest_official_1 uuid references public.guest_officials(id) on delete set null;
alter table public.games add column if not exists guest_official_2 uuid references public.guest_officials(id) on delete set null;
alter table public.games add column if not exists sheet_path text;          -- score sheet file in the private score-sheets bucket
alter table public.games add column if not exists sheet_check jsonb;        -- last reconciliation with the score sheet: {status, read, diffs, checked_at}
create index if not exists games_number_idx on public.games (tournament_id, game_number);

-- Pairs designated on each event: USATH pairs (pairs table) and organizer pairs (guest pair_key). Admins and the event organizer.
drop view if exists public.event_pairs;
create view public.event_pairs as
with d as (
  select a.tournament_id, a.referee_id, a.guest_official_id, g.pair_key
  from public.assignments a left join public.guest_officials g on g.id = a.guest_official_id
  where a.role = 'referee'),
us as (
  select distinct d1.tournament_id, least(d1.referee_id::text, d2.referee_id::text)::uuid as r1, greatest(d1.referee_id::text, d2.referee_id::text)::uuid as r2
  from d d1 join d d2 on d2.tournament_id = d1.tournament_id and d1.referee_id is not null and d2.referee_id is not null and d1.referee_id <> d2.referee_id
  join public.pairs p on ((p.referee_a = d1.referee_id and p.referee_b = d2.referee_id) or (p.referee_a = d2.referee_id and p.referee_b = d1.referee_id))
   and (p.valid_until is null or p.valid_until >= current_date)),
gs as (
  select tournament_id, min(guest_official_id::text)::uuid as g1, case when count(*) > 1 then max(guest_official_id::text)::uuid end as g2
  from d where guest_official_id is not null group by tournament_id, coalesce(pair_key, guest_official_id))
select us.tournament_id, 'usath'::text as kind, us.r1 as referee_1, us.r2 as referee_2, null::uuid as guest_official_1, null::uuid as guest_official_2,
       a.last_name || ', ' || a.first_name || ' / ' || b.last_name || ', ' || b.first_name as label
from us join public.referees a on a.id = us.r1 join public.referees b on b.id = us.r2
where public.is_admin() or us.tournament_id in (select public.organizer_tournament_ids())
union all
select gs.tournament_id, 'organizer', null, null, gs.g1, gs.g2,
       a.last_name || ', ' || a.first_name || coalesce(' / ' || b.last_name || ', ' || b.first_name, '') || coalesce(' (' || a.federation || ')', '')
from gs join public.guest_officials a on a.id = gs.g1 left join public.guest_officials b on b.id = gs.g2
where public.is_admin() or gs.tournament_id in (select public.organizer_tournament_ids());
grant select on public.event_pairs to authenticated;

-- ---------- 6. Evaluators named by Thomas (2026-10-30), certified directly by the NRC; no sign in link is sent ----------
insert into public.evaluators (first_name, last_name, email, origin, status, certified_on, certified_by, admin_notes)
values
  ('Vafa', 'Ahmadiyeh', 'vafa.ahmadiyeh@gmail.com', 'nrc', 'certified', current_date, 'NRC (direct)', 'Former NRC chair. Added 2026-10-30.'),
  ('Majid', '', 'majid80ref@yahoo.com', 'nrc', 'certified', current_date, 'NRC (direct)', 'NACHC Referee Chair, NRC member. Last name to confirm. Added 2026-10-30.'),
  ('Butso', '', 'buco11@aol.com', 'referee', 'certified', current_date, 'NRC (direct)', 'Former technical delegate. Full name to confirm. Added 2026-10-30.'),
  ('Rafael', 'Marques', 'rafael2marques@gmail.com', 'referee', 'certified', current_date, 'NRC (direct)', 'Added 2026-10-30.')
on conflict ((lower(email))) do nothing;

-- ---------- 7. Score sheets: private bucket, read by the NRC and the event organizer ----------
insert into storage.buckets (id, name, public) values ('score-sheets', 'score-sheets', false) on conflict (id) do nothing;
drop policy if exists sheets_rw on storage.objects;
create policy sheets_rw on storage.objects for all
  using (bucket_id = 'score-sheets' and (public.is_admin() or (storage.foldername(name))[1] in (select x::text from public.organizer_tournament_ids() x)))
  with check (bucket_id = 'score-sheets' and (public.is_admin() or (storage.foldername(name))[1] in (select x::text from public.organizer_tournament_ids() x)));

-- ---------- 8. Flight bookings read from the airline confirmation: the file is kept with the booking ----------
alter table public.travel_bookings add column if not exists document_path text;   -- receipts bucket

-- ---------- 9. Table officials are a role of their own, separate from the technical delegate ----------
-- assignments.role: referee | delegate (technical delegate, supervisor) | table_official (timekeeper, scorekeeper) | observer
alter table public.referee_game_reports drop constraint if exists referee_game_reports_role_check;
alter table public.referee_game_reports add constraint referee_game_reports_role_check check (role in ('referee','observer','delegate','table_official'));
