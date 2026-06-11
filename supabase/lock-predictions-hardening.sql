-- Run this once in Supabase SQL Editor.
-- It prevents prediction inserts or edits after the match is manually locked
-- or after kickoff time has passed, even if someone bypasses the website UI.

create or replace function public.prevent_closed_match_prediction_changes()
returns trigger
language plpgsql
as $$
begin
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

drop trigger if exists prevent_closed_match_prediction_inserts on public.predictions;
create trigger prevent_closed_match_prediction_inserts
before insert on public.predictions
for each row execute function public.prevent_closed_match_prediction_changes();

drop trigger if exists prevent_closed_match_prediction_updates on public.predictions;
create trigger prevent_closed_match_prediction_updates
before update on public.predictions
for each row execute function public.prevent_closed_match_prediction_changes();
