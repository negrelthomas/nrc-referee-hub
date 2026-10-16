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
