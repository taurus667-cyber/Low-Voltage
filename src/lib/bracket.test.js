import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBracket,
  getBracketHealth,
  getMatchWinner,
  getTeamSeedLabel,
  normalizeBracketRound,
} from './bracket.js';

test('normalizes and sorts official knockout rounds', () => {
  assert.equal(normalizeBracketRound('Round of 32'), 'round-of-32');
  assert.equal(normalizeBracketRound('Quarter Final'), 'quarter-finals');
  assert.equal(normalizeBracketRound('Third-place match'), 'third-place');

  const bracket = buildBracket([
    knockout({ id: 'final', stage: 'Final', bracket_slot: 'M104' }),
    knockout({ id: 'r32', stage: 'Round of 32', bracket_slot: 'M73' }),
    knockout({ id: 'semi', stage: 'Semi-finals', bracket_slot: 'M101' }),
  ], { includePlaceholders: false });

  assert.deepEqual(
    bracket.rounds.map((round) => [round.key, round.matches.map((match) => match.id)]),
    [
      ['round-of-32', ['r32']],
      ['round-of-16', []],
      ['quarter-finals', []],
      ['semi-finals', ['semi']],
      ['final', ['final']],
    ],
  );
});

test('resolves winners only from completed non-drawn knockout scores', () => {
  assert.deepEqual(getMatchWinner(knockout({ team_a_score: 2, team_b_score: 1 })), {
    side: 'A',
    team: 'Argentina',
    score: 2,
  });
  assert.equal(getMatchWinner(knockout({ team_a_score: 1, team_b_score: 1 })), null);
  assert.equal(getMatchWinner(knockout({ team_a_score: null, team_b_score: null })), null);
});

test('renders TBD and winner-source placeholders', () => {
  const source = knockout({
    id: 'source',
    bracket_slot: 'M73',
    team_a: 'Spain',
    team_b: 'Japan',
    team_a_score: 3,
    team_b_score: 0,
  });
  const target = knockout({
    id: 'target',
    bracket_slot: 'M89',
    stage: 'Round of 16',
    team_a: 'TBD',
    team_b: 'TBD',
    source_a_slot: 'M73',
  });
  const slots = new Map([['M73', source]]);

  assert.equal(getTeamSeedLabel(target, 'A', slots), 'Spain');
  assert.equal(getTeamSeedLabel(target, 'B', slots), 'TBD');
});

test('keeps third-place match outside champion rounds and reports health', () => {
  const bracket = buildBracket([
    knockout({ id: 'final', stage: 'Final', bracket_slot: 'M104' }),
    knockout({ id: 'third', stage: 'Third-place match', bracket_slot: 'M103' }),
  ], { includePlaceholders: false });
  assert.deepEqual(bracket.rounds.at(-1).matches.map((match) => match.id), ['final']);
  assert.deepEqual(bracket.thirdPlace.map((match) => match.id), ['third']);

  const health = getBracketHealth([
    knockout({ id: 'a', stage: 'Round of 32', bracket_slot: 'M73' }),
    knockout({ id: 'b', stage: 'Round of 32', bracket_slot: 'M73' }),
  ]);
  assert.equal(health.duplicateSlots.length, 1);
});

test('builds an official placeholder skeleton when fixtures are not imported yet', () => {
  const bracket = buildBracket([]);
  assert.equal(bracket.hasRealMatches, false);
  assert.equal(bracket.rounds[0].matches.length, 16);
  assert.equal(bracket.rounds[0].matches[0].team_a, 'Winner Group A');
  assert.equal(bracket.rounds[0].matches[0].date_label, 'June 28, 2026');
  assert.equal(bracket.thirdPlace[0].team_a, 'Loser M101');
  assert.equal(bracket.rounds.at(-1).matches[0].bracket_slot, 'M104');
});

function knockout(overrides = {}) {
  return {
    id: 'match',
    external_match_id: 'M73',
    team_a: 'Argentina',
    team_b: 'Brazil',
    kickoff_time: '2026-06-28T19:00:00Z',
    venue: 'Official Stadium',
    stage: 'Round of 32',
    bracket_slot: 'M73',
    winner_to_slot: 'M89',
    team_a_score: null,
    team_b_score: null,
    is_published: true,
    ...overrides,
  };
}
