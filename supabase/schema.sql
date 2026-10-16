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
-- Level 1 question drafts for the rules where the catalogue is thin (1, 3, 8, 9, 11).
-- Written from the IHF Rules of the Game; loaded inactive with source 'nrc_level1' so the NRC reviews each one
-- in Admin > Questions and ticks it active. Single correct answer, index 0 based.
insert into public.quiz_questions (source, source_ref, rule_number, category, difficulty, question, options, correct_index, answer, rule_ref, active)
values
-- Rule 1, playing court
('nrc_level1','NRC L1 1.01',1,'Playing court','level_1','What are the dimensions of the playing court?','["38 m long and 18 m wide", "40 m long and 25 m wide", "40 m long and 20 m wide", "42 m long and 22 m wide"]',2,'The playing court is a rectangle 40 metres long and 20 metres wide, including the two goal areas and the playing area.','1:1',false),
('nrc_level1','NRC L1 1.02',1,'Playing court','level_1','How far is the goal area line from the goal line?','["7 m", "9 m", "4 m", "6 m"]',3,'The goal area line (6 metre line) runs 6 m in front of the goal: two quarter circles of 6 m radius joined by a straight line parallel to the goal line.','1:4',false),
('nrc_level1','NRC L1 1.03',1,'Playing court','level_1','What is the free throw line and how far is it from the goal?','["A solid line 10 m from the goal", "A dashed line 9 m from the goal", "A solid line 9 m from the goal", "A dashed line 7 m from the goal"]',1,'The free throw line (9 metre line) is a dashed line 3 m outside the goal area line; its segments and the gaps between them are 15 cm long.','1:6',false),
('nrc_level1','NRC L1 1.04',1,'Playing court','level_1','How long is the 7 metre line and where is it?','["1 m long, 7 m in front of the goal, parallel to the goal line", "15 cm long, 7 m in front of the goal", "1 m long, 6 m in front of the goal", "3 m long, 7 m in front of the goal"]',0,'The 7 metre line is 1 m long, directly in front of the goal, parallel to the goal line and 7 m away from it, measured from the rear edge of the goal line.','1:7',false),
('nrc_level1','NRC L1 1.05',1,'Playing court','level_1','Where is the goalkeeper restraining line?','["4 m in front of the goal, 15 cm long", "4 m in front of the goal, 1 m long", "6 m in front of the goal, 15 cm long", "7 m in front of the goal, 15 cm long"]',0,'The goalkeeper restraining line (4 metre line) is 15 cm long, directly in front of the goal, 4 m from the rear edge of the goal line. The goalkeeper may not cross it before a 7 metre throw is taken.','1:8',false),
('nrc_level1','NRC L1 1.06',1,'Playing court','level_1','What are the inner dimensions of the goal?','["3 m wide and 2 m high", "3 m wide and 2.5 m high", "2.5 m wide and 2 m high", "3.5 m wide and 2 m high"]',0,'The goal is 2 m high and 3 m wide, measured on the inside. The posts and crossbar are 8 cm square and painted in two contrasting colours.','1:2',false),
('nrc_level1','NRC L1 1.07',1,'Playing court','level_1','How wide are the lines on the court?','["8 cm everywhere", "10 cm, except the goal line which is 8 cm", "5 cm, except the goal line between the posts which is 8 cm", "5 cm everywhere"]',2,'All lines are 5 cm wide and belong to the area they enclose. The goal line between the goal posts is 8 cm wide, the same depth as the posts.','1:3',false),
('nrc_level1','NRC L1 1.08',1,'Playing court','level_1','Where is the substitution line?','["On each side of the centre line, 4.5 m along the side line, in front of the team benches", "At the centre line only", "3 m from each goal line", "Anywhere along the side line in front of the benches"]',0,'The substitution lines are part of the side line on the substitution side, from the centre line to 4.5 m on each side. Players enter and leave the court across their own substitution line.','1:9',false),
('nrc_level1','NRC L1 1.09',1,'Playing court','level_1','Does the goal area line belong to the goal area?','["No, the line is part of the playing area", "Only the straight part belongs to the goal area", "It depends on which foot touches it", "Yes, lines belong to the area they enclose"]',3,'Lines belong to the area they enclose, so a court player who steps on the goal area line is in the goal area.','1:3',false),
('nrc_level1','NRC L1 1.10',1,'Playing court','level_1','What safety zone should surround the court?','["At least 1 m along the side lines and 2 m behind the goal lines", "At least 2 m all around", "At least 3 m behind the goal lines", "None is required indoors"]',0,'A safety zone of at least 1 m along the side lines and 2 m behind the goal lines is required around the playing court.','1:1',false),
-- Rule 3, the ball
('nrc_level1','NRC L1 3.01',3,'The ball','level_1','Which ball size is used for men and male youth over 16?','["Size 3: 58 to 60 cm, 425 to 475 g", "Size 2: 54 to 56 cm, 325 to 375 g", "Size 1: 50 to 52 cm, 290 to 330 g", "Size 3: 56 to 58 cm, 400 to 450 g"]',0,'Size 3 (58 to 60 cm circumference, 425 to 475 g) is used for men and male youth over 16 years.','3:2',false),
('nrc_level1','NRC L1 3.02',3,'The ball','level_1','Which ball size is used for women, female youth over 14 and male youth 12 to 16?','["Size 2: 56 to 58 cm, 375 to 400 g", "Size 2: 54 to 56 cm, 325 to 375 g", "Size 3: 58 to 60 cm, 425 to 475 g", "Size 1: 50 to 52 cm, 290 to 330 g"]',1,'Size 2 (54 to 56 cm, 325 to 375 g) is used for women, female youth over 14 and male youth from 12 to 16.','3:2',false),
('nrc_level1','NRC L1 3.03',3,'The ball','level_1','Which ball size is used for female youth 8 to 14 and male youth 8 to 12?','["Size 3", "Size 1: 50 to 52 cm, 290 to 330 g", "Size 2: 54 to 56 cm, 325 to 375 g", "Size 0: 46 to 48 cm"]',1,'Size 1 (50 to 52 cm, 290 to 330 g) is used for female youth from 8 to 14 and male youth from 8 to 12.','3:2',false),
('nrc_level1','NRC L1 3.04',3,'The ball','level_1','What must the surface of the ball be like?','["Made of leather or synthetic material, not shiny or slippery", "Shiny so it is visible", "Any material as long as it is round", "Leather only"]',0,'The ball is made of leather or synthetic material, spherical, and its surface must not be shiny or slippery.','3:1',false),
('nrc_level1','NRC L1 3.05',3,'The ball','level_1','How many balls must be available for a game?','["Exactly one", "At least four", "One per team", "At least two"]',3,'At least two balls must be available for every game, and the reserve ball must be immediately available at the timekeeper table during the game.','3:3',false),
('nrc_level1','NRC L1 3.06',3,'The ball','level_1','Who decides whether the reserve ball is brought into play?','["The referees", "The timekeeper", "The team captain in possession", "The team official of the team in possession"]',0,'The referees decide when the reserve ball is used. They should bring it in quickly to keep interruptions short.','3:4',false),
('nrc_level1','NRC L1 3.07',3,'The ball','level_1','For official international games, what must the ball carry?','["Nothing specific", "The IHF approval", "The national federation stamp", "The manufacturer name only"]',1,'Balls used in official international games must be approved by the IHF and carry the IHF approval.','3:2',false),
('nrc_level1','NRC L1 3.08',3,'The ball','level_1','A ball is found to be too light during a game. What should the referees do?','["Replace it with a compliant ball at the next interruption", "Continue, the weight does not matter once play has started", "Abandon the game", "Let the captains decide"]',0,'The ball must meet the size and weight rule for the category. The referees replace it with a compliant ball, as they decide which ball is used.','3:2 and 3:4',false),
-- Rule 8, fouls and unsportsmanlike conduct
('nrc_level1','NRC L1 8.01',8,'Fouls and unsportsmanlike conduct','level_1','Which action is permitted when playing against an opponent?','["Using an open hand to play the ball out of the hand of the opponent", "Pulling the ball out of the hands of the opponent", "Pushing the opponent with the hands", "Holding the opponent by the jersey"]',0,'Rule 8:1 permits using an open hand to play the ball out of the opponent''s hand, using bent arms to make body contact and keep control of the opponent, and using the trunk to block the opponent in the fight for position.','8:1',false),
('nrc_level1','NRC L1 8.02',8,'Fouls and unsportsmanlike conduct','level_1','Which action is NOT permitted?','["Using the trunk to block the opponent in the fight for position", "Using bent arms to make body contact", "Using an open hand to play the ball out of the opponent''s hand", "Blocking or forcing away the opponent with arms, hands or legs"]',3,'Rule 8:2 forbids pulling or hitting the ball out of the hands, blocking or forcing the opponent away with arms, hands or legs, using any part of the body to push the opponent, holding, and running or jumping into the opponent.','8:2',false),
('nrc_level1','NRC L1 8.03',8,'Fouls and unsportsmanlike conduct','level_1','A defender holds an attacker by the arm so that the attacker cannot pass. What is the decision?','["Free throw, or 7 metre throw if a clear chance of scoring was destroyed", "Throw in", "Nothing, holding the arm is allowed", "Goalkeeper throw"]',0,'Holding an opponent is a violation under rule 8:2. The game is restarted with a free throw, or a 7 metre throw when the violation destroyed a clear chance of scoring, and personal punishment follows if the criteria apply.','8:2, 13:1, 14:1',false),
('nrc_level1','NRC L1 8.04',8,'Fouls and unsportsmanlike conduct','level_1','What do the referees give for a violation that is directed mainly at the opponent and not at the ball?','["Always a direct disqualification", "A progressive punishment: warning first, then 2 minute suspension", "Nothing, as long as the ball was reached", "A free throw only, never a personal punishment"]',1,'Violations where the action is directed mainly or exclusively at the body of the opponent require progressive punishment: a warning, then 2 minute suspensions, then disqualification after the third suspension.','8:3',false),
('nrc_level1','NRC L1 8.05',8,'Fouls and unsportsmanlike conduct','level_1','An attacker in a fast break is pulled down from behind by a defender who has no chance of reaching the ball. Beyond the throw, what personal punishment applies?','["At least a 2 minute suspension; the warning stage is skipped", "A warning only", "No personal punishment", "A yellow card for the team official"]',0,'Rule 8:4 lists violations that require a direct 2 minute suspension even as a first offence, for example a foul against an opponent running at high speed or pulling an opponent down. A clear chance of scoring also brings a 7 metre throw.','8:4',false),
('nrc_level1','NRC L1 8.06',8,'Fouls and unsportsmanlike conduct','level_1','A defender hits an attacker in the head while the attacker is shooting. What is the correct personal punishment?','["Warning", "2 minute suspension", "No punishment if the ball went in", "Direct disqualification (red card)"]',3,'A hit to the head, throat or neck of an opponent, and similar particularly reckless or dangerous actions, are punished with a direct disqualification under rule 8:5.','8:5',false),
('nrc_level1','NRC L1 8.07',8,'Fouls and unsportsmanlike conduct','level_1','What is the difference between a disqualification under 8:5 and one under 8:6?','["8:6 covers assault and is reported in writing so the federation can take further action", "There is none, both are red cards", "8:6 is a 2 minute suspension", "8:5 applies only to goalkeepers"]',0,'Rule 8:6 covers particularly reckless, dangerous or malicious actions such as an assault. The disqualification is shown with the red and the blue card and the referees write a report so that the responsible authorities can decide on further measures.','8:6',false),
('nrc_level1','NRC L1 8.08',8,'Fouls and unsportsmanlike conduct','level_1','A player protests a decision with words and gestures. How is this punished the first time?','["Direct disqualification", "Nothing, protesting is allowed once", "A free throw only", "Progressively: a warning, then 2 minutes if it continues"]',3,'Protesting against a referee decision with words or gestures is unsportsmanlike conduct under rule 8:7 and is punished progressively, starting with a warning.','8:7',false),
('nrc_level1','NRC L1 8.09',8,'Fouls and unsportsmanlike conduct','level_1','After a decision against his team, a player kicks the ball away so the opponents cannot restart quickly. What is the punishment?','["Disqualification", "No punishment, the ball is dead", "2 minute suspension", "Warning"]',2,'Not releasing the ball or kicking it away after a decision, to delay the restart, is unsportsmanlike conduct requiring a 2 minute suspension under rule 8:8.','8:8',false),
('nrc_level1','NRC L1 8.10',8,'Fouls and unsportsmanlike conduct','level_1','A player throws the ball demonstratively at an opponent after the whistle. What is the punishment?','["A free throw and nothing else", "Direct disqualification", "2 minute suspension", "Warning"]',1,'Throwing the ball intentionally at an opponent during an interruption is seriously unsportsmanlike conduct under rule 8:9 and is punished with a direct disqualification.','8:9',false),
('nrc_level1','NRC L1 8.11',8,'Fouls and unsportsmanlike conduct','level_1','How many warnings may be given to one player, and how many to one team in total?','["Two per player, six per team", "Three per player, no team limit", "One per player, no team limit", "One per player, three per team"]',3,'A player may receive only one warning, and a team may receive no more than three warnings in total. After that, every violation requiring progressive punishment is a 2 minute suspension.','16:1',false),
('nrc_level1','NRC L1 8.12',8,'Fouls and unsportsmanlike conduct','level_1','What happens after a player receives a third 2 minute suspension?','["Disqualification for the rest of the game, the team plays 2 minutes short", "Nothing more, three suspensions is the maximum", "A fourth suspension of 4 minutes", "Disqualification with a written report"]',0,'A third suspension of the same player leads to disqualification (red card). The team plays with one player less for 2 minutes and the player may not return.','16:6',false),
-- Rule 9, scoring
('nrc_level1','NRC L1 9.01',9,'Scoring','level_1','When is a goal scored?','["When the ball touches the net", "When the goalkeeper fails to stop the ball", "When the entire ball has crossed the entire width of the goal line inside the goal, with no violation by the scorer or team mates before or during the throw", "When any part of the ball touches the goal line"]',2,'A goal is scored when the entire ball has crossed the entire width of the goal line, provided the scorer and the team mates did not violate the rules before or during the throw.','9:1',false),
('nrc_level1','NRC L1 9.02',9,'Scoring','level_1','A defender commits a violation but the ball still goes into the goal. What is the decision?','["No goal, free throw for the attackers", "No goal, 7 metre throw", "Retake the throw", "Goal"]',3,'A goal is awarded when a defender violates the rules but the ball still enters the goal. The violation does not cancel the goal.','9:1',false),
('nrc_level1','NRC L1 9.03',9,'Scoring','level_1','The referee whistles for an interruption and the ball then crosses the goal line. Goal?','["No goal, the game was interrupted before the ball crossed the line", "Goal, the ball crossed the line", "Goal if the goalkeeper touched it", "The referees decide by agreement with the captains"]',0,'A goal cannot be awarded when the referee or the timekeeper interrupted the game before the ball completely crossed the goal line.','9:1',false),
('nrc_level1','NRC L1 9.04',9,'Scoring','level_1','A defender deflects the ball into his own goal. What is the decision?','["No goal, goalkeeper throw", "No goal, free throw", "Throw in", "Goal for the opponents"]',3,'A ball played by a player into his own goal counts as a goal for the opposing team.','9:1',false),
('nrc_level1','NRC L1 9.05',9,'Scoring','level_1','How does the goal line referee signal a goal?','["Raising the arm with an open hand", "Pointing to the centre line only", "Two short whistle signals and hand signal 12", "One long whistle signal"]',2,'The goal line referee confirms a goal with two short whistle signals and hand signal 12 (goal).','9:2',false),
('nrc_level1','NRC L1 9.06',9,'Scoring','level_1','Can a goal be scored directly from a throw in?','["Yes", "No, the ball must be touched by another player first", "Only by the goalkeeper", "Only in youth games"]',0,'A goal may be scored directly from a throw in, as from a throw off, a free throw and a goalkeeper throw. Only the 7 metre throw has the special restrictions of rule 14.','11:2 and 9:1',false),
('nrc_level1','NRC L1 9.07',9,'Scoring','level_1','The ball is thrown towards the goal and the final signal sounds before it crosses the goal line. Goal?','["No goal", "Goal, the throw was taken before the signal", "Goal if the goalkeeper was beaten", "The timekeeper decides"]',0,'A goal is only scored when the ball crosses the goal line before the final signal; the game ends at the signal.','9:1 and 2:4',false),
('nrc_level1','NRC L1 9.08',9,'Scoring','level_1','Who wins the game?','["The team that scored more goals", "The team with fewer suspensions when goals are equal", "The team that scored first", "The team that scored last"]',0,'The team that scored more goals wins. If both teams scored the same number of goals, or none, the game is a draw, unless the competition regulations provide for extra time or 7 metre throws.','9:3',false),
('nrc_level1','NRC L1 9.09',9,'Scoring','level_1','A goal is scored and the referees have already signalled the throw off. The goal line referee then wants to disallow it. Possible?','["Yes, at any time", "Yes, if the timekeeper agrees", "Only in the last minute", "No, once the throw off has been executed the goal stands"]',3,'A goal that has been awarded cannot be cancelled after the referees have given the whistle signal for the throw off.','9:2',false),
-- Rule 11, throw in
('nrc_level1','NRC L1 11.01',11,'The throw-in','level_1','When is a throw in awarded?','["When the goalkeeper plays the ball over the outer goal line", "When the ball has completely crossed the side line, or the outer goal line after being last touched by a defending court player", "Only when the ball crosses the side line", "Every time the ball leaves the court"]',1,'A throw in is awarded when the entire ball has crossed the side line, or when a court player of the defending team was the last to touch the ball before it crossed the outer goal line. It also applies when the ball touches the ceiling or a fixture above the court.','11:1',false),
('nrc_level1','NRC L1 11.02',11,'The throw-in','level_1','Which team takes the throw in?','["The team with fewer players on the court", "The opponents of the team whose player last touched the ball", "The team that last touched the ball", "The defending team"]',1,'The throw in is taken by the opponents of the team whose player last touched the ball before it went out or touched the ceiling.','11:2',false),
('nrc_level1','NRC L1 11.03',11,'The throw-in','level_1','Where is the throw in taken when the ball crossed the side line?','["At the centre line", "Anywhere along the side line", "At the place where the ball crossed the side line", "At the nearest corner"]',2,'The throw in is taken from the spot where the ball crossed the side line.','11:3',false),
('nrc_level1','NRC L1 11.04',11,'The throw-in','level_1','Where is the throw in taken when a defending court player played the ball over the outer goal line?','["From the centre line", "From the corner, where the side line meets the outer goal line on that side", "From the goal area line", "From the 7 metre line"]',1,'When the ball crossed the outer goal line after a defender touched it, the throw in is taken from the intersection of the side line and the outer goal line on the side where the ball went out.','11:3',false),
('nrc_level1','NRC L1 11.05',11,'The throw-in','level_1','Where must the thrower stand?','["At least 1 m outside the side line", "With one foot on the side line until the ball leaves the hand; the other foot may be on either side of the line", "Completely outside the court", "With both feet inside the court"]',1,'The thrower must keep one foot on the side line until the ball has left the hand. The other foot may be placed on either side of the line.','11:4',false),
('nrc_level1','NRC L1 11.06',11,'The throw-in','level_1','How far must the opponents stay from the thrower?','["At least 5 m", "There is no distance rule for throw ins", "At least 3 m, or on their own goal area line if it is closer", "At least 1 m"]',2,'Opponents must stay at least 3 m from the thrower. If the throw in is taken close to their goal area, they may stand immediately outside their goal area line.','11:5',false),
('nrc_level1','NRC L1 11.07',11,'The throw-in','level_1','Is a whistle signal needed before a throw in?','["Only in the last five minutes", "Only when the ball crossed the outer goal line", "No, except when the throw in follows a time out", "Yes, always"]',2,'A throw in is taken without a whistle signal from the referee, except after a time out, when the referee whistles for the restart.','15:5',false),
('nrc_level1','NRC L1 11.08',11,'The throw-in','level_1','After taking the throw in, the thrower picks up the ball again before anyone else touched it. Decision?','["Retake the throw in", "Play on", "Goalkeeper throw", "Free throw for the opponents"]',3,'The thrower may not touch the ball again until it has touched another player or the goal. A violation is punished with a free throw for the opponents.','15:7 and 15:8',false),
('nrc_level1','NRC L1 11.09',11,'The throw-in','level_1','The ball goes over the outer goal line after the goalkeeper was the last to touch it. Decision?','["Throw in from the corner", "Free throw", "7 metre throw", "Goalkeeper throw"]',3,'When the goalkeeper of the defending team last touched the ball before it crossed the outer goal line, the restart is a goalkeeper throw, not a throw in.','12:1',false),
('nrc_level1','NRC L1 11.10',11,'The throw-in','level_1','The ball hits the ceiling of the hall. Decision?','["Throw off", "Free throw where the ball was last played", "Referee throw", "Throw in for the opponents of the team that last touched the ball, from the nearest point on the side line"]',3,'When the ball touches the ceiling or a fixture above the court, the opponents of the team that last touched the ball take a throw in from the point on the nearer side line closest to where the ball touched the ceiling.','11:1 and 11:3',false);
-- Timed challenge leaderboard. Run after schema.sql. Safe to re-run.
-- Points: correct answers in timed sessions of 10 questions or more, per calendar year (the season).
-- Visible to every signed in user (referees and admins); anonymous visitors do not see it.
-- The view runs as its owner, so it reads quiz_attempts across users; it exposes no email or phone.
create or replace view public.quiz_leaderboard as
select r.id as referee_id,
       r.first_name,
       r.last_name,
       r.photo_url,
       r.cert_level,
       r.home_city,
       r.home_state,
       extract(year from a.created_at)::int as season,
       count(*)::int as sessions,
       sum(a.total)::int as questions,
       sum(a.correct)::int as points,
       round(sum(a.correct)::numeric / nullif(sum(a.total), 0) * 100)::int as accuracy,
       max(round(a.correct::numeric / nullif(a.total, 0) * 100))::int as best_pct,
       max(a.created_at) as last_played
from public.quiz_attempts a
join public.referees r on r.user_id = a.user_id
where a.mode = 'timed' and a.total >= 10 and r.active
group by r.id, r.first_name, r.last_name, r.photo_url, r.cert_level, r.home_city, r.home_state, extract(year from a.created_at);
revoke all on public.quiz_leaderboard from anon;
grant select on public.quiz_leaderboard to authenticated;
-- Site feedback (Give feedback button) and referee onboarding flag. Run after schema.sql. Safe to re-run.
create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  email text,
  role text,
  page text,
  message text not null,
  user_agent text,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.site_feedback enable row level security;
drop policy if exists feedback_admin on public.site_feedback;
create policy feedback_admin on public.site_feedback for all using (public.is_admin()) with check (public.is_admin());
grant select, update on public.site_feedback to authenticated;

-- When the referee finished the welcome tour (null = show it at the next sign in).
alter table public.referees add column if not exists onboarded_at timestamptz;
