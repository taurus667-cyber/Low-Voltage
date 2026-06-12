create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
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
  external_match_id text unique,
  team_a text not null,
  team_b text not null,
  kickoff_time timestamp with time zone not null,
  venue text,
  group_name text,
  stage text,
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

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  predicted_team_a_score integer not null check (predicted_team_a_score >= 0),
  predicted_team_b_score integer not null check (predicted_team_b_score >= 0),
  submitted_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(player_id, match_id)
);

create index if not exists idx_players_name on public.players (lower(name));
create unique index if not exists idx_players_active_name_unique
on public.players (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
where is_active = true;
create index if not exists idx_matches_kickoff_time on public.matches (kickoff_time);
create index if not exists idx_matches_published on public.matches (is_published);
create index if not exists idx_matches_external_match_id on public.matches (external_match_id);
create index if not exists idx_matches_live_source_match_id on public.matches (live_source_match_id);
create index if not exists idx_predictions_player_id on public.predictions (player_id);
create index if not exists idx_predictions_match_id on public.predictions (match_id);

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

drop trigger if exists set_predictions_updated_at on public.predictions;
create trigger set_predictions_updated_at
before update on public.predictions
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
alter table public.matches enable row level security;
alter table public.predictions enable row level security;

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
