import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAllRows } from './supabasePaging.js';

test('selectAllRows fetches beyond the default 1000-row Supabase page', async () => {
  const sourceRows = Array.from({ length: 1015 }, (_, index) => ({ id: `row-${index}` }));
  const ranges = [];

  const result = await selectAllRows(
    () => ({
      range(from, to) {
        ranges.push([from, to]);
        return Promise.resolve({ data: sourceRows.slice(from, to + 1), error: null });
      },
    }),
    1000,
  );

  assert.equal(result.error, null);
  assert.equal(result.data.length, 1015);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test('selectAllRows returns partial rows with the first paging error', async () => {
  const result = await selectAllRows(
    () => ({
      range(from) {
        if (from === 0) return Promise.resolve({ data: [{ id: 'row-0' }], error: null });
        return Promise.resolve({ data: null, error: { message: 'range failed' } });
      },
    }),
    1,
  );

  assert.deepEqual(result.data, [{ id: 'row-0' }]);
  assert.equal(result.error.message, 'range failed');
});
