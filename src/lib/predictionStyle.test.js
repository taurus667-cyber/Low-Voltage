import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPredictionStyleDistribution,
  buildPredictionStyle,
  buildPredictionStylesByPlayer,
} from './predictionStyle.js';

test('favorite-heavy player becomes Shield Turtle', () => {
  const matches = fiveMatches();
  const players = familyPlayers(5);
  const predictions = [
    ...matches.map((match) => prediction('p1', match.id, 1, 0)),
    ...matches.map((match) => prediction('p2', match.id, 0, 1)),
    ...matches.map((match) => prediction('p3', match.id, 2, 0)),
    ...matches.map((match) => prediction('p4', match.id, 2, 1)),
    ...matches.map((match) => prediction('p5', match.id, 3, 0)),
  ];
  const style = buildPredictionStyle({
    playerId: 'p1',
    players,
    matches,
    predictions,
    matchOdds: matches.map((match) => odds(match.id, '1.7', '3.4', '4.8')),
  });

  assert.equal(style.key, 'shield_turtle');
  assert.equal(style.metrics.favoriteAlignment, 100);
});

test('mixed player becomes Tactical Fox', () => {
  const { players, matches, predictions, matchOdds } = spreadFixture();
  const style = buildPredictionStyle({ playerId: 'p3', players, matches, predictions, matchOdds });

  assert.equal(style.key, 'tactical_fox');
});

test('high against-favorite behavior maps to Falcon Striker', () => {
  const { players, matches, predictions, matchOdds } = spreadFixture();
  const style = buildPredictionStyle({ playerId: 'p4', players, matches, predictions, matchOdds });

  assert.equal(style.key, 'falcon_striker');
  assert.ok(style.metrics.riskPercentile >= 75);
});

test('high consensus deviation maps to Lone Wolf', () => {
  const { players, matches, predictions, matchOdds } = spreadFixture();
  const style = buildPredictionStyle({ playerId: 'p5', players, matches, predictions, matchOdds });

  assert.equal(style.key, 'lone_wolf');
  assert.equal(style.metrics.consensusDistance, 100);
});

test('consensus calculation excludes the player own pick', () => {
  const matches = fiveMatches();
  const style = buildPredictionStyle({
    playerId: 'p1',
    players: familyPlayers(3),
    matches,
    predictions: [
      ...matches.map((match) => prediction('p1', match.id, 1, 0)),
      ...matches.map((match) => prediction('p2', match.id, 0, 1)),
      ...matches.map((match) => prediction('p3', match.id, 0, 1)),
    ],
    matchOdds: matches.map((match) => odds(match.id, '1.9', '3.2', '4.0')),
  });

  assert.equal(style.metrics.consensusDistance, 100);
  assert.equal(style.metrics.consensusComparable, 5);
});

test('similar family predictions still produce a meaningful spread using percentiles', () => {
  const { players, matches, predictions, matchOdds } = spreadFixture();
  const styles = buildPredictionStylesByPlayer({ players, matches, predictions, matchOdds });
  const keys = new Set([...styles.values()].map((style) => style.key));
  const audit = auditPredictionStyleDistribution({ players, matches, predictions, matchOdds });

  assert.ok(keys.has('shield_turtle'));
  assert.ok(keys.has('tactical_fox'));
  assert.ok(keys.has('falcon_striker'));
  assert.ok(keys.has('lone_wolf'));
  assert.equal(audit.collapsed, false);
});

test('low-pick player gets provisional confidence', () => {
  const style = buildPredictionStyle({
    playerId: 'p1',
    players: familyPlayers(3),
    matches: fiveMatches(),
    predictions: [prediction('p1', 'm1', 3, 0)],
    matchOdds: [odds('m1', '1.6', '3.6', '5.0')],
  });

  assert.equal(style.confidence, 'Provisional');
  assert.equal(style.provisional, true);
});

function spreadFixture() {
  const matches = fiveMatches();
  const players = familyPlayers(6);
  const matchOdds = matches.map((match) => odds(match.id, '1.8', '3.5', '4.8'));
  const predictions = [
    ...matches.map((match) => prediction('p1', match.id, 1, 0)),
    ...matches.map((match) => prediction('p2', match.id, 2, 0)),
    prediction('p3', 'm1', 1, 0),
    prediction('p3', 'm2', 2, 1),
    prediction('p3', 'm3', 1, 1),
    prediction('p3', 'm4', 0, 1),
    prediction('p3', 'm5', 2, 0),
    ...matches.map((match) => prediction('p4', match.id, 0, 3)),
    ...matches.map((match) => prediction('p5', match.id, 0, 1)),
    prediction('p6', 'm1', 1, 0),
    prediction('p6', 'm2', 1, 0),
    prediction('p6', 'm3', 2, 0),
    prediction('p6', 'm4', 1, 1),
    prediction('p6', 'm5', 1, 0),
  ];
  return { players, matches, predictions, matchOdds };
}

function familyPlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `Player ${index + 1}`,
  }));
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
