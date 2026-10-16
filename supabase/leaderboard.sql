-- Timed challenge leaderboard. Run after schema.sql. Safe to re-run.
-- Points: correct answers in timed sessions of 10 questions or more, per calendar year (the season).
-- Visible to every signed in user (referees and admins); anonymous visitors do not see it.
-- The view runs as its owner, so it reads quiz_attempts across users; it exposes no email or phone.
create or replace view public.quiz_leaderboard as
select r.id as referee_id,
       r.first_name,
       r.last_name,
       r.photo_url,
       r.cert_level,
       r.home_city,
       r.home_state,
       extract(year from a.created_at)::int as season,
       count(*)::int as sessions,
       sum(a.total)::int as questions,
       sum(a.correct)::int as points,
       round(sum(a.correct)::numeric / nullif(sum(a.total), 0) * 100)::int as accuracy,
       max(round(a.correct::numeric / nullif(a.total, 0) * 100))::int as best_pct,
       max(a.created_at) as last_played
from public.quiz_attempts a
join public.referees r on r.user_id = a.user_id
where a.mode = 'timed' and a.total >= 10 and r.active
group by r.id, r.first_name, r.last_name, r.photo_url, r.cert_level, r.home_city, r.home_state, extract(year from a.created_at);
revoke all on public.quiz_leaderboard from anon;
grant select on public.quiz_leaderboard to authenticated;
