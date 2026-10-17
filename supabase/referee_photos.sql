-- Referee photos on the public Referees page and the referee profile card.
-- Adds photo_url and home_city to the public directory view (no contact details) and sets the
-- photos on file for Halina Lehto, Azadeh Ahmadi and Ezekiel McClintock (static files under site/assets/referees).

drop view if exists public.referee_directory;
create view public.referee_directory as
select r.id, r.first_name, r.last_name, r.cert_level, r.level_confirmed, r.home_state, c.name as club_name,
       coalesce((select min(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as certified_since,
       coalesce((select max(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as last_certified_on,
       r.photo_url, r.home_city
from public.referees r
left join public.clubs c on c.id = r.club_id
where r.active and r.cert_level <> 'candidate';
grant select on public.referee_directory to anon, authenticated;

update public.referees set photo_url = '/assets/referees/halina-lehto.jpg' where email = 'halina.lehto@gmail.com' and photo_url is null;
update public.referees set photo_url = '/assets/referees/azadeh-ahmadi.jpg' where email = 'azi.ahmadi91@gmail.com' and photo_url is null;
update public.referees set photo_url = '/assets/referees/ezekiel-mcclintock.jpg' where email = 'zeekmc05@gmail.com' and (photo_url is null or photo_url like '%demo-zeke%');
