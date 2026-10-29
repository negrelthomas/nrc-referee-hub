-- Who books each part of the trip (October 28, 2026). Run after schema.sql. Safe to re-run.
-- travel_managed_by keeps its name and now means flights; hotel and rental car get their own field.
-- Values: organizer, nrc, referee (the referee books, the organizer reimburses), none (no hotel or no rental car needed).
alter table public.tournaments add column if not exists hotel_booked_by text;
alter table public.tournaments add column if not exists car_booked_by text;

-- backfill from the single travel field without firing the change log trigger
do $$
declare trg text;
begin
  for trg in select tgname from pg_trigger where tgrelid = 'public.tournaments'::regclass and not tgisinternal
             and tgfoid = 'public.tournament_guard_and_log'::regproc loop
    execute format('alter table public.tournaments disable trigger %I', trg);
  end loop;
  update public.tournaments set hotel_booked_by = coalesce(hotel_booked_by, travel_managed_by, 'organizer'),
                                car_booked_by = coalesce(car_booked_by, travel_managed_by, 'organizer')
   where hotel_booked_by is null or car_booked_by is null;
  for trg in select tgname from pg_trigger where tgrelid = 'public.tournaments'::regclass and not tgisinternal
             and tgfoid = 'public.tournament_guard_and_log'::regproc loop
    execute format('alter table public.tournaments enable trigger %I', trg);
  end loop;
end $$;

alter table public.tournaments alter column hotel_booked_by set default 'organizer';
alter table public.tournaments alter column hotel_booked_by set not null;
alter table public.tournaments alter column car_booked_by set default 'organizer';
alter table public.tournaments alter column car_booked_by set not null;
alter table public.tournaments drop constraint if exists tournaments_hotel_booked_by_check;
alter table public.tournaments add constraint tournaments_hotel_booked_by_check check (hotel_booked_by in ('nrc','organizer','referee','none'));
alter table public.tournaments drop constraint if exists tournaments_car_booked_by_check;
alter table public.tournaments add constraint tournaments_car_booked_by_check check (car_booked_by in ('nrc','organizer','referee','none'));

-- the change log records the two new fields next to travel_managed_by (patches the live function in place)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.tournament_guard_and_log'::regproc);
  if position('hotel_booked_by' in d) = 0 then
    d := replace(d, '''travel_managed_by''', '''travel_managed_by'',''hotel_booked_by'',''car_booked_by''');
    execute d;
  end if;
end $$;

select count(*) filter (where hotel_booked_by is not null) as hotel_set, count(*) filter (where car_booked_by is not null) as car_set,
       position('car_booked_by' in pg_get_functiondef('public.tournament_guard_and_log'::regproc)) > 0 as change_log_patched
  from public.tournaments;
