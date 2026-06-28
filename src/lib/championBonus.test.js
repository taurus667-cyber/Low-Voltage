import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChampionBonusLeaderboard,
  buildChampionBonusTeams,
  calculateChampionBonus,
  getChampionBonusLockAt,
  getPotentialBonusForTeam,
} from './championBonus.js';

const tournament = {
  id: 't1',
  champion_bonus_lock_at: '2026-06-28T16:00:00Z',
};

const players = [
  { id: 'p1', tournament_id: 't1', name: 'Player One', is_active: true },
  { id: 'p2', tournament_id: 't1', name: 'Player Two', is_active: true },
  { id: 'p3', tournament_id: 't1', name: 'Player Three', is_active: true },
  { id: 'p4', tournament_id: 't1', name: 'Hidden Player', is_active: true, hidden_from_public_stats: true },
  { id: 'p5', tournament_id: 't1', name: 'Inactive Player', is_active: false },
];

const picks = [
  { id: 'c1', tournament_id: 't1', player_id: 'p1', team_slug: 'brazil', team_name: 'Brazil' },
  { id: 'c2', tournament_id: 't1', player_id: 'p2', team_slug: 'brazil', team_name: 'Brazil' },
  { id: 'c3', tournament_id: 't1', player_id: 'p3', team_slug: 'japan', team_name: 'Japan' },
  { id: 'c4', tournament_id: 't1', player_id: 'p4', team_slug: 'brazil', team_name: 'Brazil' },
  { id: 'c5', tournament_id: 't1', player_id: 'p5', team_slug: 'japan', team_name: 'Japan' },
];

test('legacy champion bonus cutoff follows first concrete Round of 32 kickoff', () => {
  const lockAt = getChampionBonusLockAt(tournament, [
    {
      id: 'm73',
      stage: 'Round of 32',
      bracket_round: 'round-of-32',
      team_a: 'Winner Group A',
      team_b: 'Runner-up Group C',
      kickoff_time: '2026-06-28T17:00:00Z',
    },
    {
      id: 'm75',
      stage: 'Round of 32',
      bracket_round: 'round-of-32',
      team_a: 'South Africa',
      team_b: 'Canada',
      kickoff_time: '2026-06-28T19:00:00Z',
    },
  ]);

  assert.equal(lockAt, '2026-06-28T19:00:00.000Z');
});

test('bonus pool equals active public player count and ignores hidden players', () => {
  const bonus = calculateChampionBonus({ players, picks, tournament, now: new Date('2026-06-27T12:00:00Z') });

  assert.equal(bonus.pool, 3);
  assert.equal(bonus.pick_count, 3);
  assert.equal(bonus.bonusByPlayer.get('p1').potential_bonus, 1.5);
  assert.equal(bonus.bonusByPlayer.get('p2').potential_bonus, 1.5);
  assert.equal(bonus.bonusByPlayer.get('p3').potential_bonus, 3);
  assert.equal(bonus.bonusByPlayer.has('p4'), false);
  assert.equal(bonus.bonusByPlayer.has('p5'), false);
});

test('unpicked teams show the full solo-pick potential', () => {
  const bonus = calculateChampionBonus({ players, picks, tournament, now: new Date('2026-06-27T12:00:00Z') });

  assert.equal(getPotentialBonusForTeam({ slug: 'canada', name: 'Canada' }, bonus), 3);
});

test('finalized champion awards only players who chose the champion', () => {
  const bonus = calculateChampionBonus({
    players,
    picks,
    tournament: {
      ...tournament,
      champion_bonus_winner_team_slug: 'brazil',
      champion_bonus_winner_team_name: 'Brazil',
    },
  });

  assert.equal(bonus.finalized, true);
  assert.equal(bonus.bonusByPlayer.get('p1').champion_bonus, 1.5);
  assert.equal(bonus.bonusByPlayer.get('p2').champion_bonus, 1.5);
  assert.equal(bonus.bonusByPlayer.get('p3').champion_bonus, 0);
});

test('leaderboard rows show projected bonus without reranking current points', () => {
  const rows = buildChampionBonusLeaderboard({
    players: [
      ...players,
      { id: 'p6', tournament_id: 't1', name: 'Point Leader', is_active: true },
    ],
    predictions: [
      {
        id: 'pred-1',
        player_id: 'p6',
        match_id: 'm1',
        predicted_team_a_score: 1,
        predicted_team_b_score: 0,
      },
    ],
    matches: [{
      id: 'm1',
      is_published: true,
      status: 'finished',
      team_a: 'A',
      team_b: 'B',
      team_a_score: 1,
      team_b_score: 0,
      kickoff_time: '2026-06-20T12:00:00Z',
    }],
    picks,
    tournament,
  });

  assert.equal(rows[0].player_id, 'p6');
  assert.equal(rows.find((row) => row.player_id === 'p3').potential_champion_bonus, 4);
  assert.equal(rows.find((row) => row.player_id === 'p3').projected_total_points, 4);
});

test('finalized champion bonus can rerank final totals', () => {
  const rows = buildChampionBonusLeaderboard({
    players: [
      { id: 'p1', tournament_id: 't1', name: 'Base Leader', is_active: true },
      { id: 'p2', tournament_id: 't1', name: 'Champion Picker', is_active: true },
    ],
    matches: [{
      id: 'm1',
      is_published: true,
      status: 'finished',
      team_a: 'A',
      team_b: 'B',
      team_a_score: 1,
      team_b_score: 0,
      kickoff_time: '2026-06-20T12:00:00Z',
    }],
    predictions: [
      { id: 'pred-1', player_id: 'p1', match_id: 'm1', predicted_team_a_score: 2, predicted_team_b_score: 0 },
    ],
    picks: [
      { id: 'champ-1', tournament_id: 't1', player_id: 'p2', team_slug: 'brazil', team_name: 'Brazil' },
    ],
    tournament: {
      ...tournament,
      champion_bonus_winner_team_slug: 'brazil',
      champion_bonus_winner_team_name: 'Brazil',
    },
  });

  assert.equal(rows[0].player_id, 'p2');
  assert.equal(rows[0].champion_bonus, 2);
  assert.equal(rows[0].projected_total_points, 2);
});

test('Round of 32 cards include concrete teams and disabled placeholders', () => {
  const cards = buildChampionBonusTeams([
    {
      id: 'm73',
      tournament_id: 't1',
      is_published: true,
      bracket_round: 'round-of-32',
      bracket_slot: 'M73',
      stage: 'Round of 32',
      team_a: 'Brazil',
      team_b: 'Japan',
      kickoff_time: '2026-06-29T17:00:00Z',
    },
    {
      id: 'm74',
      tournament_id: 't1',
      is_published: true,
      bracket_round: 'round-of-32',
      bracket_slot: 'M74',
      stage: 'Round of 32',
      team_a: 'Winner Group B',
      team_b: 'Best 3rd Group A/C/D/E/F',
      kickoff_time: '2026-06-28T17:00:00Z',
      is_placeholder: true,
    },
  ]);

  assert.equal(cards.some((card) => card.name === 'Brazil' && card.concrete), true);
  assert.equal(cards.some((card) => card.name === 'Winner Group B' && card.placeholder), true);
});
