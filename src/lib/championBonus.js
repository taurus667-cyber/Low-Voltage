import { buildBracket, isPlaceholderTeam } from './bracket.js';
import { calculateLeaderboard } from './scoring.js';
import { isPlayerActive, isPublicStatsPlayer } from './playerVisibility.js';
import { normalizeName, teamIdentity } from './teamMetadata.js';

export const DEFAULT_CHAMPION_BONUS_LOCK_AT = '2026-06-28T16:00:00Z';

export function getChampionBonusLockAt(tournament) {
  return tournament?.champion_bonus_lock_at || DEFAULT_CHAMPION_BONUS_LOCK_AT;
}

export function getChampionBonusChampion(tournament) {
  const slug = String(tournament?.champion_bonus_winner_team_slug || '').trim();
  const name = String(tournament?.champion_bonus_winner_team_name || '').trim();
  if (!slug && !name) return null;
  return { slug, name };
}

export function isChampionBonusLocked(tournament, now = new Date()) {
  const lockAt = getChampionBonusLockAt(tournament);
  const timestamp = new Date(lockAt).getTime();
  return Number.isFinite(timestamp) && now.getTime() >= timestamp;
}

export function buildChampionBonusTeams(matches = [], teams = []) {
  const bracket = buildBracket(matches);
  const roundOf32 = bracket.rounds.find((round) => round.key === 'round-of-32')?.matches || [];
  const cards = [];
  const seen = new Set();

  roundOf32.forEach((match) => {
    ['team_a', 'team_b'].forEach((field) => {
      const label = match[field];
      const slotSide = field === 'team_a' ? 'A' : 'B';
      const concrete = !isPlaceholderTeam(label);
      const team = concrete ? teamIdentity(label, teams) : null;
      const slug = concrete ? team.slug : `${match.bracket_slot || match.id}-${slotSide}`.toLowerCase();
      if (seen.has(slug)) return;
      seen.add(slug);
      cards.push({
        key: slug,
        slug,
        name: concrete ? team.name : label,
        team,
        concrete,
        bracket_slot: match.bracket_slot,
        placeholder: !concrete,
      });
    });
  });

  return cards.slice(0, 32);
}

export function getChampionPickTeamKey(pick) {
  return String(pick?.team_slug || normalizeName(pick?.team_name || '')).trim();
}

export function getCurrentChampionPick(picks = [], playerId) {
  if (!playerId) return null;
  return picks.find((pick) => pick.player_id === playerId) || null;
}

export function calculateChampionBonus({
  players = [],
  picks = [],
  tournament = {},
  publicOnly = true,
  now = new Date(),
} = {}) {
  const eligiblePlayers = players.filter(publicOnly ? isPublicStatsPlayer : isPlayerActive);
  const eligibleIds = new Set(eligiblePlayers.map((player) => player.id));
  const eligiblePicks = picks.filter((pick) => eligibleIds.has(pick.player_id));
  const pool = eligiblePlayers.length;
  const champion = getChampionBonusChampion(tournament);
  const finalized = Boolean(champion);
  const locked = isChampionBonusLocked(tournament, now);
  const pickCountsByTeam = new Map();

  eligiblePicks.forEach((pick) => {
    const key = getChampionPickTeamKey(pick);
    if (!key) return;
    pickCountsByTeam.set(key, (pickCountsByTeam.get(key) || 0) + 1);
  });

  const bonusByPlayer = new Map();
  eligiblePicks.forEach((pick) => {
    const key = getChampionPickTeamKey(pick);
    if (!key) return;
    const count = pickCountsByTeam.get(key) || 1;
    const potential = roundBonus(pool / count);
    const won = finalized && teamMatchesChampion(pick, champion);
    bonusByPlayer.set(pick.player_id, {
      player_id: pick.player_id,
      pick,
      team_key: key,
      team_name: pick.team_name,
      potential_bonus: finalized ? (won ? potential : 0) : potential,
      champion_bonus: won ? potential : 0,
      pick_count: count,
      won,
    });
  });

  return {
    pool,
    eligible_player_count: eligiblePlayers.length,
    pick_count: eligiblePicks.length,
    pickCountsByTeam,
    bonusByPlayer,
    champion,
    finalized,
    locked,
    lock_at: getChampionBonusLockAt(tournament),
  };
}

export function getPotentialBonusForTeam(team, bonus) {
  const key = String(team?.slug || normalizeName(team?.name || '')).trim();
  const count = bonus?.pickCountsByTeam?.get(key) || 0;
  return roundBonus((bonus?.pool || 0) / Math.max(1, count));
}

export function buildChampionBonusLeaderboard({
  players = [],
  matches = [],
  predictions = [],
  picks = [],
  tournament = {},
  publicOnly = true,
} = {}) {
  const eligiblePlayers = players.filter(publicOnly ? isPublicStatsPlayer : isPlayerActive);
  const baseRows = calculateLeaderboard(eligiblePlayers, matches, predictions);
  const bonus = calculateChampionBonus({ players, picks, tournament, publicOnly });
  return baseRows
    .map((row) => {
      const playerBonus = bonus.bonusByPlayer.get(row.player_id);
      const bonusPoints = bonus.finalized
        ? playerBonus?.champion_bonus || 0
        : playerBonus?.potential_bonus || 0;
      return {
        ...row,
        champion_pick: playerBonus?.pick || null,
        champion_pick_count: playerBonus?.pick_count || 0,
        potential_champion_bonus: bonus.finalized ? 0 : bonusPoints,
        champion_bonus: bonus.finalized ? bonusPoints : 0,
        projected_total_points: roundBonus(row.total_points + bonusPoints),
      };
    })
    .sort((a, b) =>
      (bonus.finalized ? b.projected_total_points - a.projected_total_points : 0) ||
      b.total_points - a.total_points ||
      b.exact_score_count - a.exact_score_count ||
      b.correct_outcome_count - a.correct_outcome_count ||
      b.predictions_submitted_count - a.predictions_submitted_count ||
      a.name.localeCompare(b.name),
    );
}

export function teamMatchesChampion(pick, champion) {
  if (!pick || !champion) return false;
  const pickSlug = String(pick.team_slug || '').trim();
  const championSlug = String(champion.slug || '').trim();
  if (pickSlug && championSlug && pickSlug === championSlug) return true;
  return normalizeName(pick.team_name || '') === normalizeName(champion.name || '');
}

export function roundBonus(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 10) / 10;
}
