-- Expenses v4 (2026-11-15): only the organizer of the event changes expense claims.
-- The NRC admin sees every claim and receipt but can no longer create, edit, decide, pay or delete one.
-- Claimants (referees, guests) keep their rights on their own claims while they wait for the organizer.
-- An admin who is also the organizer of an event, or a claimant, acts under that role only.

-- 1. Admin: read only on claims
drop policy if exists exp_admin on public.expense_claims;
drop policy if exists exp_admin_read on public.expense_claims;
create policy exp_admin_read on public.expense_claims for select using (public.is_admin());

-- 2. Admin: read only on receipt files (claimants keep full rights on their own folder)
drop policy if exists receipts_own on storage.objects;
create policy receipts_own on storage.objects for all
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists receipts_admin_read on storage.objects;
create policy receipts_admin_read on storage.objects for select using (bucket_id = 'receipts' and public.is_admin());

-- 3. Guard: no NRC bypass any more. Deletes cascading from an assignment removed by the NRC still go through.
create or replace function public.claim_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare is_org boolean; r public.expense_claims;
begin
  r := coalesce(new, old);
  if auth.uid() is null then return coalesce(new, old); end if;   -- service role (functions, SQL editor)
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;   -- cascade from a removed assignment
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
  -- claimant (row level security already limits this to their own claims)
  if old.status <> 'submitted' then raise exception 'This claim has already been decided by the organizer and can no longer be changed.'; end if;
  if tg_op = 'UPDATE' and new.status <> 'submitted' then raise exception 'Only the organizer approves claims.'; end if;
  return coalesce(new, old);
end $$;

-- 4. Decision fields: no NRC bypass
create or replace function public.claim_claimant_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if exists (select 1 from public.assignments a where a.id = new.assignment_id and a.tournament_id in (select public.organizer_tournament_ids())) then return new; end if;
  if tg_op = 'INSERT' then
    new.approved_amount := null; new.payee_snapshot := null; new.payment_request_sent_at := null; new.payment_request_to := null; new.payment_ref := null; new.payment_batch := null; new.paid_via := null;
  elsif new.approved_amount is distinct from old.approved_amount or new.payee_snapshot is distinct from old.payee_snapshot or new.payment_batch is distinct from old.payment_batch then
    raise exception 'Only the organizer sets the decision on a claim.';
  end if;
  return new;
end $$;

-- 5. Food per diems: organizer only
create or replace function public.add_per_diems(p_tournament uuid) returns int language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n int := 0; a record; days int;
begin
  if p_tournament not in (select public.organizer_tournament_ids()) then raise exception 'Only the organizer of the event adds the food per diems.'; end if;
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
