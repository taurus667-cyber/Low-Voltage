-- Correct upcoming kickoff times after external schedule verification.
-- Verified against the current published group-stage schedule on 2026-06-14.

begin;

select
  m.external_match_id,
  m.group_name,
  m.team_a,
  m.team_b,
  m.kickoff_time as current_kickoff_time,
  values_table.kickoff_time::timestamp with time zone as verified_kickoff_time,
  m.venue
from public.matches m
join (
  values
    ('wc2026-group-04-202606190100-codex', '2026-06-19T01:00:00Z'),
    ('wc2026-group-16-202606200030-codex', '2026-06-20T00:30:00Z'),
    ('wc2026-group-22-202606200300-codex', '2026-06-20T03:00:00Z'),
    ('wc2026-group-37-202606151900-codex', '2026-06-15T19:00:00Z'),
    ('wc2026-group-38-202606160100-codex', '2026-06-16T01:00:00Z'),
    ('wc2026-group-43-202606151600-codex', '2026-06-15T16:00:00Z')
) as values_table(external_match_id, kickoff_time)
  on m.external_match_id = values_table.external_match_id
order by values_table.kickoff_time::timestamp with time zone;

create table if not exists public.upcoming_kickoff_backup_20260614 as
select
  now() as backed_up_at,
  m.*
from public.matches m
where m.external_match_id in (
  'wc2026-group-04-202606190100-codex',
  'wc2026-group-16-202606200030-codex',
  'wc2026-group-22-202606200300-codex',
  'wc2026-group-37-202606151900-codex',
  'wc2026-group-38-202606160100-codex',
  'wc2026-group-43-202606151600-codex'
);

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

select
  external_match_id,
  group_name,
  team_a,
  team_b,
  kickoff_time,
  venue
from public.matches
where external_match_id in (
  'wc2026-group-04-202606190100-codex',
  'wc2026-group-16-202606200030-codex',
  'wc2026-group-22-202606200300-codex',
  'wc2026-group-37-202606151900-codex',
  'wc2026-group-38-202606160100-codex',
  'wc2026-group-43-202606151600-codex'
)
order by kickoff_time, external_match_id;

commit;
