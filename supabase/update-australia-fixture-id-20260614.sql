-- Correct Australia v Turkiye fixture after schedule/result verification.
-- Fixture: Australia 2-0 Turkiye, Group D, BC Place, 2026-06-14 04:00 UTC
-- 04:00 UTC is 07:00 Riyadh and 14:00 AEST. Current match reports confirm
-- the game has finished, so the app row must not remain pending/scheduled.

begin;

-- Preflight: review any existing Australia v Turkiye rows.
select
  external_match_id,
  group_name,
  team_a,
  team_b,
  kickoff_time,
  venue,
  team_a_score,
  team_b_score,
  status,
  is_locked,
  is_published
from public.matches
where external_match_id in (
  'wc2026-group-20-202606141600-codex',
  'wc2026-group-20-202606140400-codex'
)
or (
  group_name = 'Group D'
  and team_a = 'Australia'
  and team_b = 'Turkiye'
)
order by kickoff_time, external_match_id;

-- Backup touched rows inside the database before mutation.
create table if not exists public.schedule_reconcile_backup_20260614 as
select
  now() as backed_up_at,
  *
from public.matches
where external_match_id in (
  'wc2026-group-20-202606141600-codex',
  'wc2026-group-20-202606140400-codex'
)
or (
  group_name = 'Group D'
  and team_a = 'Australia'
  and team_b = 'Turkiye'
);

-- Rename the stale external ID and keep the verified kickoff/result explicit.
update public.matches
set external_match_id = 'wc2026-group-20-202606140400-codex',
    kickoff_time = '2026-06-14T04:00:00Z'::timestamp with time zone,
    venue = 'BC Place, Vancouver, British Columbia, Canada',
    team_a_score = 2,
    team_b_score = 0,
    status = 'finished',
    is_locked = true,
    last_synced_at = now(),
    updated_at = now()
where external_match_id = 'wc2026-group-20-202606141600-codex'
  and not exists (
    select 1
    from public.matches existing
    where existing.external_match_id = 'wc2026-group-20-202606140400-codex'
  );

-- If both IDs already exist, keep the corrected row accurate and leave review
-- of any duplicate to the admin rather than deleting prediction-linked data.
update public.matches
set kickoff_time = '2026-06-14T04:00:00Z'::timestamp with time zone,
    venue = 'BC Place, Vancouver, British Columbia, Canada',
    team_a_score = 2,
    team_b_score = 0,
    status = 'finished',
    is_locked = true,
    last_synced_at = now(),
    updated_at = now()
where external_match_id = 'wc2026-group-20-202606140400-codex';

-- Catch any already-imported row matched by teams rather than external ID.
update public.matches
set external_match_id = 'wc2026-group-20-202606140400-codex',
    kickoff_time = '2026-06-14T04:00:00Z'::timestamp with time zone,
    venue = 'BC Place, Vancouver, British Columbia, Canada',
    team_a_score = 2,
    team_b_score = 0,
    status = 'finished',
    is_locked = true,
    last_synced_at = now(),
    updated_at = now()
where group_name = 'Group D'
  and team_a = 'Australia'
  and team_b = 'Turkiye'
  and external_match_id <> 'wc2026-group-20-202606140400-codex'
  and not exists (
    select 1
    from public.matches existing
    where existing.external_match_id = 'wc2026-group-20-202606140400-codex'
  );

-- Post-check: exactly one published finished Australia v Turkiye fixture is expected.
select
  external_match_id,
  group_name,
  team_a,
  team_b,
  kickoff_time,
  venue,
  team_a_score,
  team_b_score,
  status,
  is_locked,
  is_published
from public.matches
where group_name = 'Group D'
  and team_a = 'Australia'
  and team_b = 'Turkiye'
order by kickoff_time, external_match_id;

commit;
