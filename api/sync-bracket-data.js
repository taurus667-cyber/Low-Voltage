import { createClient } from '@supabase/supabase-js';
import { getActiveTournament, getRequiredSupabaseEnv, isAuthorized } from './api-football.js';
import { refreshLinkedClonesForSource } from './clone-groups.js';
import { OFFICIAL_KNOCKOUT_PLACEHOLDERS } from '../src/lib/bracket.js';

export default async function handler(request, response) {
  if (!isAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    return response.status(200).json(await runBracketSync());
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Bracket sync failed.' });
  }
}

export async function runBracketSync() {
  const required = getRequiredSupabaseEnv();
  if (required.error) throw new Error(required.error);

  const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const tournament = await getActiveTournament(supabase);
  const existingRows = await fetchExistingBracketRows(supabase, tournament);
  const now = new Date().toISOString();
  const rows = OFFICIAL_KNOCKOUT_PLACEHOLDERS.map((slot) => {
    const existing = existingRows.get(slot.bracket_slot) || existingRows.get(slot.external_match_id);
    return {
      tournament_id: tournament.id || null,
      external_match_id: slot.external_match_id,
      bracket_round: slot.bracket_round,
      bracket_slot: slot.bracket_slot,
      bracket_side: slot.bracket_side || null,
      winner_to_slot: slot.winner_to_slot || null,
      winner_to_side: slot.winner_to_side || null,
      loser_to_slot: slot.loser_to_slot || null,
      stage: slot.stage,
      team_a: keepRealTeam(existing?.team_a, slot.team_a),
      team_b: keepRealTeam(existing?.team_b, slot.team_b),
      kickoff_time: existing?.kickoff_time || slot.kickoff_time,
      venue: keepRealVenue(existing?.venue, slot.venue),
      status: existing?.status || 'scheduled',
      is_locked: existing?.is_locked || false,
      is_published: true,
      team_a_score: existing?.team_a_score ?? null,
      team_b_score: existing?.team_b_score ?? null,
      live_source_match_id: existing?.live_source_match_id || null,
      updated_at: now,
      last_synced_at: now,
    };
  });

  const writeCounts = await writeBracketRows(supabase, rows, existingRows);

  let clones = { refreshed: 0 };
  try {
    clones = await refreshLinkedClonesForSource(supabase, tournament);
  } catch (error) {
    clones = { refreshed: 0, warning: error.message || 'Clone refresh skipped.' };
  }

  return {
    tournament: tournament.slug,
    matches: rows.length,
    inserted: writeCounts.inserted,
    updated: writeCounts.updated,
    placeholders: rows.filter((row) => isPlaceholderTeam(row.team_a) || isPlaceholderTeam(row.team_b)).length,
    clones,
  };
}

async function fetchExistingBracketRows(supabase, tournament) {
  let query = supabase
    .from('matches')
    .select('*');
  if (tournament.id) query = query.eq('tournament_id', tournament.id);
  const { data, error } = await query;
  if (error) throw error;
  const map = new Map();
  (data || []).forEach((row) => {
    if (row.bracket_slot) map.set(row.bracket_slot, row);
    if (row.external_match_id) map.set(row.external_match_id, row);
  });
  return map;
}

async function writeBracketRows(supabase, rows, existingRows) {
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = existingRows.get(row.bracket_slot) || existingRows.get(row.external_match_id);
    if (existing?.id) {
      const { error } = await supabase
        .from('matches')
        .update(row)
        .eq('id', existing.id);
      if (error) throw error;
      updated += 1;
    } else {
      const { error } = await supabase
        .from('matches')
        .insert(row);
      if (error) throw error;
      inserted += 1;
    }
  }

  return { inserted, updated };
}

function keepRealTeam(current, fallback) {
  return current && !isPlaceholderTeam(current) ? current : fallback;
}

function keepRealVenue(current, fallback) {
  return current && !/venue tbd/i.test(current) ? current : fallback;
}

function isPlaceholderTeam(value) {
  return /^(tbd|winner |runner-up |best 3rd |loser )/i.test(String(value || '').trim());
}
