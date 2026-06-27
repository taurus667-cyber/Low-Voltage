import { createClient } from '@supabase/supabase-js';
import {
  fetchApiFootball,
  getActiveTournament,
  getRequiredServerEnv,
  isAuthorized,
} from './api-football.js';
import { refreshLinkedClonesForSource } from './clone-groups.js';
import {
  OFFICIAL_KNOCKOUT_PLACEHOLDERS,
  getBracketRoundMeta,
  isPlaceholderTeam,
  normalizeBracketRound,
} from '../src/lib/bracket.js';
import { calculateGroupStandings } from '../src/lib/standings.js';
import { teamIdentity } from '../src/lib/teamMetadata.js';

export const KNOCKOUT_FIXTURE_DATES = [
  '2026-06-28',
  '2026-06-29',
  '2026-06-30',
  '2026-07-01',
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
  '2026-07-06',
  '2026-07-07',
  '2026-07-09',
  '2026-07-10',
  '2026-07-11',
  '2026-07-14',
  '2026-07-15',
  '2026-07-18',
  '2026-07-19',
];

export default async function handler(request, response) {
  if (!isAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    return response.status(200).json(await runBracketSync());
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Bracket sync failed.' });
  }
}

export async function runBracketSync(options = {}) {
  const required = getRequiredServerEnv();
  if (required.error) throw new Error(required.error);

  const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const tournament = await getActiveTournament(supabase);
  const existingRows = await fetchExistingBracketRows(supabase, tournament);
  const providerFixtures = await fetchProviderKnockoutFixtures(required.apiFootballKey, tournament);
  const now = new Date().toISOString();
  const { rows, matchedProviderFixtureIds, missingVenues, unmatchedProviderFixtures } = buildBracketRows({
    existingRows,
    providerFixtures,
    tournament,
    now,
  });

  const writeCounts = await writeBracketRows(supabase, rows, existingRows);

  const clones = options.refreshClones === false
    ? { refreshed: 0, skipped: 'Clone refresh deferred.' }
    : await refreshClonesSafely(supabase, tournament);

  return {
    tournament: tournament.slug,
    matches: rows.length,
    inserted: writeCounts.inserted,
    updated: writeCounts.updated,
    providerFixtures: providerFixtures.length,
    concrete: rows.filter((row) => !isPlaceholderTeam(row.team_a) && !isPlaceholderTeam(row.team_b)).length,
    providerMatched: matchedProviderFixtureIds.size,
    placeholders: rows.filter((row) => isPlaceholderTeam(row.team_a) || isPlaceholderTeam(row.team_b)).length,
    hiddenPlaceholders: rows.filter((row) => row.is_published === false).length,
    missingVenueFixtures: missingVenues,
    unmatchedProviderFixtures,
    clones,
  };
}

async function refreshClonesSafely(supabase, tournament) {
  try {
    return await refreshLinkedClonesForSource(supabase, tournament);
  } catch (error) {
    return { refreshed: 0, warning: error.message || 'Clone refresh skipped.' };
  }
}

export async function fetchProviderKnockoutFixtures(apiKey, tournament) {
  const fixtures = [];
  for (const date of KNOCKOUT_FIXTURE_DATES) {
    const rows = await fetchApiFootball('/fixtures', {
      league: tournament.api_football_league_id,
      season: tournament.api_football_season,
      date,
    }, apiKey);
    fixtures.push(...rows.filter(isProviderKnockoutFixture));
  }
  return fixtures.sort(compareProviderFixtures);
}

export function buildBracketRows({ existingRows, providerFixtures = [], tournament = {}, now = new Date().toISOString() }) {
  const existingMatches = uniqueExistingRows(existingRows);
  const groupStandings = calculateGroupStandings(existingMatches);
  const slotMatches = matchProviderFixturesToSlots(providerFixtures, existingRows, { groupStandings });
  const rows = OFFICIAL_KNOCKOUT_PLACEHOLDERS.map((slot) => {
    const existing = existingRows.get(slot.bracket_slot) || existingRows.get(slot.external_match_id);
    const providerFixture = slotMatches.get(slot.bracket_slot);
    const staleProviderMatch = Boolean(
      existing?.live_source_match_id &&
      !providerFixture &&
      providerFixtures.some((fixture) => getProviderFixtureId(fixture) === String(existing.live_source_match_id)),
    );
    return buildBracketRow(slot, existing, providerFixture, tournament, now, { staleProviderMatch });
  });
  const matchedProviderFixtureIds = new Set([...slotMatches.values()].map(getProviderFixtureId).filter(Boolean));
  const missingVenues = providerFixtures.filter((fixture) =>
    matchedProviderFixtureIds.has(getProviderFixtureId(fixture)) && !getProviderVenue(fixture)
  ).length;
  const unmatchedProviderFixtures = providerFixtures
    .filter((fixture) => !matchedProviderFixtureIds.has(getProviderFixtureId(fixture)))
    .map(summarizeProviderFixture);

  return { rows, matchedProviderFixtureIds, missingVenues, unmatchedProviderFixtures };
}

function buildBracketRow(slot, existing, providerFixture, tournament, now, options = {}) {
  const providerTeamA = providerFixture?.teams?.home?.name || '';
  const providerTeamB = providerFixture?.teams?.away?.name || '';
  const keepExistingTeam = !options.staleProviderMatch;
  const teamA = providerTeamA || (keepExistingTeam ? keepRealTeam(existing?.team_a, slot.team_a) : slot.team_a);
  const teamB = providerTeamB || (keepExistingTeam ? keepRealTeam(existing?.team_b, slot.team_b) : slot.team_b);
  const hasConcreteTeams = !isPlaceholderTeam(teamA) && !isPlaceholderTeam(teamB);
  const providerVenue = getProviderVenue(providerFixture);
  const providerFixtureId = getProviderFixtureId(providerFixture);

  return {
    tournament_id: tournament.id || null,
    external_match_id: slot.external_match_id,
    bracket_round: slot.bracket_round,
    bracket_slot: slot.bracket_slot,
    bracket_side: slot.bracket_side || null,
    winner_to_slot: slot.winner_to_slot || null,
    winner_to_side: slot.winner_to_side || null,
    loser_to_slot: slot.loser_to_slot || null,
    stage: providerFixture?.league?.round || slot.stage,
    team_a: teamA,
    team_b: teamB,
    kickoff_time: providerFixture?.fixture?.date || existing?.kickoff_time || slot.kickoff_time,
    venue: providerVenue || keepRealVenue(existing?.venue, slot.venue),
    status: existing?.status || 'scheduled',
    is_locked: existing?.is_locked || false,
    is_published: hasConcreteTeams,
    team_a_score: existing?.team_a_score ?? null,
    team_b_score: existing?.team_b_score ?? null,
    live_source: providerFixture ? 'API-Football' : (options.staleProviderMatch ? null : existing?.live_source || null),
    live_source_match_id: providerFixtureId || (options.staleProviderMatch ? null : existing?.live_source_match_id || null),
    team_a_source_id: providerFixture?.teams?.home?.id ? String(providerFixture.teams.home.id) : (options.staleProviderMatch ? null : existing?.team_a_source_id || null),
    team_b_source_id: providerFixture?.teams?.away?.id ? String(providerFixture.teams.away.id) : (options.staleProviderMatch ? null : existing?.team_b_source_id || null),
    updated_at: now,
    last_synced_at: now,
  };
}

export function matchProviderFixturesToSlots(providerFixtures = [], existingRows = new Map(), options = {}) {
  const matches = new Map();
  const usedFixtureIds = new Set();
  const groupStandings = options.groupStandings || calculateGroupStandings(uniqueExistingRows(existingRows));
  const resolvedSlots = OFFICIAL_KNOCKOUT_PLACEHOLDERS.map((slot) => ({
    ...slot,
    resolvedTeamA: resolveDirectGroupSeed(slot.team_a, groupStandings),
    resolvedTeamB: resolveDirectGroupSeed(slot.team_b, groupStandings),
  }));

  providerFixtures
    .filter((fixture) => !usedFixtureIds.has(getProviderFixtureId(fixture)))
    .forEach((fixture) => {
      const slot = findBestResolvedSlot(fixture, resolvedSlots, matches);
      if (!slot) return;
      matches.set(slot.bracket_slot, fixture);
      usedFixtureIds.add(getProviderFixtureId(fixture));
    });

  resolvedSlots.forEach((slot) => {
    if (matches.has(slot.bracket_slot)) return;
    const existing = existingRows.get(slot.bracket_slot) || existingRows.get(slot.external_match_id);
    const existingProviderId = String(existing?.live_source_match_id || '');
    if (!existingProviderId || usedFixtureIds.has(existingProviderId)) return;
    const fixture = providerFixtures.find((row) => getProviderFixtureId(row) === existingProviderId);
    if (!fixture) return;
    if (!fixtureFitsResolvedSlot(fixture, slot)) return;
    matches.set(slot.bracket_slot, fixture);
    usedFixtureIds.add(existingProviderId);
  });

  const slotsByRoundDate = groupSlotsByRoundDate(resolvedSlots);
  const fixturesByRoundDate = groupFixturesByRoundDate(
    providerFixtures.filter((fixture) => !usedFixtureIds.has(getProviderFixtureId(fixture))),
  );

  fixturesByRoundDate.forEach((fixtures, key) => {
    const slots = slotsByRoundDate.get(key) || [];
    fixtures.forEach((fixture, index) => {
      const slot = slots[index];
      if (!slot || matches.has(slot.bracket_slot)) return;
      matches.set(slot.bracket_slot, fixture);
      usedFixtureIds.add(getProviderFixtureId(fixture));
    });
  });

  const remainingFixturesByRound = groupFixturesByRound(
    providerFixtures.filter((fixture) => !usedFixtureIds.has(getProviderFixtureId(fixture))),
  );
  const remainingSlotsByRound = groupSlotsByRound(resolvedSlots.filter((slot) => !matches.has(slot.bracket_slot)));

  remainingFixturesByRound.forEach((fixtures, roundKey) => {
    const slots = remainingSlotsByRound.get(roundKey) || [];
    fixtures.forEach((fixture, index) => {
      const slot = slots[index];
      if (!slot || matches.has(slot.bracket_slot)) return;
      matches.set(slot.bracket_slot, fixture);
      usedFixtureIds.add(getProviderFixtureId(fixture));
    });
  });

  return matches;
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

function uniqueExistingRows(existingRows = new Map()) {
  const rowsById = new Map();
  [...existingRows.values()].forEach((row) => {
    const key = row?.id || `${row?.external_match_id || ''}:${row?.bracket_slot || ''}:${row?.team_a || ''}:${row?.team_b || ''}`;
    if (key) rowsById.set(key, row);
  });
  return [...rowsById.values()];
}

function findBestResolvedSlot(fixture, slots, matches) {
  const candidates = slots
    .filter((slot) => !matches.has(slot.bracket_slot))
    .filter((slot) => providerRoundKey(fixture) === slot.bracket_round)
    .map((slot) => ({ slot, score: scoreResolvedSlotFit(fixture, slot) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || compareSlots(a.slot, b.slot));

  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
  return candidates[0].slot;
}

function fixtureFitsResolvedSlot(fixture, slot) {
  const score = scoreResolvedSlotFit(fixture, slot);
  if (score > 0) return true;
  return !slotHasResolvedTeam(slot);
}

function scoreResolvedSlotFit(fixture, slot) {
  const fixtureTeams = getFixtureTeamSlugs(fixture);
  let score = 0;

  [slot.resolvedTeamA, slot.resolvedTeamB].forEach((team) => {
    if (isPlaceholderTeam(team)) return;
    score += fixtureTeams.has(teamIdentity(team).slug) ? 2 : -3;
  });

  return score;
}

function slotHasResolvedTeam(slot) {
  return [slot.resolvedTeamA, slot.resolvedTeamB].some((team) => team && !isPlaceholderTeam(team));
}

function getFixtureTeamSlugs(fixture) {
  return new Set([
    fixture?.teams?.home?.name,
    fixture?.teams?.away?.name,
  ].filter(Boolean).map((team) => teamIdentity(team).slug));
}

function resolveDirectGroupSeed(label, groupStandings = []) {
  const raw = String(label || '').trim();
  const match = raw.match(/^(Winner|Runner-up)\s+Group\s+([A-L])$/i);
  if (!match) return label;

  const [, seedType, groupLetter] = match;
  const group = groupStandings.find((item) =>
    String(item.groupName || '').trim().toLowerCase() === `group ${groupLetter.toLowerCase()}`,
  );
  if (!isCompleteGroup(group)) return label;

  const position = /^winner$/i.test(seedType) ? 1 : 2;
  return group.rows.find((row) => row.position === position)?.team || label;
}

function isCompleteGroup(group) {
  if (!group?.rows?.length) return false;
  return group.rows.length >= 4 && group.rows.every((row) => Number(row.played) >= 3);
}

function isProviderKnockoutFixture(fixture) {
  return Boolean(getBracketRoundMeta(providerRoundKey(fixture)));
}

function providerRoundKey(fixture) {
  return normalizeBracketRound(fixture?.league?.round || '');
}

function groupSlotsByRoundDate(slots) {
  const groups = new Map();
  slots.forEach((slot) => {
    const dates = expandSlotDates(slot);
    dates.forEach((date) => {
      const key = `${slot.bracket_round}:${date}`;
      const rows = groups.get(key) || [];
      rows.push(slot);
      rows.sort(compareSlots);
      groups.set(key, rows);
    });
  });
  return groups;
}

function groupFixturesByRoundDate(fixtures) {
  const groups = new Map();
  fixtures.forEach((fixture) => {
    const date = fixture.fixture?.date?.slice(0, 10);
    if (!date) return;
    const key = `${providerRoundKey(fixture)}:${date}`;
    const rows = groups.get(key) || [];
    rows.push(fixture);
    rows.sort(compareProviderFixtures);
    groups.set(key, rows);
  });
  return groups;
}

function groupSlotsByRound(slots) {
  const groups = new Map();
  slots.forEach((slot) => {
    const rows = groups.get(slot.bracket_round) || [];
    rows.push(slot);
    rows.sort(compareSlots);
    groups.set(slot.bracket_round, rows);
  });
  return groups;
}

function groupFixturesByRound(fixtures) {
  const groups = new Map();
  fixtures.forEach((fixture) => {
    const key = providerRoundKey(fixture);
    if (!key) return;
    const rows = groups.get(key) || [];
    rows.push(fixture);
    rows.sort(compareProviderFixtures);
    groups.set(key, rows);
  });
  return groups;
}

function expandSlotDates(slot) {
  const label = String(slot.date_label || '');
  const single = parseDisplayDate(label);
  if (single) return [single];

  const range = label.match(/([A-Za-z]+)\s+(\d+)-(\d+),\s*(\d{4})/);
  if (!range) return [slot.kickoff_time?.slice(0, 10)].filter(Boolean);
  const [, month, startDay, endDay, year] = range;
  const dates = [];
  for (let day = Number(startDay); day <= Number(endDay); day += 1) {
    dates.push(parseDisplayDate(`${month} ${day}, ${year}`));
  }
  return dates.filter(Boolean);
}

function parseDisplayDate(label) {
  const timestamp = Date.parse(`${label} 00:00:00 UTC`);
  if (Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
}

function compareSlots(a, b) {
  return String(a.bracket_slot || '').localeCompare(String(b.bracket_slot || ''), undefined, { numeric: true });
}

function compareProviderFixtures(a, b) {
  return new Date(a.fixture?.date || '').getTime() - new Date(b.fixture?.date || '').getTime() ||
    getProviderFixtureId(a).localeCompare(getProviderFixtureId(b), undefined, { numeric: true });
}

function getProviderFixtureId(fixture) {
  return fixture?.fixture?.id ? String(fixture.fixture.id) : '';
}

function getProviderVenue(fixture) {
  return String(fixture?.fixture?.venue?.name || '').trim();
}

function summarizeProviderFixture(fixture) {
  return {
    fixtureId: getProviderFixtureId(fixture),
    date: fixture.fixture?.date || null,
    round: fixture.league?.round || null,
    teams: `${fixture.teams?.home?.name || 'TBD'} v ${fixture.teams?.away?.name || 'TBD'}`,
    venue: getProviderVenue(fixture) || null,
  };
}
