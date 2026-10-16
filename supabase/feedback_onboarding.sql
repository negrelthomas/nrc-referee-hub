-- Site feedback (Give feedback button) and referee onboarding flag. Run after schema.sql. Safe to re-run.
create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  email text,
  role text,
  page text,
  message text not null,
  user_agent text,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.site_feedback enable row level security;
drop policy if exists feedback_admin on public.site_feedback;
create policy feedback_admin on public.site_feedback for all using (public.is_admin()) with check (public.is_admin());
grant select, update on public.site_feedback to authenticated;

-- When the referee finished the welcome tour (null = show it at the next sign in).
alter table public.referees add column if not exists onboarded_at timestamptz;
