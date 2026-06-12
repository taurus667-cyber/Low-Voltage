# FIFA World Cup 2026 Predictions

A small private-group prediction app for WhatsApp friends. Everyone opens one shared link, enters a display name, predicts match scores, and checks the leaderboard.

This app uses:

- React + Vite
- Supabase free tier for shared data
- Vercel free tier for hosting
- No paid APIs
- No complex authentication

The admin password is simple private-group protection in the browser. It is useful for a trusted WhatsApp group, but it is not enterprise authentication. Do not put a Supabase service role key in this app.

## Local Commands

```bash
npm install
npm run dev
npm run build
npm test
npm run smoke
```

## Environment Variables

Create a `.env` file locally and add the same variables in Vercel:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_ADMIN_PASSWORD=choose-a-private-group-admin-password
API_FOOTBALL_KEY=your-api-football-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
CRON_SECRET=choose-a-long-random-cron-secret
API_FOOTBALL_LEAGUE_ID=1
API_FOOTBALL_SEASON=2026
```

## Supabase Setup

1. Go to [Supabase](https://supabase.com/) and create a free project.
2. In the project dashboard, open **SQL Editor**.
3. Paste the full contents of `supabase/schema.sql`.
4. Run it.
5. Paste the full contents of `supabase/seed.sql`.
6. Run it.
7. Go to **Project Settings** > **API**.
8. Copy the project URL into `VITE_SUPABASE_URL`.
9. Copy the anon public key into `VITE_SUPABASE_ANON_KEY`.

If you have the Supabase CLI installed and already linked:

```bash
supabase db push
```

If you are not linked yet:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

## Vercel Deployment

1. Push this folder to a Git repository, or import the folder with Vercel CLI.
2. Create a new Vercel project.
3. Use these build settings:
   - Framework preset: Vite
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add these environment variables in **Vercel Project Settings** > **Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_ADMIN_PASSWORD`
   - `API_FOOTBALL_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET`
   - `API_FOOTBALL_LEAGUE_ID`
   - `API_FOOTBALL_SEASON`
5. Deploy.

If Vercel CLI is installed and you are logged in:

```bash
vercel
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_ADMIN_PASSWORD
vercel env add API_FOOTBALL_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add CRON_SECRET
vercel --prod
```

Before deploying live changes:

```bash
npm run build
npm run smoke
SMOKE_BASE_URL=https://your-production-url npm run smoke:prod
```

## Fixture Import

The app does not depend on live APIs during normal browsing. Matches are stored in Supabase.

Admin import supports:

- Public JSON URL
- Pasted JSON
- Pasted CSV

CSV columns:

```csv
match_id,stage,group_name,team_a,team_b,kickoff_time,venue
```

JSON format:

```json
[
  {
    "match_id": "wc2026-001",
    "stage": "Group Stage",
    "group_name": "Group A",
    "team_a": "Team A",
    "team_b": "Team B",
    "kickoff_time": "2026-06-11T19:00:00Z",
    "venue": "Stadium Name"
  }
]
```

Imports upsert by `match_id` / `external_match_id`. They do not delete manually edited matches. Imported fixtures default to unpublished so the admin can review them before publishing.

## Scoring

- Exact score: 3 points
- Correct outcome only: 1 point
- Wrong prediction: 0 points
- Predictions submitted after kickoff or lock are ignored
- Matches without final scores are ignored

## Live Match Focus

The Matches page keeps active matches in a **Live now** section instead of moving them directly to Played after kickoff. A match is live when its status is `live`, or when kickoff has passed and it is still inside the live match window. Predictions still close at kickoff; live focus does not reopen picks.

Live score syncing is handled by the server-only `/api/sync-live-scores` Vercel function. It uses API-Football as a free third-party source, writes cached live status into Supabase, and never exposes the API key or Supabase service role key to browser code.

Vercel Hobby projects only allow cron jobs once per day, so the 5-minute trigger is handled by `.github/workflows/sync-live-scores.yml` or another external scheduler. Add these GitHub repository secrets after the production Vercel URL exists:

```bash
LIVE_SYNC_URL=https://your-production-url
CRON_SECRET=the-same-secret-used-in-vercel
```

Run `supabase/migrations/20260612000000_live_score_fields.sql` before enabling live sync on an existing database.

The source is displayed in the app as third-party data with a last-synced timestamp. Admin score/status edits remain available as the manual override.

## Public Picks

The `/predictions` page shows every player's pick for each match. Picks are hidden until the match is closed by kickoff time or by the admin lock, so players cannot copy each other before the deadline.

For stronger protection, run `supabase/lock-predictions-hardening.sql` once in Supabase SQL Editor. This adds database triggers that reject prediction inserts or edits after kickoff or after the admin lock is turned on.

## Admin Flow

1. Open `/admin`.
2. Enter the admin password.
3. Add matches manually or import fixtures.
4. Review matches and publish them.
5. Lock matches manually if needed.
6. Enter final scores and set status to `finished`.
7. Open `/leaderboard` to refresh rankings.

The manual lock is not the only thing that closes predictions. A match also closes automatically after its kickoff time. If you click Unlock and predictions are still closed, edit the match kickoff time to a future time.

## Sharing

After deployment, share the Vercel URL in WhatsApp. Friends should open `/`, enter their name, then use the Matches and Leaderboard tabs.
