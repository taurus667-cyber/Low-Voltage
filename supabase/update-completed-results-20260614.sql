-- Reconcile completed World Cup fixtures through Australia v Turkiye.
-- Verified on 2026-06-14 after the Australia v Turkiye match finished.

begin;

-- Preflight: review rows that will be finalized.
select
  m.external_match_id,
  m.group_name,
  m.team_a,
  m.team_b,
  m.kickoff_time,
  m.team_a_score,
  m.team_b_score,
  m.status,
  m.is_locked,
  m.is_published
from public.matches m
join (
  values
    ('wc2026-group-01-202606111900-codex', 2, 0),
    ('wc2026-group-02-202606120200-codex', 2, 1),
    ('wc2026-group-07-202606121900-codex', 1, 1),
    ('wc2026-group-08-202606131900-codex', 1, 1),
    ('wc2026-group-13-202606132200-codex', 1, 1),
    ('wc2026-group-14-202606140100-codex', 0, 1),
    ('wc2026-group-19-202606130100-codex', 4, 1),
    ('wc2026-group-20-202606140400-codex', 2, 0),
    ('wc2026-group-20-202606141600-codex', 2, 0)
) as values_table(external_match_id, team_a_score, team_b_score)
  on m.external_match_id = values_table.external_match_id
order by m.kickoff_time, m.external_match_id;

create table if not exists public.completed_results_backup_20260614 as
select
  now() as backed_up_at,
  m.*
from public.matches m
join (
  values
    ('wc2026-group-01-202606111900-codex'),
    ('wc2026-group-02-202606120200-codex'),
    ('wc2026-group-07-202606121900-codex'),
    ('wc2026-group-08-202606131900-codex'),
    ('wc2026-group-13-202606132200-codex'),
    ('wc2026-group-14-202606140100-codex'),
    ('wc2026-group-19-202606130100-codex'),
    ('wc2026-group-20-202606140400-codex'),
    ('wc2026-group-20-202606141600-codex')
) as values_table(external_match_id)
  on m.external_match_id = values_table.external_match_id;

update public.matches
set external_match_id = case
      when public.matches.external_match_id = 'wc2026-group-20-202606141600-codex'
        then 'wc2026-group-20-202606140400-codex'
      else public.matches.external_match_id
    end,
    team_a_score = values_table.team_a_score,
    team_b_score = values_table.team_b_score,
    status = 'finished',
    is_locked = true,
    last_synced_at = now(),
    updated_at = now()
from (
  values
    ('wc2026-group-01-202606111900-codex', 2, 0),
    ('wc2026-group-02-202606120200-codex', 2, 1),
    ('wc2026-group-07-202606121900-codex', 1, 1),
    ('wc2026-group-08-202606131900-codex', 1, 1),
    ('wc2026-group-13-202606132200-codex', 1, 1),
    ('wc2026-group-14-202606140100-codex', 0, 1),
    ('wc2026-group-19-202606130100-codex', 4, 1),
    ('wc2026-group-20-202606140400-codex', 2, 0),
    ('wc2026-group-20-202606141600-codex', 2, 0)
) as values_table(external_match_id, team_a_score, team_b_score)
where public.matches.external_match_id = values_table.external_match_id
  and not (
    public.matches.external_match_id = 'wc2026-group-20-202606141600-codex'
    and exists (
      select 1
      from public.matches existing
      where existing.external_match_id = 'wc2026-group-20-202606140400-codex'
    )
  );

-- Post-check: these rows should all be finished with complete scores.
select
  external_match_id,
  group_name,
  team_a,
  team_b,
  team_a_score,
  team_b_score,
  status,
  is_locked
from public.matches
where external_match_id in (
  'wc2026-group-01-202606111900-codex',
  'wc2026-group-02-202606120200-codex',
  'wc2026-group-07-202606121900-codex',
  'wc2026-group-08-202606131900-codex',
  'wc2026-group-13-202606132200-codex',
  'wc2026-group-14-202606140100-codex',
  'wc2026-group-19-202606130100-codex',
  'wc2026-group-20-202606140400-codex'
)
order by kickoff_time, external_match_id;

commit;
