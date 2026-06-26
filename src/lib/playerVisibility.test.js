import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlayerActive, isPublicStatsPlayer } from './playerVisibility.js';

test('hidden public-stats players remain active for app access', () => {
  const player = { id: 'owner', is_active: true, hidden_from_public_stats: true };
  assert.equal(isPlayerActive(player), true);
  assert.equal(isPublicStatsPlayer(player), false);
});

test('inactive players are not public stats players', () => {
  const player = { id: 'duplicate', is_active: false, hidden_from_public_stats: false };
  assert.equal(isPlayerActive(player), false);
  assert.equal(isPublicStatsPlayer(player), false);
});
