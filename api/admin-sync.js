import { isAdminAuthorized, toPublicErrorMessage } from './api-football.js';
import { createClient } from '@supabase/supabase-js';
import { getActiveTournament, getRequiredServerEnv } from './api-football.js';
import { refreshCloneGroup } from './clone-groups.js';
import { runLiveScoreSync } from './sync-live-scores.js';
import { runPrematchSync } from './sync-prematch-data.js';

const SYNC_TYPES = new Set(['prematch', 'live', 'all']);

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!isAdminAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    const body = await getRequestBody(request);
    const sync = SYNC_TYPES.has(body.sync) ? body.sync : 'all';
    const result = {};

    if (sync === 'prematch' || sync === 'all') result.prematch = await runPrematchSync();
    if (sync === 'live' || sync === 'all') result.live = await runLiveScoreSync();
    result.clones = await refreshLinkedClones();

    return response.status(200).json({ sync, ...result });
  } catch (error) {
    return response.status(500).json({ error: toPublicErrorMessage(error) });
  }
}

async function refreshLinkedClones() {
  const required = getRequiredServerEnv();
  if (required.error) return { refreshed: 0, skipped: required.error };
  const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const source = await getActiveTournament(supabase);
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

async function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
