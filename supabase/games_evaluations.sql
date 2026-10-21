-- Game log, per game evaluations and referee rankings (2026-10-21)
-- 1. games: one row per game with the referee pair, division, teams, score and video link
-- 2. evaluation_criteria: the USATH criteria and weights (placeholders until the NRC sheet is loaded)
-- 3. evaluations: scores per criterion (jsonb), source (organizer, observer, video review, NRC), overall score
-- 4. organizers log games and evaluate the designated referees of their own tournaments
-- 5. views referee_game_log (one row per referee per game) and referee_rankings (admin only)
-- Safe to run more than once.

-- 1. games
alter table public.games add column if not exists game_time time;
alter table public.games add column if not exists division text;            -- division code such as U19-M
alter table public.games add column if not exists game_number text;
alter table public.games add column if not exists court text;
alter table public.games add column if not exists home_score int;
alter table public.games add column if not exists away_score int;
alter table public.games add column if not exists video_url text;
alter table public.games add column if not exists notes text;
alter table public.games add column if not exists updated_at timestamptz not null default now();
create index if not exists games_tournament_idx on public.games (tournament_id, game_date);
create index if not exists games_ref1_idx on public.games (referee_1);
create index if not exists games_ref2_idx on public.games (referee_2);

-- 2. criteria
create table if not exists public.evaluation_criteria (
  code text primary key,
  label text not null,
  description text,
  weight numeric not null default 1 check (weight > 0),
  scale_max int not null default 5 check (scale_max between 2 and 100),
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.evaluation_criteria (code, label, description, sort) values
  ('rules_application', 'Rules application', 'Correct decisions on the rules', 1),
  ('game_management', 'Game management', 'Control of the game and the benches', 2),
  ('progressive_punishment', 'Progressive punishment', 'Warnings, suspensions and disqualifications applied consistently', 3),
  ('positioning', 'Positioning and movement', 'Court and goal referee positions, fitness', 4),
  ('pair_cooperation', 'Pair cooperation', 'Coordination with the partner', 5),
  ('communication', 'Communication and signals', 'Signals, table and bench communication', 6)
on conflict (code) do nothing;
alter table public.evaluation_criteria enable row level security;
drop policy if exists crit_read on public.evaluation_criteria;
create policy crit_read on public.evaluation_criteria for select using (auth.uid() is not null);
drop policy if exists crit_admin on public.evaluation_criteria;
create policy crit_admin on public.evaluation_criteria for all using (public.is_admin()) with check (public.is_admin());

-- 3. evaluations
alter table public.evaluations add column if not exists scores jsonb not null default '{}'::jsonb;
alter table public.evaluations add column if not exists source text not null default 'observer';
alter table public.evaluations drop constraint if exists evaluations_source_check;
alter table public.evaluations add constraint evaluations_source_check check (source in ('organizer','observer','video','nrc'));
alter table public.evaluations add column if not exists video_url text;
alter table public.evaluations add column if not exists overall numeric(4,2);   -- weighted average on a 5 point scale
alter table public.evaluations add column if not exists updated_at timestamptz not null default now();
create index if not exists evaluations_game_idx on public.evaluations (game_id);
create index if not exists evaluations_ref_idx on public.evaluations (referee_id, evaluated_on);

-- legacy columns into scores
update public.evaluations set scores = jsonb_strip_nulls(jsonb_build_object(
  'rules_application', score_rules_application, 'game_management', score_game_management,
  'progressive_punishment', score_progressive_punishment, 'positioning', score_positioning,
  'pair_cooperation', score_pair_cooperation, 'communication', score_communication))
where scores = '{}'::jsonb;

create or replace function public.evaluation_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare tot numeric := 0; w numeric := 0; c record; v numeric;
begin
  for c in select code, weight, scale_max from public.evaluation_criteria loop
    v := nullif(new.scores ->> c.code, '')::numeric;
    if v is not null then tot := tot + c.weight * (v / c.scale_max) * 5; w := w + c.weight; end if;
  end loop;
  new.overall := case when w > 0 then round(tot / w, 2) else null end;
  -- keep the legacy columns filled while they exist
  new.score_rules_application := nullif(new.scores ->> 'rules_application', '')::smallint;
  new.score_game_management := nullif(new.scores ->> 'game_management', '')::smallint;
  new.score_progressive_punishment := nullif(new.scores ->> 'progressive_punishment', '')::smallint;
  new.score_positioning := nullif(new.scores ->> 'positioning', '')::smallint;
  new.score_pair_cooperation := nullif(new.scores ->> 'pair_cooperation', '')::smallint;
  new.score_communication := nullif(new.scores ->> 'communication', '')::smallint;
  new.updated_at := now();
  if new.game_id is not null and new.tournament_id is null then
    select tournament_id into new.tournament_id from public.games where id = new.game_id;
  end if;
  return new;
end $$;
drop trigger if exists evaluations_score on public.evaluations;
create trigger evaluations_score before insert or update on public.evaluations for each row execute function public.evaluation_score();
update public.evaluations set scores = scores;   -- fills overall on existing rows

-- 4. organizers: games and evaluations of their own tournaments
drop policy if exists games_organizer on public.games;
create policy games_organizer on public.games for all
  using (tournament_id in (select public.organizer_tournament_ids()))
  with check (tournament_id in (select public.organizer_tournament_ids()));

drop policy if exists eval_organizer_read on public.evaluations;
create policy eval_organizer_read on public.evaluations for select
  using (evaluator_user_id = auth.uid() and tournament_id in (select public.organizer_tournament_ids()));
drop policy if exists eval_organizer_write on public.evaluations;
create policy eval_organizer_write on public.evaluations for insert
  with check (evaluator_user_id = auth.uid() and source = 'organizer' and tournament_id in (select public.organizer_tournament_ids()));
drop policy if exists eval_organizer_update on public.evaluations;
create policy eval_organizer_update on public.evaluations for update
  using (evaluator_user_id = auth.uid() and tournament_id in (select public.organizer_tournament_ids()))
  with check (evaluator_user_id = auth.uid() and source = 'organizer' and tournament_id in (select public.organizer_tournament_ids()));
drop policy if exists eval_organizer_delete on public.evaluations;
create policy eval_organizer_delete on public.evaluations for delete
  using (evaluator_user_id = auth.uid() and tournament_id in (select public.organizer_tournament_ids()));

-- a game logged with a referee pair records both referees on the event (Officiated tab) if missing
create or replace function public.games_to_assignments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tournament_id is not null then
    insert into public.assignments (tournament_id, referee_id, role)
    select new.tournament_id, x, 'referee' from unnest(array[new.referee_1, new.referee_2]) x where x is not null
    on conflict (tournament_id, referee_id) do nothing;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists games_to_assignments on public.games;
create trigger games_to_assignments before insert or update on public.games for each row execute function public.games_to_assignments();

-- 5a. one row per referee per game
drop view if exists public.referee_game_log;
create view public.referee_game_log as
select g.id as game_id, g.tournament_id, t.name as tournament, t.sanction, g.game_date, g.game_time, g.game_number, g.division,
       g.home_team, g.away_team, g.home_score, g.away_score, g.video_url, g.court,
       x.referee_id, x.partner_id, p.first_name || ' ' || p.last_name as partner,
       (select round(avg(e.overall), 2) from public.evaluations e
         where e.game_id = g.id and e.referee_id = x.referee_id and e.overall is not null
           and (public.is_admin() or e.shared_with_referee)) as eval_overall,
       (select count(*) from public.evaluations e
         where e.game_id = g.id and e.referee_id = x.referee_id
           and (public.is_admin() or e.shared_with_referee or e.evaluator_user_id = auth.uid()))::int as evals
from public.games g
join lateral (values (g.referee_1, g.referee_2), (g.referee_2, g.referee_1)) as x(referee_id, partner_id) on x.referee_id is not null
left join public.tournaments t on t.id = g.tournament_id
left join public.referees p on p.id = x.partner_id
where public.is_admin() or x.referee_id = public.my_referee_id() or g.tournament_id in (select public.organizer_tournament_ids());
grant select on public.referee_game_log to authenticated;

-- 5b. rankings
create table if not exists public.ranking_settings (
  id int primary key default 1 check (id = 1),
  window_months int not null default 12,
  min_evaluations int not null default 3,
  updated_at timestamptz not null default now()
);
insert into public.ranking_settings (id) values (1) on conflict (id) do nothing;
alter table public.ranking_settings enable row level security;
drop policy if exists ranking_settings_read on public.ranking_settings;
create policy ranking_settings_read on public.ranking_settings for select using (auth.uid() is not null);
drop policy if exists ranking_settings_admin on public.ranking_settings;
create policy ranking_settings_admin on public.ranking_settings for all using (public.is_admin()) with check (public.is_admin());

drop view if exists public.referee_rankings;
create view public.referee_rankings as
with s as (select greatest(public.history_from(), (current_date - make_interval(months => window_months))::date) as since, min_evaluations from public.ranking_settings where id = 1),
ev as (
  select e.referee_id, count(*) as evals, count(distinct e.game_id) as games_evaluated,
         round(avg(e.overall), 2) as avg_overall, max(e.evaluated_on) as last_eval,
         round(avg(e.overall) filter (where e.source = 'organizer'), 2) as avg_organizer,
         round(avg(e.overall) filter (where e.source in ('observer','video','nrc')), 2) as avg_nrc
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
