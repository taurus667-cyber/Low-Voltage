# Codex Handoff

Use this file when continuing the project from another machine or another Codex thread. It is intentionally more operational than the README.

## Project Snapshot

- App: private FIFA World Cup 2026 prediction app for a WhatsApp group.
- Stack: React 18, Vite, Supabase, Vercel serverless functions, Node test runner, Playwright smoke script.
- Current branch at handoff: `main`.
- Last pushed feature commit before this handoff refresh: `87bf2dc` (`Improve champion bonus round tabs`).
- Recent feature work added clone refresh fixes, targeted insight loading, graphical/grouped match events, provider event dedupe, Leader/Top 10 leaderboard highlighting, My Stats, hidden-from-public-stats accounts, prediction style badges, knockout bracket sync, and staged Champion Bonus picks.
- Current local pending work after `87bf2dc`: Arabic explainer cards were removed from Champion Bonus/Help in `src/main.jsx`; this handoff file is being refreshed. Commit these together if the removal should ship.
- Current local-only noise: `.codex-tools/` is local tooling and should stay untracked. `gcm-diagnose.log`, `preview.err.log`, and `preview.out.log` may appear as untracked local logs and should not be committed unless deliberately needed.
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
- Built-in Codex browser: use `CODEX-BROWSER-RUNBOOK.md` for the known-good in-app browser setup and navigation sequence.

## Important Files

- `CODEX-BROWSER-RUNBOOK.md`: repeatable steps for starting the local app and controlling the built-in Codex browser.
- `src/main.jsx`: main React app, routes, admin UI, match cards, public picks, leaderboard, live match center.
- `src/lib/scoring.js`: final-score leaderboard rules.
- `src/lib/livePoints.js`: live leaderboard and live prediction points.
- `src/lib/playerStats.js`: My Stats KPI, comparison, and nearby leaderboard calculations.
- `src/lib/predictionStyle.js`: player prediction-style classification and style badge metadata.
- `src/lib/bracket.js`: official knockout bracket placeholder model, advancement display, and bracket health checks.
- `src/lib/championBonus.js`: Champion Bonus pool, stage weights, cutoffs, team cards, and leaderboard bonus projection.
- `src/lib/matches.js`: match lock, live, upcoming, played, and status-label rules.
- `src/lib/matchEvents.js`: provider event dedupe, key-event grouping, and goal/card/substitution classification.
- `src/lib/fixtures.js`: CSV/JSON fixture import parsing and normalization.
- `src/lib/tournament.js`: active tournament fallback and row scoping.
- `api/api-football.js`: shared server env, cron auth, API-Football fetch, active tournament lookup, team-name normalization.
- `api/sync-live-scores.js`: Vercel function for live scores, status, events, statistics, and lineups.
- `api/sync-prematch-data.js`: Vercel function for prediction advice, head-to-head, injuries, odds, and team bootstrap.
- `api/admin-sync.js`: admin-triggered combined sync endpoint used by the Admin page.
- `api/sync-bracket-data.js`: API-Football knockout fixture import and bracket placeholder resolution used by Admin Sync bracket/all.
- `api/clone-groups.js`: private group clone creation/refresh and football-data copy logic.
- `api/top10-core.js` and `api/top10-status.js`: Top 10 protection code generation, reveal, and profile-protection checks.
- `scripts/audit-bracket.mjs`: read-only bracket fixture/metadata audit helper.
- `scripts/audit-prediction-blockers.mjs`: read-only duplicate/inactive player prediction blocker audit helper.
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
- `team_favorites`
- `match_events`
- `match_statistics`
- `match_lineups`
- `match_prediction_aids`
- `match_odds`
- `top10_player_codes`
- `champion_winner_picks`

Important behavior:

- Predictions close automatically at kickoff or when `matches.is_locked` is true.
- Database hardening triggers reject inserts/updates after closure in the current schema.
- Players have `is_active`; inactive players lose normal app access and are excluded from public active-player counts and leaderboard ranking.
- Players can also have `hidden_from_public_stats=true`; these accounts stay active and usable but are excluded from public leaderboard, Top 10/Leader public ranking, Submitted by chips, and public stats. My Stats still shows the player's private true stats.
- Matches and predictions can have `tournament_id`; app-side helpers keep older rows visible when no tournament ID exists.
- Knockout matches use nullable bracket metadata on `matches`: `bracket_round`, `bracket_slot`, `bracket_side`, `winner_to_slot`, `winner_to_side`, and `loser_to_slot`.
- Champion Bonus uses `champion_winner_picks` plus tournament-level final champion columns. Staged picks are stored with `stage_key`, `stage_weight`, and `stage_locked_at`.
- Clone tournaments point to an original source tournament with `is_clone`, `source_tournament_id`, and `matches.source_match_id`.
- Clone refresh copies football data and shared tournament settings: teams, matches, events, statistics, lineups, prediction aids, odds, bracket metadata, and Champion Bonus settings/final result. It intentionally preserves clone players, predictions, favorites, and Champion Bonus player picks.
- Football child rows are copied by source `match_id`, not only by `tournament_id`, so legacy insight/odds rows are not skipped.
- Match-detail browser queries fetch events/statistics/lineups/aids/odds by the current tournament's match IDs to avoid Supabase/PostgREST default page limits hiding later rows.
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
4. Confirm `20260615000000_clone_groups.sql` has been applied before using private group clones.
5. Confirm the `top10_player_codes` table exists before relying on protected Top 10/Leader profile codes.
6. Confirm `20260621000000_knockout_bracket_fields.sql` has been applied before using the Bracket page or Sync bracket.
7. Confirm `hidden_from_public_stats` exists on `players` before using the Admin hide/show public stats controls.
8. Confirm `20260627020000_champion_bonus.sql`, `20260628010000_fix_champion_bonus_lock_time.sql`, and `20260629010000_champion_bonus_stages.sql` have been applied before using Champion Bonus.

Champion Bonus cutoff defaults are KSA-facing but stored as UTC:

- Round of 32: `2026-06-28T19:00:00Z` (10:00 PM KSA).
- Round of 16: `2026-07-04T19:00:00Z` (10:00 PM KSA).
- Quarter-finals: `2026-07-09T19:00:00Z` (10:00 PM KSA).
- Semi-finals: `2026-07-14T19:00:00Z` (10:00 PM KSA).

## Vercel Continuation Notes

`vercel.json` configures:

- Vite build output from `dist`.
- SPA rewrites to `index.html`.
- `/api/sync-live-scores` every 5 minutes.
- `/api/sync-prematch-data` every 6 hours.
- `/api/admin-sync` lets the Admin page manually run pre-match, live, bracket, or all syncs. These syncs also refresh linked clones for the active source tournament.
- Sync bracket calls API-Football server-side through `api/sync-bracket-data.js`, updates existing knockout match rows in place, preserves match IDs, and refreshes clones through the admin sync flow.

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
- `ADMIN_PASSWORD` can be used server-side for admin API checks; functions fall back to `VITE_ADMIN_PASSWORD` when needed.
- `TOURNAMENT_SLUG`
- `TOURNAMENT_NAME`
- `TOURNAMENT_TIMEZONE`
- `API_FOOTBALL_LEAGUE_ID`
- `API_FOOTBALL_SEASON`

`SUPABASE_URL` can also be used by server functions; they fall back to `VITE_SUPABASE_URL`.

## Current Product Behavior

- Home uses a guided profile setup flow so players know when they are creating a profile, using an existing profile, adding a last name to a single-name profile, or entering a protected Top 10 code.
- Matches has upcoming/played tabs plus a separate live focus section.
- The browser loads match details by selected tournament match IDs, so large shared databases can still show all odds, insights, events, and recaps for clone groups.
- Predictions are hidden on `/predictions` until the match is locked by kickoff/admin.
- My Stats replaces the old My Code nav item. It shows private player KPIs, nearby leaderboard, prediction style, hidden-public-stats note when relevant, and Top 10 code/status when applicable. `/top10-code` remains available for backward compatibility.
- Bracket renders the official 32-team knockout tree with placeholders until teams are confirmed. It shows concrete teams once provider or admin sync updates the row. Unresolved placeholders stay hidden from prediction cards.
- Champion Bonus lets each active player keep one champion pick per tournament. The current active stage is selectable; earlier stages are read-only history. Changing later replaces the old pick and loses the earlier weight.
- Champion Bonus stage weights are: Round of 32 `1x`, Round of 16 `0.5x`, quarter-finals `0.25x`, semi-finals `0.125x`. Color coding is shared by the stage tabs and winner cards.
- Champion Bonus pool is active public players times the stage weight. Hidden-from-public players can pick privately but do not affect the public pool or public leaderboard bonus.
- Leaderboard ranks by current match-prediction points. Potential Champion Bonus and Projected Total are shown as what-if columns until the admin sets the final champion.
- Admin can create/import/edit/delete matches, publish/unpublish them, lock/unlock them, and enter final scores.
- Admin can manually sync insights, live/recap data, Top 10 status, bracket fixtures, and refresh private group clones from their source tournament.
- Admin shows collapsible sections to keep the long page manageable, plus bracket health and Champion Bonus health/settings panels.
- Admin can hide an account from public stats without deactivating app access, and can show it publicly again.
- Admin can set the final Champion Bonus winner manually after the final.
- Admin can create private group clones. Clones share football data from the source app but keep their own players, picks, favorites, and leaderboard.
- Live scores can temporarily award live points without changing final leaderboard points.
- Pre-match aids and odds are shown as public-friendly Match Insight with item counts, source/updated timestamps, and a favored-team signal when valid match-winner odds exist.
- Played matches show Match Recap with formations, comparison stats, grouped key events, goals, market view, and odds cards.
- Key events are deduped against provider duplicate rows, then grouped by priority: red cards, yellow cards, VAR/reviews, substitutions. Goals remain separate and are deduped even when one provider row is missing assist data.
- Leaderboard rows highlight rank #1 as `Leader` and ranks #2-#10 as `Top 10`. Current Top 10/Leader players can receive protected profile codes. Player rows also show prediction-style badges.
- Prediction styles are family-relative, not personality labels. They use observed picks, favorite signals, family consensus distance excluding the player's own pick, margins, draws, and variance.
- The Help page describes current picks, insights, recaps, Leader/Top 10 status, private group behavior, event grouping, and the staged Champion Bonus rules.

## Known Design And Security Tradeoffs

- Admin password is client-side group protection, not strong auth.
- RLS policies are intentionally open enough for a trusted private game, with database triggers enforcing the critical prediction lock rule.
- API-Football data is cached server-side in Supabase so normal browsing does not call the provider.
- Fixture import upserts by `external_match_id` and does not delete manual edits.
- API-Football knockout data can be partial. The bracket sync imports concrete provider fixtures when available and leaves official placeholders intact until the provider publishes more teams.
- Provider event feeds can include duplicate or conflicting rows. Client-side event helpers dedupe common card, goal, and substitution duplicates for display, but raw provider rows remain in Supabase.
- Top 10 protection is convenience/profile protection for a trusted private game, not strong authentication.
- Champion Bonus is a family-game fairness mechanic, not a FIFA rule. The staged weights are product rules and must stay visible in UI/help copy.

## Good Next Codex Tasks

- Add a small `docs/` folder if the project grows beyond this single handoff.
- Split `src/main.jsx` into route/components modules when future UI work becomes large.
- Add tests around public-pick reveal behavior and admin import edge cases.
- Add more smoke coverage for clone routes, Match Insight odds visibility, grouped key-event display, Leader/Top 10 leaderboard highlighting, Champion Bonus stage switching, and hidden-from-public-stats account behavior.
- Consider a provider-event reconciliation admin report if future duplicate live-feed rows need manual inspection.
- Consider a small admin report for Champion Bonus participation by stage, especially while knockout rounds are being filled manually or from partial provider data.

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
