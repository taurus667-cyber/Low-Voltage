import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerStats } from './playerStats.js';

const NOW = new Date('2026-06-20T12:00:00Z').getTime();

test('builds player rank and scoring stats', () => {
  const stats = buildPlayerStats({
    playerId: 'p1',
    players: players(),
    matches: [
      match({ id: 'm1', team_a_score: 2, team_b_score: 1, kickoff_time: '2026-06-19T12:00:00Z' }),
      match({ id: 'm2', team_a_score: 0, team_b_score: 0, kickoff_time: '2026-06-18T12:00:00Z' }),
    ],
    predictions: [
      prediction({ player_id: 'p1', match_id: 'm1', a: 2, b: 1 }),
      prediction({ player_id: 'p1', match_id: 'm2', a: 1, b: 1 }),
      prediction({ player_id: 'p2', match_id: 'm1', a: 1, b: 0 }),
      prediction({ player_id: 'p2', match_id: 'm2', a: 1, b: 0 }),
    ],
    now: NOW,
  });

  assert.equal(stats.rank, 1);
  assert.equal(stats.row.total_points, 4);
  assert.equal(stats.exactScoreCount, 1);
  assert.equal(stats.correctOutcomeCount, 1);
  assert.equal(stats.accuracyRate, 100);
  assert.equal(stats.averagePointsPerCompletedPick, 2);
  assert.equal(stats.bestResult.match.id, 'm1');
});

test('open picks exclude placeholder knockout rows', () => {
  const stats = buildPlayerStats({
    playerId: 'p1',
    players: players(),
    matches: [
      match({ id: 'real-open', kickoff_time: '2026-06-21T12:00:00Z' }),
      match({
        id: 'placeholder-open',
        stage: 'Round of 32',
        bracket_round: 'round-of-32',
        team_a: 'Winner Group A',
        team_b: 'Runner-up Group C',
        kickoff_time: '2026-06-21T12:00:00Z',
      }),
    ],
    predictions: [],
    now: NOW,
  });

  assert.equal(stats.openPicksRemaining, 1);
  assert.equal(stats.upcomingGaps[0].id, 'real-open');
});

test('comparison values handle a new player with no picks', () => {
  const stats = buildPlayerStats({
    playerId: 'p3',
    players: players(),
    matches: [match({ id: 'm1', team_a_score: 2, team_b_score: 1, kickoff_time: '2026-06-19T12:00:00Z' })],
    predictions: [prediction({ player_id: 'p1', match_id: 'm1', a: 2, b: 1 })],
    now: NOW,
  });

  assert.equal(stats.rank, null);
  assert.equal(stats.completionRate, 0);
  assert.equal(stats.comparison.groupAveragePoints, 3);
  assert.deepEqual(stats.nearbyLeaderboard, []);
});

test('nearby leaderboard returns rows around the current player', () => {
  const stats = buildPlayerStats({
    playerId: 'p3',
    players: [
      player('p1', 'Player 1'),
      player('p2', 'Player 2'),
      player('p3', 'Player 3'),
      player('p4', 'Player 4'),
      player('p5', 'Player 5'),
    ],
    matches: [
      match({ id: 'm1', team_a_score: 3, team_b_score: 0, kickoff_time: '2026-06-19T12:00:00Z' }),
      match({ id: 'm2', team_a_score: 1, team_b_score: 0, kickoff_time: '2026-06-18T12:00:00Z' }),
    ],
    predictions: [
      prediction({ player_id: 'p1', match_id: 'm1', a: 3, b: 0 }),
      prediction({ player_id: 'p2', match_id: 'm1', a: 2, b: 0 }),
      prediction({ player_id: 'p3', match_id: 'm1', a: 0, b: 1 }),
      prediction({ player_id: 'p4', match_id: 'm1', a: 0, b: 1 }),
      prediction({ player_id: 'p5', match_id: 'm1', a: 0, b: 0 }),
    ],
    now: NOW,
  });

  assert.equal(stats.nearbyLeaderboard.length, 5);
  assert.equal(stats.nearbyLeaderboard.some((row) => row.player_id === 'p3' && row.isCurrentPlayer), true);
});

function players() {
  return [player('p1', 'Dana One'), player('p2', 'Nora Two'), player('p3', 'New Player')];
}

function player(id, name) {
  return { id, name, is_active: true };
}

function match(overrides = {}) {
  return {
    id: 'match',
    team_a: 'Argentina',
    team_b: 'Brazil',
    kickoff_time: '2026-06-21T12:00:00Z',
    stage: 'Group Stage',
    status: 'scheduled',
    team_a_score: null,
    team_b_score: null,
    is_locked: false,
    is_published: true,
    ...overrides,
  };
}

function prediction({ player_id, match_id, a, b }) {
  return {
    id: `${player_id}-${match_id}`,
    player_id,
    match_id,
    predicted_team_a_score: a,
    predicted_team_b_score: b,
    submitted_at: '2026-06-18T10:00:00Z',
  };
}
