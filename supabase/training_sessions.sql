-- Training sessions announced by the NRC (clinics, online rule sessions, certification courses).
-- Public pages show published sessions; admins manage them in Admin > Training sessions.
create table if not exists public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  session_type text not null default 'online', -- online | in_person | course
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text default 'America/Los_Angeles',
  location text,            -- city and venue, or "Zoom"
  audience text,            -- e.g. "Level 1 candidates", "All referees"
  description text,
  registration_url text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.training_sessions enable row level security;
drop policy if exists training_public_read on public.training_sessions;
create policy training_public_read on public.training_sessions for select using (published = true or public.is_admin());
drop policy if exists training_admin on public.training_sessions;
create policy training_admin on public.training_sessions for all using (public.is_admin()) with check (public.is_admin());
grant select on public.training_sessions to anon, authenticated;
grant insert, update, delete on public.training_sessions to authenticated;
