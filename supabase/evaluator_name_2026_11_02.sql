-- Majid's last name confirmed by Thomas (2026-11-02): Kolahdouzan
update public.evaluators
   set last_name = 'Kolahdouzan',
       admin_notes = 'NACHC Referee Chair, NRC member. Added 2026-10-30, last name confirmed 2026-11-02.'
 where lower(email) = 'majid80ref@yahoo.com';

-- Same person on the referee roster, if present
update public.referees
   set last_name = 'Kolahdouzan'
 where lower(email) = 'majid80ref@yahoo.com' and coalesce(last_name, '') = '';

-- Names copied onto reports he already wrote
update public.observation_reports set evaluator_name = 'Majid Kolahdouzan'
 where lower(evaluator_email) = 'majid80ref@yahoo.com' and trim(evaluator_name) = 'Majid';
update public.evaluations set evaluator_name = 'Majid Kolahdouzan'
 where trim(evaluator_name) = 'Majid';

select 'evaluators' as tbl, first_name, last_name, email from public.evaluators where lower(email) = 'majid80ref@yahoo.com'
union all
select 'referees', first_name, last_name, email from public.referees where lower(email) = 'majid80ref@yahoo.com';
