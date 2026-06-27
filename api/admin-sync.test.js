import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdminSync } from './admin-sync.js';

test('all sync imports bracket fixtures before fetching insights', async () => {
  const calls = [];

  const result = await runAdminSync('all', {
    runBracketSync: async () => {
      calls.push('bracket');
      return { matches: 32, clones: { refreshed: 1 } };
    },
    runPrematchSync: async () => {
      calls.push('prematch');
      return { aids: 4 };
    },
    runLiveScoreSync: async () => {
      calls.push('live');
      return { synced: 2 };
    },
    refreshLinkedClones: async () => {
      calls.push('clones');
      return { refreshed: 0 };
    },
  });

  assert.deepEqual(calls, ['bracket', 'prematch', 'live']);
  assert.deepEqual(result.clones, { refreshed: 1 });
});

test('single sync actions only run their requested job', async () => {
  const calls = [];

  await runAdminSync('prematch', {
    runBracketSync: async () => calls.push('bracket'),
    runPrematchSync: async () => {
      calls.push('prematch');
      return { clones: { refreshed: 2 } };
    },
    runLiveScoreSync: async () => calls.push('live'),
    refreshLinkedClones: async () => calls.push('clones'),
  });

  assert.deepEqual(calls, ['prematch']);
});
