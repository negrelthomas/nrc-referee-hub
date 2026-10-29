# How to videos and guide screenshots

Everything needed to regenerate the videos of the How to section (`site/guide/videos/`), the data file
(`site/guide/howto-data.js`) and the screenshots of the role guides (`site/guide/media/`, `site/guide/img/`).
Nothing here is deployed: Netlify publishes `site/` only.

The videos run on a local copy of the hub: the real site and Netlify functions, the real Supabase schema
(`supabase/*.sql` in the order of `migrations.txt`) on a local Postgres, and invented people and events
(`seed.sql`). No real referee, level or contact appears. Emails, the receipt reader and exchange rates are
answered locally; nothing leaves the machine.

## Files

- `howto_src.py`: user types, themes, video titles and the common questions. Edit questions here.
- `build_howto.py`: writes `site/guide/howto-data.js` with the real video durations.
- `videos.py`: one function per video (what is clicked, typed, captioned). `rec.py` records them.
- `shots_guide.py`: screenshots for the role guides, same file names as the pages use.
- `server.mjs`: serves `site/`, a small Supabase compatible API over local Postgres, sign in, storage and the functions.
- `seed.sql`: the invented referees, organizer, guests, events, invitations, bookings and claims.
- `build_db.sh`: builds the database (`base` rebuilds the schema after a new migration).

## Regenerate (Linux or the Claude cloud session)

1. Postgres 16 on port 5433 (socket in /tmp), Node 18+, Python 3 with Playwright and Chromium, ffmpeg.
2. `npm install` here, then `./build_db.sh base` and `node server.mjs` (port 8080).
3. `python3 videos.py` records every video into `out/` (or name some: `python3 videos.py r_expense o_pairs`).
4. `python3 build_howto.py`, then copy `out/*.mp4` and `out/*.webp` to `site/guide/videos/`.
5. Screenshots: a second server `DB=hub2 PORT=8081 node server.mjs`, then `python3 shots_guide.py`,
   and copy `gshots/media` and `gshots/img` into `site/guide/`.

When a screen changes, re-record only the videos that show it. A new migration goes at the end of
`migrations.txt`; a demo record it needs goes in `seed.sql`.
