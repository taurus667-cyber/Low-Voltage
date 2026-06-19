-- Allow service-role admin maintenance endpoints to move prediction ownership
-- while keeping public/client prediction lock rules unchanged.

create or replace function public.prevent_closed_match_prediction_changes()
returns trigger
language plpgsql
as $$
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role'
    or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  then
    return new;
  end if;

  if not exists (
    select 1
    from public.players
    where players.id = new.player_id
      and players.is_active = true
  ) then
    raise exception 'Predictions cannot be changed for inactive players.';
  end if;

  if exists (
    select 1
    from public.matches
    where matches.id = new.match_id
      and (
        matches.is_locked = true
        or matches.kickoff_time <= now()
      )
  ) then
    raise exception 'Predictions cannot be changed after the match is locked or kickoff time has passed.';
  end if;

  return new;
end;
$$;
