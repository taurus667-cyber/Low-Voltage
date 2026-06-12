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
API_FOOTBALL_KEY=your-api-football-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
CRON_SECRET=choose-a-long-random-cron-secret
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

For 5-minute live score syncing on Vercel Hobby, add GitHub repository secrets:

```text
LIVE_SYNC_URL=https://your-production-url
CRON_SECRET=the-same-secret-used-in-vercel
```

The GitHub Actions workflow `.github/workflows/sync-live-scores.yml` calls the Vercel sync endpoint every 5 minutes. Vercel cron is not used because Hobby deployments fail for cron schedules that run more than once per day.

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
