import { createClient } from '@supabase/supabase-js';
import {
  fetchApiFootball,
  getActiveTournament,
  getRequiredServerEnv,
  isAuthorized,
  normalizeTeamName,
} from './api-football.js';
import { refreshLinkedClonesForSource } from './clone-groups.js';
import { getTeamMetadata, slugifyTeamName } from '../src/lib/teamMetadata.js';

const LOOKAHEAD_DAYS = 14;

export default async function handler(request, response) {
  if (!isAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    return response.status(200).json(await runPrematchSync());
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Pre-match sync failed.' });
  }
}

export async function runPrematchSync(options = {}) {
  const required = getRequiredServerEnv();
  if (required.error) throw new Error(required.error);

  const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const tournament = await getActiveTournament(supabase);
  const warnings = [];
  await ensureTournamentTeams(supabase, tournament, required.apiFootballKey, warnings);
  const matches = await fetchUpcomingMatches(supabase, tournament);
  const now = new Date();

  const aids = [];
  const oddsRows = [];
  const fixtureUpdates = [];
  for (const match of matches) {
    const providerFixture = match.live_source_match_id
      ? null
      : await findFixtureSafely(match, tournament, required.apiFootballKey, warnings);
    const providerFixtureId = match.live_source_match_id || providerFixture?.fixture?.id;
    if (!providerFixtureId) continue;
    const teamASourceId = match.team_a_source_id || String(providerFixture?.teams?.home?.id || '');
    const teamBSourceId = match.team_b_source_id || String(providerFixture?.teams?.away?.id || '');
    if (providerFixture) fixtureUpdates.push(buildFixtureLinkUpdate(match, providerFixture, now));

    const [predictions, h2h, injuries, odds] = await Promise.all([
      fetchOptionalProviderData('/predictions', { fixture: providerFixtureId }, required.apiFootballKey, warnings, match),
      teamASourceId && teamBSourceId
        ? fetchOptionalProviderData('/fixtures/headtohead', { h2h: `${teamASourceId}-${teamBSourceId}`, last: 5 }, required.apiFootballKey, warnings, match)
        : Promise.resolve([]),
      fetchOptionalProviderData('/injuries', { fixture: providerFixtureId }, required.apiFootballKey, warnings, match),
      fetchOptionalProviderData('/odds', { fixture: providerFixtureId }, required.apiFootballKey, warnings, match),
    ]);

    aids.push(...normalizePredictionAids(match, { predictions, h2h, injuries }, tournament, now));
    oddsRows.push(...normalizeOdds(match, odds, tournament, now));
  }

  for (const update of fixtureUpdates) {
    const { id, ...payload } = update;
    const { error } = await supabase.from('matches').update(payload).eq('id', id);
    if (error) throw error;
  }
  await upsertRows(supabase, 'match_prediction_aids', aids, 'match_id,provider,aid_type');
  await upsertRows(supabase, 'match_odds', oddsRows, 'match_id,provider,bookmaker,market');
  const clones = options.refreshClones === false
    ? { refreshed: 0, skipped: 'Clone refresh deferred.' }
    : await refreshClonesSafely(supabase, tournament);

  return {
    tournament: tournament.slug,
    matches: matches.length,
    linkedFixtures: fixtureUpdates.length,
    aids: aids.length,
    odds: oddsRows.length,
    clones,
    warnings,
  };
}

async function refreshClonesSafely(supabase, tournament) {
  try {
    return await refreshLinkedClonesForSource(supabase, tournament);
  } catch (error) {
    return { refreshed: 0, warning: error.message || 'Clone refresh skipped.' };
  }
}

async function ensureTournamentTeams(supabase, tournament, apiKey, warnings) {
  const teams = await fetchOptionalProviderData('/teams', {
    league: tournament.api_football_league_id,
    season: tournament.api_football_season,
  }, apiKey, warnings);
  if (!teams.length) return;

  const rows = normalizeProviderTeams(teams, tournament);
  try {
    await upsertRows(supabase, 'teams', rows, 'tournament_id,provider,provider_team_id');
  } catch (error) {
    if (!isMissingTeamsProfileColumnError(error)) throw error;
    warnings.push('Teams table is missing profile columns; synced provider teams with legacy columns only.');
    await upsertRows(supabase, 'teams', stripTeamProfileColumns(rows), 'tournament_id,provider,provider_team_id');
  }
}

export function normalizeProviderTeams(teams, tournament = {}, now = new Date()) {
  return teams.map((row) => {
    const name = row.team?.name || 'Unknown';
    const metadata = getTeamMetadata(name);
    return {
      tournament_id: tournament.id || null,
      provider: 'API-Football',
      provider_team_id: String(row.team?.id || ''),
      name,
      slug: metadata?.slug || slugifyTeamName(name),
      logo_url: row.team?.logo || null,
      country: row.team?.country || metadata?.name || null,
      country_code: metadata?.country_code || null,
      flag_url: metadata?.flag_url || null,
      source_url: metadata?.source_url || null,
      source_checked_at: metadata?.source_checked_at || null,
      profile_payload: row,
      last_synced_at: now.toISOString(),
    };
  }).filter((row) => row.provider_team_id);
}

async function fetchUpcomingMatches(supabase, tournament) {
  const now = new Date();
  const to = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from('matches')
    .select('*')
    .eq('is_published', true)
    .gte('kickoff_time', now.toISOString())
    .lte('kickoff_time', to)
    .order('kickoff_time');
  if (tournament.id) query = query.eq('tournament_id', tournament.id);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function findFixtureId(match, tournament, apiKey) {
  const fixture = await findFixture(match, tournament, apiKey);
  return fixture?.fixture?.id ? String(fixture.fixture.id) : '';
}

export async function findFixture(match, tournament, apiKey) {
  const date = match.kickoff_time.slice(0, 10);
  const fixtures = await fetchApiFootball('/fixtures', {
    league: tournament.api_football_league_id,
    season: tournament.api_football_season,
    date,
  }, apiKey);
  return findProviderFixture(match, fixtures);
}

async function findFixtureSafely(match, tournament, apiKey, warnings) {
  try {
    return await findFixture(match, tournament, apiKey);
  } catch (error) {
    warnings.push(`${match.team_a} vs ${match.team_b}: fixture lookup skipped (${formatProviderError(error)}).`);
    return null;
  }
}

export function findProviderFixture(match, fixtures = []) {
  return fixtures.find((row) => {
    const providerKickoff = new Date(row.fixture?.date || '').getTime();
    const appKickoff = new Date(match.kickoff_time).getTime();
    const kickoffClose = Number.isNaN(providerKickoff) || Number.isNaN(appKickoff)
      ? true
      : Math.abs(providerKickoff - appKickoff) <= 2 * 60 * 60 * 1000;
    return kickoffClose &&
      normalizeTeamName(row.teams?.home?.name) === normalizeTeamName(match.team_a) &&
      normalizeTeamName(row.teams?.away?.name) === normalizeTeamName(match.team_b);
  });
}

async function fetchOptionalProviderData(path, params, apiKey, warnings, match = null) {
  try {
    return await fetchApiFootball(path, params, apiKey);
  } catch (error) {
    const label = match ? `${match.team_a} vs ${match.team_b}` : 'Provider';
    warnings.push(`${label}: ${path} skipped (${formatProviderError(error)}).`);
    return [];
  }
}

function formatProviderError(error) {
  const message = error?.message || 'provider request failed';
  const status = message.match(/\bfailed with (\d+)/i)?.[1];
  if (status === '429') return 'API-Football rate limit';
  return message;
}

export function isMissingTeamsProfileColumnError(error) {
  const message = error?.message || '';
  return /Could not find the '.*' column of 'teams' in the schema cache/i.test(message) ||
    /PGRST204/i.test(error?.code || '');
}

export function stripTeamProfileColumns(rows) {
  return rows.map((row) => ({
    tournament_id: row.tournament_id,
    provider: row.provider,
    provider_team_id: row.provider_team_id,
    name: row.name,
    logo_url: row.logo_url,
    country: row.country,
    last_synced_at: row.last_synced_at,
  }));
}

export function buildFixtureLinkUpdate(match, fixture, now = new Date()) {
  return {
    id: match.id,
    live_source: 'API-Football',
    live_source_match_id: String(fixture.fixture?.id || ''),
    team_a_source_id: String(fixture.teams?.home?.id || ''),
    team_b_source_id: String(fixture.teams?.away?.id || ''),
    last_synced_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

export function normalizePredictionAids(match, source, tournament = {}, now = new Date()) {
  const timestamp = now.toISOString();
  const prediction = source.predictions?.[0]?.predictions;
  const rows = [];

  if (prediction) {
    rows.push({
      tournament_id: match.tournament_id || tournament.id || null,
      match_id: match.id,
      provider: 'API-Football',
      aid_type: 'api_prediction',
      title: 'API prediction',
      summary: prediction.advice || null,
      payload: prediction,
      last_synced_at: timestamp,
    });
  }

  if (source.h2h?.length) {
    const homeWins = source.h2h.filter((fixture) => fixture.teams?.home?.winner).length;
    const awayWins = source.h2h.filter((fixture) => fixture.teams?.away?.winner).length;
    rows.push({
      tournament_id: match.tournament_id || tournament.id || null,
      match_id: match.id,
      provider: 'API-Football',
      aid_type: 'head_to_head',
      title: 'Recent head to head',
      summary: `${homeWins}-${awayWins} across last ${source.h2h.length}`,
      payload: { fixtures: source.h2h },
      last_synced_at: timestamp,
    });
  }

  if (source.injuries?.length) {
    rows.push({
      tournament_id: match.tournament_id || tournament.id || null,
      match_id: match.id,
      provider: 'API-Football',
      aid_type: 'injuries',
      title: 'Key absences',
      summary: `${source.injuries.length} reported absence${source.injuries.length === 1 ? '' : 's'}`,
      payload: { injuries: source.injuries },
      last_synced_at: timestamp,
    });
  }

  return rows;
}

export function normalizeOdds(match, oddsResponse, tournament = {}, now = new Date()) {
  const timestamp = now.toISOString();
  const rows = [];
  oddsResponse.forEach((fixtureOdds) => {
    (fixtureOdds.bookmakers || []).forEach((bookmaker) => {
      (bookmaker.bets || []).forEach((bet) => {
        if (!/match winner/i.test(bet.name || '')) return;
        const values = bet.values || [];
        rows.push({
          tournament_id: match.tournament_id || tournament.id || null,
          match_id: match.id,
          provider: 'API-Football',
          bookmaker: bookmaker.name || null,
          market: bet.name || 'Match Winner',
          home_value: values.find((value) => /home/i.test(value.value || ''))?.odd || null,
          draw_value: values.find((value) => /draw/i.test(value.value || ''))?.odd || null,
          away_value: values.find((value) => /away/i.test(value.value || ''))?.odd || null,
          payload: bet,
          last_synced_at: timestamp,
        });
      });
    });
  });
  return rows;
}

async function upsertRows(supabase, table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}
