import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGroupStandings } from './standings.js';

test('calculates group standings from complete published group results', () => {
  const groups = calculateGroupStandings([
    match({ team_a: 'Canada', team_b: 'Mexico', team_a_score: 2, team_b_score: 1 }),
    match({ team_a: 'Canada', team_b: 'Brazil', team_a_score: 0, team_b_score: 0 }),
    match({ team_a: 'Mexico', team_b: 'Brazil', team_a_score: 1, team_b_score: 3 }),
    match({ team_a: 'Hidden', team_b: 'Ignored', team_a_score: 9, team_b_score: 0, is_published: false }),
    match({ team_a: 'Future', team_b: 'Waiting', team_a_score: null, team_b_score: null }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rows.map((row) => row.team), ['Brazil', 'Canada', 'Future', 'Waiting', 'Mexico']);
  assert.equal(groups[0].rows[0].points, 4);
  assert.equal(groups[0].rows[0].goal_difference, 2);
  assert.equal(groups[0].rows[1].played, 2);
  assert.equal(groups[0].rows[1].points, 4);
  assert.equal(groups[0].rows[2].played, 0);
  assert.equal(groups[0].rows[4].lost, 2);
});

function match(overrides = {}) {
  return {
    group_name: 'Group A',
    stage: 'Group Stage',
    is_published: true,
    ...overrides,
  };
}
