import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePlayers, previewPlayerMerge, setPublicStatsVisibility } from './admin-players.js';

test('merge moves non-conflicting picks and deactivates source', async () => {
  const supabase = createMemorySupabase();

  const result = await mergePlayers(supabase, {
    target_player_id: 'target',
    source_player_id: 'source',
    tournament_id: 'tournament-1',
    reason: 'Duplicate profile',
    conflict_resolutions: [{ match_id: 'match-conflict', keep: 'target' }],
  });

  assert.equal(result.counts.moved_predictions, 1);
  assert.equal(result.counts.conflicts_resolved, 1);
  assert.equal(supabase.tables.predictions.find((row) => row.id === 'source-transfer').player_id, 'target');
  assert.equal(supabase.tables.predictions.find((row) => row.id === 'source-conflict').player_id, 'source');
  const source = supabase.tables.players.find((row) => row.id === 'source');
  assert.equal(source.is_active, false);
  assert.match(source.deactivation_reason, /Merged into Target Player/);
});

test('merge can replace target conflict pick with source pick values', async () => {
  const supabase = createMemorySupabase();

  await mergePlayers(supabase, {
    target_player_id: 'target',
    source_player_id: 'source',
    tournament_id: 'tournament-1',
    reason: 'Use newer duplicate picks',
    conflict_resolutions: [{ match_id: 'match-conflict', keep: 'source' }],
  });

  const targetConflict = supabase.tables.predictions.find((row) => row.id === 'target-conflict');
  assert.equal(targetConflict.predicted_team_a_score, 3);
  assert.equal(targetConflict.predicted_team_b_score, 2);
  assert.equal(targetConflict.submitted_at, '2026-06-12T12:00:00Z');
  assert.equal(supabase.tables.predictions.find((row) => row.id === 'source-conflict').player_id, 'source');
});

test('merge transfers favorites and top 10 code when target has none', async () => {
  const supabase = createMemorySupabase();

  const result = await mergePlayers(supabase, {
    target_player_id: 'target',
    source_player_id: 'source',
    tournament_id: 'tournament-1',
    reason: 'Duplicate profile',
    conflict_resolutions: [{ match_id: 'match-conflict', keep: 'target' }],
  });

  assert.equal(result.counts.moved_favorites, 1);
  assert.equal(result.counts.skipped_favorites, 1);
  assert.equal(result.counts.moved_top10_code, 1);
  assert.equal(supabase.tables.player_favorite_teams.find((row) => row.id === 'source-fav-new').player_id, 'target');
  assert.equal(supabase.tables.player_favorite_teams.find((row) => row.id === 'source-fav-duplicate').player_id, 'source');
  assert.equal(supabase.tables.top10_player_codes.find((row) => row.id === 'source-code').player_id, 'target');
});

test('merge keeps target top 10 code when both players have codes', async () => {
  const supabase = createMemorySupabase();
  supabase.tables.top10_player_codes.push({
    id: 'target-code',
    tournament_id: 'tournament-1',
    player_id: 'target',
    code: 'BBBB',
  });

  const result = await mergePlayers(supabase, {
    target_player_id: 'target',
    source_player_id: 'source',
    tournament_id: 'tournament-1',
    reason: 'Duplicate profile',
    conflict_resolutions: [{ match_id: 'match-conflict', keep: 'target' }],
  });

  assert.equal(result.counts.moved_top10_code, 0);
  assert.equal(result.counts.skipped_top10_code, 1);
  assert.equal(supabase.tables.top10_player_codes.find((row) => row.id === 'source-code').player_id, 'source');
});

test('preview reports conflicts before merge', async () => {
  const supabase = createMemorySupabase();
  const preview = await previewPlayerMerge(supabase, {
    target_player_id: 'target',
    source_player_id: 'source',
    tournament_id: 'tournament-1',
  });

  assert.equal(preview.counts.transferable_predictions, 1);
  assert.equal(preview.counts.conflicts, 1);
  assert.equal(preview.conflicts[0].match.team_a, 'Argentina');
});

test('public stats visibility toggle keeps account active', async () => {
  const supabase = createMemorySupabase();

  const result = await setPublicStatsVisibility(supabase, {
    player_id: 'target',
    hidden: true,
  });

  assert.equal(result.player.hidden_from_public_stats, true);
  assert.equal(result.player.is_active, true);
});

function createMemorySupabase() {
  const tables = {
    players: [
      { id: 'target', tournament_id: 'tournament-1', name: 'Target Player', is_active: true },
      { id: 'source', tournament_id: 'tournament-1', name: 'Source Player', is_active: true },
    ],
    matches: [
      { id: 'match-conflict', tournament_id: 'tournament-1', team_a: 'Argentina', team_b: 'Algeria' },
      { id: 'match-transfer', tournament_id: 'tournament-1', team_a: 'Spain', team_b: 'Saudi Arabia' },
    ],
    predictions: [
      {
        id: 'target-conflict',
        tournament_id: 'tournament-1',
        player_id: 'target',
        match_id: 'match-conflict',
        predicted_team_a_score: 1,
        predicted_team_b_score: 0,
        submitted_at: '2026-06-11T12:00:00Z',
      },
      {
        id: 'source-conflict',
        tournament_id: 'tournament-1',
        player_id: 'source',
        match_id: 'match-conflict',
        predicted_team_a_score: 3,
        predicted_team_b_score: 2,
        submitted_at: '2026-06-12T12:00:00Z',
      },
      {
        id: 'source-transfer',
        tournament_id: 'tournament-1',
        player_id: 'source',
        match_id: 'match-transfer',
        predicted_team_a_score: 2,
        predicted_team_b_score: 1,
        submitted_at: '2026-06-12T13:00:00Z',
      },
    ],
    player_favorite_teams: [
      { id: 'target-fav', tournament_id: 'tournament-1', player_id: 'target', team_slug: 'argentina' },
      { id: 'source-fav-duplicate', tournament_id: 'tournament-1', player_id: 'source', team_slug: 'argentina' },
      { id: 'source-fav-new', tournament_id: 'tournament-1', player_id: 'source', team_slug: 'spain' },
    ],
    top10_player_codes: [
      { id: 'source-code', tournament_id: 'tournament-1', player_id: 'source', code: 'AAAA' },
    ],
  };
  return {
    tables,
    from(table) {
      return new MemoryQuery(tables, table);
    },
  };
}

class MemoryQuery {
  constructor(tables, table) {
    this.tables = tables;
    this.table = table;
    this.filters = [];
    this.pending = null;
  }

  select() {
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  in(field, values) {
    this.filters.push({ field, values: new Set(values), type: 'in' });
    return this;
  }

  update(patch) {
    this.pending = { type: 'update', patch };
    return this;
  }

  single() {
    const rows = this.applyFilters();
    if (this.pending?.type === 'update') {
      Object.assign(rows[0], this.pending.patch);
    }
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  then(resolve) {
    const rows = this.applyFilters();
    if (this.pending?.type === 'update') {
      rows.forEach((row) => Object.assign(row, this.pending.patch));
      resolve({ data: rows, error: null });
      return;
    }
    resolve({ data: rows, error: null });
  }

  applyFilters() {
    return this.tables[this.table].filter((row) =>
      this.filters.every((filter) => {
        if (filter.type === 'in') return filter.values.has(row[filter.field]);
        return row[filter.field] === filter.value;
      }),
    );
  }
}
