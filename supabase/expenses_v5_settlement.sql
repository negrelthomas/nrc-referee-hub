-- Expenses v5 (2026-11-15): an official with open expense claims cannot be removed from an event until the claims are settled.
-- Open claim: waiting for the organizer (submitted) or approved and not yet paid.
-- Process: the NRC sends the organizer a settlement notice with 15 days to decide and pay on the hub.
-- After the 15 days the NRC can remove the official: the hub first emails the organizer a handover of everything still open
-- (claims, receipts, payout details), the NRC declines any further responsibility, and the claims leave the hub with the assignment.

create table if not exists public.expense_settlements (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,                     -- no foreign key: the record outlives the assignment
  tournament_id uuid references public.tournaments(id) on delete set null,
  official_name text,
  official_email text,
  organizer_email text,
  status text not null default 'notice' check (status in ('notice','closed','settled')),
  notice_sent_at timestamptz,
  notice_count int not null default 0,
  cure_until date not null,
  notice_snapshot jsonb,
  closed_at timestamptz,
  final_sent_at timestamptz,
  final_snapshot jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists expense_settlements_open_key on public.expense_settlements (assignment_id) where status = 'notice';
create index if not exists expense_settlements_tour_idx on public.expense_settlements (tournament_id);
alter table public.expense_settlements enable row level security;
drop policy if exists settle_admin_read on public.expense_settlements;
create policy settle_admin_read on public.expense_settlements for select using (public.is_admin());
drop policy if exists settle_organizer_read on public.expense_settlements;
create policy settle_organizer_read on public.expense_settlements for select using (tournament_id in (select public.organizer_tournament_ids()));
grant select on public.expense_settlements to authenticated;
-- written only by the settlement function (service role)

-- Lock: an assignment with open claims is deleted only once its notice period is over and the handover email went out.
-- Covers every path: Remove, Remove pair, the games tab, a referee withdrawing, and cascades from deleting a referee,
-- a guest official or a whole tournament.
create or replace function public.assignment_settlement_lock() returns trigger language plpgsql security definer set search_path = public as $$
declare n int; total numeric;
begin
  select count(*), coalesce(sum(coalesce(approved_amount, amount)), 0) into n, total
    from public.expense_claims where assignment_id = old.id and status in ('submitted','approved');
  if n = 0 then return old; end if;
  if exists (select 1 from public.expense_settlements s
              where s.assignment_id = old.id and s.status = 'closed' and s.final_sent_at is not null) then
    return old;
  end if;
  raise exception 'OPEN_CLAIMS: this official has % open expense claim(s), $%, on this event. Settle them first: from Designated and travel, Remove sends the organizer a notice with 15 days to settle.', n, to_char(total, 'FM999990.00')
    using errcode = 'P0001';
end $$;
drop trigger if exists assignments_settlement_lock on public.assignments;
create trigger assignments_settlement_lock before delete on public.assignments
  for each row execute function public.assignment_settlement_lock();

-- When the last open claim of an official under notice is decided or paid, the notice is marked settled
create or replace function public.settlement_auto_close() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('rejected','reimbursed') and old.status is distinct from new.status
     and not exists (select 1 from public.expense_claims where assignment_id = new.assignment_id and status in ('submitted','approved') and id <> new.id) then
    update public.expense_settlements set status = 'settled', closed_at = now() where assignment_id = new.assignment_id and status = 'notice';
  end if;
  return new;
end $$;
drop trigger if exists expense_claims_settlement on public.expense_claims;
create trigger expense_claims_settlement after update on public.expense_claims
  for each row execute function public.settlement_auto_close();
