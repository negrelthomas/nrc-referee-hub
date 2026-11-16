-- Duplicate check v2 (November 15, 2026). Safe to re-run.
-- The admin panel flagged past events and calendar events the NRC entered itself (all filed under the NRC contact email),
-- and men's and women's editions of the same event. A pair is now flagged only when:
--   both events are not cancelled and not over yet, their dates overlap,
--   their divisions overlap (or one of them has none recorded), and
--   they share a club, a name, or an organizer email that is not on an NRC created calendar event.
drop view if exists public.tournament_duplicates;
create view public.tournament_duplicates as
select a.id as id_a, a.name as name_a, a.start_date as start_a, a.organizer_email as email_a, a.created_at as created_a,
       b.id as id_b, b.name as name_b, b.start_date as start_b, b.organizer_email as email_b, b.created_at as created_b,
       case when a.club_id = b.club_id then 'same club, overlapping dates'
            when regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g') then 'same name, overlapping dates'
            else 'same organizer, overlapping dates' end as reason
from public.tournaments a
join public.tournaments b on a.id < b.id
where public.is_admin() and a.status <> 'cancelled' and b.status <> 'cancelled'
  and a.end_date >= current_date and b.end_date >= current_date
  and a.start_date <= b.end_date and a.end_date >= b.start_date
  and (cardinality(a.divisions) = 0 or cardinality(b.divisions) = 0 or a.divisions && b.divisions)
  and (a.club_id = b.club_id
       or regexp_replace(lower(a.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g')
       or (lower(a.organizer_email) = lower(b.organizer_email) and not a.created_by_nrc and not b.created_by_nrc));
grant select on public.tournament_duplicates to authenticated;
