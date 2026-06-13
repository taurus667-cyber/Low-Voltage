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

create index if not exists idx_player_favorite_teams_player_id
on public.player_favorite_teams (player_id);

alter table public.player_favorite_teams enable row level security;

drop policy if exists "player_favorite_teams_select_all" on public.player_favorite_teams;
create policy "player_favorite_teams_select_all" on public.player_favorite_teams
for select using (true);

drop policy if exists "player_favorite_teams_insert_all" on public.player_favorite_teams;
create policy "player_favorite_teams_insert_all" on public.player_favorite_teams
for insert with check (true);

drop policy if exists "player_favorite_teams_delete_all" on public.player_favorite_teams;
create policy "player_favorite_teams_delete_all" on public.player_favorite_teams
for delete using (true);
