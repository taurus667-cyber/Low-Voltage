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
```

## Environment Variables

Create a `.env` file locally and add the same variables in Vercel:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_ADMIN_PASSWORD=choose-a-private-group-admin-password
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
5. Deploy.

If Vercel CLI is installed and you are logged in:

```bash
vercel
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_ADMIN_PASSWORD
vercel --prod
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

## Admin Flow

1. Open `/admin`.
2. Enter the admin password.
3. Add matches manually or import fixtures.
4. Review matches and publish them.
5. Lock matches manually if needed.
6. Enter final scores and set status to `finished`.
7. Open `/leaderboard` to refresh rankings.

## Sharing

After deployment, share the Vercel URL in WhatsApp. Friends should open `/`, enter their name, then use the Matches and Leaderboard tabs.
