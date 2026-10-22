-- Tournament pairs and travel, test score privacy (October 22, 2026). Run after schema.sql. Safe to re-run.
-- 1. Travel can be booked by the officiating referees themselves (reimbursed by the organizer), besides the organizer or the NRC.
-- 2. Organizers may bring their own pairs, international pairs only (based outside the United States); pairs_needed stays
--    the number of pairs the NRC staffs. Total at the event = pairs_needed + pairs_organizer.
-- 3. Training scores stay private: the timed challenge leaderboard lists a referee only if they opt in on their profile.
--    Assessments, tests, programs and quiz results were already readable only by the referee and admins (RLS).

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.tournaments'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%travel_managed_by%' loop
    execute format('alter table public.tournaments drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.tournaments add constraint tournaments_travel_managed_by_check check (travel_managed_by in ('nrc','organizer','referee'));

alter table public.tournaments add column if not exists pairs_organizer int not null default 0;
alter table public.tournaments add column if not exists organizer_pairs_note text;
alter table public.tournaments drop constraint if exists tournaments_pairs_organizer_check;
alter table public.tournaments add constraint tournaments_pairs_organizer_check
  check (pairs_organizer between 0 and 20 and (pairs_organizer = 0 or nullif(trim(organizer_pairs_note), '') is not null));
alter table public.tournaments drop constraint if exists tournaments_pairs_needed_check;
alter table public.tournaments add constraint tournaments_pairs_needed_check check (pairs_needed >= 0);

-- organizer edits of the new fields are logged with the others
create or replace function public.tournament_guard_and_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare diff jsonb := '{}'::jsonb; f text; oldv text; newv text; role text;
begin
  select p.role::text into role from public.profiles p where p.id = auth.uid();
  -- the server (service role) claims an NRC placeholder for an organizer request: ownership and status pass through
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    -- organizers cannot touch ownership or move status except to cancelled
    new.organizer_token := old.organizer_token; new.organizer_user_id := old.organizer_user_id; new.organizer_notified_at := old.organizer_notified_at;
    if new.status is distinct from old.status and new.status <> 'cancelled' then new.status := old.status; end if;
    if old.status = 'cancelled' then raise exception 'This request is cancelled; contact the NRC to reopen it.'; end if;
  end if;
  foreach f in array array['name','start_date','end_date','venue_name','venue_address','venue_city','venue_state','nearest_airport_iata','pairs_needed','games_expected','supervisor_needed','supervisor_notes','hotel_nights_covered','flights_covered','airport_transfers_covered','airport_transfer_how','hotel_to_venue_transport','food_stipend_per_day','meals_provided','earliest_return_last_day','travel_managed_by','pairs_organizer','organizer_pairs_note','notes','status','organizer_name','organizer_email','organizer_phone'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into oldv, newv using old, new;
    if oldv is distinct from newv then diff := diff || jsonb_build_object(f, jsonb_build_object('from', oldv, 'to', newv)); end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.tournament_changes (tournament_id, changed_by, changed_by_role, changes) values (new.id, auth.uid(), coalesce(role, 'system'), diff);
  end if;
  return new;
end $$;

-- staffing overview carries the organizer pairs
drop view if exists public.tournament_overview;
drop view if exists public.tournament_overview_service;
create view public.tournament_overview_service as
select t.id, t.name, t.sanction, t.region, t.divisions, t.start_date, t.end_date, t.venue_city, t.venue_state,
       t.status, t.pairs_needed, t.pairs_organizer, t.organizer_pairs_note, t.supervisor_needed, t.travel_managed_by, t.organizer_name, t.organizer_email,
       t.organizer_notified_at, t.created_at, t.created_by_nrc, t.staff_by, c.name as club_name, t.date_status,
       t.pairs_needed * 2 as referees_needed,
       (select count(*) from public.assignments a where a.tournament_id = t.id and a.role = 'referee') as confirmed,
       (select count(*) from public.assignments a where a.tournament_id = t.id and a.role <> 'referee') as officials,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status <> 'draft') as contacted,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status in ('sent','tentative')) as waiting,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status = 'sent') as no_answer,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status = 'tentative') as tentative,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status in ('accepted','confirmed')) as accepted,
       (select count(*) from public.assignment_requests q where q.tournament_id = t.id and q.status in ('declined','no_response')) as declined,
       (select count(*) from public.referees r
          where r.active and r.cert_level <> 'candidate'
            and exists (select 1 from public.weekend_availability w where w.referee_id = r.id and w.status = 'available'
                        and w.weekend = (date_trunc('week', t.start_date)::date + 5))
            and not exists (select 1 from public.availability_blocks x where x.referee_id = r.id and x.start_date <= t.end_date and x.end_date >= t.start_date)) as available,
       (select count(*) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked') as bookings_done,
       (select count(*) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'pending') as bookings_pending,
       (select max(created_at) from public.reminder_log l where l.kind = 'staffing' and l.target_id = t.id) as last_reminder_at
from public.tournaments t
left join public.clubs c on c.id = t.club_id
where t.date_status = 'confirmed' and t.nrc_staffs;
revoke all on public.tournament_overview_service from anon, authenticated;
create view public.tournament_overview as select * from public.tournament_overview_service where public.is_admin();
grant select on public.tournament_overview to authenticated;

-- 3. leaderboard opt in
alter table public.referees add column if not exists show_on_leaderboard boolean not null default false;
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
  and (r.show_on_leaderboard or r.user_id = auth.uid() or public.is_admin())
group by r.id, r.first_name, r.last_name, r.photo_url, r.home_city, r.home_state, extract(year from a.created_at);
revoke all on public.quiz_leaderboard from anon;
grant select on public.quiz_leaderboard to authenticated;
