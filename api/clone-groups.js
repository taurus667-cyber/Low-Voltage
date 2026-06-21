import { createClient } from '@supabase/supabase-js';
import { isAdminAuthorized } from './api-football.js';

const FOOTBALL_CHILD_TABLES = [
  'match_events',
  'match_statistics',
  'match_lineups',
  'match_prediction_aids',
  'match_odds',
];

const MATCH_COPY_FIELDS = [
  'external_match_id',
  'team_a',
  'team_b',
  'team_a_source_id',
  'team_b_source_id',
  'kickoff_time',
  'venue',
  'group_name',
  'stage',
  'bracket_round',
  'bracket_slot',
  'bracket_side',
  'winner_to_slot',
  'winner_to_side',
  'loser_to_slot',
  'team_a_score',
  'team_b_score',
  'status',
  'is_locked',
  'is_published',
  'live_source',
  'live_source_match_id',
  'live_team_a_score',
  'live_team_b_score',
  'live_minute',
  'live_status_note',
  'last_synced_at',
];

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!isAdminAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    const required = getRequiredCloneEnv();
    if (required.error) throw new Error(required.error);
    const body = await getRequestBody(request);
    const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
      auth: { persistSession: false },
    });

    if (body.action === 'create') {
      const result = await createCloneGroup(supabase, body);
      return response.status(200).json(result);
    }
    if (body.action === 'refresh') {
      const result = await refreshCloneGroup(supabase, body.clone_tournament_id);
      return response.status(200).json(result);
    }
    return response.status(400).json({ error: 'Unknown clone action.' });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Clone operation failed.' });
  }
}

function getRequiredCloneEnv() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) return { error: 'Missing SUPABASE_URL or VITE_SUPABASE_URL.' };
  if (!serviceRoleKey) return { error: 'Missing SUPABASE_SERVICE_ROLE_KEY.' };
  return { supabaseUrl, serviceRoleKey };
}

export async function createCloneGroup(supabase, body) {
  const name = String(body.name || '').trim();
  const slug = normalizeSlug(body.slug || name);
  const sourceTournamentId = String(body.source_tournament_id || '').trim();
  if (!name) throw new Error('Group name is required.');
  if (!slug) throw new Error('Group slug is required.');
  if (!sourceTournamentId) throw new Error('Source tournament is required.');

  const source = await fetchSourceTournament(supabase, sourceTournamentId);
  const { data: clone, error } = await supabase
    .from('tournaments')
    .insert({
      name,
      slug,
      api_football_league_id: source.api_football_league_id,
      api_football_season: source.api_football_season,
      timezone: source.timezone,
      branding_text: source.branding_text || 'Private group clone',
      is_active: false,
      is_clone: true,
      source_tournament_id: source.id,
      parent_tournament_id: source.id,
    })
    .select()
    .single();
  if (error) throw error;

  const copy = await copySourceFootballData(supabase, source.id, clone.id);
  return { action: 'create', clone, source, copy };
}

export async function refreshCloneGroup(supabase, cloneTournamentId) {
  if (!cloneTournamentId) throw new Error('Clone tournament id is required.');
  const { data: clone, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', cloneTournamentId)
    .maybeSingle();
  if (error) throw error;
  if (!clone) throw new Error('Clone tournament was not found.');
  if (!clone.is_clone || !clone.source_tournament_id) {
    throw new Error('Only clone tournaments can be internally refreshed.');
  }

  const source = await fetchSourceTournament(supabase, clone.source_tournament_id);
  const copy = await copySourceFootballData(supabase, source.id, clone.id);
  return { action: 'refresh', clone, source, copy };
}

export async function refreshLinkedClonesForSource(supabase, source) {
  if (!source?.id) return { refreshed: 0 };
  const { data: clones, error } = await supabase
    .from('tournaments')
    .select('id,name')
    .eq('is_clone', true)
    .eq('source_tournament_id', source.id);
  if (error) throw error;
  const refreshed = [];
  for (const clone of clones || []) {
    const result = await refreshCloneGroup(supabase, clone.id);
    refreshed.push({ id: clone.id, name: clone.name, matches: result.copy.matches || 0 });
  }
  return { source: source.slug, refreshed: refreshed.length, groups: refreshed };
}

async function fetchSourceTournament(supabase, id) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Source tournament was not found.');
  if (data.is_clone) throw new Error('Choose one of the original source apps, not another clone.');
  return data;
}

async function copySourceFootballData(supabase, sourceTournamentId, targetTournamentId) {
  const teams = await copyTeams(supabase, sourceTournamentId, targetTournamentId);
  const { matchMap, matches } = await copyMatches(supabase, sourceTournamentId, targetTournamentId);
  const childCounts = {};
  for (const table of FOOTBALL_CHILD_TABLES) {
    childCounts[table] = await replaceChildRows(supabase, table, sourceTournamentId, targetTournamentId, matchMap);
  }
  const refreshedAt = new Date().toISOString();
  const { error } = await supabase
    .from('tournaments')
    .update({ last_internal_refresh_at: refreshedAt })
    .eq('id', targetTournamentId);
  if (error) throw error;
  return { teams, matches, ...childCounts, refreshedAt };
}

async function copyTeams(supabase, sourceTournamentId, targetTournamentId) {
  const { data: sourceRows, error } = await supabase
    .from('teams')
    .select('*')
    .eq('tournament_id', sourceTournamentId);
  if (error) throw error;
  const rows = (sourceRows || []).map((row) => omit(row, ['id', 'created_at', 'updated_at'])).map((row) => ({
    ...row,
    tournament_id: targetTournamentId,
  }));
  if (!rows.length) return 0;
  const { error: upsertError } = await supabase
    .from('teams')
    .upsert(rows, { onConflict: 'tournament_id,provider,provider_team_id' });
  if (upsertError) throw upsertError;
  return rows.length;
}

async function copyMatches(supabase, sourceTournamentId, targetTournamentId) {
  const { data: sourceRows, error } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', sourceTournamentId)
    .order('kickoff_time');
  if (error) throw error;

  const { data: targetRows, error: targetError } = await supabase
    .from('matches')
    .select('id,source_match_id')
    .eq('tournament_id', targetTournamentId);
  if (targetError) throw targetError;
  const existingBySource = new Map((targetRows || []).map((row) => [row.source_match_id, row]));
  const matchMap = new Map();

  for (const source of sourceRows || []) {
    const payload = {
      tournament_id: targetTournamentId,
      source_match_id: source.id,
      ...Object.fromEntries(MATCH_COPY_FIELDS.map((field) => [field, source[field] ?? null])),
    };
    const existing = existingBySource.get(source.id);
    const query = existing
      ? supabase.from('matches').update(payload).eq('id', existing.id).select('id').single()
      : supabase.from('matches').insert(payload).select('id').single();
    const { data, error: writeError } = await query;
    if (writeError) throw writeError;
    matchMap.set(source.id, data.id);
  }

  return { matchMap, matches: sourceRows?.length || 0 };
}

async function replaceChildRows(supabase, table, sourceTournamentId, targetTournamentId, matchMap) {
  const { error: deleteError } = await supabase
    .from(table)
    .delete()
    .eq('tournament_id', targetTournamentId);
  if (deleteError) throw deleteError;

  const sourceMatchIds = [...matchMap.keys()];
  if (!sourceMatchIds.length) return 0;
  const { data: sourceRows, error } = await supabase
    .from(table)
    .select('*')
    .in('match_id', sourceMatchIds);
  if (error) throw error;

  const rows = (sourceRows || [])
    .map((row) => {
      const targetMatchId = matchMap.get(row.match_id);
      if (!targetMatchId) return null;
      return {
        ...omit(row, ['id', 'created_at', 'updated_at']),
        tournament_id: targetTournamentId,
        match_id: targetMatchId,
      };
    })
    .filter(Boolean);
  if (!rows.length) return 0;
  const { error: insertError } = await supabase.from(table).insert(rows);
  if (insertError) throw insertError;
  return rows.length;
}

function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function omit(row, keys) {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(row || {}).filter(([key]) => !blocked.has(key)));
}

async function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
