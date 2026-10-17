-- Event calendar and games reported by referees.
-- 1. Tournaments carry a date status (confirmed or tentative), a source link and whether the NRC staffs them.
--    Tentative and calendar only events stay out of Staffing and its reminders.
-- 2. Events the NRC enters itself (USATH and international events) need no host club.
-- 3. History counts from a start date set by the NRC (July 1, 2026 until the NRC imports earlier records).
-- 4. Referees report the games they refereed at past events; the NRC confirms, which records the assignment.
-- 5. Calendar of events visible to every signed in user (no organizer contact, no money).
-- Run the whole script once in the Supabase SQL editor.

alter table public.tournaments add column if not exists date_status text not null default 'confirmed';
alter table public.tournaments drop constraint if exists tournaments_date_status_check;
alter table public.tournaments add constraint tournaments_date_status_check check (date_status in ('confirmed','tentative'));
alter table public.tournaments add column if not exists source_url text;
-- Calendar only events (listed so referees can report games) are not staffed by the NRC
alter table public.tournaments add column if not exists nrc_staffs boolean not null default true;

alter table public.staffing_settings add column if not exists history_from date not null default '2026-07-01';
create or replace function public.history_from() returns date
language sql stable security definer set search_path = public as $$
  select coalesce((select history_from from public.staffing_settings where id = 1), date '2026-07-01')
$$;
grant execute on function public.history_from() to anon, authenticated;

-- Guard: NRC entered events need no club; everything else unchanged
create or replace function public.tournament_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare dup record; days int;
begin
  if new.staff_by is null then
    select staff_by_days_before into days from public.staffing_settings where id = 1;
    new.staff_by := new.start_date - coalesce(days, 42);
  end if;
  if new.sanction <> 'international' and not new.created_by_nrc and (tg_op = 'INSERT' or new.club_id is distinct from old.club_id) then
    if new.club_id is null or not exists (select 1 from public.clubs c where c.id = new.club_id and c.active and c.usath_registered) then
      raise exception 'Pick the USATH registered club hosting the event. Club not listed: write to the NRC.' using errcode = 'P0001';
    end if;
  end if;
  if new.status <> 'cancelled' and (tg_op = 'INSERT' or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date or new.club_id is distinct from old.club_id or new.name is distinct from old.name) then
    select t.id, t.name, t.start_date, t.organizer_email into dup
    from public.tournaments t
    where t.id <> new.id and t.status <> 'cancelled'
      and t.start_date <= new.end_date and t.end_date >= new.start_date
      and ((new.club_id is not null and t.club_id = new.club_id)
           or regexp_replace(lower(t.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(new.name), '[^a-z0-9]', '', 'g'))
    limit 1;
    if found then
      raise exception 'Already requested: % on % (request from %). Sign in on the organizer page to change it, or write to the NRC.', dup.name, to_char(dup.start_date, 'Mon DD, YYYY'), dup.organizer_email using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tournament_guard on public.tournaments;
create trigger tournament_guard before insert or update on public.tournaments
  for each row execute procedure public.tournament_guard();

-- Staffing overview: tentative events are not staffed
drop view if exists public.tournament_overview;
drop view if exists public.tournament_overview_service;
create view public.tournament_overview_service as
select t.id, t.name, t.sanction, t.region, t.divisions, t.start_date, t.end_date, t.venue_city, t.venue_state,
       t.status, t.pairs_needed, t.supervisor_needed, t.travel_managed_by, t.organizer_name, t.organizer_email,
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

-- History from the start date only
create or replace view public.referee_tournament_history as
  select a.referee_id, t.id as tournament_id, t.name, t.sanction, t.region, t.start_date, t.end_date,
         t.venue_city, t.venue_state, a.role,
         coalesce(a.games_officiated,
                  (select count(*) from public.games g where g.tournament_id = t.id and (g.referee_1 = a.referee_id or g.referee_2 = a.referee_id)))::int as games,
         t.divisions, t.date_status
  from public.assignments a join public.tournaments t on t.id = a.tournament_id
  where t.start_date >= public.history_from();

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
    and t.status <> 'cancelled' and t.start_date <= current_date and t.start_date >= public.history_from();
grant select on public.referee_public_history to anon, authenticated;

-- Calendar: events entered by the NRC and requests the NRC has accepted, from the history start date on
drop view if exists public.event_calendar;
create view public.event_calendar as
  select t.id, t.name, t.sanction, t.region, t.divisions, t.start_date, t.end_date, t.venue_name, t.venue_city, t.venue_state,
         t.date_status, t.source_url, t.status, c.name as club_name
  from public.tournaments t left join public.clubs c on c.id = t.club_id
  where t.status <> 'cancelled' and t.end_date >= public.history_from()
    and (t.created_by_nrc or t.status in ('reviewing','staffed','completed'));
grant select on public.event_calendar to authenticated;

-- Games reported by referees
create table if not exists public.referee_game_reports (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references public.referees(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  games int not null check (games between 1 and 60),
  role text not null default 'referee' check (role in ('referee','observer','delegate')),
  partner text,
  notes text,
  status text not null default 'reported' check (status in ('reported','confirmed','rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (referee_id, tournament_id)
);
alter table public.referee_game_reports enable row level security;
drop policy if exists rgr_read on public.referee_game_reports;
create policy rgr_read on public.referee_game_reports for select using (public.is_admin() or referee_id = public.my_referee_id());
drop policy if exists rgr_insert on public.referee_game_reports;
-- Referees cannot read the tournaments table directly, so the event check runs as definer
create or replace function public.reportable_event(p_tournament uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tournaments t where t.id = p_tournament and t.status <> 'cancelled'
                 and t.start_date >= public.history_from() and t.start_date <= current_date)
$$;
grant execute on function public.reportable_event(uuid) to authenticated;
create policy rgr_insert on public.referee_game_reports for insert with check (
  referee_id = public.my_referee_id() and status = 'reported' and reviewed_at is null
  and public.reportable_event(tournament_id)
  and not exists (select 1 from public.assignments a where a.tournament_id = referee_game_reports.tournament_id and a.referee_id = referee_game_reports.referee_id));
drop policy if exists rgr_update on public.referee_game_reports;
create policy rgr_update on public.referee_game_reports for update
  using (referee_id = public.my_referee_id() and status in ('reported','rejected'))
  with check (referee_id = public.my_referee_id() and status = 'reported');
drop policy if exists rgr_delete on public.referee_game_reports;
create policy rgr_delete on public.referee_game_reports for delete using (referee_id = public.my_referee_id() and status <> 'confirmed');
drop policy if exists rgr_admin on public.referee_game_reports;
create policy rgr_admin on public.referee_game_reports for all using (public.is_admin()) with check (public.is_admin());

-- A referee edit sends the report back for review
create or replace function public.rgr_touch() returns trigger language plpgsql as $$
begin
  if not public.is_admin() then new.status := 'reported'; new.reviewed_by := null; new.reviewed_at := null; new.review_note := null; end if;
  return new;
end $$;
drop trigger if exists rgr_touch on public.referee_game_reports;
create trigger rgr_touch before update on public.referee_game_reports for each row execute procedure public.rgr_touch();

-- NRC review: confirm records the assignment with the games; reject keeps the report with a note
create or replace function public.review_game_report(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'NRC admins only' using errcode = '42501'; end if;
  if p_status not in ('confirmed','rejected','reported') then raise exception 'Unknown status %', p_status; end if;
  select * into r from public.referee_game_reports where id = p_id;
  if not found then raise exception 'Report not found'; end if;
  update public.referee_game_reports set status = p_status, review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if p_status = 'confirmed' then
    insert into public.assignments (tournament_id, referee_id, role, games_officiated)
    values (r.tournament_id, r.referee_id, r.role, r.games)
    on conflict (tournament_id, referee_id) do update set games_officiated = excluded.games_officiated, role = excluded.role;
  end if;
end $$;
grant execute on function public.review_game_report(uuid, text, text) to authenticated;
