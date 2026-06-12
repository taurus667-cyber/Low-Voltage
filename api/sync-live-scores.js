import { createClient } from '@supabase/supabase-js';

const ACTIVE_BEFORE_MINUTES = 30;
const ACTIVE_AFTER_MINUTES = 180;
const DEFAULT_LEAGUE_ID = '1';
const DEFAULT_SEASON = '2026';
const API_FOOTBALL_HOST = 'v3.football.api-sports.io';

export default async function handler(request, response) {
  if (!isAuthorized(request)) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  const required = getRequiredEnv();
  if (required.error) {
    return response.status(500).json({ error: required.error });
  }

  try {
    const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const now = new Date();
    const matches = await fetchActiveMatches(supabase, now);
    if (!matches.length) {
      return response.status(200).json({ synced: 0, message: 'No active published matches.' });
    }

    const providerFixtures = await fetchProviderFixtures(required.apiFootballKey, matches);
    const updates = buildMatchUpdates(matches, providerFixtures, now);

    for (const update of updates) {
      const { id, ...payload } = update;
      const { error } = await supabase.from('matches').update(payload).eq('id', id);
      if (error) throw error;
    }

    return response.status(200).json({
      activeMatches: matches.length,
      providerFixtures: providerFixtures.length,
      synced: updates.length,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Live score sync failed.' });
  }
}

export function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.authorization || '';
  const querySecret = request.query?.secret || '';
  return header === `Bearer ${expected}` || querySecret === expected;
}

function getRequiredEnv() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  if (!supabaseUrl) return { error: 'Missing SUPABASE_URL or VITE_SUPABASE_URL.' };
  if (!serviceRoleKey) return { error: 'Missing SUPABASE_SERVICE_ROLE_KEY.' };
  if (!apiFootballKey) return { error: 'Missing API_FOOTBALL_KEY.' };
  return { supabaseUrl, serviceRoleKey, apiFootballKey };
}

async function fetchActiveMatches(supabase, now) {
  const from = new Date(now.getTime() - ACTIVE_AFTER_MINUTES * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + ACTIVE_BEFORE_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('is_published', true)
    .gte('kickoff_time', from)
    .lte('kickoff_time', to)
    .order('kickoff_time');
  if (error) throw error;
  return data || [];
}

async function fetchProviderFixtures(apiKey, matches) {
  const league = process.env.API_FOOTBALL_LEAGUE_ID || DEFAULT_LEAGUE_ID;
  const season = process.env.API_FOOTBALL_SEASON || DEFAULT_SEASON;
  const dates = [...new Set(matches.map((match) => match.kickoff_time.slice(0, 10)))];
  const fixtures = [];

  for (const date of dates) {
    const url = new URL(`https://${API_FOOTBALL_HOST}/fixtures`);
    url.searchParams.set('league', league);
    url.searchParams.set('season', season);
    url.searchParams.set('date', date);

    const response = await fetch(url, {
      headers: {
        'x-apisports-key': apiKey,
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': API_FOOTBALL_HOST,
      },
    });
    if (!response.ok) {
      throw new Error(`API-Football request failed with ${response.status}.`);
    }
    const payload = await response.json();
    fixtures.push(...(payload.response || []));
  }

  return fixtures;
}

export function buildMatchUpdates(matches, providerFixtures, now = new Date()) {
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
      status,
      team_a_score: status === 'finished' ? scoreHome : match.team_a_score,
      team_b_score: status === 'finished' ? scoreAway : match.team_b_score,
      live_team_a_score: scoreHome,
      live_team_b_score: scoreAway,
      live_source: 'API-Football',
      live_source_match_id: providerId || match.live_source_match_id || null,
      live_minute: numberOrNull(providerFixture.fixture?.status?.elapsed),
      live_status_note: providerFixture.fixture?.status?.long || null,
      last_synced_at: timestamp,
      updated_at: timestamp,
    });
  }

  return updates;
}

function findProviderFixture(match, providerFixtures) {
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

function normalizeTeamName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function numberOrNull(value) {
  return Number.isInteger(value) ? value : null;
}
