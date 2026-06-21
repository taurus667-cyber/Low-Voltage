import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { LIVE_MATCH_WINDOW_MINUTES } from './matches.js';
import { normalizeFixtureRows, parseFixtureCsv } from './fixtures.js';

test('normalizes optional final scores from fixture rows', () => {
  const [fixture] = normalizeFixtureRows([
    {
      match_id: 'wc2026-group-20-202606140400-codex',
      stage: 'Group Stage',
      group_name: 'Group D',
      team_a: 'Australia',
      team_b: 'Turkiye',
      kickoff_time: '2026-06-14T04:00:00Z',
      venue: 'BC Place, Vancouver, British Columbia, Canada',
      team_a_score: '2',
      team_b_score: '0',
      status: 'finished',
    },
  ]);

  assert.equal(fixture.team_a_score, 2);
  assert.equal(fixture.team_b_score, 0);
  assert.equal(fixture.status, 'finished');
});

test('normalizes bracket metadata from fixture rows', () => {
  const [fixture] = normalizeFixtureRows([{
    match_id: 'wc2026-r32-73',
    stage: 'Round of 32',
    bracket_round: 'round-of-32',
    bracket_slot: 'M73',
    bracket_side: 'left',
    winner_to_slot: 'M89',
    winner_to_side: 'A',
    loser_to_slot: '',
    team_a: 'Winner Group A',
    team_b: 'Best 3rd Group C/E/F/H/I',
    kickoff_time: '2026-06-28T19:00:00Z',
    venue: 'Official Stadium',
  }]);

  assert.equal(fixture.bracket_round, 'round-of-32');
  assert.equal(fixture.bracket_slot, 'M73');
  assert.equal(fixture.winner_to_slot, 'M89');
  assert.equal(fixture.loser_to_slot, null);
});

test('sample fixture data does not leave completed matches pending', () => {
  const csv = fs.readFileSync('./sample-data/worldcup-2026-first-round-from-ics.csv', 'utf8');
  const fixtures = normalizeFixtureRows(parseFixtureCsv(csv));
  const graceMs = (LIVE_MATCH_WINDOW_MINUTES + 30) * 60 * 1000;
  const referenceNow = new Date('2026-06-14T16:00:00Z').getTime();
  const stalePending = fixtures.filter((fixture) => {
    const kickoff = new Date(fixture.kickoff_time).getTime();
    if (Number.isNaN(kickoff) || referenceNow - kickoff <= graceMs) return false;
    return fixture.status !== 'finished' || fixture.team_a_score === null || fixture.team_b_score === null;
  });

  assert.deepEqual(
    stalePending.map((fixture) => ({
      external_match_id: fixture.external_match_id,
      teams: `${fixture.team_a} v ${fixture.team_b}`,
      kickoff_time: fixture.kickoff_time,
      status: fixture.status,
    })),
    [],
  );
});
