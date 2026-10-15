-- Level 1 pathway: public referee list, contact inquiries, Level 1 course tracking, online test and automatic certification.
-- Run after schema.sql. Safe to re-run.

-- ---------------------------------------------------------------
-- Public referee list (no contact details). Certified, active referees only.
-- ---------------------------------------------------------------
drop view if exists public.referee_directory;
create view public.referee_directory as
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
