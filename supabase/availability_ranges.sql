-- Availability on any dates (2026-10-29). Some competitions run during the week, so referees declare
-- available, tentative or unavailable periods on any dates, not only weekends.
-- One function decides a referee's availability for a set of dates; the staffing view, the admin tournament
-- window and the invitation emails all read it, so they always agree.
-- Run in the Supabase SQL editor. Safe to re-run; one transaction, nothing applies if a statement fails.
begin;

-- 1. Date ranges carry a status. Rows already there are blocked dates and stay unavailable.
--    tournament_id links an answer given for a given event (events during the week, on the referee home).
alter table public.availability_blocks add column if not exists status text not null default 'unavailable';
alter table public.availability_blocks add column if not exists tournament_id uuid references public.tournaments(id) on delete cascade;
alter table public.availability_blocks add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'availability_blocks_status_check' and conrelid = 'public.availability_blocks'::regclass) then
    alter table public.availability_blocks add constraint availability_blocks_status_check check (status in ('available','tentative','unavailable'));
  end if;
end $$;
create unique index if not exists availability_blocks_event_key on public.availability_blocks (referee_id, tournament_id) where tournament_id is not null;

-- 2. Availability of one referee for a set of dates.
--    Rules, in order:
--      a. an unavailable range touching the dates: blocked
--      b. designated for another event on overlapping dates: booked
--      c. a weekend tile marked unavailable on a Friday, Saturday or Sunday of the dates: unavailable
--      d. each day is then read from the ranges and, for Friday to Sunday, from the weekend tile (the most
--         restrictive answer wins): all days available = available; any tentative = tentative;
--         some days without an answer = partial (the missing days are named); no answer at all = unknown
create or replace function public.availability_detail(p_ref uuid, p_start date, p_end date, p_tour uuid default null)
returns table(state text, word text, block_start date, block_end date, block_created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  d date; ds text; wk text; wk_tour uuid; sat date;
  n_av int := 0; n_te int := 0; missing date[] := '{}';
  b record; bk record; txt text := ''; g_start date; g_prev date; m date;
begin
  if not (public.is_admin() or p_ref = public.my_referee_id()
          or coalesce(auth.jwt() ->> 'role', '') = 'service_role' or session_user = 'postgres') then
    return;
  end if;
  if p_start is null or p_end is null or p_end < p_start then return; end if;

  select x.start_date, x.end_date, x.created_at into b from public.availability_blocks x
   where x.referee_id = p_ref and x.status = 'unavailable' and x.start_date <= p_end and x.end_date >= p_start
   order by x.start_date limit 1;
  if found then
    return query select 'blocked'::text, 'blocked from ' || to_char(b.start_date, 'Mon FMDD') || ' to ' || to_char(b.end_date, 'Mon FMDD'),
                        b.start_date, b.end_date, b.created_at;
    return;
  end if;

  select t.name into bk from public.assignments a join public.tournaments t on t.id = a.tournament_id
   where a.referee_id = p_ref and t.id is distinct from p_tour and t.status::text <> 'cancelled'
     and t.start_date <= p_end and t.end_date >= p_start
   order by t.start_date limit 1;
  if found then
    return query select 'booked'::text, 'designated for ' || bk.name, null::date, null::date, null::timestamptz;
    return;
  end if;

  for d in select generate_series(p_start, least(p_end, p_start + 60), interval '1 day')::date loop
    select case when bool_or(x.status = 'tentative') then 'tentative' when bool_or(x.status = 'available') then 'available' end
      into ds from public.availability_blocks x
     where x.referee_id = p_ref and x.status <> 'unavailable' and d between x.start_date and x.end_date;
    wk := null;
    if extract(isodow from d) >= 5 then
      sat := d + (6 - extract(isodow from d)::int);
      select w.status, w.tournament_id into wk, wk_tour from public.weekend_availability w where w.referee_id = p_ref and w.weekend = sat;
      if wk = 'assigned' then wk := case when wk_tour = p_tour then 'available' end; end if;
      if wk = 'unavailable' then
        return query select 'unavailable'::text, 'weekend of ' || to_char(sat, 'Mon FMDD') || ' marked unavailable', null::date, null::date, null::timestamptz;
        return;
      end if;
    end if;
    if ds = 'tentative' or wk = 'tentative' then n_te := n_te + 1;
    elsif ds = 'available' or wk = 'available' then n_av := n_av + 1;
    else missing := missing || d;
    end if;
  end loop;

  if n_av + n_te = 0 then
    return query select 'unknown'::text, 'not declared'::text, null::date, null::date, null::timestamptz; return;
  end if;
  if coalesce(array_length(missing, 1), 0) > 0 then
    foreach m in array missing loop
      if g_start is null then g_start := m;
      elsif m <> g_prev + 1 then
        txt := txt || case when txt = '' then '' else ', ' end || to_char(g_start, 'Dy Mon FMDD') || case when g_prev > g_start then ' to ' || to_char(g_prev, 'Dy Mon FMDD') else '' end;
        g_start := m;
      end if;
      g_prev := m;
    end loop;
    txt := txt || case when txt = '' then '' else ', ' end || to_char(g_start, 'Dy Mon FMDD') || case when g_prev > g_start then ' to ' || to_char(g_prev, 'Dy Mon FMDD') else '' end;
    return query select 'partial'::text, 'not declared for ' || txt, null::date, null::date, null::timestamptz; return;
  end if;
  if n_te > 0 then
    return query select 'tentative'::text, 'tentative'::text, null::date, null::date, null::timestamptz; return;
  end if;
  return query select 'available'::text, 'available'::text, null::date, null::date, null::timestamptz;
end $$;

create or replace function public.availability_state(p_ref uuid, p_start date, p_end date, p_tour uuid default null)
returns text language sql stable security definer set search_path = public as $$
  select state from public.availability_detail(p_ref, p_start, p_end, p_tour);
$$;

-- 3. Every active referee for one tournament (admin tournament window, invitation emails)
create or replace function public.tournament_availability(p_tour uuid)
returns table(referee_id uuid, state text, word text, block_start date, block_end date, block_created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, a.state, a.word, a.block_start, a.block_end, a.block_created_at
  from public.tournaments t
  join public.referees r on r.active
  cross join lateral public.availability_detail(r.id, t.start_date, t.end_date, t.id) a
  where t.id = p_tour
    and (public.is_admin() or coalesce(auth.jwt() ->> 'role', '') = 'service_role' or session_user = 'postgres');
$$;

revoke all on function public.availability_detail(uuid, date, date, uuid) from public, anon;
revoke all on function public.availability_state(uuid, date, date, uuid) from public, anon;
revoke all on function public.tournament_availability(uuid) from public, anon;
grant execute on function public.availability_detail(uuid, date, date, uuid) to authenticated, service_role;
grant execute on function public.availability_state(uuid, date, date, uuid) to authenticated, service_role;
grant execute on function public.tournament_availability(uuid) to authenticated, service_role;

-- 4. Staffing view: "available" counts certified referees available on every day of the event
create or replace view public.tournament_overview_service as
SELECT t.id, t.name, t.sanction, t.region, t.divisions, t.start_date, t.end_date, t.venue_city, t.venue_state, t.status,
    t.pairs_needed, t.pairs_organizer, t.organizer_pairs_note, t.supervisor_needed, t.travel_managed_by, t.organizer_name,
    t.organizer_email, t.organizer_notified_at, t.created_at, t.created_by_nrc, t.staff_by, c.name AS club_name, t.date_status,
    (t.pairs_needed * 2) AS referees_needed,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.role = 'referee' AND a.referee_id IS NOT NULL) AS confirmed,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.role <> 'referee' AND a.referee_id IS NOT NULL) AS officials,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status <> 'draft'::request_status) AS contacted,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = ANY (ARRAY['sent'::request_status, 'tentative'::request_status])) AS waiting,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = 'sent'::request_status) AS no_answer,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = 'tentative'::request_status) AS tentative,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = ANY (ARRAY['accepted'::request_status, 'confirmed'::request_status])) AS accepted,
    (SELECT count(*) FROM assignment_requests q WHERE q.tournament_id = t.id AND q.status = ANY (ARRAY['declined'::request_status, 'no_response'::request_status])) AS declined,
    (SELECT count(*) FROM referees r WHERE r.active AND r.cert_level <> 'candidate'::cert_level
       AND public.availability_state(r.id, t.start_date, t.end_date, t.id) = 'available') AS available,
    (SELECT count(*) FROM travel_bookings b JOIN assignments a ON a.id = b.assignment_id WHERE a.tournament_id = t.id AND b.status = 'booked') AS bookings_done,
    (SELECT count(*) FROM travel_bookings b JOIN assignments a ON a.id = b.assignment_id WHERE a.tournament_id = t.id AND b.status = 'pending') AS bookings_pending,
    (SELECT max(l.created_at) FROM reminder_log l WHERE l.kind = 'staffing' AND l.target_id = t.id) AS last_reminder_at,
    (SELECT count(*) FROM assignments a WHERE a.tournament_id = t.id AND a.guest_official_id IS NOT NULL) AS guests
FROM tournaments t LEFT JOIN clubs c ON c.id = t.club_id
WHERE t.date_status = 'confirmed' AND t.nrc_staffs;

commit;
