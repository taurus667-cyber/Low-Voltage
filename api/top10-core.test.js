import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTop10Code, getTop10Entrants, syncTop10Codes } from './top10-core.js';

test('generates four uppercase alphanumeric code characters', () => {
  const code = generateTop10Code(() => 0);
  assert.match(code, /^[A-Z0-9]{4}$/);
  assert.equal(code.length, 4);
});

test('selects top 10 from finished matches only', () => {
  const players = Array.from({ length: 12 }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
    is_active: true,
  }));
  const matches = [
    { id: 'finished', status: 'finished', kickoff_time: '2026-06-11T20:00:00Z', team_a_score: 1, team_b_score: 0 },
    { id: 'future', status: 'scheduled', kickoff_time: '2026-06-12T20:00:00Z' },
  ];
  const predictions = players.map((player, index) => ({
    id: `prediction-${player.id}`,
    player_id: player.id,
    match_id: index === 11 ? 'future' : 'finished',
    predicted_team_a_score: 1,
    predicted_team_b_score: 0,
    submitted_at: '2026-06-11T19:00:00Z',
  }));

  const result = getTop10Entrants(players, matches, predictions);
  assert.equal(result.entrants.length, 10);
  assert.equal(result.entrants[0].rank, 1);
  assert.equal(result.entrants.some((row) => row.player_id === 'player-12'), false);
});

test('sync creates codes only for newly protected top 10 entrants', async () => {
  const supabase = createMemorySupabase();
  const first = await syncTop10Codes(supabase, 'tournament-1');
  const second = await syncTop10Codes(supabase, 'tournament-1');

  assert.equal(first.created, 10);
  assert.equal(second.created, 0);
  assert.equal(supabase.tables.top10_player_codes.length, 10);
  assert.equal(new Set(supabase.tables.top10_player_codes.map((row) => row.player_id)).size, 10);
});

function createMemorySupabase() {
  const players = Array.from({ length: 11 }, (_, index) => ({
    id: `player-${index + 1}`,
    tournament_id: 'tournament-1',
    name: `Player ${index + 1}`,
    is_active: true,
  }));
  const tables = {
    players,
    matches: [{
      id: 'match-1',
      tournament_id: 'tournament-1',
      status: 'finished',
      is_published: true,
      kickoff_time: '2026-06-11T20:00:00Z',
      team_a_score: 2,
      team_b_score: 1,
    }],
    predictions: players.map((player) => ({
      id: `prediction-${player.id}`,
      tournament_id: 'tournament-1',
      player_id: player.id,
      match_id: 'match-1',
      predicted_team_a_score: 2,
      predicted_team_b_score: 1,
      submitted_at: '2026-06-11T19:00:00Z',
    })),
    top10_player_codes: [],
  };
  let id = 1;
  return {
    tables,
    from(table) {
      return new MemoryQuery(tables, table, () => `generated-${id++}`);
    },
  };
}

class MemoryQuery {
  constructor(tables, table, nextId) {
    this.tables = tables;
    this.table = table;
    this.nextId = nextId;
    this.filters = [];
  }

  select() {
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  insert(payload) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ id: row.id || this.nextId(), ...row }));
    this.tables[this.table].push(...rows);
    return Promise.resolve({ data: rows, error: null });
  }

  then(resolve) {
    resolve({ data: this.applyFilters(), error: null });
  }

  applyFilters() {
    return this.tables[this.table].filter((row) => this.filters.every((filter) => row[filter.field] === filter.value));
  }
}
