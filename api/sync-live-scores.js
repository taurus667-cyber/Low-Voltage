import { createClient } from '@supabase/supabase-js';
import {
  fetchApiFootball,
  getActiveTournament,
  getRequiredServerEnv,
  isAuthorized,
  normalizeTeamName,
  numberOrNull,
} from './api-football.js';

const ACTIVE_BEFORE_MINUTES = 30;
const ACTIVE_AFTER_MINUTES = 180;
const RECAP_BACKFILL_AFTER_MINUTES = 24 * 60;

export { isAuthorized };

export default async function handler(request, response) {
  if (!isAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  const required = getRequiredServerEnv();
  if (required.error) return response.status(500).json({ error: required.error });

  try {
    const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const tournament = await getActiveTournament(supabase);
    const now = new Date();
    const matches = await fetchActiveMatches(supabase, tournament, now);
    if (!matches.length) return response.status(200).json({ synced: 0, message: 'No active published matches.' });

    const providerFixtures = await fetchProviderFixtures(required.apiFootballKey, tournament, matches);
    const updates = buildMatchUpdates(matches, providerFixtures, now, tournament);
    for (const update of updates) {
      const { id, ...payload } = update;
      const { error } = await supabase.from('matches').update(payload).eq('id', id);
      if (error) throw error;
    }

    const eventRows = [];
    const statisticRows = [];
    const lineupRows = [];
    for (const match of matches.filter((match) => shouldFetchMatchDetails(match, now))) {
      const providerFixtureId = match.live_source_match_id || findProviderFixture(match, providerFixtures)?.fixture?.id;
      if (!providerFixtureId) continue;
      const [events, statistics, lineups] = await Promise.all([
        fetchApiFootball('/fixtures/events', { fixture: providerFixtureId }, required.apiFootballKey),
        fetchApiFootball('/fixtures/statistics', { fixture: providerFixtureId }, required.apiFootballKey),
        fetchApiFootball('/fixtures/lineups', { fixture: providerFixtureId }, required.apiFootballKey),
      ]);
      eventRows.push(...normalizeProviderEvents(match, events, providerFixtureId, tournament));
      statisticRows.push(...normalizeProviderStatistics(match, statistics, tournament, now));
      lineupRows.push(...normalizeProviderLineups(match, lineups, tournament, now));
    }

    await upsertRows(supabase, 'match_events', eventRows, 'match_id,provider,event_key');
    await upsertRows(supabase, 'match_statistics', statisticRows, 'match_id,provider,team_name');
    await upsertRows(supabase, 'match_lineups', lineupRows, 'match_id,provider,team_name');

    return response.status(200).json({
      tournament: tournament.slug,
      activeMatches: matches.length,
      providerFixtures: providerFixtures.length,
      synced: updates.length,
      events: eventRows.length,
      statistics: statisticRows.length,
      lineups: lineupRows.length,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Live score sync failed.' });
  }
}

async function fetchActiveMatches(supabase, tournament, now) {
  const { from, to } = getLiveSyncWindow(now);
  let query = supabase
    .from('matches')
    .select('*')
    .eq('is_published', true)
    .gte('kickoff_time', from)
    .lte('kickoff_time', to)
    .order('kickoff_time');
  if (tournament.id) query = query.eq('tournament_id', tournament.id);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export function getLiveSyncWindow(now = new Date()) {
  return {
    from: new Date(now.getTime() - RECAP_BACKFILL_AFTER_MINUTES * 60 * 1000).toISOString(),
    to: new Date(now.getTime() + ACTIVE_BEFORE_MINUTES * 60 * 1000).toISOString(),
  };
}

export function shouldFetchMatchDetails(match, now = new Date()) {
  if (match.status !== 'finished') return true;
  if (!match.live_source_match_id) return true;

  const kickoff = new Date(match.kickoff_time).getTime();
  if (Number.isNaN(kickoff)) return false;
  const activeAfterMs = ACTIVE_AFTER_MINUTES * 60 * 1000;
  return now.getTime() - kickoff <= activeAfterMs;
}

async function fetchProviderFixtures(apiKey, tournament, matches) {
  const dates = [...new Set(matches.map((match) => match.kickoff_time.slice(0, 10)))];
  const fixtures = [];
  for (const date of dates) {
    fixtures.push(...await fetchApiFootball('/fixtures', {
      league: tournament.api_football_league_id,
      season: tournament.api_football_season,
      date,
    }, apiKey));
  }
  return fixtures;
}

export function buildMatchUpdates(matches, providerFixtures, now = new Date(), tournament = {}) {
  const timestamp = now.toISOString();
  const updates = [];

  for (const match of matches) {
    const providerFixture = findProviderFixture(match, providerFixtures);
    if (!providerFixture) continue;

    const status = mapProviderStatus(providerFixture.fixture?.status?.short);
    if (match.status === 'finished' && status !== 'finished') continue;

    const goals = providerFixture.goals || {};
    const scoreHome = numberOrNull(goals.home);
    const scoreAway = numberOrNull(goals.away);
    const providerId = String(providerFixture.fixture?.id || '');

    updates.push({
      id: match.id,
      tournament_id: match.tournament_id || tournament.id || null,
      status,
      team_a_score: status === 'finished' ? scoreHome : match.team_a_score,
      team_b_score: status === 'finished' ? scoreAway : match.team_b_score,
      live_team_a_score: scoreHome,
      live_team_b_score: scoreAway,
      live_source: 'API-Football',
      live_source_match_id: providerId || match.live_source_match_id || null,
      team_a_source_id: String(providerFixture.teams?.home?.id || match.team_a_source_id || ''),
      team_b_source_id: String(providerFixture.teams?.away?.id || match.team_b_source_id || ''),
      live_minute: numberOrNull(providerFixture.fixture?.status?.elapsed),
      live_status_note: providerFixture.fixture?.status?.long || null,
      last_synced_at: timestamp,
      updated_at: timestamp,
    });
  }

  return updates;
}

export function normalizeProviderEvents(match, events, providerFixtureId, tournament = {}) {
  return events.map((event) => {
    const elapsed = numberOrNull(event.time?.elapsed);
    const extra = numberOrNull(event.time?.extra);
    const player = event.player?.name || '';
    const assist = event.assist?.name || '';
    const eventType = event.type || '';
    const detail = event.detail || '';
    const eventKey = [
      providerFixtureId,
      elapsed ?? 'na',
      extra ?? 'na',
      normalizeTeamName(event.team?.name),
      normalizeTeamName(player),
      normalizeTeamName(assist),
      normalizeTeamName(eventType),
      normalizeTeamName(detail),
    ].join(':');
    return {
      tournament_id: match.tournament_id || tournament.id || null,
      match_id: match.id,
      provider: 'API-Football',
      provider_fixture_id: String(providerFixtureId),
      event_key: eventKey,
      team_name: event.team?.name || null,
      player_name: player || null,
      assist_name: assist || null,
      elapsed,
      extra_time: extra,
      event_type: eventType || null,
      event_detail: detail || null,
      comments: event.comments || null,
      updated_at: new Date().toISOString(),
    };
  });
}

export function normalizeProviderStatistics(match, statistics, tournament = {}, now = new Date()) {
  return statistics.map((row) => ({
    tournament_id: match.tournament_id || tournament.id || null,
    match_id: match.id,
    provider: 'API-Football',
    team_name: row.team?.name || 'Unknown',
    statistics: Object.fromEntries((row.statistics || []).map((item) => [item.type, item.value])),
    last_synced_at: now.toISOString(),
  }));
}

export function normalizeProviderLineups(match, lineups, tournament = {}, now = new Date()) {
  return lineups.map((row) => ({
    tournament_id: match.tournament_id || tournament.id || null,
    match_id: match.id,
    provider: 'API-Football',
    team_name: row.team?.name || 'Unknown',
    formation: row.formation || null,
    lineup: row,
    last_synced_at: now.toISOString(),
  }));
}

export function findProviderFixture(match, providerFixtures) {
  if (match.live_source_match_id) {
    const byId = providerFixtures.find(
      (fixture) => String(fixture.fixture?.id || '') === String(match.live_source_match_id),
    );
    if (byId) return byId;
  }

  return providerFixtures.find((fixture) => {
    const homeName = fixture.teams?.home?.name || '';
    const awayName = fixture.teams?.away?.name || '';
    const providerKickoff = new Date(fixture.fixture?.date || '').getTime();
    const appKickoff = new Date(match.kickoff_time).getTime();
    const kickoffClose = Math.abs(providerKickoff - appKickoff) <= 2 * 60 * 60 * 1000;
    return kickoffClose &&
      normalizeTeamName(homeName) === normalizeTeamName(match.team_a) &&
      normalizeTeamName(awayName) === normalizeTeamName(match.team_b);
  });
}

function mapProviderStatus(shortStatus) {
  const finalStatuses = new Set(['FT', 'AET', 'PEN']);
  const liveStatuses = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
  if (finalStatuses.has(shortStatus)) return 'finished';
  if (liveStatuses.has(shortStatus)) return 'live';
  return 'scheduled';
}

async function upsertRows(supabase, table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}
