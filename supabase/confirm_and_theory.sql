-- Level confirmation badge and "theory passed" status for the Level 1 online test.
alter table public.referees add column if not exists level_confirmed boolean not null default true;
alter table public.referees add column if not exists level1_theory_passed_on date;

-- The nine CalCup 2027 respondents entered from email: level to be confirmed by the NRC
update public.referees set level_confirmed = false where email in (
 'joe.w.bauer@gmail.com','peterschubertplc@gmail.com','puig.ruiz.josep1@gmail.com','ragusarosario@gmail.com','asangacho@gmail.com',
 'toma.c.ionut@gmail.com','mladenovicmirko@gmail.com','adelavalenzuelabonilla@gmail.com','toraoline09@gmail.com');

drop view if exists public.referee_directory;
create view public.referee_directory as
select r.id, r.first_name, r.last_name, r.cert_level, r.level_confirmed, r.home_state, c.name as club_name,
       coalesce((select min(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as certified_since,
       coalesce((select max(obtained_on) from public.certifications x where x.referee_id = r.id and x.level <> 'candidate'), r.cert_date) as last_certified_on
from public.referees r
left join public.clubs c on c.id = r.club_id
where r.active and r.cert_level <> 'candidate';
grant select on public.referee_directory to anon, authenticated;

-- A passed online test records "theory passed"; the NRC awards Level 1 after the practical part.
create or replace function public.award_certification(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.certification_attempts%rowtype;
  r public.referees%rowtype;
  t public.certification_tests%rowtype;
begin
  select * into a from public.certification_attempts where id = p_attempt_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'attempt not found'); end if;
  select * into t from public.certification_tests where level = a.level;
  if not found or a.pct < t.pass_pct or not a.passed then return jsonb_build_object('ok', false, 'reason', 'not passed'); end if;
  if a.awarded then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into r from public.referees where user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'no referee record'); end if;
  if a.level = 'level_1' then
    update public.referees set level1_theory_passed_on = coalesce(level1_theory_passed_on, current_date), updated_at = now() where id = r.id;
  end if;
  update public.certification_attempts set awarded = true where id = a.id;
  return jsonb_build_object('ok', true, 'level', a.level, 'theory_only', true);
end $$;
grant execute on function public.award_certification(uuid) to authenticated;
