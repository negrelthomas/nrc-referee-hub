-- Organizer edits, cancellation, change log and change notifications.

-- Organizers may update their own request; a trigger keeps status and ownership columns under control.
drop policy if exists tournaments_organizer_update on public.tournaments;
create policy tournaments_organizer_update on public.tournaments for update
  using (organizer_user_id = auth.uid() or lower(organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), '')))
  with check (organizer_user_id = auth.uid() or lower(organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), '')));

create table if not exists public.tournament_changes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  changed_by uuid references auth.users(id),
  changed_by_role text,
  changes jsonb not null,          -- {"field": {"from": x, "to": y}}
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.tournament_changes enable row level security;
drop policy if exists tc_read on public.tournament_changes;
create policy tc_read on public.tournament_changes for select using (public.is_admin() or tournament_id in (select id from public.tournaments));
grant select on public.tournament_changes to authenticated;

create or replace function public.tournament_guard_and_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare diff jsonb := '{}'::jsonb; f text; oldv text; newv text; role text;
begin
  select p.role::text into role from public.profiles p where p.id = auth.uid();
  if not public.is_admin() then
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
drop trigger if exists tournament_guard_and_log on public.tournaments;
create trigger tournament_guard_and_log before update on public.tournaments for each row execute function public.tournament_guard_and_log();
