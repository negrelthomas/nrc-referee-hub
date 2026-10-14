-- Demo data: three referee profiles (Halina Lehto, Azadeh Ahmadi, Zeke McClintock) with tournament history,
-- one established pair, evaluations and quiz history, so the hub can be shown before the roster is loaded.
-- Emails below are placeholders so that nobody is invited by accident; replace them before inviting the real referees.
-- Remove with: delete from public.referees where email like '%@demo.nrc';

insert into public.referees (first_name,last_name,email,club_id,home_city,home_state,home_airport_iata,cert_level,cert_date,cert_by,usath_membership_valid_until,safesport_valid_until,background_check_valid_until,availability_notes,photo_url)
values
 ('Halina','Lehto','halina.lehto@demo.nrc',(select id from public.clubs where name='Boston THC'),'Boston','MA','BOS','level_3','2024-10-27','NRC, Lipov Memorial clinic','2027-08-31','2027-03-15','2027-03-15','Weekends; prefers Friday evening arrival.',null),
 ('Azadeh','Ahmadi','azadeh.ahmadi@demo.nrc',(select id from public.clubs where name='Boston THC'),'Cambridge','MA','BOS','level_3','2024-10-27','NRC, Lipov Memorial clinic','2027-08-31','2027-01-10','2026-11-30','Weekends.',null),
 ('Ezekiel','McClintock','zeke.mcclintock@demo.nrc',(select id from public.clubs where name='San Francisco CalHeat'),'San Francisco','CA','SFO','nachc','2026-06-15','NACHC PRC','2027-08-31','2027-05-01','2027-05-01','Plays GK for CalHeat; unavailable on CalHeat game days unless refereeing the same event.',null)
on conflict (email) do nothing;

insert into public.certifications (referee_id,level,obtained_on,certified_by,event)
select r.id, x.level::cert_level, x.obtained_on::date, x.by, x.event from (values
 ('halina.lehto@demo.nrc','level_1','2021-11-14','NRC','Online Level 1 course'),
 ('halina.lehto@demo.nrc','level_2','2022-10-30','NRC','Michael Lipov Memorial 2022'),
 ('halina.lehto@demo.nrc','level_3','2024-10-27','NRC','Michael Lipov Memorial 2024'),
 ('azadeh.ahmadi@demo.nrc','level_1','2021-11-14','NRC','Online Level 1 course'),
 ('azadeh.ahmadi@demo.nrc','level_2','2022-10-30','NRC','Michael Lipov Memorial 2022'),
 ('azadeh.ahmadi@demo.nrc','level_3','2024-10-27','NRC','Michael Lipov Memorial 2024'),
 ('zeke.mcclintock@demo.nrc','level_1','2022-11-05','NRC','CalHeat clinic'),
 ('zeke.mcclintock@demo.nrc','level_2','2024-01-28','NRC','CalCup 2024'),
 ('zeke.mcclintock@demo.nrc','level_3','2025-05-18','NRC','USATH National Championships 2025'),
 ('zeke.mcclintock@demo.nrc','nachc','2026-06-15','NACHC PRC','NORCA Championships 2026, Salinas PR')
) as x(email,level,obtained_on,by,event) join public.referees r on r.email=x.email;

insert into public.pairs (referee_a,referee_b,valid_from,notes)
select a.id,b.id,'2022-10-30','Established pair since Level 2.' from public.referees a, public.referees b
where a.email='halina.lehto@demo.nrc' and b.email='azadeh.ahmadi@demo.nrc';

-- Tournaments (past, with sanction level)
insert into public.tournaments (name,sanction,region,organizer_name,organizer_email,venue_name,venue_city,venue_state,nearest_airport_iata,start_date,end_date,pairs_needed,games_expected,status)
values
 ('CalCup 2026 (19th edition)','club','NORCAL','Thomas Negrel','calcup@calheat.com','Centerville Middle School','Fremont','CA','SFO','2026-01-30','2026-02-01',4,22,'completed'),
 ('USATH National Championships 2026','usath',null,'USA Team Handball','events@handballusa.org','Convention Center','Salt Lake City','UT','SLC','2026-05-15','2026-05-17',8,48,'completed'),
 ('Michael Lipov Memorial 2025','usath','Northeast','Boston THC','events@bostonthc.org','Harvard Athletic Complex','Boston','MA','BOS','2025-10-24','2025-10-26',5,30,'completed'),
 ('NORCAL Winter League 2025','regional','NORCAL','NorCal Handball','league@norcalhandball.org','Various','San Jose','CA','SJC','2025-11-08','2025-12-14',2,16,'completed'),
 ('CalHeat Open 2025','club','NORCAL','San Francisco CalHeat','calcup@calheat.com','Kezar Pavilion','San Francisco','CA','SFO','2025-09-20','2025-09-21',2,10,'completed'),
 ('NORCA Championships 2026','international','NACHC','NACHC','prc@nachc.org','Coliseo','Salinas','PR','SJU','2026-06-08','2026-06-14',6,40,'completed'),
 ('CalCup 2027 (20th edition)','club','NORCAL','Thomas Negrel','calcup@calheat.com','Centerville Middle School','Fremont','CA','SFO','2027-01-29','2027-01-31',4,24,'staffed');

insert into public.assignments (tournament_id,referee_id,role,games_officiated)
select t.id, r.id, 'referee', x.games from (values
 ('halina.lehto@demo.nrc','CalCup 2026 (19th edition)',7),
 ('azadeh.ahmadi@demo.nrc','CalCup 2026 (19th edition)',7),
 ('halina.lehto@demo.nrc','USATH National Championships 2026',9),
 ('azadeh.ahmadi@demo.nrc','USATH National Championships 2026',9),
 ('halina.lehto@demo.nrc','Michael Lipov Memorial 2025',6),
 ('azadeh.ahmadi@demo.nrc','Michael Lipov Memorial 2025',6),
 ('zeke.mcclintock@demo.nrc','USATH National Championships 2026',8),
 ('zeke.mcclintock@demo.nrc','NORCAL Winter League 2025',12),
 ('zeke.mcclintock@demo.nrc','CalHeat Open 2025',6),
 ('zeke.mcclintock@demo.nrc','NORCA Championships 2026',5),
 ('zeke.mcclintock@demo.nrc','CalCup 2026 (19th edition)',6),
 ('halina.lehto@demo.nrc','CalCup 2027 (20th edition)',null),
 ('azadeh.ahmadi@demo.nrc','CalCup 2027 (20th edition)',null),
 ('zeke.mcclintock@demo.nrc','CalCup 2027 (20th edition)',null)
) as x(email,tname,games) join public.referees r on r.email=x.email join public.tournaments t on t.name=x.tname
on conflict do nothing;

-- Evaluations
insert into public.evaluations (referee_id,tournament_id,evaluated_on,evaluator_name,score_rules_application,score_game_management,score_progressive_punishment,score_positioning,score_pair_cooperation,score_communication,strengths,points_to_improve,shared_with_referee)
select r.id, t.id, x.d::date, x.obs, x.a,x.b,x.c,x.e,x.f,x.g, x.s, x.p, true from (values
 ('halina.lehto@demo.nrc','USATH National Championships 2026','2026-05-17','Rafael Marques',4,4,3,4,5,4,'Calm under pressure, clear signals, excellent cooperation with partner.','Progressive punishment: earlier yellow card on repeated holding at the pivot; be more consistent in the last five minutes.'),
 ('azadeh.ahmadi@demo.nrc','USATH National Championships 2026','2026-05-17','Rafael Marques',4,3,4,3,5,4,'Rules knowledge, consistency on 7m decisions.','Positioning as court referee on fast breaks; move earlier toward the goal area line.'),
 ('zeke.mcclintock@demo.nrc','NORCA Championships 2026','2026-06-13','NACHC observer',5,4,4,4,4,4,'Game reading, authority with benches, fitness.','Communication with the table on time-outs; confirm with the timekeeper before restart.'),
 ('zeke.mcclintock@demo.nrc','CalCup 2026 (19th edition)','2026-02-01','Vafa Ahmadiyeh',4,4,3,4,4,3,'Decisive, good tempo.','Passive play forewarning: raise the arm earlier when the attack stalls; six pass count must be visible to both benches.')
) as x(email,tname,d,obs,a,b,c,e,f,g,s,p) join public.referees r on r.email=x.email join public.tournaments t on t.name=x.tname;

-- Quiz history is tied to auth users, so it appears once the demo referees sign in. Nothing seeded here.
