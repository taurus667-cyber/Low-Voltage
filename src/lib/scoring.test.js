import test from 'node:test';
import assert from 'node:assert/strict';
import { getPlayerTop10Status } from './scoring.js';

test('returns current Top 10 badge data for ranked players', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    player_id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    total_points: 20 - index,
    exact_score_count: 0,
    correct_outcome_count: 0,
    predictions_submitted_count: 1,
  }));

  assert.deepEqual(getPlayerTop10Status(rows, 'player-2'), {
    rank: 2,
    player_id: 'player-2',
    name: 'Player 2',
    total_points: 19,
    exact_score_count: 0,
    correct_outcome_count: 0,
    predictions_submitted_count: 1,
  });
});

test('does not return Top 10 badge data for rank 11 or lower', () => {
  const rows = Array.from({ length: 11 }, (_, index) => ({
    player_id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    total_points: 20 - index,
    exact_score_count: 0,
    correct_outcome_count: 0,
    predictions_submitted_count: 1,
  }));

  assert.equal(getPlayerTop10Status(rows, 'player-11'), null);
});

test('does not return Top 10 badge data before a player submits picks', () => {
  const rows = [{
    player_id: 'player-1',
    name: 'Player 1',
    total_points: 0,
    exact_score_count: 0,
    correct_outcome_count: 0,
    predictions_submitted_count: 0,
  }];

  assert.equal(getPlayerTop10Status(rows, 'player-1'), null);
});

test('does not return Top 10 badge data for zero-point players', () => {
  const rows = [{
    player_id: 'player-1',
    name: 'Player 1',
    total_points: 0,
    exact_score_count: 0,
    correct_outcome_count: 0,
    predictions_submitted_count: 4,
  }];

  assert.equal(getPlayerTop10Status(rows, 'player-1'), null);
});
