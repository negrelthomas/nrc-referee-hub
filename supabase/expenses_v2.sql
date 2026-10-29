-- Expenses v2 (2026-10-29): receipts read automatically, USD at a 30 day average rate, organizer approves and pays.
-- Rules:
--   * Categories: Airfare (flight), Hotel (hotel), Rideshare and taxis (transport), Car rental and related (car),
--     Food per diem (per_diem). Older categories (mileage, other) stay valid for rows already on file.
--   * Every claim except a per diem carries a receipt. The amount stored in "amount" is always USD.
--   * Foreign currency: USD = original amount x the average of the ECB daily reference rates (other central banks for
--     currencies the ECB does not publish) over the 30 calendar days
--     ending on the purchase date (source Frankfurter). The rate, window and source are frozen on the claim.
--   * The organizer of the event approves or declines each claim and marks it paid. The NRC can record a decision
--     on the organizer's behalf; the claim then shows "NRC for the organizer".
--   * Each claim is checked against what the organizer agreed on the request (flights, hotel nights, airport
--     transfers, rental car, food per day): "covered" or "outside the agreement", for the organizer's information.
--   * Payout handles (Venmo, PayPal, Zelle) only. No bank account, routing, IBAN or card numbers on the hub.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- 1. Claim fields
alter table public.expense_claims add column if not exists purchase_date date;
alter table public.expense_claims add column if not exists merchant text;
alter table public.expense_claims add column if not exists amount_original numeric(12,2);
alter table public.expense_claims add column if not exists fx_rate numeric(16,8);          -- USD per one unit of currency
alter table public.expense_claims add column if not exists fx_window_start date;
alter table public.expense_claims add column if not exists fx_window_end date;
alter table public.expense_claims add column if not exists fx_source text;
alter table public.expense_claims add column if not exists nights int check (nights is null or nights between 0 and 60);
alter table public.expense_claims add column if not exists coverage text check (coverage in ('covered','outside'));
alter table public.expense_claims add column if not exists coverage_note text;
alter table public.expense_claims add column if not exists decided_by_role text check (decided_by_role in ('organizer','nrc'));
alter table public.expense_claims add column if not exists paid_method text;
alter table public.expense_claims add column if not exists paid_reference text;
alter table public.expense_claims add column if not exists ai_read jsonb;                  -- what the receipt reader returned
alter table public.expense_claims add column if not exists ai_fields text[];               -- fields the referee kept as read
alter table public.expense_claims add column if not exists claimant_notified_status text;  -- last status emailed to the claimant
update public.expense_claims set amount_original = amount where amount_original is null;
update public.expense_claims set purchase_date = created_at::date where purchase_date is null;
update public.expense_claims set claimant_notified_status = status where claimant_notified_status is null;

-- 2. Coverage check against the event agreement
create or replace function public.claim_coverage() returns trigger language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n_other int; n_total int; pd_other numeric; cap numeric; days int;
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
      if new.nights is not null and n_total > t.hotel_nights_covered then
        new.coverage := 'outside'; new.coverage_note := format('%s nights claimed in total, %s agreed', n_total, t.hotel_nights_covered);
      else
        new.coverage := 'covered'; new.coverage_note := format('%s hotel night(s) agreed', t.hotel_nights_covered);
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
drop trigger if exists expense_claims_coverage on public.expense_claims;
create trigger expense_claims_coverage before insert or update of kind, nights, amount, assignment_id on public.expense_claims
  for each row execute function public.claim_coverage();
update public.expense_claims set kind = kind;   -- fills coverage on rows already on file

-- 3. Who may change what
--    Claimant (referee or guest): edits or deletes only while the claim waits for the organizer.
--    Organizer: decides and pays; cannot change amounts, dates or categories (except deleting a per diem they added).
--    NRC: anything; a decision recorded by the NRC is marked as made for the organizer.
create or replace function public.claim_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare is_org boolean; r public.expense_claims;
begin
  r := coalesce(new, old);
  if auth.uid() is null then return coalesce(new, old); end if;   -- service role (functions, SQL editor)
  if public.is_admin() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','rejected') then
      new.decided_by_role := 'nrc'; new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
    return coalesce(new, old);
  end if;
  select exists (select 1 from public.assignments a where a.id = r.assignment_id and a.tournament_id in (select public.organizer_tournament_ids())) into is_org;
  if is_org then
    if tg_op = 'DELETE' then
      if old.kind = 'per_diem' and old.submitted_by = auth.uid() and old.status = 'submitted' then return old; end if;
      raise exception 'Organizers cannot delete a claim. Decline it instead.';
    end if;
    if new.kind is distinct from old.kind or new.amount is distinct from old.amount or new.amount_original is distinct from old.amount_original
       or new.currency is distinct from old.currency or new.purchase_date is distinct from old.purchase_date or new.receipt_url is distinct from old.receipt_url
       or new.assignment_id is distinct from old.assignment_id or new.fx_rate is distinct from old.fx_rate or new.nights is distinct from old.nights
       or new.submitted_by is distinct from old.submitted_by or new.reimbursed_by is distinct from old.reimbursed_by then
      raise exception 'Organizers decide and pay claims; the amount, date, category and receipt stay as submitted.';
    end if;
    if new.status is distinct from old.status then
      if not ((old.status = 'submitted' and new.status in ('approved','rejected'))
           or (old.status in ('approved','rejected') and new.status = 'submitted')
           or (old.status = 'approved' and new.status = 'reimbursed')
           or (old.status = 'reimbursed' and new.status = 'approved')) then
        raise exception 'This change of status is not possible (% to %).', old.status, new.status;
      end if;
      if new.status in ('approved','rejected') then new.decided_by_role := 'organizer'; new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
      if new.status = 'submitted' then new.decided_by_role := null; new.reviewed_by := null; new.reviewed_at := null; end if;
      if new.status = 'reimbursed' then new.paid_at := coalesce(new.paid_at, now()); end if;
      if old.status = 'reimbursed' then new.paid_at := null; new.paid_method := null; new.paid_reference := null; end if;
    end if;
    return new;
  end if;
  -- claimant
  if old.status <> 'submitted' then raise exception 'This claim has already been decided by the organizer and can no longer be changed.'; end if;
  if tg_op = 'UPDATE' and new.status <> 'submitted' then raise exception 'Only the organizer approves claims.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists expense_claims_guard on public.expense_claims;
create trigger expense_claims_guard before update or delete on public.expense_claims
  for each row execute function public.claim_guard();

-- 4. Organizer rights on claims of their events
drop policy if exists exp_organizer_update on public.expense_claims;
create policy exp_organizer_update on public.expense_claims for update
  using (assignment_id in (select id from public.assignments where tournament_id in (select public.organizer_tournament_ids())))
  with check (assignment_id in (select id from public.assignments where tournament_id in (select public.organizer_tournament_ids())));
drop policy if exists exp_organizer_delete on public.expense_claims;
create policy exp_organizer_delete on public.expense_claims for delete
  using (kind = 'per_diem' and submitted_by = auth.uid()
         and assignment_id in (select id from public.assignments where tournament_id in (select public.organizer_tournament_ids())));

-- 5. Receipts: organizers open the receipts attached to claims on their events
drop policy if exists receipts_organizer_read on storage.objects;
create policy receipts_organizer_read on storage.objects for select
  using (bucket_id = 'receipts' and exists (
    select 1 from public.expense_claims e join public.assignments a on a.id = e.assignment_id
    where e.receipt_url = storage.objects.name and a.tournament_id in (select public.organizer_tournament_ids())));

-- 6. Food per diem: added by the organizer (or the NRC) for every designated official, at the agreed rate x event days.
--    Added as waiting for approval so the organizer confirms each one like any other claim.
create or replace function public.add_per_diems(p_tournament uuid) returns int language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n int := 0; a record; days int;
begin
  if not (public.is_admin() or p_tournament in (select public.organizer_tournament_ids())) then raise exception 'Not your event.'; end if;
  select * into t from public.tournaments where id = p_tournament;
  if coalesce(t.food_stipend_per_day, 0) = 0 then raise exception 'No food per diem is agreed on this event. Edit the request to set one.'; end if;
  days := greatest(1, (t.end_date - t.start_date) + 1);
  for a in select id from public.assignments where tournament_id = p_tournament loop
    if not exists (select 1 from public.expense_claims where assignment_id = a.id and kind = 'per_diem' and status <> 'rejected') then
      insert into public.expense_claims (assignment_id, kind, amount, amount_original, currency, purchase_date, description, status, reimbursed_by, submitted_by)
      values (a.id, 'per_diem', t.food_stipend_per_day * days, t.food_stipend_per_day * days, 'USD', t.start_date,
              format('%s day(s) x $%s', days, t.food_stipend_per_day), 'submitted', 'organizer', auth.uid());
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.add_per_diems(uuid) from public;
grant execute on function public.add_per_diems(uuid) to authenticated;

-- 7. Payout handles, owned by the person (referee or guest). No bank or card numbers.
create table if not exists public.payout_methods (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred text check (preferred in ('venmo','paypal','zelle')),
  venmo text check (venmo is null or (length(venmo) <= 60 and venmo !~ '^[0-9 -]{9,}$')),
  paypal text check (paypal is null or length(paypal) <= 120),
  zelle text check (zelle is null or length(zelle) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.payout_methods enable row level security;
drop policy if exists payout_own on public.payout_methods;
create policy payout_own on public.payout_methods for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists payout_admin_read on public.payout_methods;
create policy payout_admin_read on public.payout_methods for select using (public.is_admin());
grant select, insert, update, delete on public.payout_methods to authenticated;

-- The organizer sees the payout handles of the officials on their event, nothing else
create or replace function public.event_payees(p_tournament uuid)
returns table (assignment_id uuid, preferred text, venmo text, paypal text, zelle text, payment_notes text)
language sql stable security definer set search_path = public as $$
  select a.id, p.preferred, p.venmo, p.paypal, p.zelle, g.payment_notes
  from public.assignments a
  left join public.referees r on r.id = a.referee_id
  left join public.guest_officials g on g.id = a.guest_official_id
  left join public.payout_methods p on p.user_id = coalesce(r.user_id, g.user_id)
  where a.tournament_id = p_tournament
    and (public.is_admin() or p_tournament in (select public.organizer_tournament_ids()));
$$;
revoke all on function public.event_payees(uuid) from public;
grant execute on function public.event_payees(uuid) to authenticated;

-- 8. Finance view: add declined claims; amounts are USD
drop view if exists public.tournament_finance;
create view public.tournament_finance as
select t.id as tournament_id,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'nrc') as nrc_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'organizer') as organizer_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'referee') as referee_paid_bookings,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'submitted') as claims_submitted,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'approved') as claims_approved,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'reimbursed') as claims_reimbursed,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'rejected') as claims_declined
from public.tournaments t
where public.is_admin() or t.id in (select public.organizer_tournament_ids());
grant select on public.tournament_finance to authenticated;
