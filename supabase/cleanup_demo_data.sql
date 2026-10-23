-- Cleanup of demonstration data left by seed_demo.sql and seed_mock_referees.sql (2026-10-22)
-- Run PART 1 alone first and read the results. Run PART 2 only once the list is confirmed.
-- CalCup 2026 and CalCup 2027 are kept: they are real events.

-- ---------------------------------------------------------------
-- PART 1: preview (read only)
-- ---------------------------------------------------------------
select 'mock referee' as item, last_name || ', ' || first_name as detail, email as extra
  from public.referees where email like '%@demo.nrc'
union all
select 'seed tournament', name, to_char(start_date, 'YYYY-MM-DD') || ' / games logged: ' ||
       (select count(*) from public.games g where g.tournament_id = t.id)
  from public.tournaments t
 where name in ('USATH National Championships 2026','Michael Lipov Memorial 2025','NORCAL Winter League 2025','CalHeat Open 2025','NORCA Championships 2026')
union all
select 'seed evaluation', r.last_name || ', ' || r.first_name, e.evaluator_name || ' on ' || e.evaluated_on
  from public.evaluations e join public.referees r on r.id = e.referee_id
 where e.report_id is null and e.evaluator_name in ('Rafael Marques','Vafa Ahmadiyeh','NACHC observer')
union all
select 'certification to verify', r.last_name || ', ' || r.first_name, c.level || ' on ' || c.obtained_on || ' / ' || coalesce(c.event, '')
  from public.certifications c join public.referees r on r.id = c.referee_id
 where lower(r.email) in ('halina.lehto@gmail.com','azi.ahmadi91@gmail.com','zeekmc05@gmail.com')
order by 1, 2;

-- ---------------------------------------------------------------
-- PART 2: delete (run after PART 1 is confirmed)
-- ---------------------------------------------------------------
-- begin;
-- delete from public.evaluations
--  where report_id is null and evaluator_name in ('Rafael Marques','Vafa Ahmadiyeh','NACHC observer');
-- delete from public.tournaments t
--  where name in ('USATH National Championships 2026','Michael Lipov Memorial 2025','NORCAL Winter League 2025','CalHeat Open 2025','NORCA Championships 2026')
--    and not exists (select 1 from public.games g where g.tournament_id = t.id);
-- delete from public.referees where email like '%@demo.nrc';
-- commit;
