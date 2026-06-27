import { isAdminAuthorized, toPublicErrorMessage } from './api-football.js';
import { createClient } from '@supabase/supabase-js';
import { getActiveTournament, getRequiredServerEnv } from './api-football.js';
import { refreshLinkedClonesForSource } from './clone-groups.js';
import { runLiveScoreSync } from './sync-live-scores.js';
import { runPrematchSync } from './sync-prematch-data.js';
import { runBracketSync } from './sync-bracket-data.js';

const SYNC_TYPES = new Set(['prematch', 'live', 'bracket', 'all']);

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!isAdminAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    const body = await getRequestBody(request);
    const sync = SYNC_TYPES.has(body.sync) ? body.sync : 'all';
    const result = await runAdminSync(sync);

    return response.status(200).json({ sync, ...result });
  } catch (error) {
    return response.status(500).json({ error: toPublicErrorMessage(error) });
  }
}

export async function runAdminSync(sync, runners = {}) {
  const runBracket = runners.runBracketSync || runBracketSync;
  const runPrematch = runners.runPrematchSync || runPrematchSync;
  const runLive = runners.runLiveScoreSync || runLiveScoreSync;
  const refreshClones = runners.refreshLinkedClones || refreshLinkedClones;
  const result = {};

  if (sync === 'bracket' || sync === 'all') result.bracket = await runBracket();
  if (sync === 'prematch' || sync === 'all') result.prematch = await runPrematch();
  if (sync === 'live' || sync === 'all') result.live = await runLive();
  result.clones = result.live?.clones || result.prematch?.clones || result.bracket?.clones || await refreshClones();

  return result;
}

async function refreshLinkedClones() {
  const required = getRequiredServerEnv();
  if (required.error) return { refreshed: 0, skipped: required.error };
  const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const source = await getActiveTournament(supabase);
  return refreshLinkedClonesForSource(supabase, source);
}

async function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
