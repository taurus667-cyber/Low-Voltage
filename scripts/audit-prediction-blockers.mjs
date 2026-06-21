import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const PAGE_SIZE = 1000;

const env = loadEnv();
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const searchTerms = process.argv.slice(2).map((item) => item.trim()).filter(Boolean);

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Put them in the environment or .env.');
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const [players, predictions, matches] = await Promise.all([
  fetchAll('players', 'id,tournament_id,name,is_active,deactivated_at,deactivation_reason,created_at'),
  fetchAll('predictions', 'id,tournament_id,player_id,match_id,submitted_at,updated_at'),
  fetchAll('matches', 'id,tournament_id,team_a,team_b,kickoff_time,is_locked,is_published,status'),
]);

const playerById = new Map(players.map((player) => [player.id, player]));
const matchById = new Map(matches.map((match) => [match.id, match]));
const predictionCounts = countBy(predictions, 'player_id');
const inactivePlayers = players.filter((player) => player.is_active === false);
const inactiveWithPredictions = inactivePlayers
  .map((player) => ({
    ...summarizePlayer(player),
    prediction_count: predictionCounts.get(player.id) || 0,
  }))
  .filter((player) => player.prediction_count > 0)
  .sort((a, b) => b.prediction_count - a.prediction_count || a.name.localeCompare(b.name));

const report = {
  generated_at: new Date().toISOString(),
  totals: {
    players: players.length,
    inactive_players: inactivePlayers.length,
    predictions: predictions.length,
    matches: matches.length,
  },
  inactive_players_with_predictions: inactiveWithPredictions,
  active_duplicate_name_groups: duplicateNameGroups(players.filter(isActivePlayer), predictionCounts),
  inactive_duplicate_name_groups_with_predictions: duplicateNameGroups(
    inactivePlayers.filter((player) => (predictionCounts.get(player.id) || 0) > 0),
    predictionCounts,
  ),
  searches: searchTerms.map((term) => buildSearchReport(term)),
};

console.log(JSON.stringify(report, null, 2));

function buildSearchReport(term) {
  const normalizedTerm = normalizeName(term);
  const matchedPlayers = players.filter((player) => normalizeName(player.name).includes(normalizedTerm));
  const matchedIds = new Set(matchedPlayers.map((player) => player.id));
  const matchedPredictions = predictions.filter((prediction) => matchedIds.has(prediction.player_id));
  return {
    term,
    players: matchedPlayers.map((player) => ({
      ...summarizePlayer(player),
      prediction_count: predictionCounts.get(player.id) || 0,
    })),
    open_match_visibility_mismatches: buildOpenMatchMismatches(matchedPlayers, matchedPredictions),
  };
}

function buildOpenMatchMismatches(matchedPlayers, matchedPredictions) {
  const matchedIds = new Set(matchedPlayers.map((player) => player.id));
  const groupedByMatch = new Map();
  matchedPredictions.forEach((prediction) => {
    const match = matchById.get(prediction.match_id);
    if (!match || !isOpenMatch(match)) return;
    const rows = groupedByMatch.get(prediction.match_id) || [];
    rows.push(prediction);
    groupedByMatch.set(prediction.match_id, rows);
  });

  return [...groupedByMatch.entries()].flatMap(([matchId, rows]) => {
    const activeRows = rows.filter((prediction) => isActivePlayer(playerById.get(prediction.player_id)));
    const inactiveRows = rows.filter((prediction) => !isActivePlayer(playerById.get(prediction.player_id)));
    if (!inactiveRows.length) return [];
    const match = matchById.get(matchId);
    return [{
      match_id: matchId,
      tournament_id: match?.tournament_id || null,
      match: match ? `${match.team_a} vs ${match.team_b}` : 'Unknown match',
      kickoff_time: match?.kickoff_time || null,
      active_visible_prediction_count: activeRows.length,
      inactive_hidden_prediction_count: inactiveRows.length,
      active_players: activeRows.map((prediction) => summarizePlayer(playerById.get(prediction.player_id))),
      inactive_players: inactiveRows.map((prediction) => summarizePlayer(playerById.get(prediction.player_id))),
      matched_player_ids: [...matchedIds],
    }];
  });
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase.from(table).select(columns).range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function duplicateNameGroups(sourcePlayers, counts) {
  const groups = new Map();
  sourcePlayers.forEach((player) => {
    const key = `${player.tournament_id || 'legacy'}:${normalizeName(player.name)}`;
    const group = groups.get(key) || [];
    group.push(player);
    groups.set(key, group);
  });
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      players: group.map((player) => ({
        ...summarizePlayer(player),
        prediction_count: counts.get(player.id) || 0,
      })),
    }));
}

function summarizePlayer(player) {
  if (!player) return null;
  return {
    id: player.id,
    tournament_id: player.tournament_id || null,
    name: player.name,
    is_active: player.is_active !== false,
    created_at: player.created_at || null,
    deactivation_reason: player.deactivation_reason || null,
  };
}

function countBy(rows, key) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row[key], (counts.get(row[key]) || 0) + 1));
  return counts;
}

function isActivePlayer(player) {
  return player?.is_active !== false;
}

function isOpenMatch(match) {
  return match?.is_published !== false && match?.is_locked !== true && new Date(match.kickoff_time).getTime() > Date.now();
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function loadEnv() {
  if (!fs.existsSync('.env')) return {};
  return Object.fromEntries(
    fs.readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')];
      }),
  );
}
