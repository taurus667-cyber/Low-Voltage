const viteEnv = import.meta.env || {};

export const FALLBACK_TOURNAMENT = {
  id: null,
  slug: viteEnv.VITE_TOURNAMENT_SLUG || 'world-cup-2026',
  name: viteEnv.VITE_TOURNAMENT_NAME || 'FIFA World Cup 2026',
  branding_text: viteEnv.VITE_TOURNAMENT_BRANDING || 'Private friends group',
  api_football_league_id: viteEnv.VITE_API_FOOTBALL_LEAGUE_ID || '1',
  api_football_season: viteEnv.VITE_API_FOOTBALL_SEASON || '2026',
  timezone: viteEnv.VITE_TOURNAMENT_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
  is_active: true,
};

export function getActiveTournament(tournaments = []) {
  return tournaments.find((tournament) => tournament.is_active) || tournaments[0] || FALLBACK_TOURNAMENT;
}

export function getTournamentBySlug(tournaments = [], slug = '') {
  const normalizedSlug = String(slug || '').toLowerCase();
  if (!normalizedSlug) return null;
  return tournaments.find((tournament) => String(tournament.slug || '').toLowerCase() === normalizedSlug) || null;
}

export function scopedRows(rows = [], tournament) {
  if (!tournament?.id) return rows;
  return rows.filter((row) => !row.tournament_id || row.tournament_id === tournament.id);
}
