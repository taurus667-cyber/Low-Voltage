import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPredictionStyle } from './predictionStyle.js';

test('favorite-heavy player becomes Shield Turtle', () => {
  const style = buildPredictionStyle({
    playerId: 'p1',
    players: players(),
    matches: fiveMatches(),
    predictions: fiveMatches().flatMap((match) => [
      prediction('p1', match.id, 1, 0),
      prediction('p2', match.id, 1, 0),
      prediction('p3', match.id, 2, 0),
    ]),
    matchOdds: fiveMatches().map((match) => odds(match.id, '1.7', '3.4', '4.8')),
  });

  assert.equal(style.key, 'shield_turtle');
  assert.equal(style.metrics.favoriteAlignment, 100);
});

test('mixed player becomes Tactical Fox', () => {
  const matches = fiveMatches();
  const style = buildPredictionStyle({
    playerId: 'p1',
    players: players(),
    matches,
    predictions: [
      prediction('p1', 'm1', 1, 0),
      prediction('p1', 'm2', 0, 1),
      prediction('p1', 'm3', 1, 1),
      prediction('p1', 'm4', 2, 1),
      prediction('p1', 'm5', 1, 2),
      ...matches.map((match) => prediction('p2', match.id, 1, 0)),
      ...matches.map((match) => prediction('p3', match.id, 0, 1)),
    ],
    matchOdds: matches.map((match) => odds(match.id, '2.0', '3.0', '2.5')),
  });

  assert.equal(style.key, 'tactical_fox');
});

test('underdog and high-margin player becomes Falcon Striker', () => {
  const matches = fiveMatches();
  const style = buildPredictionStyle({
    playerId: 'p1',
    players: players(),
    matches,
    predictions: [
      prediction('p1', 'm1', 0, 3),
      prediction('p1', 'm2', 4, 1),
      prediction('p1', 'm3', 0, 2),
      prediction('p1', 'm4', 3, 0),
      prediction('p1', 'm5', 1, 4),
      ...matches.map((match) => prediction('p2', match.id, 1, 0)),
      ...matches.map((match) => prediction('p3', match.id, 1, 0)),
    ],
    matchOdds: matches.map((match) => odds(match.id, '1.6', '3.4', '5.5')),
  });

  assert.equal(style.key, 'falcon_striker');
});

test('consensus-disagreeing player becomes Lone Wolf', () => {
  const matches = fiveMatches();
  const style = buildPredictionStyle({
    playerId: 'p1',
    players: players(),
    matches,
    predictions: [
      ...matches.map((match) => prediction('p1', match.id, 0, 1)),
      ...matches.map((match) => prediction('p2', match.id, 1, 0)),
      ...matches.map((match) => prediction('p3', match.id, 1, 0)),
    ],
    matchOdds: matches.map((match) => odds(match.id, '2.2', '3.1', '2.8')),
  });

  assert.equal(style.key, 'lone_wolf');
  assert.equal(style.metrics.consensusDistance, 100);
});

test('low-pick player gets provisional confidence', () => {
  const style = buildPredictionStyle({
    playerId: 'p1',
    players: players(),
    matches: fiveMatches(),
    predictions: [prediction('p1', 'm1', 3, 0)],
    matchOdds: [odds('m1', '1.6', '3.6', '5.0')],
  });

  assert.equal(style.key, 'tactical_fox');
  assert.equal(style.confidence, 'Provisional');
});

function players() {
  return [
    { id: 'p1', name: 'Player One' },
    { id: 'p2', name: 'Player Two' },
    { id: 'p3', name: 'Player Three' },
  ];
}

function fiveMatches() {
  return ['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => ({
    id,
    team_a: `Home ${id}`,
    team_b: `Away ${id}`,
  }));
}

function prediction(playerId, matchId, a, b) {
  return {
    id: `${playerId}-${matchId}-${a}-${b}`,
    player_id: playerId,
    match_id: matchId,
    predicted_team_a_score: a,
    predicted_team_b_score: b,
  };
}

function odds(matchId, home, draw, away) {
  return {
    id: `odds-${matchId}`,
    match_id: matchId,
    home_value: home,
    draw_value: draw,
    away_value: away,
  };
}
