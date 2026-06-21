alter table public.matches add column if not exists bracket_round text;
alter table public.matches add column if not exists bracket_slot text;
alter table public.matches add column if not exists bracket_side text;
alter table public.matches add column if not exists winner_to_slot text;
alter table public.matches add column if not exists winner_to_side text;
alter table public.matches add column if not exists loser_to_slot text;

create index if not exists idx_matches_bracket_round
on public.matches (bracket_round);

create index if not exists idx_matches_bracket_slot
on public.matches (tournament_id, bracket_slot)
where bracket_slot is not null;
