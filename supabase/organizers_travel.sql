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
