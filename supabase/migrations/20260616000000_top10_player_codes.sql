create table if not exists public.top10_player_codes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  player_id uuid references public.players(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{4}$'),
  status_label text not null default 'Top 10',
  awarded_rank integer,
  awarded_points integer,
  awarded_after_match_id uuid references public.matches(id) on delete set null,
  shown_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(player_id)
);

create index if not exists idx_top10_player_codes_tournament_id
on public.top10_player_codes (tournament_id);

alter table public.top10_player_codes enable row level security;

drop policy if exists "top10_player_codes_no_public_select" on public.top10_player_codes;
create policy "top10_player_codes_no_public_select" on public.top10_player_codes
for select using (false);
