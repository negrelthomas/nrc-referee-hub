-- Expenses v6: payout accounts already paid to.
--   * payout_known lists the Venmo, PayPal or Zelle handles a club has already paid an official to, with where we know it from.
--     Keyed by the official's email so it works before their first sign in. Written only by this script and by the trigger below.
--   * When a claim is recorded as paid by Venmo, PayPal or Zelle, the handle on the claim is added automatically.
--   * event_payees returns, for each official, which of their current handles were paid before (and from where), so the
--     organizer page and the payment request can say "paid to before" or "new account, confirm before paying".
--   * Loads the CalCup 2026 Zelle accounts of Halina Lehto and Azadeh Ahmadi, and puts Azadeh's on her profile (editable by her).
-- Safe to run more than once.

-- 1. Same rule as the hub server: emails lower case, US phones as their last 10 digits, Venmo without the @
create or replace function public.payout_key(p_method text, p_handle text) returns text language sql immutable as $$
  select case
    when p_handle is null or btrim(p_handle) = '' then null
    when lower(p_method) <> 'venmo' and position('@' in p_handle) > 0 then lower(btrim(p_handle))
    when lower(p_method) <> 'venmo' and length(regexp_replace(p_handle, '\D', '', 'g')) >= 10 then right(regexp_replace(p_handle, '\D', '', 'g'), 10)
    else regexp_replace(lower(btrim(p_handle)), '^@', '')
  end;
$$;

create table if not exists public.payout_known (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  method text not null check (method in ('venmo','paypal','zelle')),
  handle text not null,
  handle_key text not null,
  source text not null,
  added_at timestamptz not null default now(),
  unique (email, method, handle_key)
);
alter table public.payout_known enable row level security;
drop policy if exists payout_known_read on public.payout_known;
create policy payout_known_read on public.payout_known for select
  using (public.is_admin() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
grant select on public.payout_known to authenticated;
revoke insert, update, delete on public.payout_known from authenticated;

-- 2. A payment recorded by Venmo, PayPal or Zelle teaches the hub that account
create or replace function public.claim_paid_learn_payout() returns trigger language plpgsql security definer set search_path = public as $$
declare m text; h text; em text; tname text;
begin
  if new.status = 'reimbursed' and old.status is distinct from 'reimbursed' and new.payee_snapshot is not null then
    m := lower(coalesce(new.paid_method, ''));
    if m in ('venmo','paypal','zelle') then
      h := new.payee_snapshot ->> m;
      if h is not null then
        select coalesce(r.email, g.email), t.name into em, tname
          from public.assignments a
          left join public.referees r on r.id = a.referee_id
          left join public.guest_officials g on g.id = a.guest_official_id
          left join public.tournaments t on t.id = a.tournament_id
          where a.id = new.assignment_id;
        if em is not null then
          insert into public.payout_known (email, method, handle, handle_key, source)
          values (lower(em), m, h, public.payout_key(m, h), 'paid for ' || coalesce(tname, 'an event on the hub'))
          on conflict (email, method, handle_key) do nothing;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_claim_paid_learn_payout on public.expense_claims;
create trigger trg_claim_paid_learn_payout after update of status on public.expense_claims
  for each row execute function public.claim_paid_learn_payout();

-- 3. Organizer view of payees, now with the handles paid to before
drop function if exists public.event_payees(uuid);
create or replace function public.event_payees(p_tournament uuid)
returns table (assignment_id uuid, preferred text, venmo text, paypal text, zelle text, payment_notes text, known jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, p.preferred, p.venmo, p.paypal, p.zelle, g.payment_notes,
    (select jsonb_object_agg(k.method, k.source) from public.payout_known k
      where lower(k.email) = lower(coalesce(r.email, g.email))
        and k.handle_key = public.payout_key(k.method, case k.method when 'venmo' then p.venmo when 'paypal' then p.paypal else p.zelle end))
  from public.assignments a
  left join public.referees r on r.id = a.referee_id
  left join public.guest_officials g on g.id = a.guest_official_id
  left join public.payout_methods p on p.user_id = coalesce(r.user_id, g.user_id)
  where a.tournament_id = p_tournament
    and (public.is_admin() or p_tournament in (select public.organizer_tournament_ids()));
$$;
revoke all on function public.event_payees(uuid) from public;
grant execute on function public.event_payees(uuid) to authenticated;

-- 4. Accounts used for CalCup 2026 (payment requests to the Calheat treasurer, Feb 2026; details given by the referees in Nov 2025)
insert into public.payout_known (email, method, handle, handle_key, source) values
  ('halina.lehto@gmail.com', 'zelle', '+16463739136', public.payout_key('zelle', '+16463739136'), 'CalCup 2026 reimbursement (Zelle of Wilfred Oliver Antwi, given by Halina in Nov 2025)'),
  ('halina.lehto@gmail.com', 'zelle', 'aowilfred@gmail.com', public.payout_key('zelle', 'aowilfred@gmail.com'), 'CalCup 2026 reimbursement (Zelle of Wilfred Oliver Antwi, given by Halina in Nov 2025)'),
  ('azi.ahmadi91@gmail.com', 'zelle', '610-570-0149', public.payout_key('zelle', '610-570-0149'), 'CalCup 2026 reimbursement')
on conflict (email, method, handle_key) do nothing;

-- 5. Azadeh has nothing on her profile yet: put her CalCup 2026 Zelle there. She can change it under How I get paid.
do $$ declare u uuid; begin
  select id into u from auth.users where lower(email) = 'azi.ahmadi91@gmail.com';
  if u is null then
    raise notice 'Azadeh has not signed in yet: the hub will suggest her CalCup 2026 Zelle when she opens How I get paid';
  elsif exists (select 1 from public.payout_methods where user_id = u) then
    raise notice 'Azadeh already has payment details: left unchanged';
  else
    insert into public.payout_methods (user_id, zelle, preferred, updated_at) values (u, '610-570-0149', 'zelle', now());
    insert into public.payout_changes (user_id, before, after, alert_sent_to, alert_sent)
      values (u, null, jsonb_build_object('zelle', '610-570-0149', 'preferred', 'zelle', 'source', 'NRC, from CalCup 2026 records'), null, false);
    raise notice 'Azadeh: CalCup 2026 Zelle added to her profile';
  end if;
end $$;

select 'known payouts v6 applied' as status, (select count(*) from public.payout_known) as known_accounts,
  (select coalesce(pm.zelle, 'no profile row') from auth.users u left join public.payout_methods pm on pm.user_id = u.id where lower(u.email) = 'azi.ahmadi91@gmail.com') as azadeh_zelle_on_profile,
  (select pm.zelle from auth.users u join public.payout_methods pm on pm.user_id = u.id where lower(u.email) = 'halina.lehto@gmail.com') as halina_zelle_on_profile;
