-- Tournament change log for the admin (October 22, 2026). Run after schema.sql. Safe to re-run.
-- Every field change on a tournament is logged with who made it (name, role); internal fields (club, sanction, region,
-- divisions, staff by, date status, NRC staffs, source link) are logged too but are not sent to officials or organizers.
alter table public.tournament_changes add column if not exists changed_by_label text;

create or replace function public.tournament_guard_and_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare diff jsonb := '{}'::jsonb; f text; oldv text; newv text; role text; who text;
begin
  select p.role::text, coalesce(p.full_name, p.email) into role, who from public.profiles p where p.id = auth.uid();
  if who is null then who := case when coalesce(auth.role(), '') = 'service_role' then 'Hub server' else 'Database (SQL editor or script)' end; end if;
  -- the server (service role) claims an NRC placeholder for an organizer request: ownership and status pass through
  if not public.is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    -- organizers cannot touch ownership or move status except to cancelled
    new.organizer_token := old.organizer_token; new.organizer_user_id := old.organizer_user_id; new.organizer_notified_at := old.organizer_notified_at;
    if new.status is distinct from old.status and new.status <> 'cancelled' then new.status := old.status; end if;
    if old.status = 'cancelled' then raise exception 'This request is cancelled; contact the NRC to reopen it.'; end if;
  end if;
  foreach f in array array['name','start_date','end_date','venue_name','venue_address','venue_city','venue_state','nearest_airport_iata','pairs_needed','games_expected','supervisor_needed','supervisor_notes','hotel_nights_covered','flights_covered','airport_transfers_covered','airport_transfer_how','hotel_to_venue_transport','food_stipend_per_day','meals_provided','earliest_return_last_day','travel_managed_by','pairs_organizer','organizer_pairs_note','notes','status','organizer_name','organizer_email','organizer_phone','club_id','sanction','region','divisions','staff_by','date_status','nrc_staffs','source_url'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into oldv, newv using old, new;
    if oldv is distinct from newv then diff := diff || jsonb_build_object(f, jsonb_build_object('from', oldv, 'to', newv)); end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.tournament_changes (tournament_id, changed_by, changed_by_role, changed_by_label, changes) values (new.id, auth.uid(), coalesce(role, 'system'), who, diff);
  end if;
  return new;
end $$;
