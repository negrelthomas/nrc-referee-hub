# NRC Referee Hub

Web application for the USA Team Handball National Referee Committee: recruit, train, assign and develop referees.
Static site on Netlify, data and auth on Supabase. No build step, no framework.

## Layout

```
site/                      published folder (Netlify publish = site)
  index.html               why referees matter, hub overview, club coverage stats
  become-a-referee.html    certification path (USATH Level 1, 2, 3, NACHC, IHF)
  training.html            quiz (practice, timed), flashcards, progress
  request-referees.html    organizer intake form (writes to tournaments), asks who books travel
  organizer.html           organizer page: progress of each request, designated officials, travel bookings
  referees.html            public list of certified referees (name, level, dates, club; no contact details)
  directory.html           referee directory (signed in)
  login.html               magic link sign in, with a one time code fallback
  guide/                   user guides (index, referees, organizers, admin) with click by click walkthroughs; images in guide/img
  auth.html                exchanges the token from the email link (not consumed by mail scanners)
  profile.html             referee profile, games, evaluations, assignments
  admin/index.html         NRC admin: dashboard, tasks, referees, clubs, requests, questions, imports
  js/config.js             Supabase URL and anon key (fill in)
  js/app.js                shared shell, auth, data helpers
  js/training.js, js/program.js (Level 1 course, baseline assessment, tailored program, re-test), js/admin.js
  data/questions.js        static copy of the question seed (training works without a database)
supabase/
  schema.sql               tables, views, RLS policies, storage buckets, recurring admin task
  seed_clubs.sql           33 USATH clubs (adult and collegiate), from usateamhandball.org
  seed_questions.sql       115 questions from the CalCup deck (76 flashcards, 39 timed)
  seed_questions_ihf.sql   430 questions, IHF Catalogue of Rules Questions, edition 1 July 2025
  seed_demo.sql            optional demo: Halina Lehto, Azadeh Ahmadi, Zeke McClintock with tournament history, evaluations, pair
  seed_mock_referees.sql   optional: five fictional referees (emails @demo.nrc) for reviewing the directory and profiles
  training_sessions.sql    training_sessions table (also included at the end of schema.sql)
  level1_pathway.sql       public referee list view, contact requests, Level 1 course and test, baseline assessment and programs (also in schema.sql)
  staffing_v2.sql          weekend availability, tentative answers, supervisor need, organizer token (also in schema.sql; run its first line alone)
  update_real_referees.sql real emails for the three CalCup referees and the CalCup 2027 respondents
  confirm_and_theory.sql   level_confirmed badge, level1_theory_passed_on, award function records theory passed only
  expenses_reports.sql     bookings by organizers and referees, expense_claims with receipts bucket, tournament_reports, reminder_log, tournament_finance view
  changes.sql              organizer update policy, tournament_changes log, status guard trigger
  clubs_outreach.sql       club_contacts (admin only, seeded from the CalCup 2027 registration list), club_messages log, club_id on tournaments and inquiries, club_affiliation (member, volunteer, none) on inquiries (also in schema.sql)
  evaluator_track.sql      evaluators (referees, club members, NRC), rules exam and video calibration certification, calibration library with hidden NRC reference ratings, IHF observation reports (21 items, one per pair per game) synced to evaluations, weighted rankings; organizers no longer evaluate (run its STEP 0 line alone first)
  organizers_travel.sql    organizer sign in (role organizer for emails that submitted a request), travel_managed_by, travel_bookings, organizer and staffing views
netlify/functions/        daily-reminders.mjs (scheduled, 15:00 UTC), mailer.mjs (Gmail SMTP or Resend), send-invitations.mjs (invite, reminder, confirm, organizer emails), respond.mjs (accept, tentative or decline from the email link), tournament-status.mjs (organizer page data), club-message.mjs (NRC messages to club contacts, one email per contact with the club's figures, test mode to the admin)
netlify.toml, package.json
```

## Setup (one time, about 20 minutes)

1. Supabase: create a project. In the SQL editor run, in this order: `supabase/schema.sql`, `supabase/seed_clubs.sql`, `supabase/seed_questions.sql`, `supabase/seed_questions_ihf.sql`, and optionally `supabase/seed_demo.sql` (demo profiles use placeholder emails ending in @demo.nrc; edit them to real emails to let those referees sign in, or delete the rows later).
2. Supabase > Authentication > URL configuration: set the Site URL to the Netlify URL and add `<netlify url>/**` to the redirect allow list. Authentication > Emails > Magic Link template: link to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink` and include `{{ .Token }}` as a one time code (mail scanners otherwise consume the default link before the user clicks). Optional: custom SMTP later when the sender moves to USATH.
3. Copy Project settings > API > Project URL and anon public key into `site/js/config.js`.
4. Netlify: new site from the GitHub repo, publish directory `site`, no build command. Deploy.
5. Sign in once on the deployed site with negrel.thomas@gmail.com (pre-invited as admin in schema.sql). The nav shows Admin. To add another admin: `insert into public.admin_invites (email) values ('x@y.org');` before they sign in.
6. Admin > Referees > Add referee. Sign in is invitation only: a magic link is only sent to emails that exist on the roster (or in admin_invites). Admin > Clubs to correct city, state and airports.

## Pathways

- Candidates (cert_level candidate): Level 1 online course on the Training page, tab My program. Six modules (study cards, module test), study plan exported as a calendar file, final timed test. A passed final test calls `award_certification`, which records the Level 1 certification and updates the profile. Parameters in `certification_tests` (Admin > Programs).
- Certified referees: at first sign in, a baseline assessment (default 50 questions at their level, 60 minutes). Score at or above the hurdle (default 80%) clears it. Below, a program is built on the rules scored under the threshold, due in 12 weeks by default, with study sessions exported to the referee's calendar, module tests per rule, then a re-test; a failed re-test builds a new program. Parameters in `program_settings` (Admin > Programs). Admin > Programs lists every referee's status; the dashboard counts referees without a baseline and overdue programs.
- Prospects: the Become a referee page has a contact form (table `referee_inquiries`), worked from Admin > Inquiries; "Add to roster" prefills a new candidate.

## Referee profile

Photo, club, home city and state, home airport and usual departure airport, certification with history, compliance dates, tournament history (month and year, sanction USATH / regional / club / international, venue, games officiated), game log, evaluations shared by observers, assignment requests, and training results by rule and by level with the weak rules flagged. Games per tournament are recorded by the NRC on the tournament (Admin > Tournament requests > Open), from the organizer's report, or counted from logged game sheets.

## Roles

- `referee` (default on first sign in): own profile, directory, training progress, own games, shared evaluations, own assignment requests.
- `admin`: everything. Set in `public.profiles.role`.
- `evaluator`: given at first sign in to an email the NRC added as an evaluator with no referee record (club members); lands on evaluator.html. Referees, organizers and admins reach the evaluator page from their own home once on the track.
- `organizer`: given at first sign in to an email that submitted a tournament request; sees organizer.html (own requests, designated officials, bookings). The public form works without an account.

## Clubs and action plan

Admin > Clubs lists every club with referees, certified, in training, open interest, tournament requests and contacts, with filters and multi select to email a group. Each club has a page (`#club/<id>`): contacts, pair program, referees and their training status, contact requests naming the club, its tournament requests, messages already sent, and the actions recommended for it. The dashboard action plan ranks the actions that grow the pool and opens a prepared message for the clubs concerned. Messages go through `/api/club-message`, are logged in `email_log` (kind club) and `club_messages`, and replies go to `CONTACT_EMAIL`.

## Recurring admin task

`admin_tasks` holds a Sport80 import task due every 30 days. It shows at the top of the admin dashboard, turns red when overdue, and resets itself when an import runs. It cannot be dismissed without running the import.

## Transfer to USATH checklist

Domain and DNS, Netlify site ownership, Supabase project ownership (Organization > transfer), auth email sender (custom SMTP on handballusa.org), `CONTACT_EMAIL` in config.js, GitHub repo transfer.

## Assignments (phase 2)

Admin > Tournament requests > Open. Three tabs: Find referees (level filter, local airport first, blocked dates from the referees' availability, season games, established partner), Invitations (draft, send, remind, confirm), Officiated and games (what feeds each referee's history). Referees answer from the email links (respond.html, token based, no sign in) or from their home page. Confirming creates the assignment and emails the confirmation with what the organizer covers.

Email needs these environment variables on Netlify (Site configuration > Environment variables): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project settings > API keys, service role, server only), `GMAIL_USER` and `GMAIL_APP_PASSWORD` (the same Gmail account and app password used for the Supabase auth SMTP), `MAIL_FROM` (e.g. `NRC Referee Hub <negrel.thomas@gmail.com>`), `SITE_URL` (the Netlify URL). `RESEND_API_KEY` works as an alternative transport. Without a transport the admin can still track invitations; the send buttons record the attempt as not sent. Every email is logged in `email_log`. `FEEDBACK_EMAIL` (optional) receives the notes from the Give feedback button on every page; without it they go to `CONTACT_EMAIL`. Notes are also stored in `site_feedback`.

Staffing flow: organizer request (with supervisor need) > Find referees (declared weekend availability first, local flag, pairs) > invitations with accept, tentative, decline and a sign in prompt > confirm (count and pair checks, full brief emailed, assignment created) > Notify organizer (designated list and private page `tournament.html?token=`). Referees declare weekend availability on their home page.

## Phase 3 (evaluations at scale)

Observer accounts, season reports, exports, organizer accounts with their own request list.

## Local preview

Any static server works: `python -m http.server 8765` inside `site/`, then open http://localhost:8765. Without Supabase configured, the training module runs from `data/questions.js`.

## Test identities (October 2026 test run)

Gmail plus addresses on Thomas's inbox, so every email the hub sends can be read: negrel.thomas+candidate (Casey Nguyen, candidate), +referee (Marcus Oyelaran, Level 2), +referee2 (Ingrid Solheim, Level 3), +sam (Sam Prospect, candidate from the contact form), +organizer (Olivia Test, Test Bay Open 2027), +admin (admin invite), +nrc (CONTACT_EMAIL on Netlify, so NRC digests and copies do not reach the real NRC address during testing). Switch CONTACT_EMAIL back to referee@handballusa.org when the NRC takes over.

Supabase email templates: both "Magic link" and "Confirm sign up" must use `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=...` plus `{{ .Token }}`; a first time user receives the sign up template, so the two must match.
