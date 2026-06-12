# Deployment Checklist

Use this file as the shortest path from local folder to live WhatsApp link.

## 1. Install Node.js

Install Node.js LTS from:

https://nodejs.org/

After installation, close and reopen PowerShell, then confirm:

```powershell
node -v
npm -v
```

## 2. Install And Build Locally

From this folder:

```powershell
cd "D:\Dropbox\Codex\Windows\FIFA 2026 LOW VOLTAGE"
npm install
npm run build
npm test
npm run smoke
```

## 3. Create Supabase Project

1. Open https://supabase.com/dashboard/projects
2. Create a new free project.
3. Open SQL Editor.
4. Run `supabase/schema.sql`.
5. Run `supabase/seed.sql`.
6. Open Project Settings > API.
7. Copy:
   - Project URL
   - anon public key

## 4. Create Local .env

Create `.env` in this folder:

```powershell
Copy-Item .env.example .env
notepad .env
```

Paste your real values:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_ADMIN_PASSWORD=choose-a-private-group-admin-password
VITE_TOURNAMENT_SLUG=world-cup-2026
VITE_TOURNAMENT_NAME=FIFA World Cup 2026
VITE_TOURNAMENT_BRANDING=Private friends group
VITE_TOURNAMENT_TIMEZONE=UTC
VITE_API_FOOTBALL_LEAGUE_ID=1
VITE_API_FOOTBALL_SEASON=2026
API_FOOTBALL_KEY=your-api-football-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
CRON_SECRET=choose-a-long-random-cron-secret
TOURNAMENT_SLUG=world-cup-2026
TOURNAMENT_NAME=FIFA World Cup 2026
TOURNAMENT_TIMEZONE=UTC
API_FOOTBALL_LEAGUE_ID=1
API_FOOTBALL_SEASON=2026
```

Then test again:

```powershell
npm run build
npm run dev
```

For live match focus on an existing Supabase database, run:

```powershell
supabase db push
```

Or paste and run `supabase\migrations\20260612000000_live_score_fields.sql` in Supabase SQL Editor.

Also run `supabase\migrations\20260613000000_tournament_platform.sql` for reusable tournament support, pre-match aids, odds, events, statistics, and lineups.

## 5. Deploy To Vercel

Install Vercel CLI:

```powershell
npm install -g vercel
```

Login and deploy:

```powershell
vercel login
vercel
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_ADMIN_PASSWORD
vercel env add VITE_TOURNAMENT_NAME
vercel env add API_FOOTBALL_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add CRON_SECRET
vercel --prod
```

After deployment:

```powershell
$env:SMOKE_BASE_URL="https://your-production-url"
npm run smoke:prod
```

For 5-minute live score syncing, keep the project on Vercel Pro. `vercel.json` runs `/api/sync-live-scores` every 5 minutes and `/api/sync-prematch-data` every 6 hours.

To reuse the app for another competition, create or activate a row in `tournaments` with the API-Football league ID and season, update the tournament env defaults, then import/bootstrap fixtures for that tournament.

When Vercel prints the production URL, share that link in WhatsApp.

## 6. Vercel Website Alternative

If you prefer the website:

1. Push this folder to GitHub.
2. Open https://vercel.com/new
3. Import the repo.
4. Framework preset: Vite.
5. Build command: `npm run build`.
6. Output directory: `dist`.
7. Add the three environment variables.
8. Click Deploy.
