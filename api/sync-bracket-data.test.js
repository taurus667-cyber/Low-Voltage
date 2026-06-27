import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBracketRows,
  matchProviderFixturesToSlots,
} from './sync-bracket-data.js';

test('provider knockout fixtures update existing placeholder rows without replacing match ids', () => {
  const existingRows = new Map([
    ['M73', {
      id: 'existing-match-73',
      bracket_slot: 'M73',
      external_match_id: 'M73',
      team_a: 'Winner Group A',
      team_b: 'Runner-up Group C',
      venue: 'Venue TBD',
      is_published: false,
    }],
  ]);
  const providerFixtures = [
    providerFixture({
      id: 1561329,
      date: '2026-06-28T19:00:00+00:00',
      round: 'Round of 32',
      home: 'South Africa',
      away: 'Canada',
      homeId: 111,
      awayId: 222,
      venue: 'SoFi Stadium',
    }),
  ];

  const { rows, matchedProviderFixtureIds } = buildBracketRows({
    existingRows,
    providerFixtures,
    tournament: { id: 'tournament-1' },
    now: '2026-06-27T12:00:00.000Z',
  });
  const match73 = rows.find((row) => row.bracket_slot === 'M73');

  assert.equal(match73.external_match_id, 'M73');
  assert.equal(match73.team_a, 'South Africa');
  assert.equal(match73.team_b, 'Canada');
  assert.equal(match73.venue, 'SoFi Stadium');
  assert.equal(match73.live_source, 'API-Football');
  assert.equal(match73.live_source_match_id, '1561329');
  assert.equal(match73.team_a_source_id, '111');
  assert.equal(match73.team_b_source_id, '222');
  assert.equal(match73.is_published, true);
  assert.equal(matchedProviderFixtureIds.has('1561329'), true);
});

test('missing provider venue does not erase an existing venue', () => {
  const existingRows = new Map([
    ['M75', {
      id: 'existing-match-75',
      bracket_slot: 'M75',
      external_match_id: 'M75',
      team_a: 'Runner-up Group A',
      team_b: 'Runner-up Group B',
      venue: 'MetLife Stadium',
    }],
  ]);

  const { rows, missingVenues } = buildBracketRows({
    existingRows,
    providerFixtures: [
      providerFixture({
        id: 1562344,
        date: '2026-06-29T17:00:00+00:00',
        round: 'Round of 32',
        home: 'Brazil',
        away: 'Japan',
        venue: '',
      }),
    ],
    tournament: { id: 'tournament-1' },
    now: '2026-06-27T12:00:00.000Z',
  });

  const match75 = rows.find((row) => row.bracket_slot === 'M75');
  assert.equal(match75.team_a, 'Brazil');
  assert.equal(match75.team_b, 'Japan');
  assert.equal(match75.venue, 'MetLife Stadium');
  assert.equal(missingVenues, 1);
});

test('partial provider data leaves unresolved slots as unpublished placeholders', () => {
  const { rows } = buildBracketRows({
    existingRows: new Map(),
    providerFixtures: [
      providerFixture({
        id: 1561329,
        date: '2026-06-28T19:00:00+00:00',
        round: 'Round of 32',
        home: 'South Africa',
        away: 'Canada',
      }),
    ],
    tournament: { id: 'tournament-1' },
    now: '2026-06-27T12:00:00.000Z',
  });

  const resolved = rows.find((row) => row.bracket_slot === 'M73');
  const unresolved = rows.find((row) => row.bracket_slot === 'M74');

  assert.equal(resolved.is_published, true);
  assert.equal(unresolved.team_a, 'Winner Group B');
  assert.equal(unresolved.team_b, 'Best 3rd Group A/C/D/E/F');
  assert.equal(unresolved.is_published, false);
});

test('existing provider fixture id is preferred over date order', () => {
  const existingRows = new Map([
    ['M74', {
      id: 'existing-match-74',
      bracket_slot: 'M74',
      external_match_id: 'M74',
      team_a: 'Winner Group B',
      team_b: 'Best 3rd Group A/C/D/E/F',
      live_source_match_id: 'fixture-b',
    }],
  ]);
  const fixtureA = providerFixture({
    id: 'fixture-a',
    date: '2026-06-28T17:00:00+00:00',
    round: 'Round of 32',
    home: 'Earlier',
    away: 'Fixture',
  });
  const fixtureB = providerFixture({
    id: 'fixture-b',
    date: '2026-06-28T19:00:00+00:00',
    round: 'Round of 32',
    home: 'Stored',
    away: 'Fixture',
  });

  const matches = matchProviderFixturesToSlots([fixtureA, fixtureB], existingRows);

  assert.equal(matches.get('M74').teams.home.name, 'Stored');
  assert.equal(matches.get('M73').teams.home.name, 'Earlier');
});

test('round-level chronological fallback matches provider fixtures that overflow official date buckets', () => {
  const providerFixtures = [
    providerFixture({ id: 1561329, date: '2026-06-28T19:00:00+00:00', round: 'Round of 32', home: 'South Africa', away: 'Canada' }),
    providerFixture({ id: 1562344, date: '2026-06-29T17:00:00+00:00', round: 'Round of 32', home: 'Brazil', away: 'Japan' }),
    providerFixture({ id: 1565176, date: '2026-06-29T20:30:00+00:00', round: 'Round of 32', home: 'Germany', away: 'Paraguay' }),
    providerFixture({ id: 1562345, date: '2026-06-30T01:00:00+00:00', round: 'Round of 32', home: 'Netherlands', away: 'Morocco' }),
    providerFixture({ id: 1564789, date: '2026-06-30T17:00:00+00:00', round: 'Round of 32', home: 'Ivory Coast', away: 'Norway' }),
    providerFixture({ id: 1565177, date: '2026-06-30T21:00:00+00:00', round: 'Round of 32', home: 'France', away: 'Sweden' }),
    providerFixture({ id: 1562586, date: '2026-07-02T00:00:00+00:00', round: 'Round of 32', home: 'USA', away: 'Bosnia & Herzegovina' }),
    providerFixture({ id: 1565178, date: '2026-07-03T18:00:00+00:00', round: 'Round of 32', home: 'Australia', away: 'Egypt' }),
    providerFixture({ id: 1565179, date: '2026-07-03T22:00:00+00:00', round: 'Round of 32', home: 'Argentina', away: 'Cape Verde Islands' }),
  ];

  const { rows, matchedProviderFixtureIds, unmatchedProviderFixtures } = buildBracketRows({
    existingRows: new Map(),
    providerFixtures,
    tournament: { id: 'tournament-1' },
    now: '2026-06-27T12:00:00.000Z',
  });

  assert.equal(matchedProviderFixtureIds.size, 9);
  assert.equal(unmatchedProviderFixtures.length, 0);
  assert.equal(rows.filter((row) => row.is_published).length, 9);
  assert.equal(rows.some((row) => row.team_a === 'France' && row.team_b === 'Sweden'), true);
});

test('resolved group seeds override stale provider slot assignments', () => {
  const existingRows = existingRowsMap([
    {
      id: 'stale-m76',
      bracket_slot: 'M76',
      external_match_id: 'M76',
      team_a: 'Germany',
      team_b: 'Paraguay',
      live_source: 'API-Football',
      live_source_match_id: '1565176',
      team_a_source_id: '1',
      team_b_source_id: '2',
      is_published: true,
    },
    ...completeGroup('Group E', ['Germany', 'Ivory Coast', 'Ecuador', 'Curacao']),
  ]);

  const { rows } = buildBracketRows({
    existingRows,
    providerFixtures: [
      providerFixture({
        id: 1565176,
        date: '2026-06-29T20:30:00+00:00',
        round: 'Round of 32',
        home: 'Germany',
        away: 'Paraguay',
      }),
    ],
    tournament: { id: 'tournament-1' },
    now: '2026-06-27T12:00:00.000Z',
  });

  const m76 = rows.find((row) => row.bracket_slot === 'M76');
  const m79 = rows.find((row) => row.bracket_slot === 'M79');

  assert.equal(m76.team_a, 'Winner Group F');
  assert.equal(m76.team_b, 'Runner-up Group C');
  assert.equal(m76.live_source_match_id, null);
  assert.equal(m76.is_published, false);
  assert.equal(m79.team_a, 'Germany');
  assert.equal(m79.team_b, 'Paraguay');
  assert.equal(m79.live_source_match_id, '1565176');
  assert.equal(m79.is_published, true);
});

function providerFixture({
  id,
  date,
  round,
  home,
  away,
  homeId = 1,
  awayId = 2,
  venue = '',
}) {
  return {
    fixture: {
      id,
      date,
      venue: { name: venue },
    },
    league: { round },
    teams: {
      home: { id: homeId, name: home },
      away: { id: awayId, name: away },
    },
  };
}

function existingRowsMap(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (row.bracket_slot) map.set(row.bracket_slot, row);
    if (row.external_match_id) map.set(row.external_match_id, row);
    if (!row.bracket_slot && row.id) map.set(row.id, row);
  });
  return map;
}

function completeGroup(groupName, teams) {
  return [
    groupMatch(groupName, teams[0], teams[1], 3, 0),
    groupMatch(groupName, teams[0], teams[2], 2, 0),
    groupMatch(groupName, teams[0], teams[3], 4, 1),
    groupMatch(groupName, teams[1], teams[2], 1, 0),
    groupMatch(groupName, teams[1], teams[3], 2, 0),
    groupMatch(groupName, teams[2], teams[3], 1, 0),
  ];
}

let groupMatchId = 0;
function groupMatch(groupName, teamA, teamB, scoreA, scoreB) {
  groupMatchId += 1;
  return {
    id: `group-${groupMatchId}`,
    external_match_id: `group-${groupMatchId}`,
    team_a: teamA,
    team_b: teamB,
    team_a_score: scoreA,
    team_b_score: scoreB,
    stage: 'Group Stage',
    group_name: groupName,
    kickoff_time: '2026-06-20T12:00:00Z',
    is_published: true,
  };
}
