# NRC Referee Hub: technical roadmap

Items raised by testers, the NRC or Thomas that are not built yet. Each item records where it came from, what it needs and what it depends on. Items move to the README or the guides once delivered.

Last updated: October 21, 2026

## Parked: needs an NRC or USATH decision first

| # | Item | Source | What it would take | Depends on |
|---|------|--------|--------------------|------------|
| 1 | Other technical officials: table officials (timekeeper, scorekeeper), technical delegates, observers | NRC feedback via the hub, Oct 21 | Generalize the referee record into an "official" with one or more functions; a training track and question set per function; staffing requests that ask for table officials and delegates alongside pairs; role filters on the roster and directory | NRC to define certification for each function and who manages them |
| 2 | Beach handball refereeing | NRC feedback via the hub, Oct 21 | Discipline flag on referees, events and certifications; separate beach question bank (IHF Beach Rules of the Game) and beach evaluation sheet; beach events in the calendar (currently excluded on purpose) | NRC decision to include beach; source for beach questions |
| 3 | Referee pay and expenses: games reported per referee, fees, travel costs, per diem, receipts, scheduled payouts (Finnish model: payment twice a month for league games, tax withheld) | Halina Lehto, Oct 21 | Fee schedule per event type; games already logged become the pay basis; per diem rules; payout batches; receipts already stored with expense claims; exports for accounting; W-9 collection and 1099 reporting | USATH finance and legal: referee status (contractor vs employee), federal and state tax treatment, who pays (USATH, organizer, club) |
| 4 | Ranking formula for evaluations | Evaluator track, Oct 21 | Proposal built (summary score, influence, weight by type of match); switch to the NRC's formula once agreed | Joshua to confirm |
| 5 | Validity periods and whether evaluation reports are ever public | Evaluator track, Oct 21 | Parameters already in evaluator_settings | Joshua to confirm |

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

## Delivered from the October 21 feedback

- Referee level hidden from everyone except the NRC and the referee concerned: public Referees page, signed in directory, leaderboard, organizer page, organizer and confirmation emails (NRC feedback).
- Flashcards show the answer options before the card is flipped; the back shows the correct option(s), the explanation and the rule (NRC feedback).
- Club field labelled "No club affiliation" (Halina Lehto).
- Referees can opt in to share their email and phone with other signed in referees in the directory (Halina Lehto).
- Referees see all upcoming tournaments on their weekend availability calendar (Halina Lehto; shipped in the previous commit).
- Referees can no longer change their own level, confirmation or active status through the API (found while making the level change).
