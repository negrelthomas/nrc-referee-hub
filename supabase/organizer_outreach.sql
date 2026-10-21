-- Organizer outreach: a tentative contact per event, used to invite organizers to place their request on the hub.
-- Run once in the Supabase SQL editor. Safe to run again.
-- The tentative contact is kept apart from organizer_email on purpose: organizer_email gives the person access to the
-- event on their organizer page, so it is only set when the organizer places the request themselves.

alter table public.tournaments add column if not exists outreach_email text;     -- tentative contact; blank = take the host club's primary contact
alter table public.tournaments add column if not exists outreach_name text;
alter table public.tournaments add column if not exists outreach_note text;      -- where the contact comes from
alter table public.tournaments add column if not exists outreach_sent_at timestamptz;
alter table public.tournaments add column if not exists outreach_sent_to text;

-- Gaps filled from what the hub already holds (club contacts from the CalCup 2027 registration list).
-- Events whose host club is linked take the club's primary contact automatically; only the others are set here.
update public.tournaments t set
  outreach_email = 'unchandball@gmail.com', outreach_name = null,
  outreach_note = 'UNC Chapel Hill team mailbox (CalCup 2027 list). Carolina THC hosts the Chapel Hill events; host contact not confirmed.'
where t.outreach_email is null and t.created_by_nrc
  and t.name in ('Men''s Tar Heel Invitational 2026','Women''s Tar Heel Invitational 2026','Men''s Blue Cup 2027','Women''s Blue Cup 2027');

update public.tournaments t set
  outreach_note = 'Organized by USA Team Handball: coordinate through the NRC chair rather than an outreach email.'
where t.outreach_note is null and t.created_by_nrc and t.sanction = 'usath';

update public.tournaments t set
  outreach_note = 'Independent event, no contact on file. Contact form on worldseriesofhandball.com.'
where t.outreach_note is null and t.created_by_nrc and t.name like 'World Series of Handball%';

-- A request from the organizer for an event the NRC pre-positioned updates that row (see /api/tournament-request),
-- so history and assignments stay on one event and the duplicate guard does not refuse it.
create or replace function public.tournament_guard_and_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare diff jsonb := '{}'::jsonb; f text; oldv text; newv text; role text;
begin
  select p.role::text into role from public.profiles p where p.id = auth.uid();
  -- the server (service role) claims an NRC placeholder for an organizer request: ownership and status pass through
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    -- organizers cannot touch ownership or move status except to cancelled
    new.organizer_token := old.organizer_token; new.organizer_user_id := old.organizer_user_id; new.organizer_notified_at := old.organizer_notified_at;
    if new.status is distinct from old.status and new.status <> 'cancelled' then new.status := old.status; end if;
    if old.status = 'cancelled' then raise exception 'This request is cancelled; contact the NRC to reopen it.'; end if;
  end if;
  foreach f in array array['name','start_date','end_date','venue_name','venue_address','venue_city','venue_state','nearest_airport_iata','pairs_needed','games_expected','supervisor_needed','supervisor_notes','hotel_nights_covered','flights_covered','airport_transfers_covered','airport_transfer_how','hotel_to_venue_transport','food_stipend_per_day','meals_provided','earliest_return_last_day','travel_managed_by','notes','status','organizer_name','organizer_email','organizer_phone'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into oldv, newv using old, new;
    if oldv is distinct from newv then diff := diff || jsonb_build_object(f, jsonb_build_object('from', oldv, 'to', newv)); end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.tournament_changes (tournament_id, changed_by, changed_by_role, changes) values (new.id, auth.uid(), coalesce(role, 'system'), diff);
  end if;
  return new;
end $$;
