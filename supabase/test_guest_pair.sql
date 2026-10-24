-- Test data (2026-10-24): one event with one organizer pair from outside USATH, to test the guest pages.
-- Test identities on Thomas's inbox: negrel.thomas+guest1 / +guest2 (guests), +organizer (organizer).
-- USATH staffs no pair on it (total 1, organizer 1), so no staffing reminder fires. Clean up with the block at the end.
do $$
declare t uuid; k uuid := gen_random_uuid(); g1 uuid; g2 uuid;
begin
  select id into t from public.tournaments where name = 'TEST Guest pair event (to delete)';
  if t is null then
    insert into public.tournaments (name, sanction, organizer_name, organizer_email, organizer_phone, start_date, end_date,
      pairs_total, pairs_organizer, organizer_pairs_note, status, venue_name, venue_city, venue_state, nearest_airport_iata,
      flights_covered, hotel_nights_covered, airport_transfers_covered, hotel_to_venue_transport, food_stipend_per_day,
      travel_managed_by, created_by_nrc, divisions, club_id)
    values ('TEST Guest pair event (to delete)', 'club', 'Olivia Test', 'negrel.thomas+organizer@gmail.com', '+1 415 555 0100',
      '2027-01-16', '2027-01-17', 1, 1, 'Canada', 'staffed', 'Test Gym', 'Berkeley', 'CA', 'OAK',
      true, 2, true, 'Organizer shuttle', 40, 'organizer', true, '{Senior-M}',
      (select id from public.clubs where name ilike '%heat%' limit 1))
    returning id into t;
  end if;
  if not exists (select 1 from public.assignments where tournament_id = t and guest_official_id is not null) then
    insert into public.guest_officials (first_name, last_name, email, federation, federation_level, home_city, pair_key, payment_notes)
      values ('Gaston', 'Testguest', 'negrel.thomas+guest1@gmail.com', 'Canada', 'national', 'Vancouver', k, 'Wise transfer to each referee') returning id into g1;
    insert into public.guest_officials (first_name, last_name, email, federation, pair_key, payment_notes)
      values ('Gabrielle', 'Testguest', 'negrel.thomas+guest2@gmail.com', 'Canada', k, 'Wise transfer to each referee') returning id into g2;
    insert into public.assignments (tournament_id, guest_official_id, role) values (t, g1, 'referee'), (t, g2, 'referee');
  end if;
end $$;
select t.name, g.first_name, g.last_name, g.email, g.user_id is not null as has_account
from public.assignments a join public.tournaments t on t.id = a.tournament_id join public.guest_officials g on g.id = a.guest_official_id
where t.name = 'TEST Guest pair event (to delete)';

-- CLEANUP (run when testing is done):
-- delete from public.guest_officials where email in ('negrel.thomas+guest1@gmail.com','negrel.thomas+guest2@gmail.com');
-- delete from public.tournaments where name = 'TEST Guest pair event (to delete)';
