alter table public.tournaments
alter column champion_bonus_lock_at set default '2026-06-28T19:00:00Z';

update public.tournaments
set champion_bonus_lock_at = '2026-06-28T19:00:00Z'
where champion_bonus_lock_at = '2026-06-28T16:00:00Z';

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
