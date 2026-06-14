import { isAdminAuthorized, toPublicErrorMessage } from './api-football.js';
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

    return response.status(200).json({ sync, ...result });
  } catch (error) {
    return response.status(500).json({ error: toPublicErrorMessage(error) });
  }
}

async function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
