create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  api_football_league_id text not null,
  api_football_season text not null,
  timezone text default 'UTC',
  branding_text text,
  is_active boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

insert into public.tournaments (
  slug, name, api_football_league_id, api_football_season, timezone, branding_text, is_active
)
values ('world-cup-2026', 'FIFA World Cup 2026', '1', '2026', 'UTC', 'Private friends group', true)
on conflict (slug) do nothing;

alter table public.players add column if not exists tournament_id uuid references public.tournaments(id);
alter table public.matches add column if not exists tournament_id uuid references public.tournaments(id);
alter table public.predictions add column if not exists tournament_id uuid references public.tournaments(id);
alter table public.matches add column if not exists team_a_source_id text;
alter table public.matches add column if not exists team_b_source_id text;

update public.players set tournament_id = (select id from public.tournaments where is_active = true limit 1) where tournament_id is null;
update public.matches set tournament_id = (select id from public.tournaments where is_active = true limit 1) where tournament_id is null;
-- Leave legacy predictions with null tournament_id. Backfilling locked match
-- predictions would trigger prevent_closed_match_prediction_changes(); the app
-- treats null tournament_id predictions as part of the active tournament.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  provider text not null default 'API-Football',
  provider_team_id text not null,
  name text not null,
  logo_url text,
  country text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(tournament_id, provider, provider_team_id)
);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  provider text not null default 'API-Football',
  provider_fixture_id text,
  event_key text not null,
  team_name text,
  player_name text,
  assist_name text,
  elapsed integer,
  extra_time integer,
  event_type text,
  event_detail text,
  comments text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(match_id, provider, event_key)
);

create table if not exists public.match_statistics (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  provider text not null default 'API-Football',
  team_name text not null,
  statistics jsonb not null default '{}'::jsonb,
  last_synced_at timestamp with time zone,
  unique(match_id, provider, team_name)
);

create table if not exists public.match_lineups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  provider text not null default 'API-Football',
  team_name text not null,
  formation text,
  lineup jsonb not null default '{}'::jsonb,
  last_synced_at timestamp with time zone,
  unique(match_id, provider, team_name)
);

create table if not exists public.match_prediction_aids (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  provider text not null default 'API-Football',
  aid_type text not null,
  title text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamp with time zone,
  unique(match_id, provider, aid_type)
);

create table if not exists public.match_odds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  provider text not null default 'API-Football',
  bookmaker text,
  market text not null,
  home_value text,
  draw_value text,
  away_value text,
  payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamp with time zone,
  unique(match_id, provider, bookmaker, market)
);

drop index if exists idx_players_active_name_unique;
create unique index if not exists idx_players_tournament_active_name_unique
on public.players (tournament_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
where is_active = true;

create index if not exists idx_matches_tournament_id on public.matches (tournament_id);
create index if not exists idx_players_tournament_id on public.players (tournament_id);
create index if not exists idx_predictions_tournament_id on public.predictions (tournament_id);
create index if not exists idx_match_events_match_id on public.match_events (match_id);
create index if not exists idx_match_statistics_match_id on public.match_statistics (match_id);
create index if not exists idx_match_lineups_match_id on public.match_lineups (match_id);
create index if not exists idx_match_prediction_aids_match_id on public.match_prediction_aids (match_id);
create index if not exists idx_match_odds_match_id on public.match_odds (match_id);

drop trigger if exists set_tournaments_updated_at on public.tournaments;
create trigger set_tournaments_updated_at
before update on public.tournaments
for each row execute function public.set_updated_at();

alter table public.tournaments enable row level security;
alter table public.teams enable row level security;
alter table public.match_events enable row level security;
alter table public.match_statistics enable row level security;
alter table public.match_lineups enable row level security;
alter table public.match_prediction_aids enable row level security;
alter table public.match_odds enable row level security;

drop policy if exists "tournaments_select_all" on public.tournaments;
create policy "tournaments_select_all" on public.tournaments for select using (true);
drop policy if exists "teams_select_all" on public.teams;
create policy "teams_select_all" on public.teams for select using (true);
drop policy if exists "match_events_select_all" on public.match_events;
create policy "match_events_select_all" on public.match_events for select using (true);
drop policy if exists "match_statistics_select_all" on public.match_statistics;
create policy "match_statistics_select_all" on public.match_statistics for select using (true);
drop policy if exists "match_lineups_select_all" on public.match_lineups;
create policy "match_lineups_select_all" on public.match_lineups for select using (true);
drop policy if exists "match_prediction_aids_select_all" on public.match_prediction_aids;
create policy "match_prediction_aids_select_all" on public.match_prediction_aids for select using (true);
drop policy if exists "match_odds_select_all" on public.match_odds;
create policy "match_odds_select_all" on public.match_odds for select using (true);
