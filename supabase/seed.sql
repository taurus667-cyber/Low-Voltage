insert into public.matches (
  external_match_id,
  team_a,
  team_b,
  kickoff_time,
  venue,
  group_name,
  stage,
  status,
  is_locked,
  is_published
) values
  ('wc2026-sample-001', 'Mexico', 'South Africa', '2026-06-11T19:00:00Z', 'Estadio Azteca, Mexico City', 'Group A', 'Group Stage', 'scheduled', false, true),
  ('wc2026-sample-002', 'United States', 'Canada', '2026-06-12T00:00:00Z', 'SoFi Stadium, Los Angeles', 'Group B', 'Group Stage', 'scheduled', false, true),
  ('wc2026-sample-003', 'Brazil', 'Japan', '2026-06-13T22:00:00Z', 'MetLife Stadium, New Jersey', 'Group C', 'Group Stage', 'scheduled', false, true)
on conflict (external_match_id) do update set
  team_a = excluded.team_a,
  team_b = excluded.team_b,
  kickoff_time = excluded.kickoff_time,
  venue = excluded.venue,
  group_name = excluded.group_name,
  stage = excluded.stage,
  status = excluded.status,
  is_locked = excluded.is_locked,
  is_published = excluded.is_published,
  updated_at = now();
