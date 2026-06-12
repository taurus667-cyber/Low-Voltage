import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchUpdates, isAuthorized } from './sync-live-scores.js';

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
