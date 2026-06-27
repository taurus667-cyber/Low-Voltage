alter table public.tournaments add column if not exists champion_bonus_lock_at timestamp with time zone default '2026-06-28T16:00:00Z';
alter table public.tournaments add column if not exists champion_bonus_winner_team_slug text;
alter table public.tournaments add column if not exists champion_bonus_winner_team_name text;

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

create index if not exists idx_champion_winner_picks_tournament_id on public.champion_winner_picks (tournament_id);
create index if not exists idx_champion_winner_picks_player_id on public.champion_winner_picks (player_id);

drop trigger if exists set_champion_winner_picks_updated_at on public.champion_winner_picks;
create trigger set_champion_winner_picks_updated_at
before update on public.champion_winner_picks
for each row execute function public.set_updated_at();

alter table public.champion_winner_picks enable row level security;

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
      and coalesce(tournaments.champion_bonus_lock_at, '2026-06-28T16:00:00Z'::timestamptz) > now()
  )
);

drop policy if exists "champion_winner_picks_update_before_lock" on public.champion_winner_picks;
create policy "champion_winner_picks_update_before_lock" on public.champion_winner_picks
for update
using (
  exists (
    select 1 from public.tournaments
    where tournaments.id is not distinct from champion_winner_picks.tournament_id
      and coalesce(tournaments.champion_bonus_lock_at, '2026-06-28T16:00:00Z'::timestamptz) > now()
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
      and coalesce(tournaments.champion_bonus_lock_at, '2026-06-28T16:00:00Z'::timestamptz) > now()
  )
);
