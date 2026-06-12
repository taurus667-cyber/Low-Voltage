export const API_FOOTBALL_HOST = 'v3.football.api-sports.io';

export function getRequiredServerEnv() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  if (!supabaseUrl) return { error: 'Missing SUPABASE_URL or VITE_SUPABASE_URL.' };
  if (!serviceRoleKey) return { error: 'Missing SUPABASE_SERVICE_ROLE_KEY.' };
  if (!apiFootballKey) return { error: 'Missing API_FOOTBALL_KEY.' };
  return { supabaseUrl, serviceRoleKey, apiFootballKey };
}

export function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.authorization || '';
  const querySecret = request.query?.secret || '';
  return header === `Bearer ${expected}` || querySecret === expected;
}

export async function fetchApiFootball(path, params, apiKey) {
  const url = new URL(`https://${API_FOOTBALL_HOST}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    headers: {
      'x-apisports-key': apiKey,
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': API_FOOTBALL_HOST,
    },
  });
  if (!response.ok) throw new Error(`API-Football ${path} failed with ${response.status}.`);
  const payload = await response.json();
  return payload.response || [];
}

export async function getActiveTournament(supabase) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || {
    id: null,
    name: process.env.TOURNAMENT_NAME || 'FIFA World Cup 2026',
    slug: process.env.TOURNAMENT_SLUG || 'world-cup-2026',
    api_football_league_id: process.env.API_FOOTBALL_LEAGUE_ID || '1',
    api_football_season: process.env.API_FOOTBALL_SEASON || '2026',
    timezone: process.env.TOURNAMENT_TIMEZONE || 'UTC',
  };
}

export function numberOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

export function normalizeTeamName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}
