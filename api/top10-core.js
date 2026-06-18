import { calculateLeaderboard, isFinalScoreComplete } from '../src/lib/scoring.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateTop10Code(random = Math.random) {
  let code = '';
  for (let index = 0; index < 4; index += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function getFinishedMatches(matches = []) {
  return matches.filter((match) => match.status === 'finished' || isFinalScoreComplete(match));
}

export function getLatestFinishedMatch(matches = []) {
  return getFinishedMatches(matches)
    .slice()
    .sort((a, b) => new Date(b.kickoff_time || b.updated_at || 0) - new Date(a.kickoff_time || a.updated_at || 0))[0] || null;
}

export function getTop10Entrants(players = [], matches = [], predictions = []) {
  const finishedMatches = getFinishedMatches(matches);
  if (!finishedMatches.length) return { entrants: [], latestMatch: null };
  const finishedIds = new Set(finishedMatches.map((match) => match.id));
  const eligiblePredictions = predictions.filter((prediction) => finishedIds.has(prediction.match_id));
  const rows = calculateLeaderboard(players, finishedMatches, eligiblePredictions)
    .filter((row) => row.predictions_submitted_count > 0 && row.total_points > 0)
    .slice(0, 10)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return { entrants: rows, latestMatch: getLatestFinishedMatch(finishedMatches) };
}

export async function syncTop10Codes(supabase, tournamentId) {
  const [playersResult, matchesResult, predictionsResult, codesResult] = await Promise.all([
    supabase.from('players').select('*').eq('tournament_id', tournamentId).eq('is_active', true),
    supabase.from('matches').select('*').eq('tournament_id', tournamentId).eq('is_published', true),
    supabase.from('predictions').select('*').eq('tournament_id', tournamentId),
    supabase.from('top10_player_codes').select('*').eq('tournament_id', tournamentId),
  ]);
  throwIfError(playersResult.error);
  throwIfError(matchesResult.error);
  throwIfError(predictionsResult.error);
  if (isMissingTop10Table(codesResult.error)) {
    return {
      created: 0,
      protectedCount: 0,
      entrants: [],
      setupRequired: true,
      warning: getTop10SetupMessage(),
    };
  }
  throwIfError(codesResult.error);

  const existingPlayerIds = new Set((codesResult.data || []).map((row) => row.player_id));
  const { entrants, latestMatch } = getTop10Entrants(playersResult.data || [], matchesResult.data || [], predictionsResult.data || []);
  const newRows = entrants
    .filter((row) => !existingPlayerIds.has(row.player_id))
    .map((row) => ({
      tournament_id: tournamentId,
      player_id: row.player_id,
      code: generateUniqueCode(codesResult.data || [], row.player_id),
      status_label: 'Top 10',
      awarded_rank: row.rank,
      awarded_points: row.total_points,
      awarded_after_match_id: latestMatch?.id || null,
    }));

  if (!newRows.length) return { created: 0, protectedCount: existingPlayerIds.size, entrants };
  const { error } = await supabase.from('top10_player_codes').insert(newRows);
  throwIfError(error);
  return { created: newRows.length, protectedCount: existingPlayerIds.size + newRows.length, entrants };
}

export function isMissingTop10Table(error) {
  if (!error) return false;
  return error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|schema cache|does not exist|relation .*top10_player_codes/i.test(error.message || '');
}

export function getTop10SetupMessage() {
  return 'Top 10 protection is not set up for this app database yet. Run the top10_player_codes Supabase migration for this project, then click Sync Top 10 again.';
}

function generateUniqueCode(existingRows, playerId) {
  const existing = new Set(existingRows.filter((row) => row.player_id !== playerId).map((row) => row.code));
  let code = generateTop10Code();
  while (existing.has(code)) code = generateTop10Code();
  return code;
}

function throwIfError(error) {
  if (error) throw error;
}
