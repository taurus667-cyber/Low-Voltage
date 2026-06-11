-- Deactivate duplicate player accounts and enforce unique active player names.
--
-- Duplicate identity is lower(regexp_replace(btrim(name), '\s+', ' ', 'g')).
-- Winner rule:
--   1. Highest number of predictions stays active.
--   2. If tied, the oldest created_at stays active.
--   3. If still tied, the lowest UUID text value stays active.
--
-- Predictions are not moved or deleted. Inactive accounts remain available for
-- audit, but the app ignores inactive players in the leaderboard.

begin;

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

-- Before report: duplicate active names.
select
  lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as name_key,
  count(*) as active_player_count
from public.players
where is_active = true
group by lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
having count(*) > 1
order by active_player_count desc, name_key;

create table if not exists public.player_duplicate_cleanup_players_backup_20260612 as
select
  now() as backed_up_at,
  p.*
from public.players p
where false;

create table if not exists public.player_duplicate_cleanup_predictions_backup_20260612 as
select
  now() as backed_up_at,
  pr.*
from public.predictions pr
where false;

with prediction_counts as (
  select
    p.id,
    lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) as name_key,
    count(pr.id) as prediction_count
  from public.players p
  left join public.predictions pr on pr.player_id = p.id
  where p.is_active = true
  group by p.id, lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
),
duplicate_name_keys as (
  select name_key
  from prediction_counts
  group by name_key
  having count(*) > 1
),
duplicate_players as (
  select p.*
  from public.players p
  join duplicate_name_keys d
    on d.name_key = lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
  where p.is_active = true
)
insert into public.player_duplicate_cleanup_players_backup_20260612
select now(), duplicate_players.*
from duplicate_players;

with prediction_counts as (
  select
    p.id,
    lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) as name_key
  from public.players p
  where p.is_active = true
),
duplicate_name_keys as (
  select name_key
  from prediction_counts
  group by name_key
  having count(*) > 1
),
duplicate_players as (
  select p.id
  from public.players p
  join duplicate_name_keys d
    on d.name_key = lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
  where p.is_active = true
)
insert into public.player_duplicate_cleanup_predictions_backup_20260612
select now(), pr.*
from public.predictions pr
join duplicate_players dp on dp.id = pr.player_id;

-- Show the selected winner and deactivation candidates before mutation.
with prediction_counts as (
  select
    p.id,
    p.name,
    p.created_at,
    lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) as name_key,
    count(pr.id) as prediction_count
  from public.players p
  left join public.predictions pr on pr.player_id = p.id
  where p.is_active = true
  group by p.id, p.name, p.created_at, lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
),
ranked as (
  select
    *,
    row_number() over (
      partition by name_key
      order by prediction_count desc, created_at asc, id::text asc
    ) as duplicate_rank
  from prediction_counts
),
duplicate_groups as (
  select name_key
  from ranked
  group by name_key
  having count(*) > 1
)
select
  r.name_key,
  r.id as player_id,
  r.name,
  r.prediction_count,
  r.created_at,
  case when r.duplicate_rank = 1 then 'keep_active' else 'deactivate' end as action
from ranked r
join duplicate_groups d on d.name_key = r.name_key
order by r.name_key, r.duplicate_rank;

with prediction_counts as (
  select
    p.id,
    p.created_at,
    lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g')) as name_key,
    count(pr.id) as prediction_count
  from public.players p
  left join public.predictions pr on pr.player_id = p.id
  where p.is_active = true
  group by p.id, p.created_at, lower(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))
),
ranked as (
  select
    *,
    row_number() over (
      partition by name_key
      order by prediction_count desc, created_at asc, id::text asc
    ) as duplicate_rank,
    first_value(id) over (
      partition by name_key
      order by prediction_count desc, created_at asc, id::text asc
    ) as winner_id
  from prediction_counts
),
duplicate_groups as (
  select name_key
  from ranked
  group by name_key
  having count(*) > 1
),
deactivation_candidates as (
  select r.id, r.winner_id
  from ranked r
  join duplicate_groups d on d.name_key = r.name_key
  where r.duplicate_rank > 1
)
update public.players p
set
  is_active = false,
  deactivated_at = now(),
  deactivation_reason = 'Duplicate name; kept active player ' || dc.winner_id::text || ' with highest prediction count.'
from deactivation_candidates dc
where p.id = dc.id;

create unique index if not exists idx_players_active_name_unique
on public.players (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
where is_active = true;

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

-- After report: should return zero rows.
select
  lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as name_key,
  count(*) as active_player_count
from public.players
where is_active = true
group by lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
having count(*) > 1
order by active_player_count desc, name_key;

-- Inactive duplicate audit rows.
select
  id,
  name,
  is_active,
  deactivated_at,
  deactivation_reason
from public.players
where is_active = false
order by deactivated_at desc, name;

commit;
