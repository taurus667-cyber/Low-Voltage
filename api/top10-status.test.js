import test from 'node:test';
import assert from 'node:assert/strict';
import { getProtectedRenameAuthorization } from './top10-status.js';

test('allows first protected single-name upgrade and reveals the code', () => {
  const result = getProtectedRenameAuthorization({
    player: { id: 'player-1', name: 'Nawaf', player_token: 'browser-token' },
    codeRow: { code: 'A7K2', shown_at: null },
    playerToken: '',
    code: '',
    cleanName: 'Nawaf Dhubaib',
  });

  assert.equal(result.allowed, true);
  assert.equal(result.revealCode, true);
});

test('requires code after protected profile code has been shown', () => {
  const result = getProtectedRenameAuthorization({
    player: { id: 'player-1', name: 'Nawaf', player_token: 'browser-token' },
    codeRow: { code: 'A7K2', shown_at: '2026-06-18T10:00:00Z' },
    playerToken: '',
    code: '',
    cleanName: 'Nawaf Dhubaib',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.revealCode, false);
});

test('requires code when protected profile already has a full name', () => {
  const result = getProtectedRenameAuthorization({
    player: { id: 'player-1', name: 'Nawaf Oldname', player_token: 'browser-token' },
    codeRow: { code: 'A7K2', shown_at: null },
    playerToken: '',
    code: '',
    cleanName: 'Nawaf Dhubaib',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.revealCode, false);
});

test('allows protected rename with correct code', () => {
  const result = getProtectedRenameAuthorization({
    player: { id: 'player-1', name: 'Nawaf', player_token: 'browser-token' },
    codeRow: { code: 'A7K2', shown_at: '2026-06-18T10:00:00Z' },
    playerToken: '',
    code: 'a7k2',
    cleanName: 'Nawaf Dhubaib',
  });

  assert.equal(result.allowed, true);
  assert.equal(result.revealCode, false);
});
