-- Designation books the referee's weekends (2026-10-23).
-- A designated official who does not decline is shown as booked ("assigned") on the weekends of the event,
-- on their own calendar and for the NRC. Releasing the designation (decline from the email, Remove by the NRC,
-- event cancelled or moved) restores what the referee had declared before.
-- Safe to run more than once.

-- 1. New status and bookkeeping columns
alter table public.weekend_availability add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.weekend_availability add column if not exists prev_status text;
alter table public.weekend_availability add column if not exists prev_note text;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.weekend_availability'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.weekend_availability drop constraint %I', c);
  end loop;
end $$;
alter table public.weekend_availability add constraint weekend_availability_status_check check (status in ('available','unavailable','tentative','assigned'));

-- 2. Book and release
create or replace function public.wa_apply_assignment(p_tour uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t record; first_sat date; s date;
begin
  if p_ref is null then return; end if;
  select id, name, start_date, end_date, status into t from public.tournaments where id = p_tour;
  if t.id is null or t.status = 'cancelled' or t.end_date < current_date then return; end if;
  -- Saturdays whose Friday to Sunday window touches the event (same rule as the referee calendar)
  first_sat := (t.start_date - 1) + ((6 - extract(dow from t.start_date - 1)::int + 7) % 7);
  for s in select generate_series(first_sat, t.end_date + 1, interval '7 days')::date loop
    insert into public.weekend_availability (referee_id, weekend, status, note, tournament_id, prev_status, prev_note, updated_at)
    values (p_ref, s, 'assigned', 'Designated for ' || t.name, p_tour, null, null, now())
    on conflict (referee_id, weekend) do update set
      prev_status = case when public.weekend_availability.status = 'assigned' then public.weekend_availability.prev_status else public.weekend_availability.status end,
      prev_note   = case when public.weekend_availability.status = 'assigned' then public.weekend_availability.prev_note else public.weekend_availability.note end,
      status = 'assigned', note = excluded.note, tournament_id = p_tour, updated_at = now();
  end loop;
end $$;

create or replace function public.wa_release_assignment(p_tour uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_ref is null then return; end if;
  delete from public.weekend_availability where referee_id = p_ref and tournament_id = p_tour and status = 'assigned' and prev_status is null;
  update public.weekend_availability set status = prev_status, note = prev_note, tournament_id = null, prev_status = null, prev_note = null, updated_at = now()
   where referee_id = p_ref and tournament_id = p_tour and status = 'assigned';
end $$;

-- 3. Triggers
create or replace function public.trg_assignment_weekends() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.wa_release_assignment(old.tournament_id, old.referee_id); end if;
  if tg_op in ('INSERT','UPDATE') then perform public.wa_apply_assignment(new.tournament_id, new.referee_id); end if;
  return null;
end $$;
drop trigger if exists assignment_weekends on public.assignments;
create trigger assignment_weekends after insert or delete or update of tournament_id, referee_id on public.assignments
  for each row execute function public.trg_assignment_weekends();

create or replace function public.trg_tournament_weekends() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.status is distinct from old.status or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    for a in select referee_id from public.assignments where tournament_id = new.id and referee_id is not null loop
      perform public.wa_release_assignment(new.id, a.referee_id);
      perform public.wa_apply_assignment(new.id, a.referee_id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists tournament_weekends on public.tournaments;
create trigger tournament_weekends after update of status, start_date, end_date on public.tournaments
  for each row execute function public.trg_tournament_weekends();

-- 4. Backfill: officials already designated for upcoming events
select public.wa_apply_assignment(a.tournament_id, a.referee_id)
  from public.assignments a join public.tournaments t on t.id = a.tournament_id
 where a.referee_id is not null and t.end_date >= current_date and t.status <> 'cancelled';
