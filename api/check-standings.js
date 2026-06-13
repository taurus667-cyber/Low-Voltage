import { createClient } from '@supabase/supabase-js';
import {
  fetchApiFootball,
  getActiveTournament,
  getRequiredServerEnv,
  isAuthorized,
  normalizeTeamName,
} from './api-football.js';
import { calculateGroupStandings } from '../src/lib/standings.js';

export function normalizeProviderStandings(providerRows = []) {
  const groups = [];
  providerRows.forEach((competition) => {
    const standings = competition.league?.standings || [];
    standings.forEach((groupRows, index) => {
      groups.push({
        groupName: normalizeProviderGroupName(groupRows[0]?.group || `Group ${index + 1}`),
        rows: groupRows.map((row, rowIndex) => ({
          position: row.rank || rowIndex + 1,
          team: row.team?.name || 'Unknown',
          played: row.all?.played || 0,
          won: row.all?.win || 0,
          drawn: row.all?.draw || 0,
          lost: row.all?.lose || 0,
          goals_for: row.all?.goals?.for || 0,
          goals_against: row.all?.goals?.against || 0,
          goal_difference: row.goalsDiff || 0,
          points: row.points || 0,
        })),
      });
    });
  });
  return groups;
}

export function compareStandings(appStandings = [], providerStandings = []) {
  const mismatches = [];
  const providerRows = new Map();
  providerStandings.forEach((group) => {
    group.rows.forEach((row) => {
      providerRows.set(normalizeTeamName(row.team), row);
    });
  });

  appStandings.forEach((group) => {
    group.rows.forEach((appRow) => {
      if (appRow.played === 0) return;
      const providerRow = providerRows.get(normalizeTeamName(appRow.team));
      if (!providerRow) {
        mismatches.push({ team: appRow.team, reason: 'missing_provider_row' });
        return;
      }
      const fields = ['played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against', 'goal_difference', 'points'];
      fields.forEach((field) => {
        if (Number(appRow[field]) !== Number(providerRow[field])) {
          mismatches.push({
            team: appRow.team,
            field,
            app: appRow[field],
            provider: providerRow[field],
          });
        }
      });
    });
  });

  return {
    status: mismatches.length ? 'mismatch' : 'confirmed',
    mismatches,
  };
}

export default async function handler(request, response) {
  if (!isAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  const required = getRequiredServerEnv();
  if (required.error) return response.status(500).json({ error: required.error });

  try {
    const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const tournament = await getActiveTournament(supabase);
    let query = supabase.from('matches').select('*').eq('is_published', true).order('kickoff_time');
    if (tournament.id) query = query.eq('tournament_id', tournament.id);
    const { data: matches, error: matchesError } = await query;
    if (matchesError) throw matchesError;

    const appStandings = calculateGroupStandings(matches || []);
    let providerPayload = [];
    let providerStandings = [];
    let comparison = { status: 'provider_unavailable', mismatches: [] };
    let errorMessage = null;

    try {
      providerPayload = await fetchApiFootball('/standings', {
        league: tournament.api_football_league_id,
        season: tournament.api_football_season,
      }, required.apiFootballKey);
      providerStandings = normalizeProviderStandings(providerPayload);
      comparison = providerStandings.length
        ? compareStandings(appStandings, providerStandings)
        : { status: 'provider_unavailable', mismatches: [] };
    } catch (error) {
      errorMessage = error.message || 'Provider standings check failed.';
    }

    const { error: insertError } = await supabase.from('standings_checks').insert({
      tournament_id: tournament.id || null,
      tournament_slug: tournament.slug,
      status: comparison.status,
      app_standings: appStandings,
      provider_standings: providerStandings,
      provider_payload: providerPayload,
      mismatches: comparison.mismatches,
      error_message: errorMessage,
      checked_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;

    return response.status(200).json({
      tournament: tournament.slug,
      status: comparison.status,
      mismatches: comparison.mismatches.length,
      providerAvailable: Boolean(providerStandings.length),
    });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Standings check failed.' });
  }
}

function normalizeProviderGroupName(value) {
  const match = String(value || '').match(/Group\s+([A-Z0-9]+)/i);
  return match ? `Group ${match[1].toUpperCase()}` : String(value || 'Group Stage');
}

