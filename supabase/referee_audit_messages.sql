-- Admin tools of October 22, 2026. Run after schema.sql. Safe to re-run.
-- 1. Change history on referee records: who changed what and when (admin, the referee, the hub server, or the database directly).
-- 2. Last sign in per referee for the roster (admins only).
-- 3. Log of messages sent from the roster to referees.

-- ---------------------------------------------------------------
-- 1. Change history
-- ---------------------------------------------------------------
alter table public.referees add column if not exists created_at timestamptz not null default now();
alter table public.referees add column if not exists created_by_label text;
alter table public.referees add column if not exists updated_by uuid;
alter table public.referees add column if not exists updated_by_label text;

create table if not exists public.referee_changes (
  id uuid primary key default gen_random_uuid(),
  referee_id uuid not null references public.referees(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  changed_by_label text not null,   -- e.g. "Thomas Negrel (admin)", "the referee", "Hub server", "Database (SQL editor or import)"
  source text not null,             -- admin | referee | server | database | other
  action text not null,             -- insert | update
  changes jsonb not null default '{}'::jsonb   -- { field: [old, new] }
);
create index if not exists referee_changes_ref on public.referee_changes(referee_id, changed_at desc);
alter table public.referee_changes enable row level security;
drop policy if exists referee_changes_admin on public.referee_changes;
create policy referee_changes_admin on public.referee_changes for select using (public.is_admin());
grant select on public.referee_changes to authenticated;

-- Who is acting, as a label and a source
create or replace function public.actor_info(p_referee_user uuid, out actor uuid, out label text, out source text)
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles%rowtype;
begin
  actor := auth.uid();
  if actor is not null then
    select * into p from public.profiles where id = actor;
    if p_referee_user is not null and actor = p_referee_user then
      label := coalesce(p.full_name, p.email, 'the referee') || ' (the referee)'; source := 'referee';
    elsif p.role = 'admin' then
      label := coalesce(p.full_name, p.email, 'admin') || ' (admin)'; source := 'admin';
    else
      label := coalesce(p.full_name, p.email, 'signed in user') || ' (' || coalesce(p.role::text, 'user') || ')'; source := 'other';
    end if;
  elsif coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) = 'service_role' then
    label := 'Hub server (emails, invitations, imports)'; source := 'server';
  else
    label := 'Database (SQL editor or script)'; source := 'database';
  end if;
end $$;

create or replace function public.referee_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.actor_info(new.user_id);
  if tg_op = 'INSERT' then
    new.created_by_label := coalesce(new.created_by_label, a.label);
  end if;
  new.updated_by := a.actor;
  new.updated_by_label := a.label;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists referee_stamp on public.referees;
create trigger referee_stamp before insert or update on public.referees for each row execute function public.referee_stamp();

create or replace function public.referee_log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record; o jsonb; n jsonb; k text; diff jsonb := '{}'::jsonb;
  skip text[] := array['updated_at','updated_by','updated_by_label','created_at','created_by_label'];
begin
  select * into a from public.actor_info(new.user_id);
  n := to_jsonb(new);
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    for k in select jsonb_object_keys(n) loop
      if not (k = any(skip)) and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
  else
    for k in select jsonb_object_keys(n) loop
      if not (k = any(skip)) and (n -> k) is not null and (n -> k) <> 'null'::jsonb then
        diff := diff || jsonb_build_object(k, jsonb_build_array(null, n -> k));
      end if;
    end loop;
  end if;
  insert into public.referee_changes (referee_id, changed_by, changed_by_label, source, action, changes)
  values (new.id, a.actor, a.label, a.source, lower(tg_op), diff);
  return new;
end $$;
drop trigger if exists referee_log_change on public.referees;
create trigger referee_log_change after insert or update on public.referees for each row execute function public.referee_log_change();

-- ---------------------------------------------------------------
-- 2. Sign in activity (admins only)
-- ---------------------------------------------------------------
create or replace function public.admin_referee_logins()
returns table (referee_id uuid, user_id uuid, first_sign_in_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query
    select r.id, r.user_id, u.created_at, u.last_sign_in_at
    from public.referees r left join auth.users u on u.id = r.user_id;
end $$;
revoke all on function public.admin_referee_logins() from anon, public;
grant execute on function public.admin_referee_logins() to authenticated;

-- ---------------------------------------------------------------
-- 3. Messages from the roster to referees
-- ---------------------------------------------------------------
create table if not exists public.referee_messages (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body text not null,
  referee_ids uuid[] not null default '{}',
  recipients int not null default 0,
  sent int not null default 0,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.referee_messages enable row level security;
drop policy if exists referee_messages_admin on public.referee_messages;
create policy referee_messages_admin on public.referee_messages for all using (public.is_admin()) with check (public.is_admin());
grant select, insert on public.referee_messages to authenticated;
