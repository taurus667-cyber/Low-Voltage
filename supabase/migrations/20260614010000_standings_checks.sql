create table if not exists public.standings_checks (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete set null,
  tournament_slug text,
  status text not null check (status in ('confirmed', 'mismatch', 'provider_unavailable')),
  app_standings jsonb not null default '[]'::jsonb,
  provider_standings jsonb not null default '[]'::jsonb,
  provider_payload jsonb not null default '[]'::jsonb,
  mismatches jsonb not null default '[]'::jsonb,
  error_message text,
  checked_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_standings_checks_tournament_checked_at
on public.standings_checks (tournament_id, checked_at desc);

alter table public.standings_checks enable row level security;

drop policy if exists "standings_checks_no_public_access" on public.standings_checks;
