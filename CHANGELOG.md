# Changelog

This project did not start with a formal changelog, so earlier entries are reconstructed from Git history and current docs.

## 2026-06-13

- Added smarter Matches page polling to reduce automatic refreshes when there are no live or near-kickoff matches.
- Added team flags/logos on match cards, backed by API-Football team data and verified static flag metadata.
- Added clickable nation profile pages at `/nations/:teamSlug`.
- Added app-calculated group standings page at `/groups`.
- Added a daily server-side standings check that records app standings versus API-Football standings.
- Extended Supabase `teams` profile fields for slugs, flag metadata, source notes, and provider payloads.
- Added live statistics to the match comparison table.
- Auto-refresh match data while viewing the live feed.
- Matched live provider fixtures more reliably by normalizing country/team aliases.
- Improved pre-match prediction wording:
  - Explain conflicting prediction signals.
  - Format provider data in plainer English.
  - Use public-friendly insight labels.
  - Make odds easier to read.
  - Show API-Football aid status on match cards.
- Hardened reusable tournament migration to avoid backfilling predictions for locked matches.
- Made the app tolerate pending tournament schema during gradual database rollout.
- Added reusable tournament data platform:
  - `tournaments`
  - `teams`
  - live events/statistics/lineups
  - prediction aids
  - odds
  - tournament-scoped rows
- Adjusted Vercel cron setup after Hobby-plan cron limits.
- Added live match focus and smoke tests.

## 2026-06-12

- Split matches into upcoming and played tabs.
- Showed match prediction participants.
- Added picks participation dashboard.
- Enforced unique active player names.
- Reconciled World Cup fixtures with KSA schedule.
- Synced local project and corrected World Cup fixture time.

## Initial Upload

- Added base private-group prediction app:
  - React/Vite frontend.
  - Supabase schema and seed data.
  - Player registration by display name.
  - Match predictions.
  - Admin match management.
  - Leaderboard scoring.
  - Vercel deployment configuration.
