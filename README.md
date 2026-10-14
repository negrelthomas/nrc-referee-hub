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
  login.html               magic link sign in
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
netlify.toml
```

## Setup (one time, about 20 minutes)

1. Supabase: create a project. In the SQL editor run, in this order: `supabase/schema.sql`, `supabase/seed_clubs.sql`, `supabase/seed_questions.sql`, `supabase/seed_questions_ihf.sql`, and optionally `supabase/seed_demo.sql` (demo profiles use placeholder emails ending in @demo.nrc; edit them to real emails to let those referees sign in, or delete the rows later).
2. Supabase > Authentication > URL configuration: set the Site URL to the Netlify URL and add it to the redirect allow list. Email provider: enable magic links (default). Optional: custom SMTP later when the sender moves to USATH.
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

## Phase 2 (assignments) and phase 3 (evaluations at scale)

The tables for assignment requests, assignments, games and evaluations exist and are already used by the admin referee editor (log game, add evaluation). Phase 2 adds: select referees or pairs for a tournament, send invitations by email with accept and decline links (Netlify Function plus Resend), response tracking and reminders. Phase 3 adds: observer accounts, season reports, exports.

## Local preview

Any static server works: `python -m http.server 8765` inside `site/`, then open http://localhost:8765. Without Supabase configured, the training module runs from `data/questions.js`.
