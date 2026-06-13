alter table public.teams add column if not exists slug text;
alter table public.teams add column if not exists country_code text;
alter table public.teams add column if not exists flag_url text;
alter table public.teams add column if not exists source_url text;
alter table public.teams add column if not exists source_checked_at date;
alter table public.teams add column if not exists profile_payload jsonb not null default '{}'::jsonb;

create index if not exists idx_teams_slug on public.teams (slug);
