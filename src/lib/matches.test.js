import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMatchLive,
  isMatchPlayed,
  isMatchUpcoming,
  isPlayerFacingMatch,
} from './matches.js';

const NOW = new Date('2026-06-12T20:00:00Z').getTime();

function match(overrides = {}) {
  return {
    kickoff_time: '2026-06-12T19:00:00Z',
    status: 'scheduled',
    team_a_score: null,
    team_b_score: null,
    is_locked: false,
    ...overrides,
  };
}

test('post-kickoff unfinished match is live, not played', () => {
  const row = match();
  assert.equal(isMatchLive(row, NOW), true);
  assert.equal(isMatchPlayed(row, NOW), false);
});

test('future unfinished match is upcoming', () => {
  const row = match({ kickoff_time: '2026-06-12T21:00:00Z' });
  assert.equal(isMatchUpcoming(row, NOW), true);
  assert.equal(isMatchLive(row, NOW), false);
  assert.equal(isMatchPlayed(row, NOW), false);
});

test('finished status is played', () => {
  const row = match({ status: 'finished' });
  assert.equal(isMatchPlayed(row, NOW), true);
  assert.equal(isMatchLive(row, NOW), false);
});

test('complete final score is played', () => {
  const row = match({ team_a_score: 2, team_b_score: 1 });
  assert.equal(isMatchPlayed(row, NOW), true);
  assert.equal(isMatchLive(row, NOW), false);
});

test('old post-kickoff unfinished match moves to played after active window', () => {
  const row = match({ kickoff_time: '2026-06-12T16:30:00Z' });
  assert.equal(isMatchLive(row, NOW), false);
  assert.equal(isMatchPlayed(row, NOW), true);
});

test('hides published knockout placeholders from player-facing match lists', () => {
  const row = match({
    is_published: true,
    stage: 'Round of 32',
    bracket_round: 'round-of-32',
    team_a: 'Winner Group A',
    team_b: 'Runner-up Group C',
  });
  assert.equal(isPlayerFacingMatch(row), false);
});

test('keeps published knockout fixtures once both teams are concrete', () => {
  const row = match({
    is_published: true,
    stage: 'Round of 32',
    bracket_round: 'round-of-32',
    team_a: 'Argentina',
    team_b: 'Brazil',
  });
  assert.equal(isPlayerFacingMatch(row), true);
});
