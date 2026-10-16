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
-- Joshua Forsthoefel, NRC chair: full admin access. Hosting accounts stay with Thomas until the transfer to USATH.
insert into public.admin_invites (email, invited_by) values ('referee@handballusa.org', 'setup') on conflict do nothing;

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

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.assignment_requests(id) on delete set null,
  to_email text not null,
  subject text,
  kind text, -- invite | reminder | confirm
  sent boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
alter table public.email_log enable row level security;
drop policy if exists email_admin on public.email_log;
create policy email_admin on public.email_log for all using (public.is_admin()) with check (public.is_admin());

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
drop view if exists public.referee_directory;
create view public.referee_directory as
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
drop policy if exists req_own_update on public.assignment_requests;
create policy req_own_update on public.assignment_requests for update
  using (referee_id in (select id from public.referees where user_id = auth.uid()))
  with check (referee_id in (select id from public.referees where user_id = auth.uid()));
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
-- Training sessions announced by the NRC (clinics, online rule sessions, certification courses).
-- Public pages show published sessions; admins manage them in Admin > Training sessions.
create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  session_type text not null default 'online', -- online | in_person | course
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text default 'America/Los_Angeles',
  location text,            -- city and venue, or "Zoom"
  audience text,            -- e.g. "Level 1 candidates", "All referees"
  description text,
  registration_url text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.training_sessions enable row level security;
drop policy if exists training_public_read on public.training_sessions;
create policy training_public_read on public.training_sessions for select using (published = true or public.is_admin());
drop policy if exists training_admin on public.training_sessions;
create policy training_admin on public.training_sessions for all using (public.is_admin()) with check (public.is_admin());
grant select on public.training_sessions to anon, authenticated;
grant insert, update, delete on public.training_sessions to authenticated;
-- Level 1 pathway: public referee list, contact inquiries, Level 1 course tracking, online test and automatic certification.
-- Run after schema.sql. Safe to re-run.

-- ---------------------------------------------------------------
-- Public referee list (no contact details). Certified, active referees only.
-- ---------------------------------------------------------------
create or replace view public.referee_directory as
select r.id,
       r.first_name,
       r.last_name,
       r.cert_level,
       r.home_state,
       c.name as club_name,
       coalesce((select min(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as certified_since,
       coalesce((select max(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as last_certified_on
from public.referees r
left join public.clubs c on c.id = r.club_id
where r.active and r.cert_level <> 'candidate';
grant select on public.referee_directory to anon, authenticated;

-- ---------------------------------------------------------------
-- Contact requests from the Become a referee page
-- ---------------------------------------------------------------
create table if not exists public.referee_inquiries (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  city text,
  state text,
  club_name text,
  background text,      -- playing, coaching or officiating background
  availability text,    -- when they could train and referee
  message text,
  status text not null default 'new', -- new | contacted | invited | closed
  admin_notes text,
  created_at timestamptz not null default now()
);
alter table public.referee_inquiries enable row level security;
drop policy if exists inquiries_insert on public.referee_inquiries;
create policy inquiries_insert on public.referee_inquiries for insert with check (true);
drop policy if exists inquiries_admin on public.referee_inquiries;
create policy inquiries_admin on public.referee_inquiries for all using (public.is_admin()) with check (public.is_admin());
grant insert on public.referee_inquiries to anon, authenticated;
grant select, update, delete on public.referee_inquiries to authenticated;

-- ---------------------------------------------------------------
-- Test parameters per level, editable by the NRC
-- ---------------------------------------------------------------
create table if not exists public.certification_tests (
  level cert_level primary key,
  question_count int not null default 30,
  pass_pct int not null default 80,
  time_limit_minutes int not null default 30,
  max_difficulty difficulty not null default 'level_1',
  module_pass_pct int not null default 70,   -- score needed to complete a course module
  module_question_count int not null default 10,
  updated_at timestamptz not null default now()
);
insert into public.certification_tests (level) values ('level_1') on conflict (level) do nothing;
alter table public.certification_tests enable row level security;
drop policy if exists tests_read on public.certification_tests;
create policy tests_read on public.certification_tests for select using (true);
drop policy if exists tests_admin on public.certification_tests;
create policy tests_admin on public.certification_tests for all using (public.is_admin()) with check (public.is_admin());
grant select on public.certification_tests to anon, authenticated;
grant update on public.certification_tests to authenticated;

-- ---------------------------------------------------------------
-- Course progress (one row per user and module) and study plan
-- ---------------------------------------------------------------
create table if not exists public.course_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  course text not null default 'level_1',
  module_key text not null,
  attempts int not null default 0,
  best_pct int not null default 0,
  passed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, course, module_key)
);
alter table public.course_progress enable row level security;
drop policy if exists progress_own on public.course_progress;
create policy progress_own on public.course_progress for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());
grant select, insert, update on public.course_progress to authenticated;

create table if not exists public.course_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  course text not null default 'level_1',
  start_date date not null,
  sessions_per_week int not null default 2,
  created_at timestamptz not null default now(),
  primary key (user_id, course)
);
alter table public.course_plans enable row level security;
drop policy if exists plans_own on public.course_plans;
create policy plans_own on public.course_plans for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.course_plans to authenticated;

-- ---------------------------------------------------------------
-- Certification test attempts
-- ---------------------------------------------------------------
create table if not exists public.certification_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  level cert_level not null,
  total int not null,
  correct int not null,
  pct int not null,
  passed boolean not null,
  duration_seconds int,
  awarded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.certification_attempts enable row level security;
drop policy if exists cert_attempts_own on public.certification_attempts;
create policy cert_attempts_own on public.certification_attempts for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists cert_attempts_insert on public.certification_attempts;
create policy cert_attempts_insert on public.certification_attempts for insert with check (user_id = auth.uid());
grant select, insert on public.certification_attempts to authenticated;

-- Awards the certification for a passed attempt. Runs with elevated rights so the referee
-- cannot write certifications directly; the only path is a passed attempt of their own.
create or replace function public.award_certification(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.certification_attempts%rowtype;
  r public.referees%rowtype;
  t public.certification_tests%rowtype;
  rank_new int; rank_cur int;
begin
  select * into a from public.certification_attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'attempt not found'); end if;
  select * into t from public.certification_tests where level = a.level;
  if not found or a.pct < t.pass_pct or not a.passed then return jsonb_build_object('ok', false, 'reason', 'not passed'); end if;
  if a.awarded then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into r from public.referees where user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'no referee record'); end if;
  rank_new := array_position(array['candidate','level_1','level_2','level_3','nachc','ihf']::text[], a.level::text);
  rank_cur := array_position(array['candidate','level_1','level_2','level_3','nachc','ihf']::text[], r.cert_level::text);
  insert into public.certifications (referee_id, level, obtained_on, certified_by, event, notes)
  values (r.id, a.level, current_date, 'NRC Referee Hub online test', 'Online theory test', a.correct || '/' || a.total || ' (' || a.pct || '%)');
  if rank_new > rank_cur then
    update public.referees set cert_level = a.level, cert_date = current_date, cert_by = 'NRC Referee Hub online test', updated_at = now() where id = r.id;
  end if;
  update public.certification_attempts set awarded = true where id = a.id;
  return jsonb_build_object('ok', true, 'level', a.level);
end $$;
grant execute on function public.award_certification(uuid) to authenticated;

-- ---------------------------------------------------------------
-- Certified referees: baseline assessment, tailored program, re-test
-- ---------------------------------------------------------------
create table if not exists public.program_settings (
  id int primary key default 1 check (id = 1),
  assessment_questions int not null default 50,
  assessment_pass_pct int not null default 80,     -- hurdle to clear on the baseline or a re-test
  weak_rule_pct int not null default 80,           -- rules scored below this go into the program
  program_weeks int not null default 12,
  sessions_per_week int not null default 2,
  module_question_count int not null default 10,
  module_pass_pct int not null default 80,
  time_limit_minutes int not null default 60,
  updated_at timestamptz not null default now()
);
insert into public.program_settings (id) values (1) on conflict (id) do nothing;
alter table public.program_settings enable row level security;
drop policy if exists program_settings_read on public.program_settings;
create policy program_settings_read on public.program_settings for select using (true);
drop policy if exists program_settings_admin on public.program_settings;
create policy program_settings_admin on public.program_settings for all using (public.is_admin()) with check (public.is_admin());
grant select on public.program_settings to anon, authenticated;
grant update on public.program_settings to authenticated;

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'baseline', -- baseline | retest
  total int not null,
  correct int not null,
  pct int not null,
  passed boolean not null,
  by_rule jsonb not null default '{}'::jsonb, -- {"7": {"n": 4, "c": 2}, ...}
  duration_seconds int,
  created_at timestamptz not null default now()
);
alter table public.assessments enable row level security;
drop policy if exists assessments_own on public.assessments;
create policy assessments_own on public.assessments for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments for insert with check (user_id = auth.uid());
grant select, insert on public.assessments to authenticated;

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  weak_rules int[] not null default '{}',
  started_on date not null default current_date,
  due_on date not null,
  status text not null default 'active', -- active | ready_for_retest | cleared | expired
  cleared_on date,
  created_at timestamptz not null default now()
);
alter table public.programs enable row level security;
drop policy if exists programs_own on public.programs;
create policy programs_own on public.programs for all using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid());
grant select, insert, update on public.programs to authenticated;

-- Admin overview: one row per referee with sign in status, baseline and program state
drop view if exists public.referee_program_status;
create view public.referee_program_status as
select r.id as referee_id, r.first_name, r.last_name, r.cert_level, r.user_id,
       (select max(created_at) from public.assessments a where a.user_id = r.user_id and a.kind = 'baseline') as baseline_at,
       (select pct from public.assessments a where a.user_id = r.user_id order by created_at desc limit 1) as last_pct,
       p.status as program_status, p.due_on, p.cleared_on,
       (select count(*) from public.course_progress c where c.user_id = r.user_id and c.course = 'program:' || p.id::text and c.passed) as modules_done,
       coalesce(array_length(p.weak_rules, 1), 0) as modules_total
from public.referees r
left join lateral (select * from public.programs x where x.user_id = r.user_id order by created_at desc limit 1) p on true
where r.active and public.is_admin();
grant select on public.referee_program_status to authenticated;
-- Staffing v2: weekend availability, tentative answers, supervisor need, organizer status page.
-- Run the first statement on its own (Postgres cannot add an enum value and use it in the same transaction), then the rest.

alter type request_status add value if not exists 'tentative';

-- ---------------------------------------------------------------
-- Weekend availability declared by referees (Saturday date identifies the weekend)
-- ---------------------------------------------------------------
create table if not exists public.weekend_availability (
  referee_id uuid not null references public.referees(id) on delete cascade,
  weekend date not null,                 -- the Saturday
  status text not null default 'available' check (status in ('available','unavailable','tentative')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (referee_id, weekend)
);
alter table public.weekend_availability enable row level security;
drop policy if exists wa_own on public.weekend_availability;
create policy wa_own on public.weekend_availability for all
  using (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()))
  with check (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()));
grant select, insert, update, delete on public.weekend_availability to authenticated;

-- ---------------------------------------------------------------
-- Tournament request: supervisor need, organizer access token
-- ---------------------------------------------------------------
alter table public.tournaments add column if not exists supervisor_needed boolean not null default false;
alter table public.tournaments add column if not exists supervisor_notes text;
alter table public.tournaments add column if not exists organizer_token uuid not null default gen_random_uuid();
alter table public.tournaments add column if not exists organizer_notified_at timestamptz;
-- Level confirmation badge and "theory passed" status for the Level 1 online test.
alter table public.referees add column if not exists level_confirmed boolean not null default true;
alter table public.referees add column if not exists level1_theory_passed_on date;

-- The nine CalCup 2027 respondents entered from email: level to be confirmed by the NRC
update public.referees set level_confirmed = false where email in (
 'joe.w.bauer@gmail.com','peterschubertplc@gmail.com','puig.ruiz.josep1@gmail.com','ragusarosario@gmail.com','asangacho@gmail.com',
 'toma.c.ionut@gmail.com','mladenovicmirko@gmail.com','adelavalenzuelabonilla@gmail.com','toraoline09@gmail.com');

drop view if exists public.referee_directory;
create view public.referee_directory as
select r.id, r.first_name, r.last_name, r.cert_level, r.level_confirmed, r.home_state, c.name as club_name,
       coalesce((select min(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as certified_since,
       coalesce((select max(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as last_certified_on
from public.referees r
left join public.clubs c on c.id = r.club_id
where r.active and r.cert_level <> 'candidate';
grant select on public.referee_directory to anon, authenticated;

-- A passed online test records "theory passed"; the NRC awards Level 1 after the practical part.
create or replace function public.award_certification(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.certification_attempts%rowtype;
  r public.referees%rowtype;
  t public.certification_tests%rowtype;
begin
  select * into a from public.certification_attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'attempt not found'); end if;
  select * into t from public.certification_tests where level = a.level;
  if not found or a.pct < t.pass_pct or not a.passed then return jsonb_build_object('ok', false, 'reason', 'not passed'); end if;
  if a.awarded then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into r from public.referees where user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'no referee record'); end if;
  if a.level = 'level_1' then
    update public.referees set level1_theory_passed_on = coalesce(level1_theory_passed_on, current_date), updated_at = now() where id = r.id;
  end if;
  update public.certification_attempts set awarded = true where id = a.id;
  return jsonb_build_object('ok', true, 'level', a.level, 'theory_only', true);
end $$;
grant execute on function public.award_certification(uuid) to authenticated;
-- Organizer accounts, bookings ownership, NRC travel tool.

-- Tournament: who manages bookings and expenses
alter table public.tournaments add column if not exists travel_managed_by text not null default 'organizer' check (travel_managed_by in ('nrc','organizer'));

-- Organizers can sign in: an email that submitted a tournament request is accepted at first sign in with the organizer role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare r_id uuid; r_name text; is_admin_invite boolean; is_org boolean; org_name text;
begin
  select id, first_name || ' ' || last_name into r_id, r_name from public.referees where lower(email) = lower(new.email) limit 1;
  select exists (select 1 from public.admin_invites where lower(email) = lower(new.email)) into is_admin_invite;
  select exists (select 1 from public.tournaments where lower(organizer_email) = lower(new.email)) into is_org;
  if is_org then select organizer_name into org_name from public.tournaments where lower(organizer_email) = lower(new.email) order by created_at desc limit 1; end if;
  if r_id is null and not is_admin_invite and not is_org then
    raise exception 'This email is not on the NRC referee roster and has not submitted a tournament request. Write to referee@handballusa.org to be invited.';
  end if;
  insert into public.profiles (id, email, role, full_name)
    values (new.id, new.email,
            case when is_admin_invite then 'admin'::user_role when r_id is not null then 'referee'::user_role else 'organizer'::user_role end,
            coalesce(r_name, org_name))
  on conflict (id) do nothing;
  if r_id is not null then update public.referees set user_id = new.id where id = r_id and user_id is null; end if;
  if is_org then update public.tournaments set organizer_user_id = new.id where lower(organizer_email) = lower(new.email) and organizer_user_id is null; end if;
  return new;
end $$;

-- Organizers read their tournaments by email too (requests submitted before they had an account)
drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments for select using (public.is_admin() or organizer_user_id = auth.uid()
  or lower(organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))
  or id in (select tournament_id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid())
  or id in (select tournament_id from public.assignment_requests a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()));

-- Travel bookings per assignment (flight, hotel, car, other), entered by the NRC when it manages travel
create table if not exists public.travel_bookings (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  kind text not null check (kind in ('flight','hotel','car','train','other')),
  status text not null default 'pending' check (status in ('pending','booked','cancelled')),
  provider text,          -- airline, hotel name, rental company
  reference text,         -- confirmation or PNR
  start_at timestamptz,   -- departure, check in, pickup
  end_at timestamptz,     -- arrival, check out, return
  from_place text,        -- airport or address
  to_place text,
  cost numeric(10,2),
  currency text default 'USD',
  paid_by text default 'nrc' check (paid_by in ('nrc','organizer','referee')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.travel_bookings enable row level security;
drop policy if exists travel_admin on public.travel_bookings;
create policy travel_admin on public.travel_bookings for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists travel_own on public.travel_bookings;
create policy travel_own on public.travel_bookings for select
  using (assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()));
drop policy if exists travel_organizer on public.travel_bookings;
create policy travel_organizer on public.travel_bookings for select
  using (assignment_id in (select a.id from public.assignments a join public.tournaments t on t.id = a.tournament_id
         where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
grant select, insert, update, delete on public.travel_bookings to authenticated;

-- Organizers see who is designated for their tournaments (names, level, club, contact), nothing else about referees
drop view if exists public.organizer_designations;
create view public.organizer_designations as
select a.id as assignment_id, a.tournament_id, a.role, a.travel_notes,
       r.id as referee_id, r.first_name, r.last_name, r.email, r.phone, r.cert_level, r.home_city, r.home_state, r.home_airport_iata, r.departure_airport_iata, r.photo_url,
       c.name as club_name
from public.assignments a
join public.referees r on r.id = a.referee_id
join public.tournaments t on t.id = a.tournament_id
left join public.clubs c on c.id = r.club_id
where public.is_admin() or t.organizer_user_id = auth.uid()
   or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''));
grant select on public.organizer_designations to authenticated;

-- Staffing overview for the admin cards
drop view if exists public.tournament_staffing;
create view public.tournament_staffing as
select t.id, t.name, t.start_date, t.end_date, t.venue_city, t.venue_state, t.status, t.pairs_needed, t.supervisor_needed, t.travel_managed_by, t.organizer_name, t.organizer_notified_at,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status in ('sent','tentative')) as waiting,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status = 'accepted') as accepted,
       (select count(*) from public.assignments a where a.tournament_id = t.id and a.role = 'referee') as confirmed,
       (select count(*) from public.assignments a where a.tournament_id = t.id and a.role <> 'referee') as officials,
       (select count(*) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked') as bookings_done,
       (select count(*) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'pending') as bookings_pending
from public.tournaments t
where public.is_admin();
grant select on public.tournament_staffing to authenticated;
-- Organizer edits, cancellation, change log and change notifications.

-- Organizers may update their own request; a trigger keeps status and ownership columns under control.
drop policy if exists tournaments_organizer_update on public.tournaments;
create policy tournaments_organizer_update on public.tournaments for update
  using (organizer_user_id = auth.uid() or lower(organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), '')))
  with check (organizer_user_id = auth.uid() or lower(organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), '')));

create table if not exists public.tournament_changes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  changed_by uuid references auth.users(id),
  changed_by_role text,
  changes jsonb not null,          -- {"field": {"from": x, "to": y}}
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.tournament_changes enable row level security;
drop policy if exists tc_read on public.tournament_changes;
create policy tc_read on public.tournament_changes for select using (public.is_admin() or tournament_id in (select id from public.tournaments));
grant select on public.tournament_changes to authenticated;

create or replace function public.tournament_guard_and_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare diff jsonb := '{}'::jsonb; f text; oldv text; newv text; role text;
begin
  select p.role::text into role from public.profiles p where p.id = auth.uid();
  if not public.is_admin() then
    -- organizers cannot touch ownership or move status except to cancelled
    new.organizer_token := old.organizer_token; new.organizer_user_id := old.organizer_user_id; new.organizer_notified_at := old.organizer_notified_at;
    if new.status is distinct from old.status and new.status <> 'cancelled' then new.status := old.status; end if;
    if old.status = 'cancelled' then raise exception 'This request is cancelled; contact the NRC to reopen it.'; end if;
  end if;
  foreach f in array array['name','start_date','end_date','venue_name','venue_address','venue_city','venue_state','nearest_airport_iata','pairs_needed','games_expected','supervisor_needed','supervisor_notes','hotel_nights_covered','flights_covered','airport_transfers_covered','airport_transfer_how','hotel_to_venue_transport','food_stipend_per_day','meals_provided','earliest_return_last_day','travel_managed_by','notes','status','organizer_name','organizer_email','organizer_phone'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into oldv, newv using old, new;
    if oldv is distinct from newv then diff := diff || jsonb_build_object(f, jsonb_build_object('from', oldv, 'to', newv)); end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.tournament_changes (tournament_id, changed_by, changed_by_role, changes) values (new.id, auth.uid(), coalesce(role, 'system'), diff);
  end if;
  return new;
end $$;
drop trigger if exists tournament_guard_and_log on public.tournaments;
create trigger tournament_guard_and_log before update on public.tournaments for each row execute function public.tournament_guard_and_log();
-- Session 3: bookings by organizers and referees, expense claims, post event report, reminders log.

-- Organizers and referees can record bookings on their own assignments (NRC keeps full control)
drop policy if exists travel_organizer_write on public.travel_bookings;
create policy travel_organizer_write on public.travel_bookings for all
  using (assignment_id in (select a.id from public.assignments a join public.tournaments t on t.id = a.tournament_id
         where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))))
  with check (assignment_id in (select a.id from public.assignments a join public.tournaments t on t.id = a.tournament_id
         where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
drop policy if exists travel_referee_write on public.travel_bookings;
create policy travel_referee_write on public.travel_bookings for all
  using (assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()))
  with check (assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()));
alter table public.travel_bookings add column if not exists entered_by text default 'nrc' check (entered_by in ('nrc','organizer','referee'));

-- Expense claims by referees (or entered by the NRC), reviewed by the NRC, reimbursed by the organizer or the NRC
create table if not exists public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  kind text not null check (kind in ('flight','hotel','car','mileage','per_diem','transport','other')),
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  description text,
  receipt_url text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','reimbursed')),
  reimbursed_by text default 'organizer' check (reimbursed_by in ('organizer','nrc')),
  submitted_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.expense_claims enable row level security;
drop policy if exists exp_admin on public.expense_claims;
create policy exp_admin on public.expense_claims for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists exp_referee on public.expense_claims;
create policy exp_referee on public.expense_claims for all
  using (assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()))
  with check (status = 'submitted' and assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()));
drop policy if exists exp_organizer on public.expense_claims;
create policy exp_organizer on public.expense_claims for select
  using (assignment_id in (select a.id from public.assignments a join public.tournaments t on t.id = a.tournament_id
         where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
grant select, insert, update, delete on public.expense_claims to authenticated;

-- Receipts bucket (private; signed URLs)
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
drop policy if exists receipts_own on storage.objects;
create policy receipts_own on storage.objects for all
  using (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text))
  with check (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- Post event report by the organizer
create table if not exists public.tournament_reports (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  games_played int,
  referee_rating smallint check (referee_rating between 1 and 5),
  supervisor_rating smallint check (supervisor_rating between 1 and 5),
  highlights text,
  incidents text,
  would_request_again boolean,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now()
);
alter table public.tournament_reports enable row level security;
drop policy if exists rep_admin on public.tournament_reports;
create policy rep_admin on public.tournament_reports for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists rep_organizer on public.tournament_reports;
create policy rep_organizer on public.tournament_reports for all
  using (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))))
  with check (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
grant select, insert, update on public.tournament_reports to authenticated;
-- organizers may set games officiated per official on their own tournaments
drop policy if exists asg_organizer_update on public.assignments;
create policy asg_organizer_update on public.assignments for update
  using (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))))
  with check (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
drop policy if exists asg_organizer_read on public.assignments;
create policy asg_organizer_read on public.assignments for select
  using (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));

-- Reminder log (what the daily job sent, to avoid repeats)
create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,           -- invitation | travel | report | program
  target_id uuid not null,      -- request, assignment, tournament or program id
  sent_to text,
  created_at timestamptz not null default now()
);
alter table public.reminder_log enable row level security;
drop policy if exists rl_admin on public.reminder_log;
create policy rl_admin on public.reminder_log for select using (public.is_admin());
grant select on public.reminder_log to authenticated;

-- Financial summary per tournament for the admin and the organizer
drop view if exists public.tournament_finance;
create view public.tournament_finance as
select t.id as tournament_id,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'nrc') as nrc_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'organizer') as organizer_paid_bookings,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'submitted') as claims_submitted,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'approved') as claims_approved,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'reimbursed') as claims_reimbursed
from public.tournaments t
where public.is_admin() or t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''));
grant select on public.tournament_finance to authenticated;
-- Fix: infinite recursion between tournaments and assignments policies.
-- tournaments_read looked into assignments; asg_organizer_* looked into tournaments. Postgres rejects the loop (42P17)
-- and every referee page that reads assignments, games or evaluations got a 500.
-- Helpers run as security definer so the policy bodies no longer re-enter each other's RLS.

create or replace function public.my_referee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.referees where user_id = auth.uid() limit 1
$$;

create or replace function public.my_tournament_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tournament_id from public.assignments where referee_id = public.my_referee_id()
  union
  select tournament_id from public.assignment_requests where referee_id = public.my_referee_id()
$$;

create or replace function public.organizer_tournament_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select t.id from public.tournaments t
  where t.organizer_user_id = auth.uid()
     or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))
$$;

grant execute on function public.my_referee_id(), public.my_tournament_ids(), public.organizer_tournament_ids() to authenticated, anon;

-- tournaments
drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments for select
  using (public.is_admin() or id in (select public.organizer_tournament_ids()) or id in (select public.my_tournament_ids()));
drop policy if exists tournaments_organizer_update on public.tournaments;
create policy tournaments_organizer_update on public.tournaments for update
  using (id in (select public.organizer_tournament_ids())) with check (id in (select public.organizer_tournament_ids()));

-- assignments
drop policy if exists asg_organizer_update on public.assignments;
create policy asg_organizer_update on public.assignments for update
  using (tournament_id in (select public.organizer_tournament_ids())) with check (tournament_id in (select public.organizer_tournament_ids()));
drop policy if exists asg_organizer_read on public.assignments;
create policy asg_organizer_read on public.assignments for select
  using (tournament_id in (select public.organizer_tournament_ids()));
drop policy if exists asg_own on public.assignments;
create policy asg_own on public.assignments for select
  using (public.is_admin() or referee_id = public.my_referee_id());

-- assignment requests
drop policy if exists req_own on public.assignment_requests;
create policy req_own on public.assignment_requests for select
  using (public.is_admin() or referee_id = public.my_referee_id());
drop policy if exists req_own_update on public.assignment_requests;
create policy req_own_update on public.assignment_requests for update
  using (referee_id = public.my_referee_id()) with check (referee_id = public.my_referee_id());

-- travel bookings
drop policy if exists travel_own on public.travel_bookings;
create policy travel_own on public.travel_bookings for select
  using (assignment_id in (select id from public.assignments where referee_id = public.my_referee_id()));
drop policy if exists travel_organizer on public.travel_bookings;
create policy travel_organizer on public.travel_bookings for select
  using (assignment_id in (select id from public.assignments where tournament_id in (select public.organizer_tournament_ids())));
drop policy if exists travel_organizer_write on public.travel_bookings;
create policy travel_organizer_write on public.travel_bookings for all
  using (assignment_id in (select id from public.assignments where tournament_id in (select public.organizer_tournament_ids())))
  with check (assignment_id in (select id from public.assignments where tournament_id in (select public.organizer_tournament_ids())));
drop policy if exists travel_referee_write on public.travel_bookings;
create policy travel_referee_write on public.travel_bookings for all
  using (assignment_id in (select id from public.assignments where referee_id = public.my_referee_id()))
  with check (assignment_id in (select id from public.assignments where referee_id = public.my_referee_id()));

-- expense claims
drop policy if exists exp_referee on public.expense_claims;
create policy exp_referee on public.expense_claims for all
  using (assignment_id in (select id from public.assignments where referee_id = public.my_referee_id()))
  with check (status = 'submitted' and assignment_id in (select id from public.assignments where referee_id = public.my_referee_id()));
drop policy if exists exp_organizer on public.expense_claims;
create policy exp_organizer on public.expense_claims for select
  using (assignment_id in (select id from public.assignments where tournament_id in (select public.organizer_tournament_ids())));

-- reports
drop policy if exists rep_organizer on public.tournament_reports;
create policy rep_organizer on public.tournament_reports for all
  using (tournament_id in (select public.organizer_tournament_ids())) with check (tournament_id in (select public.organizer_tournament_ids()));

-- views that filtered by organizer email inline
drop view if exists public.organizer_designations;
create view public.organizer_designations as
select a.id as assignment_id, a.tournament_id, a.role, a.travel_notes,
       r.id as referee_id, r.first_name, r.last_name, r.email, r.phone, r.cert_level, r.home_city, r.home_state, r.home_airport_iata, r.departure_airport_iata, r.photo_url,
       c.name as club_name
from public.assignments a
join public.referees r on r.id = a.referee_id
left join public.clubs c on c.id = r.club_id
where public.is_admin() or a.tournament_id in (select public.organizer_tournament_ids());
grant select on public.organizer_designations to authenticated;

-- Finance view: add bookings paid by referees (to be reimbursed)
drop view if exists public.tournament_finance;
create view public.tournament_finance as
select t.id as tournament_id,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'nrc') as nrc_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'organizer') as organizer_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'referee') as referee_paid_bookings,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'submitted') as claims_submitted,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'approved') as claims_approved,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'reimbursed') as claims_reimbursed
from public.tournaments t
where public.is_admin() or t.id in (select public.organizer_tournament_ids());
grant select on public.tournament_finance to authenticated;
