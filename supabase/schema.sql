create extension if not exists pgcrypto;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  api_football_league_id text not null,
  api_football_season text not null,
  timezone text default 'UTC',
  branding_text text,
  is_clone boolean not null default false,
  source_tournament_id uuid references public.tournaments(id) on delete set null,
  parent_tournament_id uuid references public.tournaments(id) on delete set null,
  last_internal_refresh_at timestamp with time zone,
  champion_bonus_lock_at timestamp with time zone default '2026-06-28T19:00:00Z',
  champion_bonus_winner_team_slug text,
  champion_bonus_winner_team_name text,
  is_active boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

insert into public.tournaments (
  slug, name, api_football_league_id, api_football_season, timezone, branding_text, is_active
)
values ('world-cup-2026', 'FIFA World Cup 2026', '1', '2026', 'UTC', 'Private friends group', true)
on conflict (slug) do nothing;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id),
  name text not null,
  player_token text not null unique,
  is_active boolean not null default true,
  deactivated_at timestamp with time zone,
  deactivation_reason text,
  created_at timestamp with time zone default now()
);

alter table public.players add column if not exists is_active boolean not null default true;
alter table public.players add column if not exists deactivated_at timestamp with time zone;
alter table public.players add column if not exists deactivation_reason text;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'players_name_not_blank'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players add constraint players_name_not_blank check (btrim(name) <> '') not valid;
  end if;
end;
$$;
alter table public.players validate constraint players_name_not_blank;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id),
  source_match_id uuid references public.matches(id) on delete set null,
  external_match_id text,
  team_a text not null,
  team_b text not null,
  team_a_source_id text,
  team_b_source_id text,
  kickoff_time timestamp with time zone not null,
  venue text,
  group_name text,
  stage text,
  bracket_round text,
  bracket_slot text,
  bracket_side text,
  winner_to_slot text,
  winner_to_side text,
  loser_to_slot text,
  team_a_score integer check (team_a_score is null or team_a_score >= 0),
  team_b_score integer check (team_b_score is null or team_b_score >= 0),
  status text default 'scheduled' check (status in ('scheduled', 'live', 'finished')),
  is_locked boolean default false,
  is_published boolean default true,
  live_source text,
  live_source_match_id text,
  live_team_a_score integer check (live_team_a_score is null or live_team_a_score >= 0),
  live_team_b_score integer check (live_team_b_score is null or live_team_b_score >= 0),
  live_minute integer check (live_minute is null or live_minute >= 0),
  live_status_note text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.tournaments add column if not exists is_clone boolean not null default false;
alter table public.tournaments add column if not exists source_tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.tournaments add column if not exists parent_tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.tournaments add column if not exists last_internal_refresh_at timestamp with time zone;
alter table public.tournaments add column if not exists champion_bonus_lock_at timestamp with time zone default '2026-06-28T19:00:00Z';
alter table public.tournaments add column if not exists champion_bonus_winner_team_slug text;
alter table public.tournaments add column if not exists champion_bonus_winner_team_name text;
alter table public.matches add column if not exists source_match_id uuid references public.matches(id) on delete set null;
alter table public.matches add column if not exists bracket_round text;
alter table public.matches add column if not exists bracket_slot text;
alter table public.matches add column if not exists bracket_side text;
alter table public.matches add column if not exists winner_to_slot text;
alter table public.matches add column if not exists winner_to_side text;
alter table public.matches add column if not exists loser_to_slot text;
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'matches_external_match_id_key'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches drop constraint matches_external_match_id_key;
  end if;
end;
$$;

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id),
  player_id uuid references public.players(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  predicted_team_a_score integer not null check (predicted_team_a_score >= 0),
  predicted_team_b_score integer not null check (predicted_team_b_score >= 0),
  submitted_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(player_id, match_id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  provider text not null default 'API-Football',
  provider_team_id text not null,
  name text not null,
  slug text,
  logo_url text,
  country text,
  country_code text,
  flag_url text,
  source_url text,
  source_checked_at date,
  profile_payload jsonb not null default '{}'::jsonb,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(tournament_id, provider, provider_team_id)
);

create table if not exists public.player_favorite_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  team_slug text not null,
  team_name text not null,
  country_code text,
  flag_url text,
  created_at timestamp with time zone default now(),
  unique(player_id, team_slug)
);

alter table public.teams add column if not exists slug text;
alter table public.teams add column if not exists country_code text;
alter table public.teams add column if not exists flag_url text;
alter table public.teams add column if not exists source_url text;
alter table public.teams add column if not exists source_checked_at date;
alter table public.teams add column if not exists profile_payload jsonb not null default '{}'::jsonb;

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

create table if not exists public.standings_checks (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete set null,
  tournament_slug text,
  status text not null check (status in ('confirmed', 'mismatch', 'provider_unavailable')),
  app_standings jsonb not null default '[]'::jsonb,
  provider_standings jsonb not null default '[]'::jsonb,
  provider_payload jsonb not null default '[]'::jsonb,
  mismatches jsonb not null default '[]'::jsonb,
  error_message text,
  checked_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

create table if not exists public.champion_winner_picks (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  team_slug text not null,
  team_name text not null,
  team_country_code text,
  team_flag_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(player_id, tournament_id)
);

create table if not exists public.top10_player_codes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{4}$'),
  status_label text not null default 'Top 10',
  awarded_rank integer,
  awarded_points integer,
  awarded_after_match_id uuid references public.matches(id) on delete set null,
  shown_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(player_id)
);

create index if not exists idx_players_name on public.players (lower(name));
create unique index if not exists idx_players_tournament_active_name_unique
on public.players (tournament_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
where is_active = true;
create index if not exists idx_players_tournament_id on public.players (tournament_id);
create index if not exists idx_matches_tournament_id on public.matches (tournament_id);
create index if not exists idx_matches_source_match_id on public.matches (source_match_id);
create unique index if not exists idx_matches_tournament_external_match_id_unique
on public.matches (tournament_id, external_match_id)
where external_match_id is not null;
create unique index if not exists idx_matches_tournament_source_match_id_unique
on public.matches (tournament_id, source_match_id)
where source_match_id is not null;
create index if not exists idx_matches_kickoff_time on public.matches (kickoff_time);
create index if not exists idx_matches_published on public.matches (is_published);
create index if not exists idx_matches_external_match_id on public.matches (external_match_id);
create index if not exists idx_matches_live_source_match_id on public.matches (live_source_match_id);
create index if not exists idx_matches_bracket_round on public.matches (bracket_round);
create index if not exists idx_matches_bracket_slot on public.matches (tournament_id, bracket_slot)
where bracket_slot is not null;
create index if not exists idx_predictions_player_id on public.predictions (player_id);
create index if not exists idx_predictions_match_id on public.predictions (match_id);
create index if not exists idx_predictions_tournament_id on public.predictions (tournament_id);
create index if not exists idx_match_events_match_id on public.match_events (match_id);
create index if not exists idx_match_statistics_match_id on public.match_statistics (match_id);
create index if not exists idx_match_lineups_match_id on public.match_lineups (match_id);
create index if not exists idx_match_prediction_aids_match_id on public.match_prediction_aids (match_id);
create index if not exists idx_match_odds_match_id on public.match_odds (match_id);
create index if not exists idx_teams_slug on public.teams (slug);
create index if not exists idx_player_favorite_teams_player_id on public.player_favorite_teams (player_id);
create index if not exists idx_champion_winner_picks_tournament_id on public.champion_winner_picks (tournament_id);
create index if not exists idx_champion_winner_picks_player_id on public.champion_winner_picks (player_id);
create index if not exists idx_standings_checks_tournament_checked_at on public.standings_checks (tournament_id, checked_at desc);
create index if not exists idx_top10_player_codes_tournament_id on public.top10_player_codes (tournament_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_closed_match_prediction_changes()
returns trigger
language plpgsql
as $$
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role'
    or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.players
    where players.id = new.player_id
      and players.is_active = true
  ) then
    raise exception 'Predictions cannot be changed for inactive players.';
  end if;

  if exists (
    select 1
    from public.matches
    where matches.id = new.match_id
      and (
        matches.is_locked = true
        or matches.kickoff_time <= now()
      )
  ) then
    raise exception 'Predictions cannot be changed after the match is locked or kickoff time has passed.';
  end if;

  return new;
end;
$$;

drop trigger if exists set_matches_updated_at on public.matches;
create trigger set_matches_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

drop trigger if exists set_tournaments_updated_at on public.tournaments;
create trigger set_tournaments_updated_at
before update on public.tournaments
for each row execute function public.set_updated_at();

drop trigger if exists set_predictions_updated_at on public.predictions;
create trigger set_predictions_updated_at
before update on public.predictions
for each row execute function public.set_updated_at();

drop trigger if exists set_champion_winner_picks_updated_at on public.champion_winner_picks;
create trigger set_champion_winner_picks_updated_at
before update on public.champion_winner_picks
for each row execute function public.set_updated_at();

drop trigger if exists prevent_closed_match_prediction_inserts on public.predictions;
create trigger prevent_closed_match_prediction_inserts
before insert on public.predictions
for each row execute function public.prevent_closed_match_prediction_changes();

drop trigger if exists prevent_closed_match_prediction_updates on public.predictions;
create trigger prevent_closed_match_prediction_updates
before update on public.predictions
for each row execute function public.prevent_closed_match_prediction_changes();

alter table public.players enable row level security;
alter table public.tournaments enable row level security;
alter table public.matches enable row level security;
alter table public.predictions enable row level security;
alter table public.teams enable row level security;
alter table public.player_favorite_teams enable row level security;
alter table public.champion_winner_picks enable row level security;
alter table public.match_events enable row level security;
alter table public.match_statistics enable row level security;
alter table public.match_lineups enable row level security;
alter table public.match_prediction_aids enable row level security;
alter table public.match_odds enable row level security;
alter table public.standings_checks enable row level security;
alter table public.top10_player_codes enable row level security;

drop policy if exists "tournaments_select_all" on public.tournaments;
create policy "tournaments_select_all" on public.tournaments for select using (true);

drop policy if exists "top10_player_codes_no_public_select" on public.top10_player_codes;
create policy "top10_player_codes_no_public_select" on public.top10_player_codes for select using (false);

drop policy if exists "players_select_all" on public.players;
create policy "players_select_all" on public.players for select using (true);

drop policy if exists "players_insert_all" on public.players;
create policy "players_insert_all" on public.players for insert with check (true);

drop policy if exists "matches_select_published_or_admin_client" on public.matches;
create policy "matches_select_published_or_admin_client" on public.matches for select using (true);

drop policy if exists "matches_insert_admin_client" on public.matches;
create policy "matches_insert_admin_client" on public.matches for insert with check (true);

drop policy if exists "matches_update_admin_client" on public.matches;
create policy "matches_update_admin_client" on public.matches for update using (true) with check (true);

drop policy if exists "matches_delete_admin_client" on public.matches;
create policy "matches_delete_admin_client" on public.matches for delete using (true);

drop policy if exists "predictions_select_all" on public.predictions;
create policy "predictions_select_all" on public.predictions for select using (true);

drop policy if exists "teams_select_all" on public.teams;
create policy "teams_select_all" on public.teams for select using (true);
drop policy if exists "player_favorite_teams_select_all" on public.player_favorite_teams;
create policy "player_favorite_teams_select_all" on public.player_favorite_teams for select using (true);
drop policy if exists "player_favorite_teams_insert_all" on public.player_favorite_teams;
create policy "player_favorite_teams_insert_all" on public.player_favorite_teams for insert with check (true);
drop policy if exists "player_favorite_teams_delete_all" on public.player_favorite_teams;
create policy "player_favorite_teams_delete_all" on public.player_favorite_teams for delete using (true);

drop policy if exists "champion_winner_picks_select_all" on public.champion_winner_picks;
create policy "champion_winner_picks_select_all" on public.champion_winner_picks for select using (true);
drop policy if exists "champion_winner_picks_insert_before_lock" on public.champion_winner_picks;
create policy "champion_winner_picks_insert_before_lock" on public.champion_winner_picks
for insert
with check (
  exists (
    select 1 from public.players
    where players.id = champion_winner_picks.player_id
      and players.is_active = true
      and players.tournament_id is not distinct from champion_winner_picks.tournament_id
  )
  and
  exists (
    select 1 from public.tournaments
    where tournaments.id is not distinct from champion_winner_picks.tournament_id
      and coalesce(tournaments.champion_bonus_lock_at, '2026-06-28T19:00:00Z'::timestamptz) > now()
  )
);
drop policy if exists "champion_winner_picks_update_before_lock" on public.champion_winner_picks;
create policy "champion_winner_picks_update_before_lock" on public.champion_winner_picks
for update
using (
  exists (
    select 1 from public.tournaments
    where tournaments.id is not distinct from champion_winner_picks.tournament_id
      and coalesce(tournaments.champion_bonus_lock_at, '2026-06-28T19:00:00Z'::timestamptz) > now()
  )
)
with check (
  exists (
    select 1 from public.players
    where players.id = champion_winner_picks.player_id
      and players.is_active = true
      and players.tournament_id is not distinct from champion_winner_picks.tournament_id
  )
  and
  exists (
    select 1 from public.tournaments
    where tournaments.id is not distinct from champion_winner_picks.tournament_id
      and coalesce(tournaments.champion_bonus_lock_at, '2026-06-28T19:00:00Z'::timestamptz) > now()
  )
);
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

drop policy if exists "predictions_insert_before_kickoff" on public.predictions;
create policy "predictions_insert_before_kickoff" on public.predictions
for insert
with check (
  exists (
    select 1 from public.players
    where players.id = predictions.player_id
      and players.is_active = true
  )
  and
  exists (
    select 1 from public.matches
    where matches.id = predictions.match_id
      and matches.is_locked = false
      and matches.kickoff_time > now()
  )
);

drop policy if exists "predictions_update_before_kickoff" on public.predictions;
create policy "predictions_update_before_kickoff" on public.predictions
for update
using (
  exists (
    select 1 from public.matches
    where matches.id = predictions.match_id
      and matches.is_locked = false
      and matches.kickoff_time > now()
  )
)
with check (
  exists (
    select 1 from public.players
    where players.id = predictions.player_id
      and players.is_active = true
  )
  and
  exists (
    select 1 from public.matches
    where matches.id = predictions.match_id
      and matches.is_locked = false
      and matches.kickoff_time > now()
  )
);
