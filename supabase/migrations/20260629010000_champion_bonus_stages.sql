alter table public.champion_winner_picks
add column if not exists stage_key text not null default 'round-of-32',
add column if not exists stage_label text not null default 'Round of 32',
add column if not exists stage_weight numeric not null default 1,
add column if not exists stage_locked_at timestamp with time zone;

update public.champion_winner_picks
set
  stage_key = coalesce(nullif(stage_key, ''), 'round-of-32'),
  stage_label = coalesce(nullif(stage_label, ''), 'Round of 32'),
  stage_weight = coalesce(stage_weight, 1),
  stage_locked_at = coalesce(stage_locked_at, '2026-06-28T19:00:00Z'::timestamptz);

alter table public.champion_winner_picks
drop constraint if exists champion_winner_picks_stage_key_check;

alter table public.champion_winner_picks
add constraint champion_winner_picks_stage_key_check
check (stage_key in ('round-of-32', 'round-of-16', 'quarter-finals', 'semi-finals'));

alter table public.champion_winner_picks
drop constraint if exists champion_winner_picks_stage_weight_check;

alter table public.champion_winner_picks
add constraint champion_winner_picks_stage_weight_check
check (stage_weight in (1, 0.5, 0.25, 0.125));

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
  and coalesce(champion_winner_picks.stage_locked_at, '2026-06-28T19:00:00Z'::timestamptz) > now()
);

drop policy if exists "champion_winner_picks_update_before_lock" on public.champion_winner_picks;
create policy "champion_winner_picks_update_before_lock" on public.champion_winner_picks
for update
using (
  exists (
    select 1 from public.players
    where players.id = champion_winner_picks.player_id
      and players.is_active = true
      and players.tournament_id is not distinct from champion_winner_picks.tournament_id
  )
)
with check (
  exists (
    select 1 from public.players
    where players.id = champion_winner_picks.player_id
      and players.is_active = true
      and players.tournament_id is not distinct from champion_winner_picks.tournament_id
  )
  and coalesce(champion_winner_picks.stage_locked_at, '2026-06-28T19:00:00Z'::timestamptz) > now()
);
