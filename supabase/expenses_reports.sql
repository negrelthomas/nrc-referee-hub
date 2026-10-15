-- Session 3: bookings by organizers and referees, expense claims, post event report, reminders log.

-- Organizers and referees can record bookings on their own assignments (NRC keeps full control)
drop policy if exists travel_organizer_write on public.travel_bookings;
create policy travel_organizer_write on public.travel_bookings for all
  using (assignment_id in (select a.id from public.assignments a join public.tournaments t on t.id = a.tournament_id
         where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))))
  with check (assignment_id in (select a.id from public.assignments a join public.tournaments t on t.id = a.tournament_id
         where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
drop policy if exists travel_referee_write on public.travel_bookings;
create policy travel_referee_write on public.travel_bookings for all
  using (assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()))
  with check (assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()));
alter table public.travel_bookings add column if not exists entered_by text default 'nrc' check (entered_by in ('nrc','organizer','referee'));

-- Expense claims by referees (or entered by the NRC), reviewed by the NRC, reimbursed by the organizer or the NRC
create table if not exists public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  kind text not null check (kind in ('flight','hotel','car','mileage','per_diem','transport','other')),
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  description text,
  receipt_url text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','reimbursed')),
  reimbursed_by text default 'organizer' check (reimbursed_by in ('organizer','nrc')),
  submitted_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.expense_claims enable row level security;
drop policy if exists exp_admin on public.expense_claims;
create policy exp_admin on public.expense_claims for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists exp_referee on public.expense_claims;
create policy exp_referee on public.expense_claims for all
  using (assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()))
  with check (status = 'submitted' and assignment_id in (select a.id from public.assignments a join public.referees r on r.id = a.referee_id where r.user_id = auth.uid()));
drop policy if exists exp_organizer on public.expense_claims;
create policy exp_organizer on public.expense_claims for select
  using (assignment_id in (select a.id from public.assignments a join public.tournaments t on t.id = a.tournament_id
         where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
grant select, insert, update, delete on public.expense_claims to authenticated;

-- Receipts bucket (private; signed URLs)
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
drop policy if exists receipts_own on storage.objects;
create policy receipts_own on storage.objects for all
  using (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text))
  with check (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- Post event report by the organizer
create table if not exists public.tournament_reports (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  games_played int,
  referee_rating smallint check (referee_rating between 1 and 5),
  supervisor_rating smallint check (supervisor_rating between 1 and 5),
  highlights text,
  incidents text,
  would_request_again boolean,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now()
);
alter table public.tournament_reports enable row level security;
drop policy if exists rep_admin on public.tournament_reports;
create policy rep_admin on public.tournament_reports for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists rep_organizer on public.tournament_reports;
create policy rep_organizer on public.tournament_reports for all
  using (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))))
  with check (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
grant select, insert, update on public.tournament_reports to authenticated;
-- organizers may set games officiated per official on their own tournaments
drop policy if exists asg_organizer_update on public.assignments;
create policy asg_organizer_update on public.assignments for update
  using (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))))
  with check (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));
drop policy if exists asg_organizer_read on public.assignments;
create policy asg_organizer_read on public.assignments for select
  using (tournament_id in (select id from public.tournaments t where t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''))));

-- Reminder log (what the daily job sent, to avoid repeats)
create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,           -- invitation | travel | report | program
  target_id uuid not null,      -- request, assignment, tournament or program id
  sent_to text,
  created_at timestamptz not null default now()
);
alter table public.reminder_log enable row level security;
drop policy if exists rl_admin on public.reminder_log;
create policy rl_admin on public.reminder_log for select using (public.is_admin());
grant select on public.reminder_log to authenticated;

-- Financial summary per tournament for the admin and the organizer
drop view if exists public.tournament_finance;
create view public.tournament_finance as
select t.id as tournament_id,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'nrc') as nrc_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'organizer') as organizer_paid_bookings,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'submitted') as claims_submitted,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'approved') as claims_approved,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'reimbursed') as claims_reimbursed
from public.tournaments t
where public.is_admin() or t.organizer_user_id = auth.uid() or lower(t.organizer_email) = lower(coalesce((select email from public.profiles where id = auth.uid()), ''));
grant select on public.tournament_finance to authenticated;
