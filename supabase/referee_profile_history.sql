-- Referee profile history: tournament divisions (age group and gender), tournaments entered by the NRC,
-- the tournament history shown on the public referee profile card, and physical and theory tests.
-- Run the whole script once in the Supabase SQL editor.
-- Division codes: <age>-<gender>, age in Senior, U21, U19, U18, U17, U16, U14, U12; gender M, W or X (mixed). Example: {'Senior-M','U18-W'}.

alter table public.tournaments add column if not exists divisions text[] not null default '{}';
alter table public.tournaments add column if not exists created_by_nrc boolean not null default false;

-- Admin history view gains the divisions (appended column, keeps existing grants)
create or replace view public.referee_tournament_history as
  select a.referee_id, t.id as tournament_id, t.name, t.sanction, t.region, t.start_date, t.end_date,
         t.venue_city, t.venue_state, a.role,
         coalesce(a.games_officiated,
                  (select count(*) from public.games g where g.tournament_id = t.id and (g.referee_1 = a.referee_id or g.referee_2 = a.referee_id)))::int as games,
         t.divisions
  from public.assignments a join public.tournaments t on t.id = a.tournament_id;

-- Public history: certified active referees, tournaments already started and not cancelled.
-- No contact details, no travel, no money.
drop view if exists public.referee_public_history;
create view public.referee_public_history as
  select a.referee_id, t.id as tournament_id, t.name, t.sanction, t.region, t.divisions,
         t.start_date, t.end_date, t.venue_city, t.venue_state, a.role,
         coalesce(a.games_officiated,
                  (select count(*) from public.games g where g.tournament_id = t.id and (g.referee_1 = a.referee_id or g.referee_2 = a.referee_id)))::int as games
  from public.assignments a
  join public.tournaments t on t.id = a.tournament_id
  join public.referees r on r.id = a.referee_id
  where r.active and r.cert_level <> 'candidate'
    and t.status <> 'cancelled' and t.start_date <= current_date;
grant select on public.referee_public_history to anon, authenticated;

-- Physical tests and in person theory exams recorded by the NRC. Online theory comes from public.assessments,
-- in game evaluations from public.evaluations.
create table if not exists public.referee_tests (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references public.referees(id) on delete cascade,
  kind text not null check (kind in ('physical','theory')),
  tested_on date not null default current_date,
  test_name text not null,           -- e.g. Yo-Yo IR1, 40 m sprint, written rules exam
  result text,                       -- e.g. level 16.2, 5.9 s, 42/50
  passed boolean,
  evaluator_name text,
  notes text,
  shared_with_referee boolean not null default true,
  entered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.referee_tests enable row level security;
drop policy if exists referee_tests_admin on public.referee_tests;
create policy referee_tests_admin on public.referee_tests for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists referee_tests_own on public.referee_tests;
create policy referee_tests_own on public.referee_tests for select
  using (shared_with_referee and referee_id in (select id from public.referees where user_id = auth.uid()));
create index if not exists referee_tests_ref on public.referee_tests (referee_id, kind, tested_on desc);
