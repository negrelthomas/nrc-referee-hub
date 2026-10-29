-- Fictional demo data for the how-to videos. Nobody here is real.
set session_replication_role = default;
insert into public.clubs (name, city, state, usath_registered, active, nearest_airport_iata) values ('Bay City Handball Club','San Jose','CA', true, true, 'SJC') on conflict do nothing;
update public.referees set email = replace(email, '@demo.nrc', '@example.com');

insert into public.admin_invites (email, invited_by) values ('morgan.hale@example.org','demo') on conflict do nothing;

insert into public.referees (first_name,last_name,email,phone,club_id,home_city,home_state,home_airport_iata,cert_level,cert_date,cert_by,usath_member_id,usath_membership_valid_until,safesport_valid_until,background_check_valid_until,level_confirmed,share_contact,onboarded_at)
values
 ('Jordan','Ellis','jordan.ellis@example.com','(408) 555 0142',(select id from public.clubs where name='Bay City Handball Club'),'San Jose','CA','SJC','level_2','2025-05-18','NRC, National Championships 2025','US-40213','2027-08-31','2027-03-31','2027-03-31',true,false,now() - interval '20 days'),
 ('Sam','Okafor','sam.okafor@example.com','(510) 555 0187',(select id from public.clubs where name='Bay City Handball Club'),'Oakland','CA','OAK','level_2','2025-05-18','NRC, National Championships 2025','US-40377','2027-08-31','2027-01-31','2027-01-31',true,true,now() - interval '18 days'),
 ('Lena','Fischer','lena.fischer@example.com',null,(select id from public.clubs where name='Bay City Handball Club'),'Denver','CO','DEN','level_1','2026-03-01','NRC, Level 1 course','US-41022','2027-08-31','2027-02-28','2027-02-28',true,false,null),
 ('Carlos','Ruiz','carlos.ruiz@example.com',null,(select id from public.clubs where name='Bay City Handball Club'),'Boulder','CO','DEN','level_1','2026-03-01','NRC, Level 1 course','US-41023','2027-08-31','2027-02-28','2027-02-28',true,false,null),
 ('Aisha','Bello','aisha.bello@example.com',null,(select id from public.clubs where name='Bay City Handball Club'),'Atlanta','GA','ATL','level_3','2023-05-21','NRC, National Championships 2023','US-38810','2027-08-31','2027-05-31','2027-05-31',true,false,null),
 ('Noah','Brooks','noah.brooks@example.com',null,(select id from public.clubs where name='Bay City Handball Club'),'Decatur','GA','ATL','level_3','2023-05-21','NRC, National Championships 2023','US-38811','2027-08-31','2027-05-31','2027-05-31',true,false,null),
 ('Riley','Park','riley.park@example.com',null,(select id from public.clubs where name='Bay City Handball Club'),'Sunnyvale','CA','SJC','candidate',null,null,null,'2027-08-31',null,null,true,false,now() - interval '3 days'),
 ('Elena','Vasquez','elena.vasquez@example.com',null,(select id from public.clubs where name='Bay City Handball Club'),'Fresno','CA','FAT','level_1','2026-06-01','NRC, Level 1 course','US-41100','2027-08-31','2027-06-30','2027-06-30',false,false,null)
on conflict (email) do nothing;

-- pairs
insert into public.pairs (referee_a, referee_b, valid_from)
select a.id, b.id, '2025-05-18' from public.referees a, public.referees b where (a.email,b.email) in (('jordan.ellis@example.com','sam.okafor@example.com'),('marcus.oyelaran@example.com','priya.raghunathan@example.com'),('ingrid.solheim@example.com','tomasz.wierzbicki@example.com'),('lena.fischer@example.com','carlos.ruiz@example.com'),('aisha.bello@example.com','noah.brooks@example.com'));

insert into public.certifications (referee_id,level,obtained_on,certified_by,event)
select r.id, x.level::cert_level, x.d::date, 'NRC', x.ev from (values
 ('jordan.ellis@example.com','level_1','2023-04-02','Level 1 course and clinic'),('jordan.ellis@example.com','level_2','2025-05-18','National Championships 2025'),
 ('sam.okafor@example.com','level_1','2023-04-02','Level 1 course and clinic'),('sam.okafor@example.com','level_2','2025-05-18','National Championships 2025')) x(e,level,d,ev)
join public.referees r on r.email = x.e;

-- guest referees from outside the US
insert into public.guest_officials (first_name,last_name,federation,country,email,home_city,home_airport_iata,federation_level,pair_key)
values ('Lukas','Brandt','German Handball Federation (DHB)','Germany','lukas.brandt@example.de','Cologne','CGN','national','11111111-1111-1111-1111-111111111111'),
       ('Jonas','Weber','German Handball Federation (DHB)','Germany','jonas.weber@example.de','Bonn','CGN','national','11111111-1111-1111-1111-111111111111');

-- tournaments run by the fictional organizer Dana Whitfield
insert into public.tournaments (name,sanction,region,organizer_name,organizer_email,organizer_phone,venue_name,venue_address,venue_city,venue_state,nearest_airport_iata,start_date,end_date,pairs_total,pairs_organizer,organizer_pairs_note,games_expected,hotel_nights_covered,flights_covered,airport_transfers_covered,airport_transfer_how,hotel_to_venue_transport,food_stipend_per_day,earliest_return_last_day,status,club_id,divisions,travel_managed_by,hotel_booked_by,car_booked_by,date_status,supervisor_needed,notes)
values
 ('Pacific Coast Open 2027','club','West','Dana Whitfield','dana.whitfield@example.com','(408) 555 0110','Bay City Sports Center','1200 Arena Way','San Jose','CA','SJC','2027-03-13','2027-03-14',3,1,'Lukas Brandt and Jonas Weber, German Handball Federation',28,2,true,true,'Organizer picks up','Organizer van',40,'17:00','reviewing',(select id from public.clubs where name='Bay City Handball Club'),'{Senior-M,Senior-W,U18-M}','organizer','organizer','none','confirmed',false,'Two courts, games from 9:00 to 19:00.'),
 ('Rocky Mountain Cup 2027','club','Mountain','Dana Whitfield','dana.whitfield@example.com','(408) 555 0110','Front Range Fieldhouse','400 Summit Blvd','Denver','CO','DEN','2027-01-23','2027-01-24',1,0,null,14,1,true,true,'Rideshare, reimbursed','Rideshare, reimbursed',40,'16:00','staffed',(select id from public.clubs where name='Bay City Handball Club'),'{Senior-M,Senior-W}','referee','nrc','referee','confirmed',false,null),
 ('Desert Classic 2026','club','Southwest','Dana Whitfield','dana.whitfield@example.com','(408) 555 0110','Sun Valley Gym','88 Mesa Road','Phoenix','AZ','PHX','2026-09-26','2026-09-27',1,0,null,12,1,true,true,'Rideshare, reimbursed','Walking distance',40,'15:00','completed',(select id from public.clubs where name='Bay City Handball Club'),'{Senior-M}','referee','referee','none','confirmed',false,null),
 ('Lone Star Invitational 2027','club','South','Chris Navarro','chris.navarro@example.com',null,'Gulf Coast Arena',null,'Houston','TX','IAH','2027-02-06','2027-02-07',2,0,null,20,2,true,false,null,null,35,'16:00','submitted',(select id from public.clubs where name='Houston Firehawks'),'{Senior-M,U18-W}','nrc','nrc','nrc','confirmed',true,'First edition.');

do $$
declare pco uuid; rmc uuid; dc uuid; j uuid; s uuid; m uuid; p uuid; a uuid; ja uuid; sa uuid; g uuid; i int; gb uuid; gw uuid;
begin
  select id into pco from public.tournaments where name='Pacific Coast Open 2027';
  select id into rmc from public.tournaments where name='Rocky Mountain Cup 2027';
  select id into dc from public.tournaments where name='Desert Classic 2026';
  select id into j from public.referees where email='jordan.ellis@example.com';
  select id into s from public.referees where email='sam.okafor@example.com';
  select id into m from public.referees where email='marcus.oyelaran@example.com';
  select id into p from public.referees where email='priya.raghunathan@example.com';
  select id into gb from public.guest_officials where last_name='Brandt';
  select id into gw from public.guest_officials where last_name='Weber';
  perform set_config('nrc.system','on',true);
  -- invitations for the Pacific Coast Open (Jordan has not answered yet)
  insert into public.assignment_requests (tournament_id, referee_id, status, sent_at, responded_at) values
    (pco, j, 'sent', now() - interval '2 days', null), (pco, s, 'accepted', now() - interval '2 days', now() - interval '1 day'),
    (pco, m, 'accepted', now() - interval '2 days', now() - interval '1 day'), (pco, p, 'tentative', now() - interval '2 days', now() - interval '20 hours');
  -- organizer pair from Germany designated on the Pacific Coast Open
  insert into public.assignments (tournament_id, guest_official_id, role, confirmed_at) values (pco, gb, 'referee', now() - interval '3 days'), (pco, gw, 'referee', now() - interval '3 days');
  -- Rocky Mountain Cup: Jordan and Sam designated, travel booked
  insert into public.assignment_requests (tournament_id, referee_id, status, sent_at, responded_at) values (rmc, j, 'confirmed', now() - interval '30 days', now() - interval '29 days'), (rmc, s, 'confirmed', now() - interval '30 days', now() - interval '28 days');
  insert into public.assignments (tournament_id, referee_id, role, confirmed_at) values (rmc, j, 'referee', now() - interval '25 days') returning id into ja;
  insert into public.assignments (tournament_id, referee_id, role, confirmed_at) values (rmc, s, 'referee', now() - interval '25 days') returning id into sa;
  insert into public.travel_bookings (assignment_id, kind, status, provider, reference, start_at, end_at, from_place, to_place, cost, currency, paid_by, entered_by) values
    (ja, 'flight', 'booked', 'United UA 1734', 'K7Q2LM', '2027-01-22 15:05-08', '2027-01-22 18:40-07', 'SJC', 'DEN', 286, 'USD', 'referee', 'referee'),
    (ja, 'hotel', 'booked', 'Summit Inn Denver', 'HX-55120', '2027-01-22 20:00-07', '2027-01-24 11:00-07', null, 'Denver', 318, 'USD', 'nrc', 'nrc'),
    (sa, 'hotel', 'booked', 'Summit Inn Denver', 'HX-55121', '2027-01-22 20:00-07', '2027-01-24 11:00-07', null, 'Denver', 318, 'USD', 'nrc', 'nrc');
  insert into public.expense_claims (assignment_id, kind, amount, currency, description, status, purchase_date, merchant, coverage, receipt_url) values
    (ja, 'flight', 286, 'USD', 'Round trip SJC to DEN', 'submitted', '2026-12-02', 'United Airlines', 'covered', 'demo/flight-jordan.jpg'),
    (sa, 'flight', 241, 'USD', 'Round trip OAK to DEN', 'submitted', '2026-12-04', 'Southwest Airlines', 'covered', 'demo/flight-sam.jpg');
  -- Desert Classic 2026: completed, games logged
  insert into public.assignments (tournament_id, referee_id, role, confirmed_at, games_officiated) values (dc, j, 'referee', '2026-08-20', 6), (dc, s, 'referee', '2026-08-20', 6);
  for i in 1..6 loop
    insert into public.games (tournament_id, game_date, game_time, home_team, away_team, division, game_number, court, home_score, away_score, referee_1, referee_2)
    values (dc, case when i <= 3 then date '2026-09-26' else date '2026-09-27' end, (time '09:00' + (i * interval '90 minutes')),
      (array['Phoenix Suns HC','Tucson Desert','Bay City HC','Mesa Thunder','Phoenix Suns HC','Bay City HC'])[i],
      (array['Mesa Thunder','Bay City HC','Tucson Desert','Phoenix Suns HC','Tucson Desert','Mesa Thunder'])[i], 'Senior-M', 'G' || i, 'Court 1',
      (array[27,24,31,22,29,26])[i], (array[25,28,30,22,23,27])[i], j, s) returning id into g;
  end loop;
end $$;

-- remove real contact data carried by the repo seeds
update public.club_contacts c set name = (array['Alex Morgan','Jamie Chen','Taylor Brooks','Casey Nguyen','Drew Patel','Robin Silva','Jesse Kim','Avery Cole','Quinn Rossi','Parker Lane'])[1 + (abs(hashtext(c.id::text)) % 10)],
  email = 'contact' || (abs(hashtext(c.id::text)) % 900 + 100) || '@example.org', phone = null, notes = null;
update public.tournaments set organizer_email = 'nrc@example.org' where organizer_email like 'negrel%';
update public.tournaments set outreach_email = 'events' || (abs(hashtext(id::text)) % 90 + 10) || '@example.org', outreach_name = null where outreach_email is not null;
delete from public.admin_invites where email <> 'morgan.hale@example.org';
update public.evaluators set first_name = 'Alex', last_name = 'Grant', email = 'alex.grant@example.org', phone = null where email = 'referee@handballusa.org';

-- declared availability around the Pacific Coast Open (Mar 13 to 14, 2027) for the staffing videos
insert into public.availability_blocks (referee_id, start_date, end_date, status, note)
select r.id, x.s::date, x.e2::date, x.st, x.n from (values
  ('aisha.bello@example.com','2027-03-12','2027-03-15','available',null),
  ('noah.brooks@example.com','2027-03-12','2027-03-15','available',null),
  ('lena.fischer@example.com','2027-03-13','2027-03-14','tentative','Depends on work'),
  ('carlos.ruiz@example.com','2027-03-13','2027-03-14','available',null),
  ('ingrid.solheim@example.com','2027-03-06','2027-03-20','unavailable','School trip'),
  ('diego.marchetti@example.com','2027-03-13','2027-03-14','available',null)) x(e,s,e2,st,n)
join public.referees r on r.email = x.e;

-- Jordan: a physical test and an evaluation shared by the NRC
insert into public.referee_tests (referee_id, kind, tested_on, test_name, passed, evaluator_name, shared_with_referee, std_band, beep_level, beep_shuttle, beep_loops, result)
select id, 'physical', '2026-08-15', 'Shuttle run test', true, 'Alex Grant', true, 'M30', 9, 2, 72, null from public.referees where email = 'jordan.ellis@example.com';
insert into public.evaluations (referee_id, game_id, tournament_id, evaluated_on, evaluator_name, overall, source, shared_with_referee, strengths, points_to_improve)
select r.id, g.id, g.tournament_id, '2026-10-02', 'Alex Grant', 4.2, 'video', true, 'Consistent progressive punishment, clear signals, good positioning on fast breaks.', 'Anticipate passive play earlier; communicate more with the partner on 7 metre decisions.'
from public.referees r, public.games g join public.tournaments t on t.id = g.tournament_id
where r.email = 'jordan.ellis@example.com' and t.name = 'Desert Classic 2026' and g.game_number = 'G3';
