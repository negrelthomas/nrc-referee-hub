-- Change notices (October 27, 2026). Run after tournament_change_log.sql. Safe to re-run.
-- Admins can dismiss pending event changes from the tournament list: the rows are marked handled without any email,
-- and the change log shows them as "not sent (dismissed)".
alter table public.tournament_changes add column if not exists dismissed boolean not null default false;
drop policy if exists tc_admin_update on public.tournament_changes;
create policy tc_admin_update on public.tournament_changes for update using (public.is_admin()) with check (public.is_admin());
grant update (notified_at, dismissed) on public.tournament_changes to authenticated;
