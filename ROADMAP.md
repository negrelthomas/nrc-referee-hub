# NRC Referee Hub: technical roadmap

Items raised by testers, the NRC or Thomas that are not built yet. Each item records where it came from, what it needs and what it depends on. Items move to the README or the guides once delivered.

Last updated: October 22, 2026 (evening)

## Parked: needs an NRC or USATH decision first

| # | Item | Source | What it would take | Depends on |
|---|------|--------|--------------------|------------|
| 1 | Other technical officials: table officials (timekeeper, scorekeeper), technical delegates, observers | NRC feedback via the hub, Oct 21 | Generalize the referee record into an "official" with one or more functions; a training track and question set per function; staffing requests that ask for table officials and delegates alongside pairs; role filters on the roster and directory | NRC to define certification for each function and who manages them |
| 2 | Beach handball refereeing | NRC feedback via the hub, Oct 21 | Discipline flag on referees, events and certifications; separate beach question bank (IHF Beach Rules of the Game) and beach evaluation sheet; beach events in the calendar (currently excluded on purpose) | NRC decision to include beach; source for beach questions |
| 3 | Referee pay and expenses: games reported per referee, fees, travel costs, per diem, receipts, scheduled payouts (Finnish model: payment twice a month for league games, tax withheld) | Halina Lehto, Oct 21 | Fee schedule per event type; games already logged become the pay basis; per diem rules; payout batches; receipts already stored with expense claims; exports for accounting; W-9 collection and 1099 reporting | USATH finance and legal: referee status (contractor vs employee), federal and state tax treatment, who pays (USATH, organizer, club) |
| 4 | Ranking formula for evaluations | Evaluator track, Oct 21 | Proposal built (summary score, influence, weight by type of match); switch to the NRC's formula once agreed | Joshua to confirm |
| 5 | Validity periods and whether evaluation reports are ever public | Evaluator track, Oct 21 | Parameters already in evaluator_settings | Joshua to confirm |
| 6 | "Invalid scores" item: keep or drop | NRC sheet, Oct 21 | The NRC report form lists 20 items; the instructions define a 21st, Invalid scores, and say it overlaps the others. The hub rates all 21. Dropping it is one switch (active flag on the item) | Joshua to choose |

## Next development items (no decision needed)

| # | Item | Source | Notes |
|---|------|--------|-------|
| 6 | Email when an evaluation report is released or returned | Evaluator track | Reuse mailer.mjs; one email to each referee of the pair, one to the evaluator on return |
| 7 | Admin console load time | Testing | Many queries on load; batch into views or lazy load per section |
| 8 | Calibration library: 5 to 8 reference games rated by the NRC chair | Evaluator track | Needed before any evaluator candidate can certify; content task for Joshua, no code |
| 9 | Dartfish or tagged video review | Evaluator track | Later, once game video is regular |
| 10 | Season reports and exports (referee activity, games, evaluations) | README phase 3 | CSV exports from admin first |
| 11 | Load USATH member data at go live (clubs, referees) | Go live plan | Ask USATH for exports; import through the existing CSV tools |
| 12 | Move CONTACT_EMAIL, SMTP sender and hosting to USATH | Transfer checklist | See README, Transfer to USATH checklist |

## AI assisted reviews (started October 22)

Process agreed by Thomas, to confirm with Joshua: an AI pass logs each game from its video and flags moments; the AI reconciles its log with the official score sheet (only the score is trusted; table officials often miss cards, suspensions, 7 m throws and scorers, so other differences become flags); a certified evaluator reviews the flags and writes the IHF report; the NRC releases it. No human fact check. The AI never rates referees. Referees see the report marked as AI assisted.

| # | Item | Status | Notes |
|---|------|--------|-------|
| 13 | Hub support: AI log on the game, fact check, flags beside the video with Confirm and Dismiss, match facts fill, AI assisted mark, flag statistics | Delivered Oct 22 (run supabase/ai_assist.sql) | See guide/evaluators.html#ai |
| 14 | AI pass pipeline: Gemini API script, game cut in segments, three passes (goals and score, whistles, personal punishments), fixed output format; reads the scanned score sheet, re-runs the goals pass until the score matches, turns other sheet differences into flags; writes the log and flags to the hub | To build | Runs on the Gemini API free tier (allow generativelanguage.googleapis.com in Claude settings, API key from AI Studio). Gate before wider use: score exact, and at least 9 of 10 punishments caught, measured on broadcast games with official IHF or EHF match reports and one CalCup game checked by an evaluator, since CalCup sheets are not reliable for punishments |
| 15 | Better score sheets at CalCup 2027 and NRC events: 7 m throws, timeouts, minute of every card and suspension | Ask organizers | Game 4 of CalCup 2026 had none of these; table officials often miss punishments and scorers, so only the score is used as a reference |
| 16 | A camera that follows the referees, or a second angle, on games used for evaluation | Ask organizers | Single wide camera is the main limit found in testing |
| 17 | Labelled clip library (EHF teaching materials, IHF Rule Interpretation app) as reference examples for the AI pass | Needs access | EHF platform is members only; ask whether the NRC has access |

Test results, October 22: on CalCup 2026 Game 4 (NYC W 16, San Diego W 31) Gemini 3.8 Flash in AI Studio got the score exactly right at high resolution, but caught 1 of 4 personal punishments and a small share of free throws; runs were not consistent. On the Tokyo 2020 men's final broadcast it caught every punishment it reached.

## Delivered from the October 21 feedback

- Referee level hidden from everyone except the NRC and the referee concerned: public Referees page, signed in directory, leaderboard, organizer page, organizer and confirmation emails (NRC feedback).
- Flashcards show the answer options before the card is flipped; the back shows the correct option(s), the explanation and the rule (NRC feedback).
- Club field labelled "No club affiliation" (Halina Lehto).
- Referees can opt in to share their email and phone with other signed in referees in the directory (Halina Lehto).
- Referees see all upcoming tournaments on their weekend availability calendar (Halina Lehto; shipped in the previous commit).
- Referees can no longer change their own level, confirmation or active status through the API (found while making the level change).

## Delivered October 22

- Admin can email all or a selection of referees from the roster (tick boxes, select all shown, test copy to self, one email per referee, logged).
- Roster shows last sign in and last update with its author; filter on sign in status.
- Change history on each referee record: who changed which field, from what to what, and when (admin by name, the referee, the hub server, or the database directly).
- Initial assessment within 7 days of the first sign in: banner with the due date and a direct button on the referee home, reminder email with a direct link every 48 hours until done, due or overdue status on Admin > Programs, overdue referees in the NRC digest.
- Tournament travel can be booked by the officiating referees (reimbursed by the organizer), besides the organizer or the NRC.
- Organizers can declare international pairs they bring themselves (outside the US only, country or federation required); pairs needed is the number the NRC staffs; organizer page, tournament page, admin cards and emails show total, organizer and NRC pairs.
- Test scores private across the site: assessments, tests, programs and quizzes readable only by the referee and admins (verified in the database rules); timed challenge leaderboard now opt in; privacy line on every test and in the guide.
- Staffing: Find referees names who is hidden as unavailable and why, leaves out referees already designated, invites pairs together (partner added automatically with their availability); invitation email names the partner and asks referees with undeclared, tentative or blocked dates to confirm availability; conflict badge on designated referees whose home shows blocked dates.
- Admin override of declared availability for one tournament, with a mandatory reason emailed to the referee, who accepts or reverts (answer page, home alert, NRC notified); referee availability page asks to block only dates they cannot referee at all, shows confirmed tournaments as Assigned and warns before blocking them.
- Admin lists show Last name, First name, sorted by last name. Designated referees without an invitation on the hub can have their acceptance recorded (reason, confirmation email noting it was recorded by the NRC).
- Tournament window reworked: event details grouped and saved automatically per field, update emailed on close (public fields only), sending locks on email buttons with progress messages, change log tab with author, fewer red buttons. Staffing page merged into Tournaments with staffing status filters and counts; event snapshot; one place to enter games.
