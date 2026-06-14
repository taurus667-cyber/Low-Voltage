-- Reconcile production match data with fifa_world_cup_2026_schedule-chatGPT.xlsx.
-- Source time basis: Date (Riyadh) + Time (Riyadh), converted from KSA UTC+3 to UTC.
--
-- This script updates only six real fixture kickoff times and unpublishes stale
-- wc2026-sample-* seed rows. It does not delete sample rows, so related
-- predictions remain available for audit or rollback.

begin;

-- Preflight: review the rows that will be touched.
select
  external_match_id,
  group_name,
  team_a,
  team_b,
  kickoff_time,
  venue,
  status,
  is_locked,
  is_published
from public.matches
where external_match_id in (
  'wc2026-group-04-202606190100-codex',
  'wc2026-group-16-202606200030-codex',
  'wc2026-group-22-202606200300-codex',
  'wc2026-group-37-202606151900-codex',
  'wc2026-group-38-202606160100-codex',
  'wc2026-group-43-202606151600-codex'
)
or external_match_id like 'wc2026-sample-%'
order by kickoff_time, external_match_id;

-- Preflight: count predictions attached to stale sample rows before unpublishing.
select
  m.external_match_id,
  m.team_a,
  m.team_b,
  count(p.id) as prediction_count
from public.matches m
left join public.predictions p on p.match_id = m.id
where m.external_match_id like 'wc2026-sample-%'
group by m.external_match_id, m.team_a, m.team_b
order by m.external_match_id;

-- Backup touched rows inside the database before mutation.
create table if not exists public.schedule_reconcile_backup_20260612 as
select
  now() as backed_up_at,
  *
from public.matches
where external_match_id in (
  'wc2026-group-04-202606190100-codex',
  'wc2026-group-16-202606200030-codex',
  'wc2026-group-22-202606200300-codex',
  'wc2026-group-37-202606151900-codex',
  'wc2026-group-38-202606160100-codex',
  'wc2026-group-43-202606151600-codex'
)
or external_match_id like 'wc2026-sample-%';

-- Update six real fixtures by stable external_match_id.
update public.matches
set kickoff_time = values_table.kickoff_time::timestamp with time zone,
    last_synced_at = now(),
    updated_at = now()
from (
  values
    ('wc2026-group-04-202606190100-codex', '2026-06-19T01:00:00Z'),
    ('wc2026-group-16-202606200030-codex', '2026-06-20T00:30:00Z'),
    ('wc2026-group-22-202606200300-codex', '2026-06-20T03:00:00Z'),
    ('wc2026-group-37-202606151900-codex', '2026-06-15T19:00:00Z'),
    ('wc2026-group-38-202606160100-codex', '2026-06-16T01:00:00Z'),
    ('wc2026-group-43-202606151600-codex', '2026-06-15T16:00:00Z')
) as values_table(external_match_id, kickoff_time)
where public.matches.external_match_id = values_table.external_match_id;

-- Hide stale seed/sample rows without deleting related predictions.
update public.matches
set is_published = false,
    last_synced_at = now(),
    updated_at = now()
where external_match_id like 'wc2026-sample-%';

-- Post-check: the published group stage should now have 72 rows.
select count(*) as published_group_stage_count
from public.matches
where stage = 'Group Stage'
  and is_published = true;

-- Post-check: the invalid stale fixture should no longer be published.
select
  external_match_id,
  group_name,
  team_a,
  team_b,
  kickoff_time,
  is_published
from public.matches
where (
  (team_a in ('United States', 'USA') and team_b = 'Canada')
  or (team_a = 'Canada' and team_b in ('United States', 'USA'))
  or external_match_id like 'wc2026-sample-%'
)
order by external_match_id;

commit;
