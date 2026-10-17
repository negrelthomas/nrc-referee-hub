-- Event calendar from July 1, 2026: publicly announced events, or tentative dates projected from the last edition
-- (same weekend one year later). Beach events and youth leagues are left out for now.
-- Run after event_calendar.sql. Safe to run again: each event is inserted only if its name is not there yet.

-- CalCup 2027 is already in the hub (staffed). Attach the host club and divisions.
update public.tournaments
   set club_id = (select id from public.clubs where name = 'San Francisco CalHeat' limit 1),
       divisions = '{Senior-M,Senior-W}', date_status = 'confirmed', source_url = 'https://www.calheat.com/'
 where name = 'CalCup 2027 (20th edition)';

insert into public.tournaments (name, sanction, region, organizer_name, organizer_email, venue_name, venue_city, venue_state,
  start_date, end_date, divisions, date_status, source_url, notes, created_by_nrc, status, pairs_needed, club_id)
select v.name, v.sanction::sanction_level, v.region, 'NRC', 'negrel.thomas+nrc@gmail.com', v.venue_name, v.venue_city, v.venue_state,
       v.start_date::date, v.end_date::date, v.divisions::text[], v.date_status, v.source_url, v.notes, true,
       (case when v.end_date::date < current_date then 'completed' else 'reviewing' end)::tournament_status, 1,
       (select id from public.clubs c where c.name = v.club)
from (values
  ('USATH College Nationals 2027', 'usath', null, null, null, null, '2027-04-23', '2027-04-25', '{Senior-M,Senior-W}', 'tentative',
   'https://www.usateamhandball.org/news/2026/march/07/registration-open-for-2026-usa-team-handball-college-nationals-in-raleigh',
   'Projected from the 2026 edition (Apr 24 to 26, 2026, NC State, Raleigh NC). Venue to be announced.', null),
  ('USATH US Open Championships 2027', 'usath', null, null, null, null, '2027-05-13', '2027-05-16', '{Senior-M,Senior-W}', 'tentative',
   'https://www.usateamhandball.org/news/2026/may/17/2026OpenChampionships',
   'Projected from the 2026 edition (May 14 to 17, 2026, TBK Bank Sports Complex, Bettendorf IA). Venue to be announced.', null)
) as v(name, sanction, region, venue_name, venue_city, venue_state, start_date, end_date, divisions, date_status, source_url, notes, club)
where not exists (select 1 from public.tournaments t where t.name = v.name);

select name, start_date, date_status, sanction from public.tournaments where start_date >= public.history_from() order by start_date;
