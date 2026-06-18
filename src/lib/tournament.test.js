import assert from 'node:assert/strict';
import test from 'node:test';
import { getTournamentBySlug } from './tournament.js';

test('finds tournament slugs case-insensitively', () => {
  const tournaments = [
    { id: 'source', slug: 'world-cup-2026' },
    { id: 'clone', slug: 'bci26' },
  ];

  assert.equal(getTournamentBySlug(tournaments, 'BCI26').id, 'clone');
});
