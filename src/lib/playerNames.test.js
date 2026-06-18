import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlayerName, validatePlayerFullName } from './playerNames.js';

test('normalizes player names for duplicate matching', () => {
  assert.equal(normalizePlayerName('  Sara   Ahmed  '), 'sara ahmed');
});

test('requires at least first and last name', () => {
  assert.equal(validatePlayerFullName('Sara').valid, false);
  assert.equal(validatePlayerFullName('Sara Ahmed').valid, true);
  assert.equal(validatePlayerFullName('Sara Bint Ahmed').valid, true);
});
