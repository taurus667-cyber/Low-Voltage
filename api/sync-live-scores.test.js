import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchUpdates,
  findProviderFixture,
  getLiveSyncWindow,
  isAuthorized,
  normalizeProviderEvents,
  normalizeProviderStatistics,
  shouldFetchMatchDetails,
} from './sync-live-scores.js';

test('sync endpoint rejects missing or invalid cron secret', () => {
  process.env.CRON_SECRET = 'expected-secret';
  assert.equal(isAuthorized({ headers: {}, query: {} }), false);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer wrong' }, query: {} }), false);
  assert.equal(isAuthorized({ headers: { authorization: 'Bearer expected-secret' }, query: {} }), true);
});

test('provider live fixture updates score and status', () => {
  const updates = buildMatchUpdates(
    [{
      id: 'match-1',
      team_a: 'Canada',
      team_b: 'Mexico',
      kickoff_time: '2026-06-12T19:00:00Z',
      status: 'scheduled',
    }],
    [{
      fixture: {
        id: 123,
        date: '2026-06-12T19:00:00Z',
        status: { short: '2H', long: 'Second Half', elapsed: 67 },
      },
      teams: { home: { name: 'Canada' }, away: { name: 'Mexico' } },
      goals: { home: 1, away: 2 },
    }],
    new Date('2026-06-12T20:15:00Z'),
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'live');
  assert.equal(updates[0].team_a_score, undefined);
  assert.equal(updates[0].team_b_score, undefined);
  assert.equal(updates[0].live_team_a_score, 1);
  assert.equal(updates[0].live_team_b_score, 2);
  assert.equal(updates[0].live_minute, 67);
});

test('provider final fixture updates to finished', () => {
  const updates = buildMatchUpdates(
    [{
      id: 'match-1',
      team_a: 'Canada',
      team_b: 'Mexico',
      kickoff_time: '2026-06-12T19:00:00Z',
      status: 'live',
    }],
    [{
      fixture: {
        id: 123,
        date: '2026-06-12T19:00:00Z',
        status: { short: 'FT', long: 'Match Finished', elapsed: 90 },
      },
      teams: { home: { name: 'Canada' }, away: { name: 'Mexico' } },
      goals: { home: 2, away: 2 },
    }],
    new Date('2026-06-12T21:00:00Z'),
  );

  assert.equal(updates[0].status, 'finished');
  assert.equal(updates[0].team_a_score, 2);
  assert.equal(updates[0].team_b_score, 2);
  assert.equal(updates[0].live_team_a_score, 2);
  assert.equal(updates[0].live_team_b_score, 2);
});

test('manual finished match is not downgraded by non-final provider status', () => {
  const updates = buildMatchUpdates(
    [{
      id: 'match-1',
      team_a: 'Canada',
      team_b: 'Mexico',
      kickoff_time: '2026-06-12T19:00:00Z',
      status: 'finished',
    }],
    [{
      fixture: {
        id: 123,
        date: '2026-06-12T19:00:00Z',
        status: { short: '2H', long: 'Second Half', elapsed: 67 },
      },
      teams: { home: { name: 'Canada' }, away: { name: 'Mexico' } },
      goals: { home: 1, away: 2 },
    }],
    new Date('2026-06-12T20:15:00Z'),
  );

  assert.deepEqual(updates, []);
});

test('missing provider match leaves existing match unchanged', () => {
  const updates = buildMatchUpdates(
    [{
      id: 'match-1',
      team_a: 'Canada',
      team_b: 'Mexico',
      kickoff_time: '2026-06-12T19:00:00Z',
      status: 'live',
    }],
    [],
    new Date('2026-06-12T20:15:00Z'),
  );

  assert.deepEqual(updates, []);
});

test('provider fixture matching handles common country aliases', () => {
  const fixture = findProviderFixture(
    {
      team_a: 'United States',
      team_b: 'Paraguay',
      kickoff_time: '2026-06-13T01:00:00Z',
    },
    [{
      fixture: { id: 1489370, date: '2026-06-13T01:00:00+00:00' },
      teams: { home: { name: 'USA' }, away: { name: 'Paraguay' } },
    }],
  );

  assert.equal(fixture.fixture.id, 1489370);
});

test('provider fixture matching handles Turkey spelling variants', () => {
  const fixture = findProviderFixture(
    {
      team_a: 'Australia',
      team_b: 'Turkiye',
      kickoff_time: '2026-06-14T04:00:00Z',
    },
    [{
      fixture: { id: 1489371, date: '2026-06-14T04:00:00+00:00' },
      teams: { home: { name: 'Australia' }, away: { name: 'Turkey' } },
    }],
  );

  assert.equal(fixture.fixture.id, 1489371);
});

test('live sync keeps a recap backfill window for recently finished matches', () => {
  const window = getLiveSyncWindow(new Date('2026-06-14T12:00:00Z'));

  assert.equal(window.from, '2026-06-13T12:00:00.000Z');
  assert.equal(window.to, '2026-06-14T12:30:00.000Z');
  assert.equal(shouldFetchMatchDetails({
    status: 'finished',
    kickoff_time: '2026-06-14T04:00:00Z',
    live_source_match_id: null,
  }, new Date('2026-06-14T12:00:00Z')), true);
  assert.equal(shouldFetchMatchDetails({
    status: 'finished',
    kickoff_time: '2026-06-14T04:00:00Z',
    live_source_match_id: '1489371',
  }, new Date('2026-06-15T12:00:00Z')), false);
});

test('normalizes live goal and card events', () => {
  const rows = normalizeProviderEvents(
    { id: 'match-1', tournament_id: 'tournament-1' },
    [{
      time: { elapsed: 34, extra: null },
      team: { name: 'Canada' },
      player: { name: 'Smoke Striker' },
      assist: { name: 'Smoke Creator' },
      type: 'Goal',
      detail: 'Normal Goal',
    }, {
      time: { elapsed: 61 },
      team: { name: 'Mexico' },
      player: { name: 'Carded Player' },
      type: 'Card',
      detail: 'Yellow Card',
    }],
    123,
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].event_type, 'Goal');
  assert.equal(rows[0].assist_name, 'Smoke Creator');
  assert.equal(rows[1].event_detail, 'Yellow Card');
});

test('normalizes provider event keys without unstable array order', () => {
  const first = {
    time: { elapsed: 34, extra: null },
    team: { name: 'Canada' },
    player: { name: 'Smoke Striker' },
    assist: { name: 'Smoke Creator' },
    type: 'Goal',
    detail: 'Normal Goal',
  };
  const second = {
    time: { elapsed: 61 },
    team: { name: 'Mexico' },
    player: { name: 'Carded Player' },
    type: 'Card',
    detail: 'Yellow Card',
  };
  const original = normalizeProviderEvents({ id: 'match-1' }, [first, second], 123);
  const reordered = normalizeProviderEvents({ id: 'match-1' }, [second, first], 123);

  assert.equal(original[0].event_key, reordered[1].event_key);
  assert.equal(original[1].event_key, reordered[0].event_key);
});

test('normalizes match statistics by team', () => {
  const rows = normalizeProviderStatistics(
    { id: 'match-1', tournament_id: 'tournament-1' },
    [{
      team: { name: 'Canada' },
      statistics: [
        { type: 'Shots on Goal', value: 4 },
        { type: 'Ball Possession', value: '55%' },
      ],
    }],
  );

  assert.equal(rows[0].team_name, 'Canada');
  assert.equal(rows[0].statistics['Shots on Goal'], 4);
});
