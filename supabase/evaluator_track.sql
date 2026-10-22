-- Evaluator track and IHF pair observation reports (2026-10-21)
-- Run STEP 0 alone first (new enum value), then the rest. Safe to run more than once.
--
-- 1. evaluators: a function held by a referee, a club member or an NRC member; club affiliation optional
-- 2. certification: rules exam (IHF catalogue, 80%) and video calibration (rate NRC reference games; 80% of items
--    within one step of the reference rating; only the first attempt on each game counts); validity in evaluator_settings
-- 3. observation_reports: one report per referee pair per game, 21 IHF items on the six step scale (stored -2 to +3),
--    summary, type of match, influence, remarks, key scenes with video timestamps; the NRC reviews and releases
-- 4. each submitted report writes one evaluations row per referee, so profiles, game log and rankings keep working
-- 5. organizers no longer evaluate; they keep logging games

-- STEP 0 (run alone, before the rest)
-- alter type user_role add value if not exists 'evaluator';

-- ---------------------------------------------------------------
-- 1. settings and evaluators
-- ---------------------------------------------------------------
create table if not exists public.evaluator_settings (
  id int primary key default 1 check (id = 1),
  rules_question_count int not null default 40,
  rules_pass_pct int not null default 80,
  rules_time_limit_minutes int not null default 45,
  rules_max_difficulty difficulty not null default 'level_2',
  calibration_pass_pct int not null default 80,
  calibration_tolerance int not null default 1,          -- steps on the six step scale
  calibration_games_required int not null default 3,
  rules_valid_months int not null default 12,
  calibration_valid_months int not null default 24,
  probation_reports int not null default 2,              -- first reports of a new evaluator read in full by the NRC
  report_due_days int not null default 3,
  weekly_target int not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.evaluator_settings (id) values (1) on conflict (id) do nothing;
alter table public.evaluator_settings enable row level security;
drop policy if exists evs_read on public.evaluator_settings;
create policy evs_read on public.evaluator_settings for select using (auth.uid() is not null);
drop policy if exists evs_admin on public.evaluator_settings;
create policy evs_admin on public.evaluator_settings for all using (public.is_admin()) with check (public.is_admin());
grant select, update on public.evaluator_settings to authenticated;

create table if not exists public.evaluators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  referee_id uuid unique references public.referees(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  club_id uuid references public.clubs(id) on delete set null,   -- null: no club affiliation
  origin text not null default 'referee' check (origin in ('referee','club_member','coach','nrc','organizer','other')),
  handball_background text,
  usath_member_id text,
  safesport_valid_until date,
  status text not null default 'in_training' check (status in ('in_training','certified','suspended','inactive')),
  founding boolean not null default false,   -- certified directly by the NRC to set the reference ratings
  rules_pct int, rules_passed_on date,
  calibration_pct int, calibration_passed_on date,
  certified_on date, certified_by text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists evaluators_email_uq on public.evaluators (lower(email));

-- link to the account and the referee record by email
create or replace function public.evaluators_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if new.user_id is null then select id into new.user_id from auth.users where lower(email) = new.email limit 1; end if;
  if new.referee_id is null then select id into new.referee_id from public.referees where lower(email) = new.email limit 1; end if;
  if new.referee_id is not null and new.origin = 'club_member' then new.origin := 'referee'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists evaluators_link on public.evaluators;
create trigger evaluators_link before insert or update on public.evaluators for each row execute function public.evaluators_link();

create or replace function public.my_evaluator_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.evaluators where user_id = auth.uid() limit 1;
$$;

-- certified and within validity (founding evaluators are not subject to expiry)
create or replace function public.evaluator_is_current(e public.evaluators) returns boolean
language sql stable security definer set search_path = public as $$
  select e.status = 'certified' and (e.founding or (
    e.rules_passed_on >= (current_date - make_interval(months => s.rules_valid_months))::date and
    e.calibration_passed_on >= (current_date - make_interval(months => s.calibration_valid_months))::date))
  from public.evaluator_settings s where s.id = 1;
$$;
create or replace function public.is_certified_evaluator() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.evaluator_is_current(e) from public.evaluators e where e.user_id = auth.uid()), false);
$$;

alter table public.evaluators enable row level security;
drop policy if exists evaluators_read on public.evaluators;
create policy evaluators_read on public.evaluators for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists evaluators_admin on public.evaluators;
create policy evaluators_admin on public.evaluators for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists evaluators_self on public.evaluators;
create policy evaluators_self on public.evaluators for update using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.evaluators to authenticated;

-- the evaluator edits contact fields only; certification fields belong to the NRC
create or replace function public.evaluators_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or coalesce(current_setting('nrc.system', true), '') = 'on' then return new; end if;
  if new.status is distinct from old.status or new.founding is distinct from old.founding or new.rules_pct is distinct from old.rules_pct
     or new.rules_passed_on is distinct from old.rules_passed_on or new.calibration_pct is distinct from old.calibration_pct
     or new.calibration_passed_on is distinct from old.calibration_passed_on or new.certified_on is distinct from old.certified_on
     or new.certified_by is distinct from old.certified_by or new.admin_notes is distinct from old.admin_notes
     or new.email is distinct from old.email or new.user_id is distinct from old.user_id or new.referee_id is distinct from old.referee_id then
    raise exception 'Only the NRC can change certification fields.';
  end if;
  return new;
end $$;
drop trigger if exists evaluators_guard on public.evaluators;
create trigger evaluators_guard before update on public.evaluators for each row execute function public.evaluators_guard();

-- a signed in referee, organizer or admin joins the track from their page
create or replace function public.evaluator_enroll(p_background text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; r public.referees%rowtype; p public.profiles%rowtype; fn text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select id into v from public.evaluators where user_id = auth.uid();
  if v is not null then return v; end if;
  select * into p from public.profiles where id = auth.uid();
  select * into r from public.referees where user_id = auth.uid();
  fn := coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1));
  insert into public.evaluators (user_id, referee_id, first_name, last_name, email, phone, club_id, origin, handball_background, usath_member_id, safesport_valid_until)
  values (auth.uid(), r.id,
          coalesce(r.first_name, split_part(fn, ' ', 1)),
          coalesce(r.last_name, nullif(trim(substr(fn, length(split_part(fn, ' ', 1)) + 1)), ''), '-'),
          p.email, r.phone, r.club_id,
          case when r.id is not null then 'referee' when p.role = 'organizer' then 'organizer' when p.role = 'admin' then 'nrc' else 'other' end,
          p_background, r.usath_member_id, r.safesport_valid_until)
  returning id into v;
  return v;
end $$;
grant execute on function public.evaluator_enroll(text) to authenticated;

-- sign in: evaluators added by the NRC can sign in; club members without a referee record get the evaluator role
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare r_id uuid; r_name text; is_admin_invite boolean; is_org boolean; org_name text; ev_id uuid; ev_name text;
begin
  select id, first_name || ' ' || last_name into r_id, r_name from public.referees where lower(email) = lower(new.email) limit 1;
  select exists (select 1 from public.admin_invites where lower(email) = lower(new.email)) into is_admin_invite;
  select exists (select 1 from public.tournaments where lower(organizer_email) = lower(new.email)) into is_org;
  if is_org then select organizer_name into org_name from public.tournaments where lower(organizer_email) = lower(new.email) order by created_at desc limit 1; end if;
  select id, first_name || ' ' || last_name into ev_id, ev_name from public.evaluators where lower(email) = lower(new.email) limit 1;
  if r_id is null and not is_admin_invite and not is_org and ev_id is null then
    raise exception 'This email is not on the NRC roster and has not submitted a tournament request. Write to referee@handballusa.org to be invited.';
  end if;
  insert into public.profiles (id, email, role, full_name)
    values (new.id, new.email,
            case when is_admin_invite then 'admin'::user_role when r_id is not null then 'referee'::user_role
                 when is_org then 'organizer'::user_role else 'evaluator'::user_role end,
            coalesce(r_name, org_name, ev_name))
  on conflict (id) do nothing;
  if r_id is not null then update public.referees set user_id = new.id where id = r_id and user_id is null; end if;
  if is_org then update public.tournaments set organizer_user_id = new.id where lower(organizer_email) = lower(new.email) and organizer_user_id is null; end if;
  if ev_id is not null then
    perform set_config('nrc.system', 'on', true);
    update public.evaluators set user_id = new.id where id = ev_id and user_id is null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------
-- 2. certification: rules exam and video calibration
-- ---------------------------------------------------------------
create table if not exists public.calibration_games (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  video_url text not null,
  game_id uuid references public.games(id) on delete set null,
  division text,
  watch_notes text,          -- which half, start time, which pair
  active boolean not null default true,
  sort int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.calibration_references (
  calibration_game_id uuid primary key references public.calibration_games(id) on delete cascade,
  scores jsonb not null default '{}'::jsonb,
  summary text, match_type text, influence text,
  positive text, negative text, suggestions text,
  rated_by text,
  updated_at timestamptz not null default now()
);
alter table public.calibration_games enable row level security;
alter table public.calibration_references enable row level security;
drop policy if exists calg_read on public.calibration_games;
create policy calg_read on public.calibration_games for select using (public.is_admin() or (active and public.my_evaluator_id() is not null));
drop policy if exists calg_admin on public.calibration_games;
create policy calg_admin on public.calibration_games for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists calr_admin on public.calibration_references;
create policy calr_admin on public.calibration_references for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.calibration_games, public.calibration_references to authenticated;

create table if not exists public.evaluator_attempts (
  id uuid primary key default gen_random_uuid(),
  evaluator_id uuid not null references public.evaluators(id) on delete cascade,
  kind text not null check (kind in ('rules','calibration')),
  calibration_game_id uuid references public.calibration_games(id) on delete set null,
  first_attempt boolean not null default true,
  total int not null, correct int not null, pct int not null, passed boolean not null,
  duration_seconds int,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists evaluator_attempts_ev_idx on public.evaluator_attempts (evaluator_id, kind, created_at);
alter table public.evaluator_attempts enable row level security;
drop policy if exists eva_read on public.evaluator_attempts;
create policy eva_read on public.evaluator_attempts for select using (public.is_admin() or evaluator_id = public.my_evaluator_id());
grant select on public.evaluator_attempts to authenticated;

-- reference games ready for calibration (rated by the NRC), without revealing the rating
drop view if exists public.calibration_library;
create view public.calibration_library as
select g.id, g.title, g.video_url, g.division, g.watch_notes, g.sort,
       (select min(a.pct) filter (where a.first_attempt) from public.evaluator_attempts a where a.calibration_game_id = g.id and a.evaluator_id = public.my_evaluator_id()) as my_first_pct,
       (select max(a.pct) from public.evaluator_attempts a where a.calibration_game_id = g.id and a.evaluator_id = public.my_evaluator_id()) as my_best_pct,
       (select count(*) from public.evaluator_attempts a where a.calibration_game_id = g.id and a.evaluator_id = public.my_evaluator_id())::int as my_attempts
from public.calibration_games g
where g.active and exists (select 1 from public.calibration_references r where r.calibration_game_id = g.id)
  and (public.is_admin() or public.my_evaluator_id() is not null);
grant select on public.calibration_library to authenticated;

-- recompute certification from the attempts
create or replace function public.evaluator_refresh(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.evaluator_settings%rowtype; e public.evaluators%rowtype; rb record; cal record; ok boolean;
begin
  select * into s from public.evaluator_settings where id = 1;
  select * into e from public.evaluators where id = p_id; if not found then return; end if;
  select pct, created_at::date as d into rb from public.evaluator_attempts where evaluator_id = p_id and kind = 'rules' and passed order by created_at desc limit 1;
  -- calibration: first attempt on each reference game, the latest N games, average at or above the pass mark
  select count(*) as n, round(avg(pct))::int as pct, max(d) as d into cal from (
    select pct, created_at::date as d from public.evaluator_attempts where evaluator_id = p_id and kind = 'calibration' and first_attempt
    order by created_at desc limit s.calibration_games_required) x;
  ok := rb.d is not null and cal.n >= s.calibration_games_required and cal.pct >= s.calibration_pass_pct;
  perform set_config('nrc.system', 'on', true);
  update public.evaluators set
    rules_pct = coalesce(rb.pct, (select max(pct) from public.evaluator_attempts where evaluator_id = p_id and kind = 'rules')),
    rules_passed_on = rb.d,
    calibration_pct = cal.pct,
    calibration_passed_on = case when cal.n >= s.calibration_games_required and cal.pct >= s.calibration_pass_pct then cal.d end,
    status = case when status in ('suspended','inactive') then status when founding or ok then 'certified' else status end,
    certified_on = case when certified_on is null and ok then current_date else certified_on end,
    certified_by = case when certified_by is null and ok then 'Rules exam and video calibration' else certified_by end
  where id = p_id;
end $$;

-- rules exam result (graded on the page, as the Level 1 test)
create or replace function public.evaluator_submit_rules(p_total int, p_correct int, p_duration int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public.my_evaluator_id(); s public.evaluator_settings%rowtype; pc int; ok boolean;
begin
  if v is null then raise exception 'Join the evaluator track first.'; end if;
  select * into s from public.evaluator_settings where id = 1;
  if p_total < s.rules_question_count or p_correct < 0 or p_correct > p_total then raise exception 'Invalid exam result.'; end if;
  pc := floor(100.0 * p_correct / p_total); ok := pc >= s.rules_pass_pct;
  insert into public.evaluator_attempts (evaluator_id, kind, total, correct, pct, passed, duration_seconds) values (v, 'rules', p_total, p_correct, pc, ok, p_duration);
  perform public.evaluator_refresh(v);
  return jsonb_build_object('pct', pc, 'passed', ok, 'pass_pct', s.rules_pass_pct);
end $$;
grant execute on function public.evaluator_submit_rules(int, int, int) to authenticated;

-- calibration: graded on the server against the hidden reference rating; returns the comparison
create or replace function public.evaluator_submit_calibration(p_game uuid, p_scores jsonb, p_summary text, p_match_type text, p_influence text, p_duration int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := public.my_evaluator_id(); s public.evaluator_settings%rowtype; ref public.calibration_references%rowtype;
        k text; rv int; mv int; tot int := 0; ok int := 0; det jsonb := '{}'::jsonb; first boolean; pc int; e public.evaluators%rowtype;
begin
  if v is null then raise exception 'Join the evaluator track first.'; end if;
  select * into e from public.evaluators where id = v;
  if e.rules_passed_on is null and not e.founding then raise exception 'Pass the rules exam before the video calibration.'; end if;
  select * into s from public.evaluator_settings where id = 1;
  select * into ref from public.calibration_references where calibration_game_id = p_game;
  if not found then raise exception 'This reference game has no NRC rating yet.'; end if;
  for k in select jsonb_object_keys(ref.scores) loop
    rv := (ref.scores ->> k)::int; mv := nullif(p_scores ->> k, '')::int;
    if mv is null then raise exception 'Rate every item before submitting.'; end if;
    tot := tot + 1;
    if abs(mv - rv) <= s.calibration_tolerance then ok := ok + 1; end if;
    det := det || jsonb_build_object(k, jsonb_build_object('mine', mv, 'ref', rv, 'ok', abs(mv - rv) <= s.calibration_tolerance));
  end loop;
  if ref.summary is not null then
    tot := tot + 1; if p_summary = ref.summary then ok := ok + 1; end if;
    det := det || jsonb_build_object('_summary', jsonb_build_object('mine', p_summary, 'ref', ref.summary, 'ok', p_summary is not distinct from ref.summary));
  end if;
  det := det || jsonb_build_object('_match_type', jsonb_build_object('mine', p_match_type, 'ref', ref.match_type), '_influence', jsonb_build_object('mine', p_influence, 'ref', ref.influence),
                                   '_remarks', jsonb_build_object('positive', ref.positive, 'negative', ref.negative, 'suggestions', ref.suggestions, 'rated_by', ref.rated_by));
  pc := case when tot > 0 then floor(100.0 * ok / tot) else 0 end;
  first := not exists (select 1 from public.evaluator_attempts where evaluator_id = v and calibration_game_id = p_game);
  insert into public.evaluator_attempts (evaluator_id, kind, calibration_game_id, first_attempt, total, correct, pct, passed, duration_seconds, details)
  values (v, 'calibration', p_game, first, tot, ok, pc, pc >= s.calibration_pass_pct, p_duration, det);
  perform public.evaluator_refresh(v);
  return jsonb_build_object('pct', pc, 'passed', pc >= s.calibration_pass_pct, 'counts', first, 'details', det, 'pass_pct', s.calibration_pass_pct, 'tolerance', s.calibration_tolerance);
end $$;
grant execute on function public.evaluator_submit_calibration(uuid, jsonb, text, text, text, int) to authenticated;

-- ---------------------------------------------------------------
-- 3. the 21 IHF observation items (six step scale stored as -2..3)
-- ---------------------------------------------------------------
alter table public.evaluation_criteria add column if not exists scale text not null default 'n5';
alter table public.evaluation_criteria drop constraint if exists evaluation_criteria_scale_max_check;
insert into public.evaluation_criteria (code, label, description, sort, scale, scale_max, active) values
  ('fair_play', 'Fair play and neutrality', 'Fair play respected and represented in the match; both teams and their officials treated impartially; no influence on the result or the direction of the match.', 1, 'ihf6', 6, true),
  ('ball_handling', 'Ball handling, dribbling, holding', 'Technical faults: dribbling, foot playing, holding the ball more than 3 seconds.', 2, 'ihf6', 6, true),
  ('steps', 'Steps', 'Reaction to and correction of all kinds of steps. Steps let through in 1 on 1 make defending almost impossible and can cause severe fouls.', 3, 'ihf6', 6, true),
  ('offensive_faults', 'Offensive faults', 'Infringements by the attacking player with and without the ball.', 4, 'ihf6', 6, true),
  ('ga_defense', 'Goal area defense activity', 'Distinguishing deliberate or systematic violations from unintentional ones in 1 on 1 situations.', 5, 'ihf6', 6, true),
  ('ga_offense', 'Goal area offense activity', 'Violations when going for the ball, entering in 1 on 1, landed shots, stepping or falling inside before release.', 6, 'ihf6', 6, true),
  ('seven_m', '7 m decisions', 'Decisions according to the rules and correct restitution of a clear chance of scoring.', 7, 'ihf6', 6, true),
  ('invalid_scores', 'Invalid scores', 'Goals following a violation by the scorer; spectacular throws and goals judged according to the rules. Overlaps with at least one item above.', 8, 'ihf6', 6, true),
  ('passive_play', 'Passive play', 'Warning signal and call applied according to the rules, the idea of the game and the situation.', 9, 'ihf6', 6, true),
  ('throws', 'Execution of throws', 'Placement, 1 m distance, foot on the side line on a fast throw in, goalkeeper throw, goalkeeper line check.', 10, 'ihf6', 6, true),
  ('cooperation', 'Referee cooperation and positioning', 'Teamwork and communication within the pair, correct positions and running lanes.', 11, 'ihf6', 6, true),
  ('reading', 'Reading the game, simulation', 'Calls timed for game flow rather than breaking its rhythm with unnecessary whistles; provocation and simulation recognised.', 12, 'ihf6', 6, true),
  ('advantage', 'Advantage', 'Correct application, same balance for both teams.', 13, 'ihf6', 6, true),
  ('pivot_defender', 'Struggling pivot and defender', 'Pivot and defense interplay, correct and incorrect blocking (goal referee observation).', 14, 'ihf6', 6, true),
  ('body_language', 'Body language and signals', 'Neutral, positive attitude, neither arrogant nor insecure; firm but not repressive in position, signals and gestures.', 15, 'ihf6', 6, true),
  ('straight_line', 'Straight line', 'Clear, consistent calls that let players, coaches and spectators see the line of decisions.', 16, 'ihf6', 6, true),
  ('game_management', 'Game management', 'Pre game, running match and after game phase.', 17, 'ihf6', 6, true),
  ('atmosphere', 'Atmosphere', 'General impression and flair of the game, including the referees'' personal influence on it.', 18, 'ihf6', 6, true),
  ('shootout', 'Shootout', 'Correct application of the rules and positioning. Rate Average when there was no shootout.', 19, 'ihf6', 6, true),
  ('progressive_punishment', 'Progressive punishment', 'Clear and strict line in accordance with the rules.', 20, 'ihf6', 6, true),
  ('table', 'Cooperation with the table', 'Mutual assistance, clear calls on punishments, continuous contact.', 21, 'ihf6', 6, true)
on conflict (code) do update set label = excluded.label, description = excluded.description, sort = excluded.sort, scale = excluded.scale, scale_max = excluded.scale_max, active = true;
update public.evaluation_criteria set active = false, sort = 100 + (sort % 100) where scale = 'n5';

-- ---------------------------------------------------------------
-- 4. observation reports (one per pair per game per evaluator)
-- ---------------------------------------------------------------
create table if not exists public.observation_reports (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete set null,
  referee_1 uuid references public.referees(id) on delete set null,
  referee_2 uuid references public.referees(id) on delete set null,
  evaluator_id uuid references public.evaluators(id) on delete set null,
  evaluator_user_id uuid references auth.users(id),
  evaluator_name text,
  evaluator_email text,
  evaluator_club text,
  submitted_as text not null default 'delegate' check (submitted_as in ('delegate','referee')),
  method text not null default 'video' check (method in ('live','video')),
  video_url text,
  match_info jsonb not null default '{}'::jsonb,   -- ko, final, half scores, OT/SO, 7m, yellow, red, blue per team
  scores jsonb not null default '{}'::jsonb,       -- item code -> -2..3
  summary text check (summary in ('positive','neutral','negative')),
  match_type text check (match_type in ('easy','normal','difficult','very_difficult')),
  influence text check (influence in ('reducing','none','increasing')),
  positive text, negative text, suggestions text,
  remark_ref1 text, remark_ref2 text,
  key_scenes jsonb not null default '[]'::jsonb,   -- [{t: "12:34", item: "seven_m", note: "..."}]
  item_avg numeric(4,2),
  overall numeric(4,2),
  weight numeric(4,2),
  status text not null default 'draft' check (status in ('draft','submitted','released','returned')),
  nrc_note text, reviewed_by text, reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists obs_game_evaluator_uq on public.observation_reports (game_id, evaluator_id);
create index if not exists obs_status_idx on public.observation_reports (status, submitted_at);

-- overall on 5 from the summary verdict and the referees' influence; weight from the type of match (used in rankings)
create or replace function public.observation_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
declare g public.games%rowtype; e public.evaluators%rowtype; k text; v int; n int := 0; t numeric := 0; base numeric;
begin
  select * into g from public.games where id = new.game_id;
  new.tournament_id := g.tournament_id; new.referee_1 := g.referee_1; new.referee_2 := g.referee_2;
  if new.video_url is null then new.video_url := g.video_url; end if;
  if new.evaluator_id is not null then
    select * into e from public.evaluators where id = new.evaluator_id;
    new.evaluator_name := e.first_name || ' ' || e.last_name; new.evaluator_email := e.email;
    new.evaluator_club := coalesce((select name from public.clubs where id = e.club_id), 'No club affiliation');
    if e.referee_id is not null and e.referee_id in (g.referee_1, g.referee_2) then raise exception 'An evaluator cannot evaluate a game they refereed.'; end if;
  end if;
  for k in select jsonb_object_keys(new.scores) loop
    v := nullif(new.scores ->> k, '')::int;
    if v is not null then
      if v < -2 or v > 3 then raise exception 'Ratings run from -2 (not satisfactory) to +3 (excellent).'; end if;
      n := n + 1; t := t + v;
    end if;
  end loop;
  new.item_avg := case when n > 0 then round(t / n, 2) end;
  if new.status in ('submitted','released') then
    if n < (select count(*) from public.evaluation_criteria where active and scale = 'ihf6') then raise exception 'Rate every item before submitting (Average when an item did not occur).'; end if;
    if new.summary is null or new.match_type is null or new.influence is null then raise exception 'Summary, type of match and influence are required.'; end if;
    if coalesce(trim(new.positive), '') = '' or coalesce(trim(new.suggestions), '') = '' then raise exception 'Positive remarks and suggestions for improvement are required.'; end if;
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  base := case new.summary when 'positive' then 4 when 'neutral' then 3 when 'negative' then 2 end;
  if base is not null then base := base + case new.influence when 'reducing' then 1 when 'increasing' then -1 else 0 end; end if;
  new.overall := greatest(1, least(5, base));
  new.weight := case new.match_type when 'easy' then 0.75 when 'normal' then 1 when 'difficult' then 1.25 when 'very_difficult' then 1.5 else 1 end;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists observation_prepare on public.observation_reports;
create trigger observation_prepare before insert or update on public.observation_reports for each row execute function public.observation_prepare();

-- evaluations: one row per referee per report
alter table public.evaluations add column if not exists report_id uuid references public.observation_reports(id) on delete cascade;
alter table public.evaluations add column if not exists weight numeric(4,2) not null default 1;
create unique index if not exists evaluations_report_ref_uq on public.evaluations (report_id, referee_id);

create or replace function public.evaluation_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare tot numeric := 0; w numeric := 0; c record; v numeric;
begin
  if new.report_id is null then
    for c in select code, weight, scale_max from public.evaluation_criteria where scale = 'n5' loop
      v := case when (new.scores ->> c.code) ~ '^[0-9]+$' then (new.scores ->> c.code)::numeric end;
      if v is not null then tot := tot + c.weight * (v / c.scale_max) * 5; w := w + c.weight; end if;
    end loop;
    new.overall := case when w > 0 then round(tot / w, 2) else new.overall end;
    new.score_rules_application := case when (new.scores ->> 'rules_application') ~ '^[1-5]$' then (new.scores ->> 'rules_application')::smallint end;
    new.score_game_management := case when (new.scores ->> 'game_management') ~ '^[1-5]$' then (new.scores ->> 'game_management')::smallint end;
    new.score_progressive_punishment := case when (new.scores ->> 'progressive_punishment') ~ '^[1-5]$' then (new.scores ->> 'progressive_punishment')::smallint end;
    new.score_positioning := case when (new.scores ->> 'positioning') ~ '^[1-5]$' then (new.scores ->> 'positioning')::smallint end;
    new.score_pair_cooperation := case when (new.scores ->> 'pair_cooperation') ~ '^[1-5]$' then (new.scores ->> 'pair_cooperation')::smallint end;
    new.score_communication := case when (new.scores ->> 'communication') ~ '^[1-5]$' then (new.scores ->> 'communication')::smallint end;
  end if;
  new.updated_at := now();
  if new.game_id is not null and new.tournament_id is null then
    select tournament_id into new.tournament_id from public.games where id = new.game_id;
  end if;
  return new;
end $$;

create or replace function public.observation_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare r uuid; rem text; z uuid := '00000000-0000-0000-0000-000000000000';
begin
  delete from public.evaluations where report_id = new.id
    and (new.status not in ('submitted','released') or referee_id not in (coalesce(new.referee_1, z), coalesce(new.referee_2, z)));
  if new.status in ('submitted','released') then
    foreach r in array array[new.referee_1, new.referee_2] loop
      continue when r is null;
      rem := case when r = new.referee_1 then new.remark_ref1 else new.remark_ref2 end;
      insert into public.evaluations (referee_id, game_id, tournament_id, evaluated_on, evaluator_name, evaluator_user_id, source, video_url, scores, overall, weight,
                                      strengths, points_to_improve, notes, shared_with_referee, report_id)
      values (r, new.game_id, new.tournament_id, coalesce((select game_date from public.games where id = new.game_id), current_date), coalesce(new.evaluator_name, 'Evaluator'), new.evaluator_user_id,
              case when new.method = 'live' then 'observer' else 'video' end, new.video_url, new.scores, new.overall, new.weight,
              new.positive, concat_ws(E'\n', nullif(new.negative, ''), case when coalesce(new.suggestions, '') <> '' then 'Suggestions: ' || new.suggestions end), rem, new.status = 'released', new.id)
      on conflict (report_id, referee_id) do update set scores = excluded.scores, overall = excluded.overall, weight = excluded.weight, strengths = excluded.strengths,
        points_to_improve = excluded.points_to_improve, notes = excluded.notes, shared_with_referee = excluded.shared_with_referee, video_url = excluded.video_url,
        evaluator_name = excluded.evaluator_name, source = excluded.source;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists observation_sync on public.observation_reports;
create trigger observation_sync after insert or update on public.observation_reports for each row execute function public.observation_sync();

alter table public.observation_reports enable row level security;
drop policy if exists obs_admin on public.observation_reports;
create policy obs_admin on public.observation_reports for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists obs_own_read on public.observation_reports;
create policy obs_own_read on public.observation_reports for select using (evaluator_user_id = auth.uid());
drop policy if exists obs_own_insert on public.observation_reports;
create policy obs_own_insert on public.observation_reports for insert
  with check (evaluator_user_id = auth.uid() and evaluator_id = public.my_evaluator_id() and public.is_certified_evaluator() and status in ('draft','submitted'));
drop policy if exists obs_own_update on public.observation_reports;
create policy obs_own_update on public.observation_reports for update
  using (evaluator_user_id = auth.uid() and status in ('draft','returned'))
  with check (evaluator_user_id = auth.uid() and evaluator_id = public.my_evaluator_id() and status in ('draft','submitted'));
drop policy if exists obs_own_delete on public.observation_reports;
create policy obs_own_delete on public.observation_reports for delete using (evaluator_user_id = auth.uid() and status = 'draft');
-- referees read the full report once released
drop policy if exists obs_referee_read on public.observation_reports;
create policy obs_referee_read on public.observation_reports for select
  using (status = 'released' and public.my_referee_id() in (referee_1, referee_2));
grant select, insert, update, delete on public.observation_reports to authenticated;

-- organizers no longer evaluate (they keep logging games)
drop policy if exists eval_organizer_read on public.evaluations;
drop policy if exists eval_organizer_write on public.evaluations;
drop policy if exists eval_organizer_update on public.evaluations;
drop policy if exists eval_organizer_delete on public.evaluations;

-- ---------------------------------------------------------------
-- 5. views
-- ---------------------------------------------------------------
-- games open to evaluators: played games with the pair, video link and report status
drop view if exists public.evaluator_games;
create view public.evaluator_games as
select g.id as game_id, g.tournament_id, t.name as tournament, t.sanction, t.venue_city, t.venue_state, g.game_date, g.game_time, g.game_number, g.division,
       g.home_team, g.away_team, g.home_score, g.away_score, g.video_url, g.court,
       g.referee_1, g.referee_2, r1.first_name || ' ' || r1.last_name as referee_1_name, r2.first_name || ' ' || r2.last_name as referee_2_name,
       (select count(*) from public.observation_reports o where o.game_id = g.id and o.status in ('submitted','released'))::int as reports,
       (select o.id from public.observation_reports o where o.game_id = g.id and o.evaluator_user_id = auth.uid() limit 1) as my_report_id,
       (select o.status from public.observation_reports o where o.game_id = g.id and o.evaluator_user_id = auth.uid() limit 1) as my_report_status,
       coalesce(me.referee_id is not null and me.referee_id in (g.referee_1, g.referee_2), false) as conflict
from public.games g
left join public.tournaments t on t.id = g.tournament_id
left join public.referees r1 on r1.id = g.referee_1
left join public.referees r2 on r2.id = g.referee_2
left join public.evaluators me on me.user_id = auth.uid()
where g.game_date <= current_date and (public.is_admin() or public.is_certified_evaluator());
grant select on public.evaluator_games to authenticated;

-- NRC overview of evaluators
drop view if exists public.evaluator_overview;
create view public.evaluator_overview as
select e.*, c.name as club_name, r.cert_level as referee_level,
       public.evaluator_is_current(e) as current,
       case when e.founding then null else (e.rules_passed_on + make_interval(months => s.rules_valid_months))::date end as rules_valid_until,
       case when e.founding then null else (e.calibration_passed_on + make_interval(months => s.calibration_valid_months))::date end as calibration_valid_until,
       (select count(*) from public.evaluator_attempts a where a.evaluator_id = e.id and a.kind = 'calibration' and a.first_attempt)::int as calibration_games_done,
       (select count(*) from public.observation_reports o where o.evaluator_id = e.id and o.status = 'released')::int as reports_released,
       (select count(*) from public.observation_reports o where o.evaluator_id = e.id and o.status = 'submitted')::int as reports_pending,
       (select count(*) from public.observation_reports o where o.evaluator_id = e.id and o.status in ('submitted','released') and o.submitted_at >= now() - interval '7 days')::int as reports_7d,
       (select max(o.submitted_at) from public.observation_reports o where o.evaluator_id = e.id) as last_report_at
from public.evaluators e
cross join public.evaluator_settings s
left join public.clubs c on c.id = e.club_id
left join public.referees r on r.id = e.referee_id
where s.id = 1 and public.is_admin();
grant select on public.evaluator_overview to authenticated;

-- rankings: weighted by the type of match
drop view if exists public.referee_rankings;
create view public.referee_rankings as
with s as (select greatest(public.history_from(), (current_date - make_interval(months => window_months))::date) as since, min_evaluations from public.ranking_settings where id = 1),
ev as (
  select e.referee_id, count(*) as evals, count(distinct e.game_id) as games_evaluated,
         round(sum(e.overall * e.weight) / nullif(sum(e.weight), 0), 2) as avg_overall, max(e.evaluated_on) as last_eval,
         round(avg(e.overall) filter (where e.source = 'organizer'), 2) as avg_organizer,
         round(sum(e.overall * e.weight) filter (where e.source in ('observer','video','nrc')) / nullif(sum(e.weight) filter (where e.source in ('observer','video','nrc')), 0), 2) as avg_nrc
  from public.evaluations e, s where e.overall is not null and e.evaluated_on >= s.since group by e.referee_id),
gm as (
  select h.referee_id, sum(h.games)::int as games, count(*)::int as tournaments
  from public.referee_tournament_history h, s where h.start_date >= s.since and h.start_date <= current_date group by h.referee_id),
base as (
  select r.id as referee_id, r.first_name, r.last_name, r.cert_level, r.photo_url, c.name as club_name,
         coalesce(gm.games, 0) as games, coalesce(gm.tournaments, 0) as tournaments,
         coalesce(ev.evals, 0)::int as evals, coalesce(ev.games_evaluated, 0)::int as games_evaluated,
         ev.avg_overall, ev.avg_organizer, ev.avg_nrc, ev.last_eval,
         coalesce(ev.evals, 0) >= s.min_evaluations as ranked, s.since
  from public.referees r cross join s
  left join public.clubs c on c.id = r.club_id
  left join ev on ev.referee_id = r.id
  left join gm on gm.referee_id = r.id
  where r.active and r.cert_level <> 'candidate')
select b.*, case when b.ranked then rank() over (partition by b.ranked order by b.avg_overall desc nulls last) end as rank
from base b
where public.is_admin();
grant select on public.referee_rankings to authenticated;

-- ---------------------------------------------------------------
-- 6. founding evaluator: the NRC chair sets the reference ratings
-- ---------------------------------------------------------------
insert into public.evaluators (first_name, last_name, email, origin, status, founding, certified_on, certified_by)
select 'Joshua', 'Forsthoefel', 'referee@handballusa.org', 'nrc', 'certified', true, current_date, 'NRC chair, founding evaluator'
where not exists (select 1 from public.evaluators where lower(email) = 'referee@handballusa.org');
