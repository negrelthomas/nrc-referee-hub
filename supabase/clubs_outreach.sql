-- Club outreach: club contacts, club link on tournaments and inquiries, message log.
-- Run once in the Supabase SQL editor (also appended to schema.sql). Safe to run again.

-- Contacts per club. Admin only: never exposed on public pages.
create table if not exists public.club_contacts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text,
  role text,             -- Club contact, Men's team, Women's team, Coach, Club mailbox...
  email text,
  phone text,
  is_primary boolean not null default false,
  receives_messages boolean not null default true, -- untick to keep the contact on file without emailing it
  source text,           -- where the contact came from
  notes text,
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null)
);
create unique index if not exists club_contacts_email_uq on public.club_contacts(club_id, lower(email)) where email is not null;
create index if not exists club_contacts_club_idx on public.club_contacts(club_id);
alter table public.club_contacts enable row level security;
drop policy if exists club_contacts_admin on public.club_contacts;
create policy club_contacts_admin on public.club_contacts for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.club_contacts to authenticated;

-- Hosting club on tournament requests (optional on the public form)
alter table public.tournaments add column if not exists club_id uuid references public.clubs(id) on delete set null;
create index if not exists tournaments_club_idx on public.tournaments(club_id);

-- Club link on contact requests: club picked from the list, and whether the person is a member or a volunteer
alter table public.referee_inquiries add column if not exists club_id uuid references public.clubs(id) on delete set null;
alter table public.referee_inquiries add column if not exists club_affiliation text check (club_affiliation in ('member','volunteer','none'));

-- Messages the NRC sends to clubs from the admin (one row per send; each email is also in email_log)
create table if not exists public.club_messages (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body text not null,
  template text,
  club_ids uuid[] not null default '{}',
  recipients int not null default 0,
  sent int not null default 0,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.club_messages enable row level security;
drop policy if exists club_messages_admin on public.club_messages;
create policy club_messages_admin on public.club_messages for all using (public.is_admin()) with check (public.is_admin());
grant select on public.club_messages to authenticated;

-- Two clubs that registered for CalCup and are missing from the USATH directory list
insert into public.clubs (name, club_type, state, website) values
  ('SoCal Handball Club', 'adult', 'CA', 'https://socalhandball.org'),
  ('California Eagles', 'adult', 'CA', null)
on conflict (name) do nothing;

-- Contacts from the CalCup 2027 master file (Registration 2027 tab, October 2026)
insert into public.club_contacts (club_id, name, email, phone, role, source)
select c.id, v.name, v.email, v.phone, v.role, 'CalCup 2027 registration list'
from (values
  ('Boston THC', 'Elise Renard', 'er.lilfox@gmail.com', null, 'Men''s team'),
  ('Boston THC', 'Robin Chan', 'robin.chan2@gmail.com', '781-223-5060', 'Men''s team'),
  ('Boston THC', null, 'lukaspohl@arcor.de', null, 'Men''s team'),
  ('Boston THC', null, 'gustavogaigherght@gmail.com', null, 'Men''s team'),
  ('Boston THC', 'Dina Kahriman', 'd@dinakahriman.com', null, 'Women''s team'),
  ('Denver Wolves THC', 'Moshe Mukori', 'wolveshandballclub@yahoo.com', '206-375-9848', 'Club contact'),
  ('Los Angeles THC', 'Michael Hinson', 'michaelhinson@yahoo.com', null, 'Club contact'),
  ('Los Angeles THC', null, 'losangelesteamhandball@gmail.com', null, 'Club mailbox'),
  ('Massif Salt Lake City', 'Patrick Halladay', 'massifslc.handball@gmail.com', null, 'Club contact'),
  ('Massif Salt Lake City', 'Andre Rammi', null, '801-330-5728', 'Women''s team'),
  ('Minnesota THC', 'Josh Hetterick', 'mnteamhandball@gmail.com', null, 'Club contact'),
  ('New York Athletic Club', 'Hady Elsayed', 'ahadyelsayed@gmail.com', null, 'Club contact'),
  ('New York Athletic Club', 'William Harrison', 'xwharrison@aol.com', null, 'Club contact'),
  ('New York City THC', 'Bini', 'shkumbin@newyorkcityteamhandball.com', null, 'Men''s team'),
  ('New York City THC', 'Cecilie', 'cecilie.maria@live.com', null, 'Women''s team'),
  ('New York City THC', 'Stephanie', null, '347-282-6467', 'Women''s team'),
  ('Phoenix THC', 'Peter Schubert', 'psremax@hotmail.com', null, 'Club contact'),
  ('Portland Sasquatch THC', 'Jan Vanderstraeten', 'janvanderstraeten84@gmail.com', null, 'Club contact'),
  ('San Diego THC', 'Saadallah Kassir', 'sdthc.contact@gmail.com', '818-689-3587', 'Club contact'),
  ('San Francisco CalHeat', 'Gabriela Davi', 'gabriela_davi_@hotmail.com', '415-209-3211', 'Club contact'),
  ('San Francisco CalHeat', 'Leila Movahedian', 'leilamovahedian@gmail.com', null, 'Club contact'),
  ('Seattle THC', 'Todor Avramov', 'tavramov@gmail.com', null, 'Club contact'),
  ('Seattle THC', 'Felix Schwock', 'fschwock@gmail.com', '206-226-2284', 'Club contact'),
  ('Air Force Academy THC', 'Mike Cavanaugh', 'mikecava2000@netscape.net', null, 'Coach'),
  ('Air Force Academy THC', 'David Schmitt', 'david.schmitt@afacademy.af.edu', null, 'Academy contact'),
  ('DC Diplomats', 'Mila Manevska', 'mila@dcdiplomats.com', null, 'Club contact'),
  ('Army West Point THC', 'Dylan Hyde', 'dylan.hyde@westpoint.edu', null, 'Officer in charge'),
  ('Army West Point THC', 'Othie Freeny', null, '317-626-3905', 'Team contact'),
  ('Army West Point WTHC', 'Dajah Treece', 'dajah.treece@westpoint.edu', null, 'Team contact'),
  ('Army West Point WTHC', 'Dana Meyers', 'dana.meyers@westpoint.edu', '571-404-9229', 'Team contact'),
  ('Houston Firehawks', null, 'margotprovensal@gmail.com', null, 'Club contact'),
  ('Dallas THC', 'Jordan Wenske', 'jhwenske@gmail.com', null, 'Club contact'),
  ('Dallas THC', null, 'contact@dallasteamhandballclub.com', null, 'Club mailbox'),
  ('Motor City Handball', null, 'detroithandballclub@gmail.com', null, 'Club mailbox'),
  ('Cincinnati Gladiators', null, 'cincythc@gmail.com', null, 'Club mailbox'),
  ('Chicago Inter HC', 'Patrick Jalabert', 'patrick@chicagointer.org', null, 'Club contact'),
  ('Chicago Inter HC', null, 'contact@chicagointer.org', null, 'Club mailbox'),
  ('Philly Handball', null, 'info@phillyteamhandball.com', null, 'Club mailbox'),
  ('Miami Storm THC', null, 'intermiamihandballclub@yahoo.com', null, 'Club mailbox'),
  ('University of North Carolina Chapel Hill WTHC', null, 'unchandball@gmail.com', null, 'Team mailbox'),
  ('SoCal Handball Club', 'Elizabeth Hartnett Wyatt', 'liz@socalhandball.org', null, 'Club contact'),
  ('SoCal Handball Club', 'Fabio Pastorello', 'fabio@socalhandball.org', null, 'Club contact'),
  ('California Eagles', 'Sonia Gmar', 'sonia.gmar@gmail.com', null, 'Club contact')
) as v(club, name, email, phone, role)
join public.clubs c on c.name = v.club
where not exists (select 1 from public.club_contacts x where x.club_id = c.id and ((v.email is not null and lower(x.email) = v.email) or (v.email is null and x.phone = v.phone)));

-- One primary contact per club: the first named contact with an email
update public.club_contacts cc set is_primary = true
where cc.id in (select distinct on (club_id) id from public.club_contacts where email is not null order by club_id, (name is null), created_at)
  and not exists (select 1 from public.club_contacts y where y.club_id = cc.club_id and y.is_primary);
