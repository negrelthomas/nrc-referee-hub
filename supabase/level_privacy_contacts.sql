-- Referee feedback of October 21, 2026. Run after schema.sql. Safe to re-run.
-- 1. Referee levels are visible only to the NRC (admins) and to the referee concerned:
--    removed from the public list, the referee directory, the leaderboard and the organizer view.
-- 2. Referees may share their email and phone with other signed in referees (opt in, off by default).
-- 3. Referees cannot change their own level, confirmation or active status through the API.

alter table public.referees add column if not exists share_contact boolean not null default false;

create or replace function public.is_active_referee()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.referees where user_id = auth.uid() and active);
$$;
grant execute on function public.is_active_referee() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- Public list and signed in directory
drop view if exists public.referee_directory;
create view public.referee_directory as
select r.id, r.first_name, r.last_name,
       case when public.is_admin() or r.user_id = auth.uid() then r.cert_level::text end as cert_level,
       case when public.is_admin() or r.user_id = auth.uid() then r.level_confirmed end as level_confirmed,
       r.home_state, c.name as club_name,
       coalesce((select min(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as certified_since,
       coalesce((select max(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as last_certified_on,
       r.photo_url, r.home_city,
       case when r.share_contact and (public.is_admin() or public.is_active_referee()) then r.email end as email,
       case when r.share_contact and (public.is_admin() or public.is_active_referee()) then r.phone end as phone
from public.referees r
left join public.clubs c on c.id = r.club_id
where r.active and r.cert_level <> 'candidate';
grant select on public.referee_directory to anon, authenticated;

-- Leaderboard without level
drop view if exists public.quiz_leaderboard;
create view public.quiz_leaderboard as
select r.id as referee_id, r.first_name, r.last_name, r.photo_url, r.home_city, r.home_state,
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
group by r.id, r.first_name, r.last_name, r.photo_url, r.home_city, r.home_state, extract(year from a.created_at);
revoke all on public.quiz_leaderboard from anon;
grant select on public.quiz_leaderboard to authenticated;

-- Organizers see designated officials without their level (admins still see it)
drop view if exists public.organizer_designations;
create view public.organizer_designations as
select a.id as assignment_id, a.tournament_id, a.role, a.travel_notes,
       r.id as referee_id, r.first_name, r.last_name, r.email, r.phone,
       case when public.is_admin() then r.cert_level::text end as cert_level,
       r.home_city, r.home_state, r.home_airport_iata, r.departure_airport_iata, r.photo_url,
       c.name as club_name
from public.assignments a
join public.referees r on r.id = a.referee_id
left join public.clubs c on c.id = r.club_id
where public.is_admin() or a.tournament_id in (select public.organizer_tournament_ids());
grant select on public.organizer_designations to authenticated;

-- Guard: a referee editing their own profile cannot change level, confirmation, dates or status.
-- Security definer functions (certification award, email sync) run as the owner and are not affected.
create or replace function public.referee_self_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.cert_level is distinct from old.cert_level
       or new.level_confirmed is distinct from old.level_confirmed
       or new.cert_date is distinct from old.cert_date
       or new.level1_theory_passed_on is distinct from old.level1_theory_passed_on
       or new.active is distinct from old.active
       or new.user_id is distinct from old.user_id then
      raise exception 'Level, certification and status are managed by the NRC.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists referee_self_guard on public.referees;
create trigger referee_self_guard before update on public.referees for each row execute function public.referee_self_guard();
