-- NRC Referee Hub: Supabase schema
-- Run in the Supabase SQL editor, in this order: schema.sql, seed_clubs.sql, seed_questions.sql
-- Sign in is invitation only: admins add referees (Admin > Referees) before they can sign in. negrel.thomas@gmail.com is pre-invited as admin.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------
do $$ begin
  create type user_role as enum ('referee','admin','organizer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cert_level as enum ('candidate','level_1','level_2','level_3','nachc','ihf');
exception when duplicate_object then null; end $$;

do $$ begin
  create type request_status as enum ('draft','sent','accepted','declined','no_response','confirmed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tournament_status as enum ('submitted','reviewing','staffed','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sanction_level as enum ('usath','regional','club','international');
exception when duplicate_object then null; end $$;

do $$ begin
  create type difficulty as enum ('level_1','level_2','level_3');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pair_program_status as enum ('none','nominated','mentor_assigned','in_training','observed','certified_pair');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- Clubs
-- ---------------------------------------------------------------
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  club_type text not null default 'adult', -- adult | collegiate_men | collegiate_women | youth
  city text,
  state text,
  website text,
  nearest_airport_iata text,
  lat double precision,
  lng double precision,
  pair_program_status pair_program_status not null default 'none',
  pair_program_notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Profiles (one per auth user). role decides what the person sees.
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role user_role not null default 'referee',
  full_name text,
  created_at timestamptz not null default now()
);

-- Invitation only: a user may sign in only if an admin created a referee record (or an admin profile) with that email first.
-- The trigger links the new auth user to the referee row and creates the profile.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare r_id uuid; r_name text; is_admin_invite boolean;
begin
  select id, first_name || ' ' || last_name into r_id, r_name from public.referees where lower(email) = lower(new.email) limit 1;
  select exists (select 1 from public.admin_invites where lower(email) = lower(new.email)) into is_admin_invite;
  if r_id is null and not is_admin_invite then
    raise exception 'This email is not on the NRC referee roster. Write to referee@handballusa.org to be invited.';
  end if;
  insert into public.profiles (id, email, role, full_name)
    values (new.id, new.email, case when is_admin_invite then 'admin'::user_role else 'referee'::user_role end, r_name)
  on conflict (id) do nothing;
  if r_id is not null then update public.referees set user_id = new.id where id = r_id and user_id is null; end if;
  return new;
end $$;

-- Admin invitations (emails allowed to sign in as admin before any referee record exists)
create table if not exists public.admin_invites (
  email text primary key,
  invited_by text,
  created_at timestamptz not null default now()
);
insert into public.admin_invites (email, invited_by) values ('negrel.thomas@gmail.com', 'setup') on conflict do nothing;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

-- Helper: is the current user an admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------------------------------------------------------------
-- Referees
-- ---------------------------------------------------------------
create table if not exists public.referees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text,
  photo_url text,
  club_id uuid references public.clubs(id) on delete set null,
  home_city text,
  home_state text,
  home_airport_iata text,
  departure_airport_iata text, -- usual departure airport if different from home
  cert_level cert_level not null default 'candidate',
  cert_date date,
  cert_by text,
  usath_member_id text,
  usath_membership_valid_until date,
  safesport_valid_until date,
  background_check_valid_until date,
  active boolean not null default true,
  availability_notes text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists referees_club_idx on public.referees(club_id);
create index if not exists referees_level_idx on public.referees(cert_level);

-- Established pairs
create table if not exists public.pairs (
  id uuid primary key default gen_random_uuid(),
  referee_a uuid not null references public.referees(id) on delete cascade,
  referee_b uuid not null references public.referees(id) on delete cascade,
  valid_from date default current_date,
  valid_until date,
  notes text,
  created_at timestamptz not null default now(),
  check (referee_a <> referee_b)
);

-- Availability: dates a referee cannot work (assignors see this before inviting)
create table if not exists public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references public.referees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists availability_ref_idx on public.availability_blocks(referee_id, start_date);

-- Certification history (one row per promotion or renewal)
create table if not exists public.certifications (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references public.referees(id) on delete cascade,
  level cert_level not null,
  obtained_on date not null,
  certified_by text,
  event text,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Tournaments and assignments (phase 2 uses these; created now so the schema is stable)
-- ---------------------------------------------------------------
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sanction sanction_level not null default 'club', -- usath | regional (NORCAL etc.) | club | international
  region text, -- e.g. NORCAL, SOCAL, Northeast
  organizer_name text not null,
  organizer_email text not null,
  organizer_phone text,
  organizer_user_id uuid references auth.users(id) on delete set null,
  venue_name text,
  venue_address text,
  venue_city text,
  venue_state text,
  nearest_airport_iata text,
  start_date date not null,
  end_date date not null,
  pairs_needed int not null default 2,
  games_expected int,
  hotel_nights_covered int default 0,
  flights_covered boolean default false,
  airport_transfers_covered boolean default false,
  airport_transfer_how text,
  hotel_to_venue_transport text,
  food_stipend_per_day numeric(8,2),
  meals_provided text,
  earliest_return_last_day time,
  budget_owner text,
  notes text,
  status tournament_status not null default 'submitted',
  created_at timestamptz not null default now()
);

create table if not exists public.assignment_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  referee_id uuid references public.referees(id) on delete cascade,
  pair_id uuid references public.pairs(id) on delete cascade,
  status request_status not null default 'draft',
  token uuid not null default gen_random_uuid(), -- for accept/decline links
  sent_at timestamptz,
  responded_at timestamptz,
  reminder_count int not null default 0,
  response_note text,
  created_at timestamptz not null default now(),
  check (referee_id is not null or pair_id is not null)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  referee_id uuid not null references public.referees(id) on delete cascade,
  role text not null default 'referee', -- referee | observer | delegate
  confirmed_at timestamptz default now(),
  travel_notes text,
  games_officiated int, -- reported by the organizer after the tournament (or counted from games table)
  unique (tournament_id, referee_id)
);

-- Games logged from game sheets
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete set null,
  game_date date not null,
  home_team text,
  away_team text,
  category text, -- men, women, youth
  referee_1 uuid references public.referees(id) on delete set null,
  referee_2 uuid references public.referees(id) on delete set null,
  game_sheet_url text,
  entered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Evaluations (IHF observer structure)
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references public.referees(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  tournament_id uuid references public.tournaments(id) on delete set null,
  evaluated_on date not null default current_date,
  evaluator_name text not null,
  evaluator_user_id uuid references auth.users(id),
  score_rules_application smallint check (score_rules_application between 1 and 5),
  score_game_management smallint check (score_game_management between 1 and 5),
  score_progressive_punishment smallint check (score_progressive_punishment between 1 and 5),
  score_positioning smallint check (score_positioning between 1 and 5),
  score_pair_cooperation smallint check (score_pair_cooperation between 1 and 5),
  score_communication smallint check (score_communication between 1 and 5),
  strengths text,
  points_to_improve text,
  notes text,
  shared_with_referee boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Training
-- ---------------------------------------------------------------
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'calcup', -- calcup | ihf_catalogue
  source_ref text, -- e.g. IHF 2025 7.12
  rule_number smallint, -- 1..18 per IHF rules
  category text not null,
  difficulty difficulty not null default 'level_2',
  question text not null,
  options jsonb, -- array of strings; null for flashcard only
  correct_index smallint, -- single correct option (0 based)
  correct_indexes smallint[], -- all correct options when more than one (0 based); null for single answer questions
  answer text not null, -- explanation or flashcard back
  rule_ref text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists quiz_questions_rule_idx on public.quiz_questions(rule_number);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null, -- practice | timed | flashcard
  difficulty difficulty,
  rule_number smallint,
  total int not null,
  correct int not null,
  duration_seconds int,
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  correct boolean not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Admin tasks (Sport80 import reminder lives here)
-- ---------------------------------------------------------------
create table if not exists public.admin_tasks (
  id uuid primary key default gen_random_uuid(),
  key text unique, -- stable key for recurring tasks
  title text not null,
  description text,
  due_on date,
  recurrence_days int, -- when completed, next due = today + recurrence_days
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.admin_tasks (key, title, description, due_on, recurrence_days)
values ('sport80_import', 'Import the Sport80 referee membership export',
        'Export the referee membership list from Sport80 as CSV and upload it on the Admin > Import page. This refreshes membership validity dates for every referee.',
        current_date, 30)
on conflict (key) do nothing;

create table if not exists public.import_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- sport80 | ihf_catalogue | clubs
  rows_processed int,
  rows_updated int,
  rows_unmatched int,
  notes text,
  imported_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Storage bucket for referee photos and game sheets
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('referee-photos','referee-photos', true)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('game-sheets','game-sheets', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
alter table public.clubs enable row level security;
alter table public.profiles enable row level security;
alter table public.referees enable row level security;
alter table public.pairs enable row level security;
alter table public.certifications enable row level security;
alter table public.availability_blocks enable row level security;
drop policy if exists avail_own on public.availability_blocks;
create policy avail_own on public.availability_blocks for all
  using (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()))
  with check (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()));
alter table public.tournaments enable row level security;
alter table public.assignment_requests enable row level security;
alter table public.assignments enable row level security;
alter table public.games enable row level security;
alter table public.evaluations enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.admin_tasks enable row level security;
alter table public.import_log enable row level security;

-- clubs: public read, admin write
drop policy if exists clubs_read on public.clubs;
create policy clubs_read on public.clubs for select using (true);
drop policy if exists clubs_admin on public.clubs;
create policy clubs_admin on public.clubs for all using (public.is_admin()) with check (public.is_admin());

-- profiles: own row read, admin all
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for update using (public.is_admin()) with check (public.is_admin());

-- referees: a referee reads and updates own row; admins everything.
-- Signed in referees can also read a directory view (name, club, level, photo) through the view below.
drop policy if exists referees_own_read on public.referees;
create policy referees_own_read on public.referees for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists referees_own_update on public.referees;
create policy referees_own_update on public.referees for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists referees_admin on public.referees;
create policy referees_admin on public.referees for all using (public.is_admin()) with check (public.is_admin());

-- directory view for signed in referees (no contact details, no admin notes)
create or replace view public.referee_directory as
  select r.id, r.first_name, r.last_name, r.photo_url, r.home_city, r.home_state,
         r.home_airport_iata, r.cert_level, r.active, c.name as club_name, c.id as club_id
  from public.referees r left join public.clubs c on c.id = r.club_id
  where r.active;
grant select on public.referee_directory to authenticated;

-- certifications, pairs, evaluations: own read, admin all
drop policy if exists certs_own on public.certifications;
create policy certs_own on public.certifications for select
  using (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()));
drop policy if exists certs_admin on public.certifications;
create policy certs_admin on public.certifications for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists pairs_read on public.pairs;
create policy pairs_read on public.pairs for select using (auth.uid() is not null);
drop policy if exists pairs_admin on public.pairs;
create policy pairs_admin on public.pairs for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists eval_own on public.evaluations;
create policy eval_own on public.evaluations for select
  using (public.is_admin() or (shared_with_referee and referee_id in (select id from public.referees where user_id = auth.uid())));
drop policy if exists eval_admin on public.evaluations;
create policy eval_admin on public.evaluations for all using (public.is_admin()) with check (public.is_admin());

-- tournaments: anyone can submit (organizer intake), organizer reads own, admin all
drop policy if exists tournaments_insert on public.tournaments;
create policy tournaments_insert on public.tournaments for insert with check (true);
drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments for select using (public.is_admin() or organizer_user_id = auth.uid()
  or id in (select tournament_id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid())
  or id in (select tournament_id from public.assignment_requests a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()));
drop policy if exists tournaments_admin on public.tournaments;
create policy tournaments_admin on public.tournaments for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists tournaments_admin_del on public.tournaments;
create policy tournaments_admin_del on public.tournaments for delete using (public.is_admin());

-- assignment requests and assignments: referee reads own, admin all
drop policy if exists req_own on public.assignment_requests;
create policy req_own on public.assignment_requests for select
  using (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()));
drop policy if exists req_admin on public.assignment_requests;
create policy req_admin on public.assignment_requests for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists asg_own on public.assignments;
create policy asg_own on public.assignments for select
  using (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()));
drop policy if exists asg_admin on public.assignments;
create policy asg_admin on public.assignments for all using (public.is_admin()) with check (public.is_admin());

-- games: referee reads games they officiated; admin all
drop policy if exists games_own on public.games;
create policy games_own on public.games for select
  using (public.is_admin() or referee_1 in (select id from public.referees where user_id = auth.uid())
         or referee_2 in (select id from public.referees where user_id = auth.uid()));
drop policy if exists games_admin on public.games;
create policy games_admin on public.games for all using (public.is_admin()) with check (public.is_admin());

-- quiz questions: public read of active questions; admin write
drop policy if exists qq_read on public.quiz_questions;
create policy qq_read on public.quiz_questions for select using (active or public.is_admin());
drop policy if exists qq_admin on public.quiz_questions;
create policy qq_admin on public.quiz_questions for all using (public.is_admin()) with check (public.is_admin());

-- attempts: own
drop policy if exists qa_own on public.quiz_attempts;
create policy qa_own on public.quiz_attempts for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());
drop policy if exists qans_own on public.quiz_answers;
create policy qans_own on public.quiz_answers for all
  using (attempt_id in (select id from public.quiz_attempts where user_id = auth.uid()) or public.is_admin())
  with check (attempt_id in (select id from public.quiz_attempts where user_id = auth.uid()));

-- admin invites: admin only
alter table public.admin_invites enable row level security;
drop policy if exists invites_admin on public.admin_invites;
create policy invites_admin on public.admin_invites for all using (public.is_admin()) with check (public.is_admin());

-- admin tasks and import log: admin only
drop policy if exists tasks_admin on public.admin_tasks;
create policy tasks_admin on public.admin_tasks for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists imports_admin on public.import_log;
create policy imports_admin on public.import_log for all using (public.is_admin()) with check (public.is_admin());

-- storage policies
drop policy if exists photos_public_read on storage.objects;
create policy photos_public_read on storage.objects for select using (bucket_id = 'referee-photos');
drop policy if exists photos_own_write on storage.objects;
create policy photos_own_write on storage.objects for insert
  with check (bucket_id = 'referee-photos' and auth.uid() is not null);
drop policy if exists photos_own_update on storage.objects;
create policy photos_own_update on storage.objects for update
  using (bucket_id = 'referee-photos' and (owner = auth.uid() or public.is_admin()));
drop policy if exists sheets_admin on storage.objects;
create policy sheets_admin on storage.objects for all
  using (bucket_id = 'game-sheets' and public.is_admin()) with check (bucket_id = 'game-sheets' and public.is_admin());

-- ---------------------------------------------------------------
-- Reporting views for the admin dashboard
-- ---------------------------------------------------------------
create or replace view public.club_coverage as
  select c.id, c.name, c.club_type, c.city, c.state, c.pair_program_status,
         count(r.id) filter (where r.active) as referee_count,
         count(r.id) filter (where r.active and r.cert_level in ('level_1','level_2','level_3','nachc','ihf')) as certified_count,
         exists (select 1 from public.pairs p
                 join public.referees ra on ra.id = p.referee_a
                 join public.referees rb on rb.id = p.referee_b
                 where ra.club_id = c.id and rb.club_id = c.id
                   and (p.valid_until is null or p.valid_until >= current_date)) as has_certified_pair
  from public.clubs c left join public.referees r on r.club_id = c.id
  where c.active
  group by c.id;
grant select on public.club_coverage to anon, authenticated;

-- Tournament history per referee: one row per tournament officiated, games from the organizer report or counted from game sheets
create or replace view public.referee_tournament_history as
  select a.referee_id, t.id as tournament_id, t.name, t.sanction, t.region, t.start_date, t.end_date,
         t.venue_city, t.venue_state, a.role,
         coalesce(a.games_officiated,
                  (select count(*) from public.games g where g.tournament_id = t.id and (g.referee_1 = a.referee_id or g.referee_2 = a.referee_id)))::int as games
  from public.assignments a join public.tournaments t on t.id = a.tournament_id;
grant select on public.referee_tournament_history to authenticated;

create or replace view public.referee_season_stats as
  select h.referee_id,
         extract(year from h.start_date)::int as season,
         sum(h.games)::int as games,
         count(*)::int as tournaments
  from public.referee_tournament_history h
  group by h.referee_id, extract(year from h.start_date);
grant select on public.referee_season_stats to authenticated;
