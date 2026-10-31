-- CalCup 2027 French pair (2026-10-31): details sent by Mathilde Cournil and Loriane Lamour by email on Oct 31, 2026.
-- Sets the official photo (pink EHF jersey, static files under site/assets/referees), phone, departure airport,
-- level, country and reimbursement method on their guest profiles, and records the flights they asked for.
-- Run in the Supabase SQL editor AFTER the Hub push that adds the two photos is live. Safe to re-run.

update public.guest_officials set
  photo_url = '/assets/referees/mathilde-cournil.jpg',
  phone = '+33 7 89 56 09 97',
  country = 'France',
  federation_level = 'ihf',
  departure_airport_iata = 'ORY',
  payment_notes = 'International bank transfer (IBAN, BIC and account holder requested Oct 31, 2026)',
  notes = 'Daikin Starligue referee since 2023, EHF since 2024, IHF since July 2026. From Brittany. '
       || 'Flights requested Oct 31 (booked by the referees, invoices to upload to the Hub): '
       || 'ORY Wed Jan 27, 2027 17:40 to SFO 20:10; SFO Mon Feb 1, 2027 20:00 to ORY Tue Feb 2 15:45.',
  updated_at = now()
where lower(email) = 'mathilde.cournil@orange.fr';

update public.guest_officials set
  photo_url = '/assets/referees/loriane-lamour.jpg',
  phone = '+33 6 70 73 85 48',
  country = 'France',
  federation_level = 'ihf',
  departure_airport_iata = 'ORY',
  payment_notes = 'International bank transfer (IBAN, BIC and account holder requested Oct 31, 2026)',
  notes = 'Daikin Starligue referee since 2023, EHF since 2024, IHF since July 2026. From Brittany. '
       || 'Also writes from lamourloriane@gmail.com. '
       || 'Flights requested Oct 31 (booked by the referees, invoices to upload to the Hub): '
       || 'ORY Wed Jan 27, 2027 17:40 to SFO 20:10; SFO Mon Feb 1, 2027 20:00 to ORY Tue Feb 2 15:45.',
  updated_at = now()
where lower(email) = 'loriane.lamour@laposte.net';

-- check: two rows, both with photo, phone and payment method
select first_name, last_name, email, phone, departure_airport_iata, federation_level, photo_url, payment_notes
from public.guest_officials
where lower(email) in ('mathilde.cournil@orange.fr', 'loriane.lamour@laposte.net');
