-- Admin override of a referee's declared availability for one tournament (October 22, 2026). Run after schema.sql. Safe to re-run.
-- The admin gives a reason; the referee gets an email with the reason and answers Accept or Revert.
-- The override does not change the referee's own blocked dates or weekends: it only makes them selectable for that tournament.
create table if not exists public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  referee_id uuid not null references public.referees(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 15),
  declared text,                         -- what the referee had declared, as shown to the admin
  status text not null default 'pending' check (status in ('pending','accepted','reverted')),
  token uuid not null default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  created_by_label text,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  responded_at timestamptz,
  response_note text,
  unique (tournament_id, referee_id)
);
alter table public.availability_overrides enable row level security;
drop policy if exists ao_admin on public.availability_overrides;
create policy ao_admin on public.availability_overrides for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists ao_own on public.availability_overrides;
create policy ao_own on public.availability_overrides for select using (referee_id = public.my_referee_id());
grant select, insert, update, delete on public.availability_overrides to authenticated;
