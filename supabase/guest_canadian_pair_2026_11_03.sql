-- CalCup 2027 Canadian pair (2026-11-03): photo and background sent by Teodora Bosonea by email on Nov 3, 2026.
-- Keira Hopkinson is on the left of the photo, Teodora (Teo) Bosonea on the right (Teo's reply of Nov 3, 2026).
-- Sets the official photo (static files under site/assets/referees), country, home city and a background note
-- on their guest profiles. Run in the Supabase SQL editor AFTER the Hub push that adds the two photos is live.
-- Safe to re-run: the background note is only added once.

update public.guest_officials set
  photo_url = '/assets/referees/keira-hopkinson.jpg',
  country = 'Canada',
  home_city = coalesce(nullif(home_city, ''), 'Edmonton, Alberta'),
  notes = case when coalesce(notes, '') ilike '%IHF Trophy%' then notes
               else concat_ws(' ', nullif(notes, ''),
                 'Referee pair from Edmonton, Alberta, refereeing together for two and a half years. '
                 || 'Two IHF Trophy competitions and several Canadian and USA National Championships (email of Nov 3, 2026).') end,
  updated_at = now()
where lower(email) = 'keirahoppy@gmail.com';

update public.guest_officials set
  photo_url = '/assets/referees/teodora-bosonea.jpg',
  country = 'Canada',
  home_city = coalesce(nullif(home_city, ''), 'Edmonton, Alberta'),
  notes = case when coalesce(notes, '') ilike '%IHF Trophy%' then notes
               else concat_ws(' ', nullif(notes, ''),
                 'Goes by Teo. Referee pair from Edmonton, Alberta, refereeing together for two and a half years. '
                 || 'Two IHF Trophy competitions and several Canadian and USA National Championships (email of Nov 3, 2026).') end,
  updated_at = now()
where lower(email) = 'tbosonea@gmail.com';

-- check: expect two rows, both with photo and Canada
select first_name, last_name, email, country, home_city, photo_url
from public.guest_officials
where lower(email) in ('keirahoppy@gmail.com', 'tbosonea@gmail.com');
