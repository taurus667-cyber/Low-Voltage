import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import { getBracketHealth, getBracketRound, isKnockoutMatch } from '../src/lib/bracket.js';

const PAGE_SIZE = 1000;
const env = loadEnv();
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Put them in the environment or .env.');
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const matches = await fetchAll('matches', [
  'id',
  'tournament_id',
  'external_match_id',
  'team_a',
  'team_b',
  'kickoff_time',
  'venue',
  'stage',
  'is_published',
  'bracket_round',
  'bracket_slot',
  'bracket_side',
  'winner_to_slot',
  'winner_to_side',
  'loser_to_slot',
].join(','));

const knockout = matches.filter(isKnockoutMatch);
const health = getBracketHealth(matches);
const byTournament = groupBy(knockout, (match) => match.tournament_id || 'legacy');

const report = {
  generated_at: new Date().toISOString(),
  health,
  tournaments: [...byTournament.entries()].map(([tournament_id, rows]) => ({
    tournament_id,
    health: getBracketHealth(rows),
    rounds: summarizeRounds(rows),
    slots_without_next_link: rows
      .filter((match) => !['final', 'third-place'].includes(getBracketRound(match)) && !match.winner_to_slot)
      .map(summarizeMatch),
    unpublished: rows.filter((match) => !match.is_published).map(summarizeMatch),
    missing_official_data: rows
      .filter((match) => !match.external_match_id || !match.kickoff_time || !match.venue)
      .map(summarizeMatch),
  })),
};

console.log(JSON.stringify(report, null, 2));

async function fetchAll(table, select) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function summarizeRounds(rows) {
  const groups = groupBy(rows, (match) => match.bracket_round || match.stage || 'untagged');
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([round, matches]) => ({ round, matches: matches.length }));
}

function summarizeMatch(match) {
  return {
    id: match.id,
    external_match_id: match.external_match_id,
    bracket_round: match.bracket_round,
    bracket_slot: match.bracket_slot,
    teams: `${match.team_a} v ${match.team_b}`,
    kickoff_time: match.kickoff_time,
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    const items = map.get(key) || [];
    items.push(row);
    map.set(key, items);
  });
  return map;
}

function loadEnv() {
  const env = {};
  if (!fs.existsSync('.env')) return env;
  const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index <= 0) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  });
  return env;
}
