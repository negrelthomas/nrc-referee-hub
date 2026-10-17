-- Staffing overview: deadline to staff, admin reminder cadence, club affiliation required, duplicate guard,
-- and the admin overview of every tournament (requested, designated, available, contacted, answers).
-- Run the whole script once in the Supabase SQL editor.

-- 1. Settings (one row). Cadence to confirm with the NRC; the admin edits it on the Staffing page.
create table if not exists public.staffing_settings (
  id int primary key default 1 check (id = 1),
  staff_by_days_before int not null default 42,      -- deadline to staff = start date minus this
  remind_every_days int not null default 7,          -- admin reminder while a request is not staffed
  remind_daily_within_days int not null default 14,  -- daily reminders in the last days before the deadline
  remind_to text,                                    -- empty = CONTACT_EMAIL on Netlify
  updated_at timestamptz not null default now()
);
insert into public.staffing_settings (id) values (1) on conflict (id) do nothing;
alter table public.staffing_settings enable row level security;
drop policy if exists staffing_settings_admin on public.staffing_settings;
create policy staffing_settings_admin on public.staffing_settings for all using (public.is_admin()) with check (public.is_admin());

-- 2. Deadline to staff, set from the settings when not given
alter table public.tournaments add column if not exists staff_by date;
update public.tournaments set staff_by = start_date - 42 where staff_by is null;

-- 3. Clubs registered with USATH (all current clubs start as registered; untick in Admin > Clubs)
alter table public.clubs add column if not exists usath_registered boolean not null default true;

-- 4. Guard on every new or edited tournament: registered club required (international events excepted),
--    no second request for the same event (same club or same name, overlapping dates).
create or replace function public.tournament_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare dup record; days int;
begin
  if new.staff_by is null then
    select staff_by_days_before into days from public.staffing_settings where id = 1;
    new.staff_by := new.start_date - coalesce(days, 42);
  end if;
  if new.sanction <> 'international' and (tg_op = 'INSERT' or new.club_id is distinct from old.club_id) then
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

-- 5. Possible duplicates already in the table (pairs), for the admin check panel
drop view if exists public.tournament_duplicates;
create view public.tournament_duplicates as
select a.id as id_a, a.name as name_a, a.start_date as start_a, a.organizer_email as email_a, a.created_at as created_a,
       b.id as id_b, b.name as name_b, b.start_date as start_b, b.organizer_email as email_b, b.created_at as created_b,
       case when a.club_id = b.club_id then 'same club, overlapping dates'
            when regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g') then 'same name, overlapping dates'
            else 'same organizer, overlapping dates' end as reason
from public.tournaments a
join public.tournaments b on a.id < b.id
where public.is_admin() and a.status <> 'cancelled' and b.status <> 'cancelled'
  and a.start_date <= b.end_date and a.end_date >= b.start_date
  and (a.club_id = b.club_id
       or regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g')
       or lower(a.organizer_email) = lower(b.organizer_email));
grant select on public.tournament_duplicates to authenticated;

-- 6. Overview of every tournament for the admin Staffing page
-- tournament_overview_service is read by the daily job (service role only); admins read tournament_overview.
drop view if exists public.tournament_overview;
drop view if exists public.tournament_overview_service;
create view public.tournament_overview_service as
select t.id, t.name, t.sanction, t.region, t.divisions, t.start_date, t.end_date, t.venue_city, t.venue_state,
       t.status, t.pairs_needed, t.supervisor_needed, t.travel_managed_by, t.organizer_name, t.organizer_email,
       t.organizer_notified_at, t.created_at, t.created_by_nrc, t.staff_by, c.name as club_name,
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
left join public.clubs c on c.id = t.club_id;
revoke all on public.tournament_overview_service from anon, authenticated;
create view public.tournament_overview as select * from public.tournament_overview_service where public.is_admin();
grant select on public.tournament_overview to authenticated;
