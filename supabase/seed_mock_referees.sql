-- Five fictional referees so the directory, coverage dashboard and profiles can be reviewed before the real roster is loaded.
-- Names and emails are invented; emails end in @demo.nrc so nobody is invited by accident.
-- Remove with: delete from public.referees where email like '%@demo.nrc';
-- Requires seed_demo.sql first (tournaments used below come from it).

insert into public.referees (first_name,last_name,email,club_id,home_city,home_state,home_airport_iata,cert_level,cert_date,cert_by,usath_membership_valid_until,safesport_valid_until,background_check_valid_until,availability_notes,photo_url)
values
 ('Marcus','Oyelaran','marcus.oyelaran@demo.nrc',(select id from public.clubs where name='DC Diplomats'),'Arlington','VA','DCA','level_2','2025-10-26','NRC, Lipov Memorial clinic','2027-08-31','2027-02-28','2027-02-28','Weekends only; can drive to Philadelphia and New York.',null),
 ('Ingrid','Solheim','ingrid.solheim@demo.nrc',(select id from public.clubs where name='Minnesota THC'),'Saint Paul','MN','MSP','level_3','2024-05-19','NRC, National Championships 2024','2027-08-31','2026-12-31','2027-06-30','Available most weekends; school teacher, no weekday travel.',null),
 ('Diego','Marchetti','diego.marchetti@demo.nrc',(select id from public.clubs where name='Los Angeles THC'),'Pasadena','CA','BUR','level_1','2026-02-01','NRC, CalCup 2026 clinic','2027-08-31','2027-01-31','2027-01-31','New referee; prefers to be paired with a Level 2 or above.',null),
 ('Priya','Raghunathan','priya.raghunathan@demo.nrc',(select id from public.clubs where name='Houston Firehawks'),'Houston','TX','IAH','level_2','2025-05-18','NRC, National Championships 2025','2027-08-31','2027-04-15','2026-11-15','Available for Texas and Southeast events; one flight per quarter.',null),
 ('Tomasz','Wierzbicki','tomasz.wierzbicki@demo.nrc',(select id from public.clubs where name='Chicago Inter HC'),'Evanston','IL','ORD','level_3','2023-10-29','NRC, Lipov Memorial clinic','2027-08-31','2027-05-31','2027-05-31','Also an observer for Level 1 evaluations.',null)
on conflict (email) do nothing;

insert into public.certifications (referee_id,level,obtained_on,certified_by,event)
select r.id, x.level::cert_level, x.obtained_on::date, x.by, x.event from (values
 ('marcus.oyelaran@demo.nrc','level_1','2024-03-10','NRC','Online Level 1 course'),
 ('marcus.oyelaran@demo.nrc','level_2','2025-10-26','NRC','Michael Lipov Memorial 2025'),
 ('ingrid.solheim@demo.nrc','level_1','2021-04-18','NRC','Online Level 1 course'),
 ('ingrid.solheim@demo.nrc','level_2','2022-05-22','NRC','USATH National Championships 2022'),
 ('ingrid.solheim@demo.nrc','level_3','2024-05-19','NRC','USATH National Championships 2024'),
 ('diego.marchetti@demo.nrc','level_1','2026-02-01','NRC','CalCup 2026 clinic'),
 ('priya.raghunathan@demo.nrc','level_1','2023-09-17','NRC','Online Level 1 course'),
 ('priya.raghunathan@demo.nrc','level_2','2025-05-18','NRC','USATH National Championships 2025'),
 ('tomasz.wierzbicki@demo.nrc','level_1','2019-11-03','NRC','Chicago clinic'),
 ('tomasz.wierzbicki@demo.nrc','level_2','2021-10-31','NRC','Michael Lipov Memorial 2021'),
 ('tomasz.wierzbicki@demo.nrc','level_3','2023-10-29','NRC','Michael Lipov Memorial 2023')
) as x(email,level,obtained_on,by,event) join public.referees r on r.email=x.email;

insert into public.pairs (referee_a,referee_b,valid_from,notes)
select a.id,b.id,'2025-10-26','Paired at the 2025 Lipov Memorial; worked well together.' from public.referees a, public.referees b
where a.email='tomasz.wierzbicki@demo.nrc' and b.email='marcus.oyelaran@demo.nrc';

insert into public.assignments (tournament_id,referee_id,role,games_officiated)
select t.id, r.id, 'referee', x.games from (values
 ('ingrid.solheim@demo.nrc','USATH National Championships 2026',8),
 ('tomasz.wierzbicki@demo.nrc','USATH National Championships 2026',9),
 ('tomasz.wierzbicki@demo.nrc','Michael Lipov Memorial 2025',7),
 ('marcus.oyelaran@demo.nrc','Michael Lipov Memorial 2025',7),
 ('priya.raghunathan@demo.nrc','USATH National Championships 2026',6),
 ('diego.marchetti@demo.nrc','CalCup 2026 (19th edition)',4),
 ('diego.marchetti@demo.nrc','NORCAL Winter League 2025',5),
 ('ingrid.solheim@demo.nrc','CalCup 2027 (20th edition)',null)
) as x(email,tname,games) join public.referees r on r.email=x.email join public.tournaments t on t.name=x.tname
on conflict do nothing;

insert into public.evaluations (referee_id,tournament_id,evaluated_on,evaluator_name,score_rules_application,score_game_management,score_progressive_punishment,score_positioning,score_pair_cooperation,score_communication,strengths,points_to_improve,notes)
select r.id, t.id, x.d::date, x.ev, x.s1, x.s2, x.s3, x.s4, x.s5, x.s6, x.st, x.pi, x.n from (values
 ('marcus.oyelaran@demo.nrc','Michael Lipov Memorial 2025','2025-10-26','T. Wierzbicki',4,3,3,4,4,4,'Calm under pressure, clear signals.','Progressive punishment: first warning came late in two games.','Ready for Level 3 observation in 2026.'),
 ('diego.marchetti@demo.nrc','CalCup 2026 (19th edition)','2026-01-31','I. Solheim',3,2,2,3,3,3,'Good positioning for a first tournament.','Game management: let the bench talk too long; whistle earlier on passive play.','Pair with an experienced referee for the next two tournaments.'),
 ('priya.raghunathan@demo.nrc','USATH National Championships 2026','2026-05-17','T. Wierzbicki',4,4,3,4,3,4,'Consistent line on offensive fouls.','Cooperation with the goal line referee on 7 meter decisions.',null),
 ('ingrid.solheim@demo.nrc','USATH National Championships 2026','2026-05-17','NRC observer',5,4,4,5,4,5,'Excellent rules application and communication with coaches.','Positioning in fast break transitions.','Candidate for NACHC nomination.')
) as x(email,tname,d,ev,s1,s2,s3,s4,s5,s6,st,pi,n) join public.referees r on r.email=x.email join public.tournaments t on t.name=x.tname;
