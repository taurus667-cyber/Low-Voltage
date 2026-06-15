alter table public.tournaments add column if not exists is_clone boolean not null default false;
alter table public.tournaments add column if not exists source_tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.tournaments add column if not exists parent_tournament_id uuid references public.tournaments(id) on delete set null;
alter table public.tournaments add column if not exists last_internal_refresh_at timestamp with time zone;

alter table public.matches add column if not exists source_match_id uuid references public.matches(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'matches_external_match_id_key'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches drop constraint matches_external_match_id_key;
  end if;
end;
$$;

create unique index if not exists idx_matches_tournament_external_match_id_unique
on public.matches (tournament_id, external_match_id)
where external_match_id is not null;

create index if not exists idx_matches_source_match_id
on public.matches (source_match_id);

create unique index if not exists idx_matches_tournament_source_match_id_unique
on public.matches (tournament_id, source_match_id)
where source_match_id is not null;
