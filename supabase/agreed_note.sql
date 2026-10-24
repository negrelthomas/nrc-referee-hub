-- How a change to a tournament request was agreed with the organizer (phone, WhatsApp, email), written by the admin
-- and quoted in the update email. Kept on the change log rows sent in that update (2026-10-23). Safe to re-run.
alter table public.tournament_changes add column if not exists agreed_note text;
