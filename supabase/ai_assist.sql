-- AI assisted reviews (2026-10-22)
-- An AI pass (Gemini, run outside the hub) logs a game from its video and flags moments for review.
-- The AI also reconciles the log with the official score sheet. Only the score on the sheet is trusted: table officials
-- often miss cards, suspensions and scorers, so other differences become flags rather than corrections.
-- Certified evaluators review the flagged moments while writing the IHF report.
-- The AI never rates the referees. Evaluators confirm or dismiss each flag; confirmed flags become key scenes.
-- 1. game_ai_logs: one log per game (events, match facts, fact check)
-- 2. game_ai_flags: moments flagged for review, with video time
-- 3. observation_reports.ai_flag_decisions: each evaluator's confirm or dismiss per flag
-- 4. evaluator_games gains ai_log and ai_flags; ai_flag_stats for the NRC
-- Safe to run more than once.

-- 1. logs
create table if not exists public.game_ai_logs (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null unique references public.games(id) on delete cascade,
  model text,                                   -- e.g. gemini-3.8-flash
  settings text,                                -- resolution, frames per second, passes
  video_start int, video_end int,               -- seconds in the video covered by the log
  home_label text, away_label text,             -- team labels as written in the log (shirt colours)
  events jsonb not null default '[]'::jsonb,    -- rows of the log: {t, clock, score, type, team, player, referee, whistle, signal, confidence, note}
  facts jsonb not null default '{}'::jsonb,     -- {home:{h1,h2,seven_m,yellow,two_min,red,blue,timeouts}, away:{...}} in the report's match facts shape
  facts_checked boolean not null default false, -- reconciled with the official score sheet (score must match; other differences flagged)
  facts_checked_by text, facts_checked_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. flags
create table if not exists public.game_ai_flags (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.game_ai_logs(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  t_seconds int not null,                       -- video time in seconds
  t_label text,                                 -- as written, e.g. 53:54
  category text not null default 'other' check (category in ('punishment','seven_m','foul','passive_play','mechanics','possible_miss','sheet_mismatch','other')),
  reason text not null,
  item text,                                    -- IHF item code when the AI suggests one (evaluator decides)
  confidence text check (confidence in ('high','medium','low')),
  created_at timestamptz not null default now()
);
alter table public.game_ai_flags drop constraint if exists game_ai_flags_category_check;
alter table public.game_ai_flags add constraint game_ai_flags_category_check check (category in ('punishment','seven_m','foul','passive_play','mechanics','possible_miss','sheet_mismatch','other'));
create index if not exists game_ai_flags_game_idx on public.game_ai_flags (game_id, t_seconds);

-- 3. decisions on each report
alter table public.observation_reports add column if not exists ai_flag_decisions jsonb not null default '{}'::jsonb;  -- flag id -> {d: confirmed|dismissed, note}
alter table public.observation_reports add column if not exists ai_assisted boolean not null default false;

-- updated_at
create or replace function public.ai_log_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists ai_log_touch on public.game_ai_logs;
create trigger ai_log_touch before update on public.game_ai_logs for each row execute function public.ai_log_touch();

-- security: NRC admins write; certified evaluators read
alter table public.game_ai_logs enable row level security;
alter table public.game_ai_flags enable row level security;
drop policy if exists ai_logs_admin on public.game_ai_logs;
create policy ai_logs_admin on public.game_ai_logs for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_logs_eval_read on public.game_ai_logs;
create policy ai_logs_eval_read on public.game_ai_logs for select using (public.is_certified_evaluator());
drop policy if exists ai_flags_admin on public.game_ai_flags;
create policy ai_flags_admin on public.game_ai_flags for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists ai_flags_eval_read on public.game_ai_flags;
create policy ai_flags_eval_read on public.game_ai_flags for select using (public.is_certified_evaluator());
grant select, insert, update, delete on public.game_ai_logs, public.game_ai_flags to authenticated;

-- 4. views
drop view if exists public.evaluator_games;
create view public.evaluator_games as
select g.id as game_id, g.tournament_id, t.name as tournament, t.sanction, t.venue_city, t.venue_state, g.game_date, g.game_time, g.game_number, g.division,
       g.home_team, g.away_team, g.home_score, g.away_score, g.video_url, g.court,
       g.referee_1, g.referee_2, r1.first_name || ' ' || r1.last_name as referee_1_name, r2.first_name || ' ' || r2.last_name as referee_2_name,
       (select count(*) from public.observation_reports o where o.game_id = g.id and o.status in ('submitted','released'))::int as reports,
       (select o.id from public.observation_reports o where o.game_id = g.id and o.evaluator_user_id = auth.uid() limit 1) as my_report_id,
       (select o.status from public.observation_reports o where o.game_id = g.id and o.evaluator_user_id = auth.uid() limit 1) as my_report_status,
       coalesce(me.referee_id is not null and me.referee_id in (g.referee_1, g.referee_2), false) as conflict,
       exists (select 1 from public.game_ai_logs l where l.game_id = g.id) as ai_log,
       (select count(*) from public.game_ai_flags f where f.game_id = g.id)::int as ai_flags
from public.games g
left join public.tournaments t on t.id = g.tournament_id
left join public.referees r1 on r1.id = g.referee_1
left join public.referees r2 on r2.id = g.referee_2
left join public.evaluators me on me.user_id = auth.uid()
where g.game_date <= current_date and (public.is_admin() or public.is_certified_evaluator());
grant select on public.evaluator_games to authenticated;

-- which flags evaluators find worth their time (NRC only)
drop view if exists public.ai_flag_stats;
create view public.ai_flag_stats as
select f.category,
       count(distinct f.id)::int as flags,
       count(*) filter (where d.value->>'d' = 'confirmed')::int as confirmed,
       count(*) filter (where d.value->>'d' = 'dismissed')::int as dismissed,
       round(100.0 * count(*) filter (where d.value->>'d' = 'confirmed') / nullif(count(*) filter (where d.value->>'d' in ('confirmed','dismissed')), 0))::int as confirmed_pct
from public.game_ai_flags f
left join public.observation_reports o on o.game_id = f.game_id and o.status in ('submitted','released')
left join lateral jsonb_each(coalesce(o.ai_flag_decisions, '{}'::jsonb)) d on d.key = f.id::text
where public.is_admin()
group by f.category;
grant select on public.ai_flag_stats to authenticated;
