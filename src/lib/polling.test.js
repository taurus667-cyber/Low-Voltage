import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMatchesRefreshInterval,
  LIVE_REFRESH_MS,
  NEAR_MATCH_REFRESH_MS,
} from './polling.js';

const NOW = new Date('2026-06-12T20:00:00Z').getTime();

test('uses live refresh interval when a match is live', () => {
  assert.equal(getMatchesRefreshInterval([
    match({ status: 'live', kickoff_time: '2026-06-12T19:00:00Z' }),
  ], NOW), LIVE_REFRESH_MS);
});

test('uses near-match refresh interval before kickoff', () => {
  assert.equal(getMatchesRefreshInterval([
    match({ kickoff_time: '2026-06-12T20:45:00Z' }),
  ], NOW), NEAR_MATCH_REFRESH_MS);
});

test('disables automatic refresh when idle', () => {
  assert.equal(getMatchesRefreshInterval([
    match({ kickoff_time: '2026-06-13T20:00:00Z' }),
  ], NOW), 0);
});

function match(overrides = {}) {
  return {
    is_published: true,
    status: 'scheduled',
    team_a_score: null,
    team_b_score: null,
    kickoff_time: '2026-06-13T20:00:00Z',
    ...overrides,
  };
}

