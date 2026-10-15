-- Staffing v2: weekend availability, tentative answers, supervisor need, organizer status page.
-- Run the first statement on its own (Postgres cannot add an enum value and use it in the same transaction), then the rest.

alter type request_status add value if not exists 'tentative';

-- ---------------------------------------------------------------
-- Weekend availability declared by referees (Saturday date identifies the weekend)
-- ---------------------------------------------------------------
create table if not exists public.weekend_availability (
  referee_id uuid not null references public.referees(id) on delete cascade,
  weekend date not null,                 -- the Saturday
  status text not null default 'available' check (status in ('available','unavailable','tentative')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (referee_id, weekend)
);
alter table public.weekend_availability enable row level security;
drop policy if exists wa_own on public.weekend_availability;
create policy wa_own on public.weekend_availability for all
  using (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()))
  with check (public.is_admin() or referee_id in (select id from public.referees where user_id = auth.uid()));
grant select, insert, update, delete on public.weekend_availability to authenticated;

-- ---------------------------------------------------------------
-- Tournament request: supervisor need, organizer access token
-- ---------------------------------------------------------------
alter table public.tournaments add column if not exists supervisor_needed boolean not null default false;
alter table public.tournaments add column if not exists supervisor_notes text;
alter table public.tournaments add column if not exists organizer_token uuid not null default gen_random_uuid();
alter table public.tournaments add column if not exists organizer_notified_at timestamptz;
