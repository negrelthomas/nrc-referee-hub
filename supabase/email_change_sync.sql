-- A referee changes their own email from My profile (Supabase secure email change: both addresses confirm).
-- When the sign in email changes, copy it to the profile and the referee record so the NRC sees the new address
-- and every hub email goes there. Skipped for the referee record if another referee already uses that address.
create or replace function public.sync_user_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
    if not exists (select 1 from public.referees where lower(email) = lower(new.email) and user_id is distinct from new.id) then
      update public.referees set email = lower(new.email), updated_at = now() where user_id = new.id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute procedure public.sync_user_email();
