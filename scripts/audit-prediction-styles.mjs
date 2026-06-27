import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { auditPredictionStyleDistribution, buildPredictionStylesByPlayer } from '../src/lib/predictionStyle.js';
import { isPublicStatsPlayer } from '../src/lib/playerVisibility.js';

const env = readEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const tournamentSlug = process.argv[2] || '';

const { data: tournaments, error: tournamentError } = await supabase.from('tournaments').select('*').order('created_at');
if (tournamentError) throw tournamentError;
const tournament = tournamentSlug
  ? tournaments.find((row) => row.slug === tournamentSlug || row.id === tournamentSlug)
  : tournaments.find((row) => row.is_active) || tournaments[0] || null;
const tournamentId = tournament?.id || null;
const scoped = (table, select = '*') => {
  const query = supabase.from(table).select(select);
  return tournamentId ? query.eq('tournament_id', tournamentId) : query;
};

const [playersResult, matchesResult, predictionsResult, aidsResult, oddsResult] = await Promise.all([
  scoped('players', 'id,name,is_active,hidden_from_public_stats,tournament_id'),
  scoped('matches', '*'),
  scoped('predictions', '*'),
  scoped('match_prediction_aids', '*'),
  scoped('match_odds', '*'),
]);

for (const result of [playersResult, matchesResult, predictionsResult]) {
  if (result.error) throw result.error;
}

const players = (playersResult.data || []).filter(isPublicStatsPlayer);
const matches = matchesResult.data || [];
const predictions = predictionsResult.data || [];
const predictionAids = aidsResult.error ? [] : aidsResult.data || [];
const matchOdds = oddsResult.error ? [] : oddsResult.data || [];
const styles = buildPredictionStylesByPlayer({ players, matches, predictions, predictionAids, matchOdds });
const audit = auditPredictionStyleDistribution({ players, matches, predictions, predictionAids, matchOdds });

const examples = players
  .map((player) => ({ player, style: styles.get(player.id) }))
  .filter((row) => row.style?.metrics.pickCount > 0)
  .sort((a, b) => b.style.relativeScore - a.style.relativeScore || a.player.name.localeCompare(b.player.name))
  .slice(0, 15)
  .map(({ player, style }) => ({
    name: player.name,
    style: style.label,
    confidence: style.confidence,
    score: style.score,
    relative_score: style.relativeScore,
    metrics: style.metrics,
  }));

console.log(JSON.stringify({
  tournament: tournament?.name || tournament?.slug || tournamentId,
  players: players.length,
  matches: matches.length,
  predictions: predictions.length,
  prediction_aids: predictionAids.length,
  match_odds: matchOdds.length,
  ...audit,
  examples,
}, null, 2));

function readEnv() {
  return Object.fromEntries(fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([^#=]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, '')]));
}
