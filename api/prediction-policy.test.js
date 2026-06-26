import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicStatsPlayer } from '../src/lib/playerVisibility.js';

test('active player can submit an open future match prediction', () => {
  const result = canWritePrediction({
    player: { id: 'active-player', is_active: true },
    match: futureMatch(),
  });

  assert.equal(result.allowed, true);
});

test('hidden public-stats player can still submit an open future match prediction', () => {
  const result = canWritePrediction({
    player: { id: 'hidden-player', is_active: true, hidden_from_public_stats: true },
    match: futureMatch(),
  });

  assert.equal(result.allowed, true);
});

test('inactive duplicate player is blocked from prediction writes', () => {
  const result = canWritePrediction({
    player: { id: 'inactive-player', is_active: false },
    match: futureMatch(),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'Predictions cannot be changed for inactive players.');
});

test('active player is blocked when match is locked or kickoff has passed', () => {
  const locked = canWritePrediction({
    player: { id: 'active-player', is_active: true },
    match: { ...futureMatch(), is_locked: true },
  });
  const past = canWritePrediction({
    player: { id: 'active-player', is_active: true },
    match: { ...futureMatch(), kickoff_time: new Date(Date.now() - 60_000).toISOString() },
  });

  assert.equal(locked.allowed, false);
  assert.equal(locked.reason, 'Predictions cannot be changed after the match is locked or kickoff time has passed.');
  assert.equal(past.allowed, false);
  assert.equal(past.reason, 'Predictions cannot be changed after the match is locked or kickoff time has passed.');
});

test('inactive duplicate predictions are excluded from active submitted-by rows', () => {
  const players = [
    { id: 'active-adil', name: 'Adil Walanshira', is_active: true },
    { id: 'inactive-adil', name: 'Adil Walanshira', is_active: false },
  ];
  const predictions = [
    { id: 'visible-pick', player_id: 'active-adil', match_id: 'match-1' },
    { id: 'hidden-pick', player_id: 'inactive-adil', match_id: 'match-1' },
  ];

  const visibleRows = getActiveSubmittedPredictions({ predictions, players, matchId: 'match-1' });

  assert.deepEqual(visibleRows.map((prediction) => prediction.id), ['visible-pick']);
});

test('hidden public-stats predictions are excluded from public submitted-by rows', () => {
  const players = [
    { id: 'public-player', name: 'Public Player', is_active: true },
    { id: 'hidden-player', name: 'Hidden Player', is_active: true, hidden_from_public_stats: true },
  ];
  const predictions = [
    { id: 'visible-pick', player_id: 'public-player', match_id: 'match-1' },
    { id: 'hidden-pick', player_id: 'hidden-player', match_id: 'match-1' },
  ];

  const visibleRows = getPublicSubmittedPredictions({ predictions, players, matchId: 'match-1' });

  assert.deepEqual(visibleRows.map((prediction) => prediction.id), ['visible-pick']);
});

function canWritePrediction({ player, match, now = Date.now() }) {
  if (!player || player.is_active === false) {
    return { allowed: false, reason: 'Predictions cannot be changed for inactive players.' };
  }
  if (!match || match.is_locked === true || new Date(match.kickoff_time).getTime() <= now) {
    return {
      allowed: false,
      reason: 'Predictions cannot be changed after the match is locked or kickoff time has passed.',
    };
  }
  return { allowed: true };
}

function getActiveSubmittedPredictions({ predictions, players, matchId }) {
  const playersById = new Map(players.map((player) => [player.id, player]));
  return predictions.filter((prediction) =>
    prediction.match_id === matchId &&
    playersById.get(prediction.player_id)?.is_active !== false
  );
}

function getPublicSubmittedPredictions({ predictions, players, matchId }) {
  const playersById = new Map(players.map((player) => [player.id, player]));
  return predictions.filter((prediction) =>
    prediction.match_id === matchId &&
    isPublicStatsPlayer(playersById.get(prediction.player_id))
  );
}

function futureMatch() {
  return {
    id: 'match-1',
    is_locked: false,
    kickoff_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
