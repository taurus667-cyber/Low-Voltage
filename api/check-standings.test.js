import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStandings, normalizeProviderStandings } from './check-standings.js';

test('normalizes API-Football standings response', () => {
  const groups = normalizeProviderStandings([{
    league: {
      standings: [[{
        rank: 1,
        group: 'World Cup: Group A',
        team: { name: 'Mexico' },
        points: 4,
        goalsDiff: 2,
        all: { played: 2, win: 1, draw: 1, lose: 0, goals: { for: 3, against: 1 } },
      }]],
    },
  }]);

  assert.equal(groups[0].groupName, 'Group A');
  assert.equal(groups[0].rows[0].team, 'Mexico');
  assert.equal(groups[0].rows[0].points, 4);
});

test('compares completed app standings with provider standings', () => {
  const comparison = compareStandings(
    [{
      groupName: 'Group A',
      rows: [
        { team: 'Mexico', played: 2, won: 1, drawn: 1, lost: 0, goals_for: 3, goals_against: 1, goal_difference: 2, points: 4 },
        { team: 'Future Team', played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0 },
      ],
    }],
    [{
      groupName: 'Group A',
      rows: [
        { team: 'Mexico', played: 2, won: 1, drawn: 1, lost: 0, goals_for: 3, goals_against: 1, goal_difference: 2, points: 4 },
      ],
    }],
  );

  assert.equal(comparison.status, 'confirmed');
  assert.deepEqual(comparison.mismatches, []);
});

test('reports mismatched completed standings fields', () => {
  const comparison = compareStandings(
    [{ groupName: 'Group A', rows: [{ team: 'Mexico', played: 1, won: 1, drawn: 0, lost: 0, goals_for: 2, goals_against: 0, goal_difference: 2, points: 3 }] }],
    [{ groupName: 'Group A', rows: [{ team: 'Mexico', played: 1, won: 0, drawn: 1, lost: 0, goals_for: 1, goals_against: 1, goal_difference: 0, points: 1 }] }],
  );

  assert.equal(comparison.status, 'mismatch');
  assert.ok(comparison.mismatches.some((item) => item.field === 'points'));
});

