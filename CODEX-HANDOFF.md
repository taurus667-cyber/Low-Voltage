# Codex Handoff

Use this file when continuing the project from another machine or another Codex thread. It is intentionally more operational than the README.

## Project Snapshot

- App: private FIFA World Cup 2026 prediction app for a WhatsApp group.
- Stack: React 18, Vite, Supabase, Vercel serverless functions, Node test runner, Playwright smoke script.
- Current branch at handoff: `main`.
- Last known synced commit: `bcd19ef` (`Show live stats in comparison table`).
- Current local-only noise: `.codex-tools/` is local tooling and should stay untracked.
- Secrets live in `.env`, Supabase, and Vercel environment variables. Do not commit `.env`.

## Start Here On A New Machine

```powershell
git clone <repo-url>
cd "FIFA 2026 LOW VOLTAGE"
npm install
Copy-Item .env.example .env
notepad .env
npm test
npm run build
npm run smoke
```

If the repo is copied as a folder instead of cloned, confirm Git state before editing:

```powershell
git status --short --branch
git log --oneline -n 5
```

## Runtime Commands

- `npm run dev`: Vite dev server on `0.0.0.0`.
- `npm run build`: production build to `dist`.
- `npm test`: unit tests under `src/**/*.test.js` and `api/**/*.test.js`.
- `npm run smoke`: Playwright smoke test, defaults to local dev URL unless `SMOKE_BASE_URL` is set.
- `npm run smoke:prod`: same smoke script, usually run with `SMOKE_BASE_URL=https://...`.

## Important Files

- `src/main.jsx`: main React app, routes, admin UI, match cards, public picks, leaderboard, live match center.
- `src/lib/scoring.js`: final-score leaderboard rules.
- `src/lib/livePoints.js`: live leaderboard and live prediction points.
- `src/lib/matches.js`: match lock, live, upcoming, played, and status-label rules.
- `src/lib/fixtures.js`: CSV/JSON fixture import parsing and normalization.
- `src/lib/tournament.js`: active tournament fallback and row scoping.
- `api/api-football.js`: shared server env, cron auth, API-Football fetch, active tournament lookup, team-name normalization.
- `api/sync-live-scores.js`: Vercel function for live scores, status, events, statistics, and lineups.
- `api/sync-prematch-data.js`: Vercel function for prediction advice, head-to-head, injuries, odds, and team bootstrap.
- `supabase/schema.sql`: full current schema for a fresh Supabase project.
- `supabase/migrations/`: incremental migrations for existing databases.
- `supabase/seed.sql`: initial World Cup 2026 seed data.
- `DEPLOYMENT-CHECKLIST.md`: shortest manual deployment runbook.

## Database State Model

The current schema is tournament-aware. Core tables:

- `tournaments`
- `players`
- `matches`
- `predictions`
- `teams`
- `match_events`
- `match_statistics`
- `match_lineups`
- `match_prediction_aids`
- `match_odds`

Important behavior:

- Predictions close automatically at kickoff or when `matches.is_locked` is true.
- Database hardening triggers reject inserts/updates after closure in the current schema.
- Players have `is_active`; inactive players are excluded from public active-player counts and leaderboard ranking.
- Matches and predictions can have `tournament_id`; app-side helpers keep older rows visible when no tournament ID exists.
- Browser code uses the Supabase anon key only.
- Serverless sync functions use `SUPABASE_SERVICE_ROLE_KEY`; never expose it to frontend code.

## Supabase Continuation Notes

Fresh project:

1. Run `supabase/schema.sql`.
2. Run `supabase/seed.sql`.
3. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` into `.env` and Vercel.
4. Put `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY`, and `CRON_SECRET` into Vercel for sync functions.

Existing project:

1. Prefer `supabase db push` if the CLI is linked.
2. If working manually, run migration SQL files in timestamp order.
3. Confirm `20260613000000_tournament_platform.sql` has been applied before relying on live events, stats, lineups, prediction aids, odds, or reusable tournament support.

## Vercel Continuation Notes

`vercel.json` configures:

- Vite build output from `dist`.
- SPA rewrites to `index.html`.
- `/api/sync-live-scores` every 5 minutes.
- `/api/sync-prematch-data` every 6 hours.

Vercel Hobby does not support the 5-minute cron cadence. Keep that in mind if deployment fails on cron limits.

## Environment Variables

Client-exposed variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ADMIN_PASSWORD`
- `VITE_TOURNAMENT_SLUG`
- `VITE_TOURNAMENT_NAME`
- `VITE_TOURNAMENT_BRANDING`
- `VITE_TOURNAMENT_TIMEZONE`
- `VITE_API_FOOTBALL_LEAGUE_ID`
- `VITE_API_FOOTBALL_SEASON`

Server-only variables:

- `API_FOOTBALL_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `TOURNAMENT_SLUG`
- `TOURNAMENT_NAME`
- `TOURNAMENT_TIMEZONE`
- `API_FOOTBALL_LEAGUE_ID`
- `API_FOOTBALL_SEASON`

`SUPABASE_URL` can also be used by server functions; they fall back to `VITE_SUPABASE_URL`.

## Current Product Behavior

- Home lets users create or reuse a player display name.
- Matches has upcoming/played tabs plus a separate live focus section.
- Predictions are hidden on `/predictions` until the match is locked by kickoff/admin.
- Admin can create/import/edit/delete matches, publish/unpublish them, lock/unlock them, and enter final scores.
- Live scores can temporarily award live points without changing final leaderboard points.
- Pre-match aids are shown as public-friendly insights with source and last-synced timestamps.

## Known Design And Security Tradeoffs

- Admin password is client-side group protection, not strong auth.
- RLS policies are intentionally open enough for a trusted private game, with database triggers enforcing the critical prediction lock rule.
- API-Football data is cached server-side in Supabase so normal browsing does not call the provider.
- Fixture import upserts by `external_match_id` and does not delete manual edits.

## Good Next Codex Tasks

- Add a small `docs/` folder if the project grows beyond this single handoff.
- Split `src/main.jsx` into route/components modules when future UI work becomes large.
- Add tests around public-pick reveal behavior and admin import edge cases.
- Add a manual admin action to trigger sync functions with `CRON_SECRET` for troubleshooting.
- Add a deployment note after the actual production URL and Supabase project ref are finalized.

## Before Handing Off Again

Run:

```powershell
npm test
npm run build
git status --short --branch
git log --oneline -n 5
```

Then update:

- `CHANGELOG.md` with user-visible and operational changes.
- This file's snapshot commit and any changed continuation notes.
- `README.md` only if setup, architecture, or user-facing behavior changed.
