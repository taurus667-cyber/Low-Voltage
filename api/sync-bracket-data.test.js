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
