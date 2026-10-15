-- Real contact emails for the three CalCup 2027 referees (from the CalCup correspondence). Certification history to be confirmed by the NRC.
update public.referees set email = 'halina.lehto@gmail.com', admin_notes = 'CalCup 2027 confirmed pair with Azadeh Ahmadi. Certification history entered from CalCup notes; confirm with NRC roster.' where email = 'halina.lehto@demo.nrc';
update public.referees set email = 'azi.ahmadi91@gmail.com', admin_notes = 'CalCup 2027 confirmed pair with Halina Lehto. Certification history entered from CalCup notes; confirm with NRC roster.' where email = 'azadeh.ahmadi@demo.nrc';
update public.referees set email = 'zeekmc05@gmail.com', admin_notes = 'CalCup 2027 confirmed, pair with Tora (toraoline09@gmail.com, not yet on the roster). Certification history entered from CalCup notes; confirm with NRC roster.' where email = 'zeke.mcclintock@demo.nrc';
select first_name, last_name, email from public.referees order by last_name;

-- Referees who answered the CalCup 2027 availability call (October 2026). Level and club to confirm with the NRC roster.
insert into public.referees (first_name,last_name,email,home_city,home_state,home_airport_iata,cert_level,admin_notes)
values
 ('Joe','Bauer','joe.w.bauer@gmail.com',null,null,null,'level_1','Replied to the CalCup 2027 availability call with a flight quote. Level, club and home base to confirm.'),
 ('Peter','Schubert','peterschubertplc@gmail.com','Phoenix','AZ','PHX','level_1','Replied to the CalCup 2027 availability call (also writes from psremax@hotmail.com). Level and club to confirm.'),
 ('Josep','Puig Ruiz','puig.ruiz.josep1@gmail.com','Boston','MA','BOS','level_1','Replied to the CalCup 2027 availability call, flight from Boston. Level and club to confirm.'),
 ('Rosario','Ragusa','ragusarosario@gmail.com','Boston','MA','BOS','level_1','Replied to the CalCup 2027 availability call, flight from Boston. Level and club to confirm.'),
 ('Asanga','Cho','asangacho@gmail.com',null,null,null,'level_1','Replied to the CalCup 2027 availability call with a flight quote. Level, club and home base to confirm.'),
 ('Ionut','Toma','toma.c.ionut@gmail.com',null,'FL',null,'level_1','Replied to the CalCup 2027 availability call, flight from Florida. Level, club and home base to confirm.'),
 ('Mirko','Mladenovic','mladenovicmirko@gmail.com',null,null,null,'level_1','Replied to the CalCup 2027 availability call, flight quoted in Canadian dollars (based in Canada). Level and affiliation to confirm.'),
 ('Adela','Valenzuela Bonilla','adelavalenzuelabonilla@gmail.com',null,null,null,'level_1','Replied to the CalCup 2027 availability call. Level, club and home base to confirm.'),
 ('Tora','Oline','toraoline09@gmail.com',null,null,null,'level_1','CalCup 2027 confirmed pair with Zeke McClintock. Last name taken from the email address, to confirm. Level and club to confirm.')
on conflict (email) do nothing;

-- Established pair for CalCup 2027
insert into public.pairs (referee_a,referee_b,valid_from,notes)
select a.id,b.id,'2026-10-11','Confirmed pair for CalCup 2027.' from public.referees a, public.referees b
where a.email='zeekmc05@gmail.com' and b.email='toraoline09@gmail.com'
  and not exists (select 1 from public.pairs p where (p.referee_a=a.id and p.referee_b=b.id) or (p.referee_a=b.id and p.referee_b=a.id));

select first_name, last_name, email, cert_level from public.referees order by last_name;
