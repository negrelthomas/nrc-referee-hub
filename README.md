# NRC Referee Hub

Web application for the USA Team Handball National Referee Committee: recruit, train, assign and develop referees.
Static site on Netlify, data and auth on Supabase. No build step, no framework.

## Layout

```
site/                      published folder (Netlify publish = site)
  index.html               why referees matter, hub overview, club coverage stats
  become-a-referee.html    certification path (USATH Level 1, 2, 3, NACHC, IHF)
  training.html            quiz (practice, timed), flashcards, progress
  request-referees.html    organizer intake form (writes to tournaments)
  referees.html            public club coverage list
  directory.html           referee directory (signed in)
  login.html               magic link sign in, with a 6 digit code fallback
  auth.html                exchanges the token from the email link (not consumed by mail scanners)
  profile.html             referee profile, games, evaluations, assignments
  admin/index.html         NRC admin: dashboard, tasks, referees, clubs, requests, questions, imports
  js/config.js             Supabase URL and anon key (fill in)
  js/app.js                shared shell, auth, data helpers
  js/training.js, js/admin.js
  data/questions.js        static copy of the question seed (training works without a database)
supabase/
  schema.sql               tables, views, RLS policies, storage buckets, recurring admin task
  seed_clubs.sql           33 USATH clubs (adult and collegiate), from usateamhandball.org
  seed_questions.sql       115 questions from the CalCup deck (76 flashcards, 39 timed)
  seed_questions_ihf.sql   430 questions, IHF Catalogue of Rules Questions, edition 1 July 2025
  seed_demo.sql            optional demo: Halina Lehto, Azadeh Ahmadi, Zeke McClintock with tournament history, evaluations, pair
  seed_mock_referees.sql   optional: five fictional referees (emails @demo.nrc) for reviewing the directory and profiles
  training_sessions.sql    training_sessions table (also included at the end of schema.sql)
netlify/functions/        send-invitations.mjs (invite, reminder, confirm emails), respond.mjs (accept or decline from the email link)
netlify.toml, package.json
```

## Setup (one time, about 20 minutes)

1. Supabase: create a project. In the SQL editor run, in this order: `supabase/schema.sql`, `supabase/seed_clubs.sql`, `supabase/seed_questions.sql`, `supabase/seed_questions_ihf.sql`, and optionally `supabase/seed_demo.sql` (demo profiles use placeholder emails ending in @demo.nrc; edit them to real emails to let those referees sign in, or delete the rows later).
2. Supabase > Authentication > URL configuration: set the Site URL to the Netlify URL and add `<netlify url>/**` to the redirect allow list. Authentication > Emails > Magic Link template: link to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink` and include `{{ .Token }}` as a 6 digit code (mail scanners otherwise consume the default link before the user clicks). Optional: custom SMTP later when the sender moves to USATH.
3. Copy Project settings > API > Project URL and anon public key into `site/js/config.js`.
4. Netlify: new site from the GitHub repo, publish directory `site`, no build command. Deploy.
5. Sign in once on the deployed site with negrel.thomas@gmail.com (pre-invited as admin in schema.sql). The nav shows Admin. To add another admin: `insert into public.admin_invites (email) values ('x@y.org');` before they sign in.
6. Admin > Referees > Add referee. Sign in is invitation only: a magic link is only sent to emails that exist on the roster (or in admin_invites). Admin > Clubs to correct city, state and airports.

## Referee profile

Photo, club, home city and state, home airport and usual departure airport, certification with history, compliance dates, tournament history (month and year, sanction USATH / regional / club / international, venue, games officiated), game log, evaluations shared by observers, assignment requests, and training results by rule and by level with the weak rules flagged. Games per tournament are recorded by the NRC on the tournament (Admin > Tournament requests > Open), from the organizer's report, or counted from logged game sheets.

## Roles

- `referee` (default on first sign in): own profile, directory, training progress, own games, shared evaluations, own assignment requests.
- `admin`: everything. Set in `public.profiles.role`.
- `organizer`: reserved for phase 2 (own tournament requests). The public form works without an account.

## Recurring admin task

`admin_tasks` holds a Sport80 import task due every 30 days. It shows at the top of the admin dashboard, turns red when overdue, and resets itself when an import runs. It cannot be dismissed without running the import.

## Transfer to USATH checklist

Domain and DNS, Netlify site ownership, Supabase project ownership (Organization > transfer), auth email sender (custom SMTP on handballusa.org), `CONTACT_EMAIL` in config.js, GitHub repo transfer.

## Assignments (phase 2)

Admin > Tournament requests > Open. Three tabs: Find referees (level filter, local airport first, blocked dates from the referees' availability, season games, established partner), Invitations (draft, send, remind, confirm), Officiated and games (what feeds each referee's history). Referees answer from the email links (respond.html, token based, no sign in) or from their home page. Confirming creates the assignment and emails the confirmation with what the organizer covers.

Email needs four environment variables on Netlify (Site configuration > Environment variables): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase > Project settings > API, service role, server only), `RESEND_API_KEY` (resend.com, free tier), `MAIL_FROM` (a verified sender on Resend, e.g. `NRC Referee Hub <thomas@calheat.com>` until USATH's domain is verified), `SITE_URL` (the Netlify URL). Without these the admin can still track invitations; the send buttons record the attempt as not sent. Every email is logged in `email_log`.

## Phase 3 (evaluations at scale)

Observer accounts, season reports, exports, organizer accounts with their own request list.

## Local preview

Any static server works: `python -m http.server 8765` inside `site/`, then open http://localhost:8765. Without Supabase configured, the training module runs from `data/questions.js`.
