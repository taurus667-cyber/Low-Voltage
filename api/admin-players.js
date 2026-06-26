import { createClient } from '@supabase/supabase-js';
import { getRequiredSupabaseEnv, isAdminAuthorized } from './api-football.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!isAdminAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    const required = getRequiredSupabaseEnv();
    if (required.error) throw new Error(required.error);
    const body = await getRequestBody(request);
    const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
      auth: { persistSession: false },
    });

    if (body.action === 'deactivate') {
      const result = await deactivatePlayer(supabase, body);
      return response.status(200).json(result);
    }
    if (body.action === 'set-public-stats-visibility') {
      const result = await setPublicStatsVisibility(supabase, body);
      return response.status(200).json(result);
    }
    if (body.action === 'preview-merge') {
      const result = await previewPlayerMerge(supabase, body);
      return response.status(200).json(result);
    }
    if (body.action === 'merge') {
      const result = await mergePlayers(supabase, body);
      return response.status(200).json(result);
    }

    return response.status(400).json({ error: 'Unknown player admin action.' });
  } catch (error) {
    return response.status(500).json({ error: toPublicPlayerAdminError(error) });
  }
}

export async function deactivatePlayer(supabase, body) {
  const playerId = cleanId(body.player_id);
  const reason = cleanReason(body.reason);
  if (!playerId) throw new Error('Player id is required.');
  if (!reason) throw new Error('Deactivation reason is required.');
  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from('players')
    .update({
      is_active: false,
      deactivated_at: timestamp,
      deactivation_reason: reason,
    })
    .eq('id', playerId)
    .select()
    .single();
  if (error) throw error;
  return { action: 'deactivate', player: data };
}

export async function setPublicStatsVisibility(supabase, body) {
  const playerId = cleanId(body.player_id);
  if (!playerId) throw new Error('Player id is required.');
  const hidden = body.hidden === true;
  const { data, error } = await supabase
    .from('players')
    .update({ hidden_from_public_stats: hidden })
    .eq('id', playerId)
    .select()
    .single();
  if (error) throw error;
  return { action: 'set-public-stats-visibility', player: data };
}

export async function previewPlayerMerge(supabase, body) {
  const { targetId, sourceId, tournamentId } = getMergeIds(body);
  const [players, predictions, matches, favorites, codes] = await Promise.all([
    fetchPlayers(supabase, [targetId, sourceId]),
    fetchPredictions(supabase, [targetId, sourceId]),
    fetchMatches(supabase, tournamentId),
    fetchFavorites(supabase, [targetId, sourceId]),
    fetchTop10Codes(supabase, [targetId, sourceId]),
  ]);
  return buildMergePreview({ targetId, sourceId, players, predictions, matches, favorites, codes });
}

export async function mergePlayers(supabase, body) {
  const { targetId, sourceId, tournamentId } = getMergeIds(body);
  const reason = cleanReason(body.reason);
  if (!reason) throw new Error('Merge reason is required.');

  const preview = await previewPlayerMerge(supabase, body);
  validateConflictResolutions(preview.conflicts, body.conflict_resolutions || []);
  const resolutionMap = new Map((body.conflict_resolutions || []).map((item) => [item.match_id, item.keep]));
  const now = new Date().toISOString();
  const counts = {
    moved_predictions: 0,
    conflicts_resolved: 0,
    source_conflicts_kept_for_audit: 0,
    moved_favorites: 0,
    skipped_favorites: 0,
    moved_top10_code: 0,
    skipped_top10_code: 0,
  };

  for (const item of preview.transferable_predictions) {
    const { error } = await supabase
      .from('predictions')
      .update({
        player_id: targetId,
        tournament_id: tournamentId || item.prediction.tournament_id || null,
        updated_at: now,
      })
      .eq('id', item.prediction.id);
    if (error) throw error;
    counts.moved_predictions += 1;
  }

  for (const conflict of preview.conflicts) {
    const keep = resolutionMap.get(conflict.match_id);
    if (keep === 'source') {
      const patch = copyPredictionFields(conflict.source_prediction, now);
      const { error } = await supabase
        .from('predictions')
        .update(patch)
        .eq('id', conflict.target_prediction.id);
      if (error) throw error;
    } else {
      counts.source_conflicts_kept_for_audit += 1;
    }
    counts.conflicts_resolved += 1;
  }

  const favoriteResult = await transferFavorites(supabase, preview, targetId, tournamentId);
  counts.moved_favorites = favoriteResult.moved;
  counts.skipped_favorites = favoriteResult.skipped;

  const codeResult = await transferTop10Code(supabase, preview, targetId);
  counts.moved_top10_code = codeResult.moved;
  counts.skipped_top10_code = codeResult.skipped;

  const mergeReason = `Merged into ${preview.target_player.name} (${targetId}): ${reason}`;
  const { data: deactivatedPlayer, error: deactivateError } = await supabase
    .from('players')
    .update({
      is_active: false,
      deactivated_at: now,
      deactivation_reason: mergeReason,
    })
    .eq('id', sourceId)
    .select()
    .single();
  if (deactivateError) throw deactivateError;

  return {
    action: 'merge',
    target_player: preview.target_player,
    deactivated_player: deactivatedPlayer,
    counts,
  };
}

export function buildMergePreview({ targetId, sourceId, players, predictions, matches, favorites, codes }) {
  const targetPlayer = players.find((player) => player.id === targetId);
  const sourcePlayer = players.find((player) => player.id === sourceId);
  if (!targetPlayer) throw new Error('Target player was not found.');
  if (!sourcePlayer) throw new Error('Source player was not found.');

  const targetPredictions = predictions.filter((prediction) => prediction.player_id === targetId);
  const sourcePredictions = predictions.filter((prediction) => prediction.player_id === sourceId);
  const targetByMatch = new Map(targetPredictions.map((prediction) => [prediction.match_id, prediction]));
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const transferable = [];
  const conflicts = [];

  for (const prediction of sourcePredictions) {
    const targetPrediction = targetByMatch.get(prediction.match_id);
    if (targetPrediction) {
      conflicts.push({
        match_id: prediction.match_id,
        match: matchById.get(prediction.match_id) || null,
        target_prediction: targetPrediction,
        source_prediction: prediction,
      });
    } else {
      transferable.push({
        match_id: prediction.match_id,
        match: matchById.get(prediction.match_id) || null,
        prediction,
      });
    }
  }

  return {
    target_player: targetPlayer,
    source_player: sourcePlayer,
    counts: {
      target_predictions: targetPredictions.length,
      source_predictions: sourcePredictions.length,
      transferable_predictions: transferable.length,
      conflicts: conflicts.length,
      target_favorites: favorites.filter((favorite) => favorite.player_id === targetId).length,
      source_favorites: favorites.filter((favorite) => favorite.player_id === sourceId).length,
    },
    transferable_predictions: transferable,
    conflicts,
    favorites: {
      target: favorites.filter((favorite) => favorite.player_id === targetId),
      source: favorites.filter((favorite) => favorite.player_id === sourceId),
    },
    top10_codes: {
      target: codes.find((code) => code.player_id === targetId) || null,
      source: codes.find((code) => code.player_id === sourceId) || null,
    },
  };
}

function getMergeIds(body) {
  const targetId = cleanId(body.target_player_id);
  const sourceId = cleanId(body.source_player_id);
  const tournamentId = cleanId(body.tournament_id);
  if (!targetId) throw new Error('Target player id is required.');
  if (!sourceId) throw new Error('Source player id is required.');
  if (targetId === sourceId) throw new Error('Choose two different players to merge.');
  return { targetId, sourceId, tournamentId };
}

async function fetchPlayers(supabase, ids) {
  const { data, error } = await supabase.from('players').select('*').in('id', ids);
  if (error) throw error;
  return data || [];
}

async function fetchPredictions(supabase, ids) {
  const { data, error } = await supabase.from('predictions').select('*').in('player_id', ids);
  if (error) throw error;
  return data || [];
}

async function fetchMatches(supabase, tournamentId) {
  let query = supabase.from('matches').select('*');
  if (tournamentId) query = query.eq('tournament_id', tournamentId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function fetchFavorites(supabase, ids) {
  const { data, error } = await supabase.from('player_favorite_teams').select('*').in('player_id', ids);
  if (isMissingOptionalRelation(error)) return [];
  if (error) throw error;
  return data || [];
}

async function fetchTop10Codes(supabase, ids) {
  const { data, error } = await supabase.from('top10_player_codes').select('*').in('player_id', ids);
  if (isMissingOptionalRelation(error)) return [];
  if (error) throw error;
  return data || [];
}

function validateConflictResolutions(conflicts, resolutions) {
  const required = new Set(conflicts.map((conflict) => conflict.match_id));
  for (const resolution of resolutions) {
    if (!required.has(resolution.match_id)) throw new Error('Conflict resolution includes an unknown match.');
    if (resolution.keep !== 'target' && resolution.keep !== 'source') {
      throw new Error('Conflict resolution must keep target or source.');
    }
    required.delete(resolution.match_id);
  }
  if (required.size) throw new Error('Resolve every prediction conflict before merging.');
}

function copyPredictionFields(sourcePrediction, now) {
  return {
    predicted_team_a_score: sourcePrediction.predicted_team_a_score,
    predicted_team_b_score: sourcePrediction.predicted_team_b_score,
    submitted_at: sourcePrediction.submitted_at,
    updated_at: now,
  };
}

async function transferFavorites(supabase, preview, targetId, tournamentId) {
  let moved = 0;
  let skipped = 0;
  const targetKeys = new Set(preview.favorites.target.map((favorite) => favorite.team_slug));
  for (const favorite of preview.favorites.source) {
    if (targetKeys.has(favorite.team_slug)) {
      skipped += 1;
      continue;
    }
    const { error } = await supabase
      .from('player_favorite_teams')
      .update({
        player_id: targetId,
        tournament_id: tournamentId || favorite.tournament_id || null,
      })
      .eq('id', favorite.id);
    if (isMissingOptionalRelation(error)) return { moved, skipped };
    if (error) throw error;
    moved += 1;
    targetKeys.add(favorite.team_slug);
  }
  return { moved, skipped };
}

async function transferTop10Code(supabase, preview, targetId) {
  if (!preview.top10_codes.source) return { moved: 0, skipped: 0 };
  if (preview.top10_codes.target) return { moved: 0, skipped: 1 };
  const { error } = await supabase
    .from('top10_player_codes')
    .update({ player_id: targetId, updated_at: new Date().toISOString() })
    .eq('id', preview.top10_codes.source.id);
  if (isMissingOptionalRelation(error)) return { moved: 0, skipped: 0 };
  if (error) throw error;
  return { moved: 1, skipped: 0 };
}

function cleanId(value) {
  return String(value || '').trim();
}

function cleanReason(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isMissingOptionalRelation(error) {
  if (!error) return false;
  return error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|schema cache|does not exist/i.test(error.message || '');
}

function toPublicPlayerAdminError(error) {
  const message = error?.message || String(error || '');
  if (/Predictions cannot be changed after the match is locked or kickoff time has passed/i.test(message)) {
    return 'Player merge is blocked by the database prediction-lock trigger. Apply the admin_player_merge_service_role Supabase migration, then try again.';
  }
  return message || 'Player admin action failed.';
}

async function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
