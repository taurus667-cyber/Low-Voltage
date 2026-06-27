import { createClient } from '@supabase/supabase-js';
import { getRequiredSupabaseEnv, isAdminAuthorized } from './api-football.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!isAdminAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });

  try {
    const required = getRequiredSupabaseEnv();
    if (required.error) throw new Error(required.error);
    const body = await getRequestBody(request);
    const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
      auth: { persistSession: false },
    });

    if (body.action === 'settings') {
      const result = await updateChampionBonusSettings(supabase, body);
      return response.status(200).json(result);
    }
    if (body.action === 'finalize') {
      const result = await finalizeChampionBonus(supabase, body);
      return response.status(200).json(result);
    }

    return response.status(400).json({ error: 'Unknown champion bonus action.' });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Champion bonus action failed.' });
  }
}

export async function updateChampionBonusSettings(supabase, body) {
  const tournamentId = cleanId(body.tournament_id);
  const lockAt = cleanDate(body.champion_bonus_lock_at);
  if (!tournamentId) throw new Error('Tournament id is required.');
  if (!lockAt) throw new Error('Champion bonus lock time is required.');

  const { data, error } = await supabase
    .from('tournaments')
    .update({ champion_bonus_lock_at: lockAt })
    .eq('id', tournamentId)
    .select()
    .single();
  if (error) throw error;
  return { action: 'settings', tournament: data };
}

export async function finalizeChampionBonus(supabase, body) {
  const tournamentId = cleanId(body.tournament_id);
  const teamSlug = cleanId(body.team_slug);
  const teamName = cleanName(body.team_name);
  if (!tournamentId) throw new Error('Tournament id is required.');
  if (!body.clear && !teamSlug && !teamName) throw new Error('Champion team is required.');

  const { data, error } = await supabase
    .from('tournaments')
    .update({
      champion_bonus_winner_team_slug: teamSlug || null,
      champion_bonus_winner_team_name: teamName || null,
    })
    .eq('id', tournamentId)
    .select()
    .single();
  if (error) throw error;
  return { action: 'finalize', tournament: data };
}

function cleanId(value) {
  return String(value || '').trim();
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function cleanDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('Champion bonus lock time is invalid.');
  return date.toISOString();
}

async function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
