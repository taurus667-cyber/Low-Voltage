import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloneGroup, refreshCloneGroup, refreshLinkedClonesForSource } from './clone-groups.js';

test('clone creation copies source football data without player data', async () => {
  const supabase = createMemorySupabase();
  const result = await createCloneGroup(supabase, {
    name: 'Family Group',
    slug: 'family-group',
    source_tournament_id: 'source-1',
  });

  assert.equal(result.clone.slug, 'family-group');
  assert.equal(result.copy.matches, 1);
  assert.equal(result.copy.teams, 1);
  assert.equal(supabase.tables.players.filter((row) => row.tournament_id === result.clone.id).length, 0);
  assert.equal(supabase.tables.predictions.filter((row) => row.tournament_id === result.clone.id).length, 0);
  assert.equal(supabase.tables.player_favorite_teams.filter((row) => row.tournament_id === result.clone.id).length, 0);
});

test('clone refresh preserves clone players and predictions', async () => {
  const supabase = createMemorySupabase();
  const created = await createCloneGroup(supabase, {
    name: 'Family Group',
    slug: 'family-group',
    source_tournament_id: 'source-1',
  });
  const cloneMatch = supabase.tables.matches.find((row) => row.tournament_id === created.clone.id);
  supabase.tables.players.push({ id: 'clone-player', tournament_id: created.clone.id, name: 'Clone Player', is_active: true });
  supabase.tables.predictions.push({
    id: 'clone-pick',
    tournament_id: created.clone.id,
    player_id: 'clone-player',
    match_id: cloneMatch.id,
  });

  const sourceMatch = supabase.tables.matches.find((row) => row.id === 'match-1');
  sourceMatch.team_a_score = 2;
  sourceMatch.team_b_score = 1;
  sourceMatch.status = 'finished';

  await refreshCloneGroup(supabase, created.clone.id);
  const refreshedCloneMatch = supabase.tables.matches.find((row) => row.id === cloneMatch.id);

  assert.equal(refreshedCloneMatch.team_a_score, 2);
  assert.equal(supabase.tables.players.some((row) => row.id === 'clone-player'), true);
  assert.equal(supabase.tables.predictions.some((row) => row.id === 'clone-pick'), true);
});

test('linked clone refresh copies live match-center data from source', async () => {
  const supabase = createMemorySupabase();
  const created = await createCloneGroup(supabase, {
    name: 'Family Group',
    slug: 'family-group',
    source_tournament_id: 'source-1',
  });
  const sourceMatch = supabase.tables.matches.find((row) => row.id === 'match-1');
  sourceMatch.status = 'live';
  sourceMatch.live_team_a_score = 1;
  sourceMatch.live_team_b_score = 0;
  sourceMatch.live_minute = 38;
  supabase.tables.match_statistics.push({
    id: 'stat-1',
    tournament_id: 'source-1',
    match_id: 'match-1',
    provider: 'API-Football',
    team_name: 'Mexico',
    statistics: { Possession: '54%' },
  });

  const result = await refreshLinkedClonesForSource(supabase, supabase.tables.tournaments[0]);
  const cloneMatch = supabase.tables.matches.find((row) => row.tournament_id === created.clone.id);
  const cloneStats = supabase.tables.match_statistics.filter((row) => row.tournament_id === created.clone.id);

  assert.equal(result.refreshed, 1);
  assert.equal(cloneMatch.status, 'live');
  assert.equal(cloneMatch.live_team_a_score, 1);
  assert.equal(cloneMatch.live_minute, 38);
  assert.equal(cloneStats.length, 1);
  assert.equal(cloneStats[0].match_id, cloneMatch.id);
});

function createMemorySupabase() {
  const tables = {
    tournaments: [{
      id: 'source-1',
      slug: 'source-app',
      name: 'Source App',
      api_football_league_id: '1',
      api_football_season: '2026',
      timezone: 'UTC',
      branding_text: 'Source',
      is_clone: false,
      is_active: true,
    }],
    teams: [{
      id: 'team-1',
      tournament_id: 'source-1',
      provider: 'API-Football',
      provider_team_id: '10',
      name: 'Mexico',
      slug: 'mexico',
    }],
    matches: [{
      id: 'match-1',
      tournament_id: 'source-1',
      external_match_id: 'fixture-1',
      team_a: 'Mexico',
      team_b: 'Canada',
      kickoff_time: '2026-06-20T20:00:00Z',
      status: 'scheduled',
      is_locked: false,
      is_published: true,
    }],
    match_events: [{
      id: 'event-1',
      tournament_id: 'source-1',
      match_id: 'match-1',
      provider: 'API-Football',
      event_key: 'event-1',
    }],
    match_statistics: [],
    match_lineups: [],
    match_prediction_aids: [],
    match_odds: [],
    players: [],
    predictions: [],
    player_favorite_teams: [],
  };
  let idCounter = 1;
  return {
    tables,
    from(table) {
      return new MemoryQuery(tables, table, () => `generated-${idCounter++}`);
    },
  };
}

class MemoryQuery {
  constructor(tables, table, nextId) {
    this.tables = tables;
    this.table = table;
    this.nextId = nextId;
    this.filters = [];
    this.pending = null;
  }

  select() {
    this.pending = this.pending || { type: 'select' };
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  order() {
    return this;
  }

  maybeSingle() {
    const rows = this.applyFilters();
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  single() {
    if (this.pending?.type === 'insert') {
      const row = this.pending.rows[0];
      this.tables[this.table].push(row);
      return Promise.resolve({ data: row, error: null });
    }
    if (this.pending?.type === 'update') {
      const rows = this.applyFilters();
      Object.assign(rows[0], this.pending.patch);
      return Promise.resolve({ data: rows[0], error: null });
    }
    return Promise.resolve({ data: this.applyFilters()[0] || null, error: null });
  }

  insert(payload) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
      id: row.id || this.nextId(),
      ...row,
    }));
    this.pending = { type: 'insert', rows };
    if (Array.isArray(payload)) {
      this.tables[this.table].push(...rows);
      return Promise.resolve({ data: rows, error: null });
    }
    return this;
  }

  upsert(payload) {
    const rows = Array.isArray(payload) ? payload : [payload];
    rows.forEach((row) => {
      const existing = this.tables[this.table].find((item) =>
        item.tournament_id === row.tournament_id &&
        item.provider === row.provider &&
        item.provider_team_id === row.provider_team_id,
      );
      if (existing) Object.assign(existing, row);
      else this.tables[this.table].push({ id: row.id || this.nextId(), ...row });
    });
    return Promise.resolve({ data: rows, error: null });
  }

  update(patch) {
    this.pending = { type: 'update', patch };
    return this;
  }

  delete() {
    this.pending = { type: 'delete' };
    return this;
  }

  then(resolve) {
    if (this.pending?.type === 'delete') {
      const toDelete = new Set(this.applyFilters());
      this.tables[this.table] = this.tables[this.table].filter((row) => !toDelete.has(row));
      resolve({ data: null, error: null });
      return;
    }
    resolve({ data: this.applyFilters(), error: null });
  }

  applyFilters() {
    return this.tables[this.table].filter((row) =>
      this.filters.every((filter) => row[filter.field] === filter.value),
    );
  }
}
