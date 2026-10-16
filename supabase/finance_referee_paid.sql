-- Finance view: add bookings paid by referees (to be reimbursed)
drop view if exists public.tournament_finance;
create view public.tournament_finance as
select t.id as tournament_id,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'nrc') as nrc_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'organizer') as organizer_paid_bookings,
       (select coalesce(sum(b.cost),0) from public.travel_bookings b join public.assignments a on a.id = b.assignment_id where a.tournament_id = t.id and b.status = 'booked' and b.paid_by = 'referee') as referee_paid_bookings,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'submitted') as claims_submitted,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'approved') as claims_approved,
       (select coalesce(sum(e.amount),0) from public.expense_claims e join public.assignments a on a.id = e.assignment_id where a.tournament_id = t.id and e.status = 'reimbursed') as claims_reimbursed
from public.tournaments t
where public.is_admin() or t.id in (select public.organizer_tournament_ids());
grant select on public.tournament_finance to authenticated;
