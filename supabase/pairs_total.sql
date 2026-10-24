-- Referee pairs: the organizer gives the total pairs the tournament requires and the pairs sourced outside USATH
-- (for example Canada or Europe). The pairs USATH staffs (pairs_needed) are always calculated: total minus organizer pairs.
-- pairs_needed stays the column every page, email and view reads; it is no longer an input.
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table public.tournaments add column if not exists pairs_total int;

-- existing events: total = USATH pairs + organizer pairs
update public.tournaments set pairs_total = coalesce(pairs_needed, 0) + coalesce(pairs_organizer, 0) where pairs_total is null;

alter table public.tournaments alter column pairs_total set not null;
alter table public.tournaments drop constraint if exists tournaments_pairs_total_check;
alter table public.tournaments add constraint tournaments_pairs_total_check check (pairs_total >= 0);
alter table public.tournaments drop constraint if exists tournaments_pairs_split_check;
alter table public.tournaments add constraint tournaments_pairs_split_check check (pairs_needed = pairs_total - coalesce(pairs_organizer, 0));

create or replace function public.tournament_pairs_derive()
returns trigger language plpgsql as $$
declare org int := coalesce(new.pairs_organizer, 0);
begin
  new.pairs_organizer := org;
  if new.pairs_total is null then
    -- a writer that only knows the old fields (NRC placeholder, old script): keep its USATH count, derive the total
    new.pairs_total := coalesce(new.pairs_needed, 0) + org;
  elsif tg_op = 'UPDATE' and new.pairs_total is not distinct from old.pairs_total
        and new.pairs_needed is distinct from old.pairs_needed then
    -- an old page edited the USATH count directly: treat it as a change of the total
    new.pairs_total := coalesce(new.pairs_needed, 0) + org;
  end if;
  if org > new.pairs_total then
    raise exception 'The pairs sourced outside USATH (%) exceed the total pairs the tournament requires (%).', org, new.pairs_total;
  end if;
  new.pairs_needed := new.pairs_total - org;
  return new;
end $$;

-- the name sorts before tournament_guard and tournament_guard_and_log, so the change log records the derived figures
drop trigger if exists tournament_a_pairs on public.tournaments;
create trigger tournament_a_pairs before insert or update on public.tournaments
  for each row execute function public.tournament_pairs_derive();

-- check: no row where the split does not add up
select count(*) as rows_out_of_balance from public.tournaments where pairs_needed <> pairs_total - pairs_organizer;
