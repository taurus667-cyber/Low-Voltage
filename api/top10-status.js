import { createClient } from '@supabase/supabase-js';
import { getRequiredSupabaseEnv, isAdminAuthorized } from './api-football.js';
import { generateTop10Code, syncTop10Codes } from './top10-core.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  try {
    const body = await getRequestBody(request);
    const required = getRequiredSupabaseEnv();
    if (required.error) throw new Error(required.error);
    const supabase = createClient(required.supabaseUrl, required.serviceRoleKey, {
      auth: { persistSession: false },
    });
    const tournament = await getTournament(supabase, body);
    if (!tournament?.id) throw new Error('Tournament was not found.');

    if (body.action === 'sync') {
      return response.status(200).json(await syncTop10Codes(supabase, tournament.id));
    }

    if (body.action === 'check') {
      const codeRow = await getCodeRow(supabase, tournament.id, body.player_id);
      return response.status(200).json({ protected: Boolean(codeRow), requiresCode: Boolean(codeRow) });
    }

    if (body.action === 'verify') {
      const codeRow = await getCodeRow(supabase, tournament.id, body.player_id);
      if (!codeRow) return response.status(200).json({ verified: true, protected: false });
      if (normalizeCode(body.code) !== codeRow.code) {
        return response.status(403).json({ error: 'Top 10 code is incorrect.' });
      }
      const player = await getPlayer(supabase, body.player_id);
      return response.status(200).json({ verified: true, protected: true, player });
    }

    if (body.action === 'rename') {
      const cleanName = String(body.name || '').trim().replace(/\s+/g, ' ');
      if (!cleanName) return response.status(400).json({ error: 'Player name is required.' });
      const codeRow = await getCodeRow(supabase, tournament.id, body.player_id);
      let renameAuth = { allowed: true, revealCode: false };
      if (codeRow) {
        const player = await getPlayer(supabase, body.player_id);
        renameAuth = getProtectedRenameAuthorization({
          player,
          codeRow,
          playerToken: body.player_token,
          code: body.code,
          cleanName,
        });
        if (!renameAuth.allowed) return response.status(403).json({ error: 'Top 10 code is required to update this protected profile.' });
      }
      const { data, error } = await supabase
        .from('players')
        .update({ name: cleanName })
        .eq('id', body.player_id)
        .select()
        .single();
      if (error) throw error;
      if (renameAuth.revealCode) {
        const { error: showError } = await supabase.from('top10_player_codes').update({ shown_at: new Date().toISOString() }).eq('id', codeRow.id);
        if (showError) throw showError;
        return response.status(200).json({ player: data, protectionCode: codeRow.code, firstReveal: true });
      }
      return response.status(200).json({ player: data });
    }

    if (body.action === 'reveal') {
      const player = await getPlayer(supabase, body.player_id);
      if (!player || player.player_token !== body.player_token) return response.status(403).json({ error: 'Profile token is invalid.' });
      const codeRow = await getCodeRow(supabase, tournament.id, body.player_id);
      if (!codeRow) return response.status(200).json({ protected: false });
      if (!codeRow.shown_at) {
        const { error } = await supabase.from('top10_player_codes').update({ shown_at: new Date().toISOString() }).eq('id', codeRow.id);
        if (error) throw error;
      }
      return response.status(200).json({ protected: true, status_label: codeRow.status_label, code: codeRow.code, firstReveal: !codeRow.shown_at });
    }

    if (body.action === 'admin-list') {
      if (!isAdminAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });
      const { data, error } = await supabase
        .from('top10_player_codes')
        .select('*, players(name)')
        .eq('tournament_id', tournament.id)
        .order('created_at');
      if (error) throw error;
      return response.status(200).json({ codes: data || [] });
    }

    if (body.action === 'admin-reset') {
      if (!isAdminAuthorized(request)) return response.status(401).json({ error: 'Unauthorized' });
      const code = generateTop10Code();
      const { data, error } = await supabase
        .from('top10_player_codes')
        .update({ code, shown_at: null, updated_at: new Date().toISOString() })
        .eq('id', body.code_id)
        .select('*, players(name)')
        .single();
      if (error) throw error;
      return response.status(200).json({ code: data });
    }

    return response.status(400).json({ error: 'Unknown Top 10 action.' });
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Top 10 status failed.' });
  }
}

async function getTournament(supabase, body) {
  let query = supabase.from('tournaments').select('*');
  if (body.tournament_id) query = query.eq('id', body.tournament_id);
  else if (body.tournament_slug) query = query.eq('slug', String(body.tournament_slug).toLowerCase());
  else query = query.eq('is_active', true);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function getCodeRow(supabase, tournamentId, playerId) {
  if (!playerId) return null;
  const { data, error } = await supabase
    .from('top10_player_codes')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (isMissingOptionalRelation(error)) return null;
  if (error) throw error;
  return data || null;
}

async function getPlayer(supabase, playerId) {
  const { data, error } = await supabase.from('players').select('*').eq('id', playerId).maybeSingle();
  if (error) throw error;
  return data;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function getProtectedRenameAuthorization({ player, codeRow, playerToken, code, cleanName }) {
  if (!codeRow) return { allowed: true, revealCode: false };
  const tokenMatches = Boolean(player?.player_token && player.player_token === playerToken);
  const codeMatches = normalizeCode(code) === codeRow.code;
  const firstSingleNameUpgrade = !tokenMatches &&
    !codeMatches &&
    !codeRow.shown_at &&
    isIncompleteProfileName(player?.name) &&
    hasFullName(cleanName);
  return {
    allowed: tokenMatches || codeMatches || firstSingleNameUpgrade,
    revealCode: firstSingleNameUpgrade,
  };
}

function hasFullName(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length >= 2;
}

function isIncompleteProfileName(value) {
  return !hasFullName(value);
}

function isMissingOptionalRelation(error) {
  if (!error) return false;
  return error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /could not find the table|schema cache|does not exist|relation .*top10_player_codes/i.test(error.message || '');
}

async function getRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
