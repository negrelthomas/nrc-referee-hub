-- Expenses v3 (2026-11-10): partial approval, payment request to the club, mark paid link, payment batches,
-- shared expenses, payout details changed only through the hub server (with an alert), fully loaded hotel rate.
-- Rules:
--   * The organizer approves the full amount or a lower amount. A lower amount needs a reason the official sees.
--   * When a claim is approved, the official's payout handle is copied onto the claim. A later change of handle does
--     not redirect a payment already requested.
--   * On approval the hub emails the club's payment address (or the organizer) the amount to pay and the handle,
--     with a copy to the official, unless the organizer chose to send payment requests by hand.
--   * The email carries a single use "mark as paid" link, valid 30 days, so the treasurer needs no login.
--   * A shared expense (car, rideshare, hotel room) is claimed in full by whoever paid, tagged with the others.
--   * Hotel: the organizer agrees a fully loaded cost per night (all taxes and fees). A hotel receipt above that
--     rate x nights is flagged outside the agreement.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- 1. Claims
alter table public.expense_claims add column if not exists approved_amount numeric(10,2);
alter table public.expense_claims drop constraint if exists expense_claims_approved_amount_chk;
alter table public.expense_claims add constraint expense_claims_approved_amount_chk check (approved_amount is null or (approved_amount > 0 and approved_amount <= amount));
alter table public.expense_claims add column if not exists shared_with uuid[];              -- assignment ids of the officials the expense covers too
alter table public.expense_claims add column if not exists payee_snapshot jsonb;            -- payout handle at approval
alter table public.expense_claims add column if not exists payment_request_sent_at timestamptz;
alter table public.expense_claims add column if not exists payment_request_to text;
alter table public.expense_claims add column if not exists payment_ref text;                -- reference to put in the payment memo
alter table public.expense_claims add column if not exists payment_batch text;              -- set when exported in "payments to make"
alter table public.expense_claims add column if not exists paid_via text check (paid_via is null or paid_via in ('hub','link'));

-- 2. Tournaments
alter table public.tournaments add column if not exists payment_email text;
alter table public.tournaments add column if not exists payment_requests_auto boolean not null default true;
alter table public.tournaments add column if not exists hotel_rate_per_night numeric(10,2) check (hotel_rate_per_night is null or hotel_rate_per_night >= 0);
alter table public.tournaments add column if not exists hotel_rate_confirmed_at timestamptz;

-- 3. Hotel coverage: nights and fully loaded rate
create or replace function public.claim_coverage() returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n_other int; n_total int; pd_other numeric; cap numeric; days int; n_use int;
begin
  select tt.* into t from public.tournaments tt join public.assignments a on a.tournament_id = tt.id where a.id = new.assignment_id;
  if t.id is null then return new; end if;
  days := greatest(1, (t.end_date - t.start_date) + 1);
  if new.kind = 'flight' then
    if coalesce(t.flights_covered, false) then new.coverage := 'covered'; new.coverage_note := 'Flights are covered';
    else new.coverage := 'outside'; new.coverage_note := 'Flights are not covered for this event'; end if;
  elsif new.kind = 'hotel' then
    if coalesce(t.hotel_booked_by, '') = 'none' or coalesce(t.hotel_nights_covered, 0) = 0 then
      new.coverage := 'outside'; new.coverage_note := 'No hotel nights agreed for this event';
    else
      select coalesce(sum(nights), 0) into n_other from public.expense_claims
       where assignment_id = new.assignment_id and kind = 'hotel' and status <> 'rejected' and id <> new.id;
      n_total := n_other + coalesce(new.nights, 0);
      n_use := coalesce(nullif(new.nights, 0), t.hotel_nights_covered);
      if new.nights is not null and n_total > t.hotel_nights_covered then
        new.coverage := 'outside'; new.coverage_note := format('%s nights claimed in total, %s agreed', n_total, t.hotel_nights_covered);
      elsif coalesce(t.hotel_rate_per_night, 0) > 0 and new.amount > t.hotel_rate_per_night * n_use + 0.5 then
        new.coverage := 'outside'; new.coverage_note := format('$%s for %s night(s), above the agreed $%s per night all taxes and fees included ($%s)', new.amount, n_use, t.hotel_rate_per_night, t.hotel_rate_per_night * n_use);
      else
        new.coverage := 'covered'; new.coverage_note := format('%s hotel night(s) agreed', t.hotel_nights_covered) || case when coalesce(t.hotel_rate_per_night, 0) > 0 then format(' at up to $%s per night all included', t.hotel_rate_per_night) else '' end;
      end if;
    end if;
  elsif new.kind = 'transport' then
    if coalesce(t.airport_transfers_covered, false) then new.coverage := 'covered'; new.coverage_note := 'Airport transfers are covered';
    else new.coverage := 'outside'; new.coverage_note := 'Airport transfers are not covered' || coalesce('; hotel to venue: ' || t.hotel_to_venue_transport, ''); end if;
  elsif new.kind = 'car' then
    if coalesce(t.car_booked_by, 'none') <> 'none' then new.coverage := 'covered'; new.coverage_note := 'Rental car agreed for this event';
    else new.coverage := 'outside'; new.coverage_note := 'No rental car agreed for this event'; end if;
  elsif new.kind = 'per_diem' then
    if coalesce(t.food_stipend_per_day, 0) = 0 then
      new.coverage := 'outside'; new.coverage_note := 'No food per diem agreed for this event';
    else
      cap := t.food_stipend_per_day * days;
      select coalesce(sum(amount), 0) into pd_other from public.expense_claims
       where assignment_id = new.assignment_id and kind = 'per_diem' and status <> 'rejected' and id <> new.id;
      if pd_other + new.amount > cap then new.coverage := 'outside'; new.coverage_note := format('Above the agreed $%s per day x %s day(s) = $%s', t.food_stipend_per_day, days, cap);
      else new.coverage := 'covered'; new.coverage_note := format('$%s per day x %s day(s) agreed', t.food_stipend_per_day, days); end if;
    end if;
  else
    new.coverage := 'outside'; new.coverage_note := 'Category not in the agreement';
  end if;
  return new;
end $$;

-- 4. Approval rules on top of the existing guard (runs after it: triggers fire in name order)
create or replace function public.claim_payment_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid; pm public.payout_methods; notes text;
begin
  -- back to decide: the decision and everything attached to it is cleared
  if new.status = 'submitted' and old.status <> 'submitted' then
    new.approved_amount := null; new.payee_snapshot := null; new.payment_request_sent_at := null; new.payment_request_to := null;
    new.payment_ref := null; new.payment_batch := null;
    return new;
  end if;
  if new.approved_amount is distinct from old.approved_amount then
    if new.status <> 'approved' then raise exception 'The approved amount is set when the claim is approved.'; end if;
    if old.status = 'approved' and old.payment_request_sent_at is not null then
      raise exception 'The payment request for this claim has already been sent. Undo the approval to change the amount.';
    end if;
  end if;
  if new.approved_amount is not null and new.approved_amount >= new.amount then new.approved_amount := null; end if;
  if new.approved_amount is not null and coalesce(btrim(new.review_note), '') = '' then
    raise exception 'Give the reason for approving less than claimed. The official sees it.';
  end if;
  -- approval: copy the payout handle onto the claim
  if new.status = 'approved' and old.status = 'submitted' then
    select coalesce(r.user_id, g.user_id), g.payment_notes into uid, notes
      from public.assignments a left join public.referees r on r.id = a.referee_id left join public.guest_officials g on g.id = a.guest_official_id
     where a.id = new.assignment_id;
    select * into pm from public.payout_methods where user_id = uid;
    new.payee_snapshot := jsonb_strip_nulls(jsonb_build_object('preferred', pm.preferred, 'venmo', pm.venmo, 'paypal', pm.paypal, 'zelle', pm.zelle, 'notes', notes, 'taken_at', now()));
  end if;
  if new.status = 'reimbursed' and old.status <> 'reimbursed' and new.paid_via is null then new.paid_via := 'hub'; end if;
  if old.status = 'reimbursed' and new.status <> 'reimbursed' then new.paid_via := null; end if;
  return new;
end $$;
drop trigger if exists expense_claims_zpayment on public.expense_claims;
create trigger expense_claims_zpayment before update on public.expense_claims
  for each row execute function public.claim_payment_rules();

-- the claimant cannot touch decision fields while the claim waits
create or replace function public.claim_claimant_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if exists (select 1 from public.assignments a where a.id = new.assignment_id and a.tournament_id in (select public.organizer_tournament_ids())) then return new; end if;
  if tg_op = 'INSERT' then
    new.approved_amount := null; new.payee_snapshot := null; new.payment_request_sent_at := null; new.payment_request_to := null; new.payment_ref := null; new.payment_batch := null; new.paid_via := null;
  elsif new.approved_amount is distinct from old.approved_amount or new.payee_snapshot is distinct from old.payee_snapshot or new.payment_batch is distinct from old.payment_batch then
    raise exception 'Only the organizer sets the decision on a claim.';
  end if;
  return new;
end $$;
drop trigger if exists expense_claims_claimant_fields on public.expense_claims;
create trigger expense_claims_claimant_fields before insert or update on public.expense_claims
  for each row execute function public.claim_claimant_fields();

-- 5. Officials on the same event, for "shared with" (names only)
create or replace function public.event_colleagues(p_assignment uuid)
returns table (assignment_id uuid, name text)
language sql stable security definer set search_path = public as $$
  with mine as (select a.tournament_id from public.assignments a
                  left join public.referees r on r.id = a.referee_id left join public.guest_officials g on g.id = a.guest_official_id
                 where a.id = p_assignment
                   and (public.is_admin() or r.user_id = auth.uid() or g.user_id = auth.uid() or a.tournament_id in (select public.organizer_tournament_ids())))
  select a.id, coalesce(r.last_name || ', ' || r.first_name, g.last_name || ', ' || g.first_name)
    from public.assignments a join mine m on m.tournament_id = a.tournament_id
    left join public.referees r on r.id = a.referee_id left join public.guest_officials g on g.id = a.guest_official_id
   where a.id <> p_assignment
   order by 2;
$$;
revoke all on function public.event_colleagues(uuid) from public;
grant execute on function public.event_colleagues(uuid) to authenticated;

-- 6. Mark as paid links (server only)
create table if not exists public.pay_links (
  token text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  claim_ids uuid[] not null,
  amount numeric(10,2) not null,
  sent_to text,
  expires_at timestamptz not null default now() + interval '30 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.pay_links enable row level security;

-- 7. Payout handles: saved only through the hub server, which emails the person on every change
drop policy if exists payout_own on public.payout_methods;
drop policy if exists payout_own_read on public.payout_methods;
create policy payout_own_read on public.payout_methods for select using (user_id = auth.uid());
drop policy if exists payout_own_delete on public.payout_methods;
create policy payout_own_delete on public.payout_methods for delete using (user_id = auth.uid());
revoke insert, update on public.payout_methods from authenticated;
create table if not exists public.payout_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  before jsonb, after jsonb,
  alert_sent_to text, alert_sent boolean,
  created_at timestamptz not null default now()
);
alter table public.payout_changes enable row level security;
drop policy if exists payout_changes_read on public.payout_changes;
create policy payout_changes_read on public.payout_changes for select using (user_id = auth.uid() or public.is_admin());
grant select on public.payout_changes to authenticated;

-- 8. Finance view: approved and paid at the approved amount
drop view if exists public.tournament_finance;
create view public.tournament_finance as
select t.id as tournament_id,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'nrc') as nrc_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'organizer') as organizer_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'referee') as referee_paid_bookings,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'submitted') as claims_submitted,
       (select coalesce(sum(coalesce(e.approved_amount, e.amount)),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'approved') as claims_approved,
       (select coalesce(sum(coalesce(e.approved_amount, e.amount)),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'reimbursed') as claims_reimbursed,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'rejected') as claims_declined
from public.tournaments t
where public.is_admin() or t.id in (select public.organizer_tournament_ids());
grant select on public.tournament_finance to authenticated;
