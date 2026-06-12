alter table public.matches add column if not exists live_source text;
alter table public.matches add column if not exists live_source_match_id text;
alter table public.matches add column if not exists live_team_a_score integer check (live_team_a_score is null or live_team_a_score >= 0);
alter table public.matches add column if not exists live_team_b_score integer check (live_team_b_score is null or live_team_b_score >= 0);
alter table public.matches add column if not exists live_minute integer check (live_minute is null or live_minute >= 0);
alter table public.matches add column if not exists live_status_note text;

create index if not exists idx_matches_live_source_match_id on public.matches (live_source_match_id);
