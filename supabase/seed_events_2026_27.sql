-- Event calendar from July 1, 2026: publicly announced events, or tentative dates projected from the last edition
-- (same weekend one year later), from today on. Beach events and youth events are left out for now.
-- Run after event_calendar.sql. Safe to run again: each event is inserted only if its name is not there yet.

-- CalCup is not loaded here: Thomas submits it himself through the organizer form.

insert into public.tournaments (name, sanction, region, organizer_name, organizer_email, venue_name, venue_city, venue_state,
  start_date, end_date, divisions, date_status, source_url, notes, created_by_nrc, status, pairs_needed, club_id, nrc_staffs)
select v.name, v.sanction::sanction_level, v.region, 'NRC', 'negrel.thomas+nrc@gmail.com', v.venue_name, v.venue_city, v.venue_state,
       v.start_date::date, v.end_date::date, v.divisions::text[], v.date_status, v.source_url, v.notes, true,
       (case when v.end_date::date < current_date then 'completed' else 'reviewing' end)::tournament_status, 1,
       (select id from public.clubs c where c.name = v.club), false
from (values
  ('USATH College Nationals 2027', 'usath', null, null, null, null, '2027-04-23', '2027-04-25', '{Senior-M,Senior-W}', 'tentative',
   'https://www.usateamhandball.org/news/2026/march/07/registration-open-for-2026-usa-team-handball-college-nationals-in-raleigh',
   'Projected from the 2026 edition (Apr 24 to 26, 2026, NC State, Raleigh NC). Venue to be announced.', null),
  ('USATH US Open Championships 2027', 'usath', null, null, null, null, '2027-05-13', '2027-05-16', '{Senior-M,Senior-W}', 'tentative',
   'https://www.usateamhandball.org/news/2026/may/17/2026OpenChampionships',
   'Projected from the 2026 edition (May 14 to 17, 2026, TBK Bank Sports Complex, Bettendorf IA). Venue to be announced.', null),
  ('Michael Lipov Cup 2026', 'club', null, null, 'Chicago', 'IL', '2026-11-06', '2026-11-08', '{Senior-M,Senior-W}', 'confirmed',
   'https://www.usateamhandball.org/usath-events', 'Announced on the USATH events calendar. 2025 edition played in Mokena, IL.', 'Chicago Inter HC'),
  ('Men''s Tar Heel Invitational 2026', 'club', null, null, 'Chapel Hill', 'NC', '2026-11-07', '2026-11-08', '{Senior-M}', 'confirmed',
   'https://www.usateamhandball.org/usath-events', 'Announced on the USATH events calendar. Host: Carolina team handball club.', null),
  ('Women''s Tar Heel Invitational 2026', 'club', null, null, 'Chapel Hill', 'NC', '2026-11-07', '2026-11-08', '{Senior-W}', 'confirmed',
   'https://www.usateamhandball.org/usath-events', 'Announced on the USATH events calendar. Host: Carolina team handball club.', null),
  ('Samala Cup 2026', 'club', null, null, 'Denver', 'CO', '2026-12-04', '2026-12-06', '{Senior-M,Senior-W}', 'tentative',
   'https://www.usateamhandball.org/usath-events', 'USATH lists December 2026, provisional. Dates projected from the 2025 edition (Dec 5 to 7, 2025, Volo Arena, Denver).', 'Denver Wolves THC'),
  ('Men''s Blue Cup 2027', 'club', null, null, 'Chapel Hill', 'NC', '2027-02-13', '2027-02-14', '{Senior-M}', 'tentative',
   'https://www.usateamhandball.org/usath-events', 'USATH events calendar, provisional dates.', null),
  ('Women''s Blue Cup 2027', 'club', null, null, 'Chapel Hill', 'NC', '2027-02-20', '2027-02-21', '{Senior-W}', 'tentative',
   'https://www.usateamhandball.org/usath-events', 'USATH events calendar, provisional dates.', null),
  ('Seattle Handball Cup 2027', 'club', null, null, null, 'WA', '2027-04-03', '2027-04-04', '{Senior-M,Senior-W}', 'tentative',
   'https://snocosports.org/event-recap-2026-seattle-handball-cup/', 'Projected from the 2026 edition (Apr 4 to 5, 2026, Walt Price Fitness Center, Everett WA).', 'Seattle THC'),
  ('World Series of Handball 2027', 'international', null, null, 'Las Vegas', 'NV', '2027-08-04', '2027-08-08', '{Senior-M,Senior-W}', 'tentative',
   'https://worldseriesofhandball.com', 'Independent international club event. Projected from the 2026 edition (Aug 5 to 9, 2026, Las Vegas).', null)
) as v(name, sanction, region, venue_name, venue_city, venue_state, start_date, end_date, divisions, date_status, source_url, notes, club)
where not exists (select 1 from public.tournaments t where t.name = v.name);

select name, start_date, date_status, sanction from public.tournaments where start_date >= public.history_from() order by start_date;
