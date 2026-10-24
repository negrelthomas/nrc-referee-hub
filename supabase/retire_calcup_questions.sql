-- Retire the CalCup deck questions (source 'calcup'). Hub questions come only from the IHF Catalogue of Rules Questions.
-- Several CalCup items were wrong under the current IHF rules, e.g. the "referee throw", which no longer exists
-- (Rule 13:4: a game interrupted without an infringement restarts with a free throw; Rule 7:9: play continues when the
-- ball touches a referee). Rows are kept, inactive, so past quiz answers still resolve.
update public.quiz_questions set active = false where source = 'calcup' and active;
select source, active, count(*) from public.quiz_questions group by 1, 2 order by 1, 2;
