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

test('clone refresh copies legacy insight rows that only point at source match ids', async () => {
  const supabase = createMemorySupabase();
  const created = await createCloneGroup(supabase, {
    name: 'Family Group',
    slug: 'family-group',
    source_tournament_id: 'source-1',
  });
  supabase.tables.match_prediction_aids.push({
    id: 'aid-legacy',
    tournament_id: null,
    match_id: 'match-1',
    provider: 'API-Football',
    aid_type: 'api_prediction',
    title: 'API prediction',
    summary: 'Home team',
  });
  supabase.tables.match_odds.push({
    id: 'odds-source',
    tournament_id: 'source-1',
    match_id: 'match-1',
    provider: 'API-Football',
    bookmaker: 'Demo',
    market: 'Match Winner',
  });

  const result = await refreshCloneGroup(supabase, created.clone.id);
  const cloneMatch = supabase.tables.matches.find((row) => row.tournament_id === created.clone.id);
  const cloneAids = supabase.tables.match_prediction_aids.filter((row) => row.tournament_id === created.clone.id);
  const cloneOdds = supabase.tables.match_odds.filter((row) => row.tournament_id === created.clone.id);

  assert.equal(result.copy.match_prediction_aids, 1);
  assert.equal(result.copy.match_odds, 1);
  assert.equal(cloneAids.length, 1);
  assert.equal(cloneAids[0].match_id, cloneMatch.id);
  assert.equal(cloneOdds.length, 1);
  assert.equal(cloneOdds[0].match_id, cloneMatch.id);
});

test('clone refresh preserves valid match winner odds values for insight favorites', async () => {
  const supabase = createMemorySupabase();
  const created = await createCloneGroup(supabase, {
    name: 'Family Group',
    slug: 'family-group',
    source_tournament_id: 'source-1',
  });
  supabase.tables.match_odds.push({
    id: 'odds-source',
    tournament_id: 'source-1',
    match_id: 'match-1',
    provider: 'API-Football',
    bookmaker: 'Demo',
    market: 'Match Winner',
    home_value: '1.80',
    draw_value: '3.20',
    away_value: '4.50',
    last_synced_at: '2026-06-19T08:00:00.000Z',
  });

  const result = await refreshCloneGroup(supabase, created.clone.id);
  const cloneMatch = supabase.tables.matches.find((row) => row.tournament_id === created.clone.id);
  const cloneOdds = supabase.tables.match_odds.filter((row) => row.tournament_id === created.clone.id);

  assert.equal(result.copy.match_odds, 1);
  assert.equal(cloneOdds.length, 1);
  assert.equal(cloneOdds[0].match_id, cloneMatch.id);
  assert.equal(cloneOdds[0].home_value, '1.80');
  assert.equal(cloneOdds[0].draw_value, '3.20');
  assert.equal(cloneOdds[0].away_value, '4.50');
  assert.equal(cloneOdds[0].last_synced_at, '2026-06-19T08:00:00.000Z');
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

  in(field, values) {
    this.filters.push({ field, values: new Set(values), type: 'in' });
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
      this.filters.every((filter) => {
        if (filter.type === 'in') return filter.values.has(row[filter.field]);
        return row[filter.field] === filter.value;
      }),
    );
  }
}
