import { buildBracket, getTeamSeedLabel, isPlaceholderTeam } from './bracket.js';
import { calculateLeaderboard } from './scoring.js';
import { isPlayerActive, isPublicStatsPlayer } from './playerVisibility.js';
import { normalizeName, teamIdentity } from './teamMetadata.js';

export const LEGACY_CHAMPION_BONUS_LOCK_AT = '2026-06-28T16:00:00Z';
export const DEFAULT_CHAMPION_BONUS_LOCK_AT = '2026-06-28T19:00:00Z';
export const CHAMPION_BONUS_STAGES = [
  { key: 'round-of-32', label: 'Round of 32', shortLabel: '32', weight: 1, color: 'teal', defaultCutoff: DEFAULT_CHAMPION_BONUS_LOCK_AT },
  { key: 'round-of-16', label: 'Round of 16', shortLabel: '16', weight: 0.5, color: 'blue', defaultCutoff: '2026-07-04T19:00:00Z' },
  { key: 'quarter-finals', label: 'Quarter-finals', shortLabel: '8', weight: 0.25, color: 'amber', defaultCutoff: '2026-07-09T19:00:00Z' },
  { key: 'semi-finals', label: 'Semi-finals', shortLabel: '4', weight: 0.125, color: 'rose', defaultCutoff: '2026-07-14T19:00:00Z' },
];
const STAGE_BY_KEY = new Map(CHAMPION_BONUS_STAGES.map((stage) => [stage.key, stage]));

export function getDefaultChampionBonusLockAt(matches = []) {
  const concreteRoundOf32Kickoffs = matches
    .filter((match) => (match.bracket_round === 'round-of-32' || match.stage === 'Round of 32'))
    .filter((match) => !isPlaceholderTeam(match.team_a) && !isPlaceholderTeam(match.team_b))
    .map((match) => new Date(match.kickoff_time).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return concreteRoundOf32Kickoffs.length
    ? new Date(concreteRoundOf32Kickoffs[0]).toISOString()
    : DEFAULT_CHAMPION_BONUS_LOCK_AT;
}

export function getChampionBonusLockAt(tournament, matches = []) {
  const configured = tournament?.champion_bonus_lock_at;
  const fallback = getDefaultChampionBonusLockAt(matches);
  if (!configured || configured === LEGACY_CHAMPION_BONUS_LOCK_AT) return fallback;
  return configured;
}

export function getChampionBonusStage(stageKey) {
  return STAGE_BY_KEY.get(stageKey) || CHAMPION_BONUS_STAGES[0];
}

export function getChampionBonusStageCutoff(stageKey, tournament, matches = []) {
  if (stageKey === 'round-of-32') return getChampionBonusLockAt(tournament, matches);
  const stage = getChampionBonusStage(stageKey);
  const timestamps = matches
    .filter((match) => (match.bracket_round || match.stage) && getStageKey(match) === stage.key)
    .filter((match) => !isPlaceholderTeam(match.team_a) && !isPlaceholderTeam(match.team_b))
    .map((match) => new Date(match.kickoff_time).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return timestamps.length ? new Date(timestamps[0]).toISOString() : stage.defaultCutoff;
}

export function getChampionBonusStageStatus(tournament, matches = [], now = new Date()) {
  const stages = CHAMPION_BONUS_STAGES.map((stage) => {
    const cutoff = getChampionBonusStageCutoff(stage.key, tournament, matches);
    const timestamp = cutoff ? new Date(cutoff).getTime() : NaN;
    const hasCutoff = Number.isFinite(timestamp);
    return {
      ...stage,
      cutoff,
      locked: hasCutoff ? now.getTime() >= timestamp : false,
      available: hasCutoff,
    };
  });

  const openStage = stages.find((stage) => stage.available && !stage.locked) ||
    stages.find((stage) => !stage.available) ||
    stages[stages.length - 1];
  return { stages, openStage };
}

export function getChampionBonusChampion(tournament) {
  const slug = String(tournament?.champion_bonus_winner_team_slug || '').trim();
  const name = String(tournament?.champion_bonus_winner_team_name || '').trim();
  if (!slug && !name) return null;
  return { slug, name };
}

export function isChampionBonusLocked(tournament, now = new Date(), matches = []) {
  const { openStage } = getChampionBonusStageStatus(tournament, matches, now);
  const lockAt = openStage?.cutoff;
  const timestamp = new Date(lockAt).getTime();
  return !Number.isFinite(timestamp) || now.getTime() >= timestamp;
}

export function buildChampionBonusTeams(matches = [], teams = [], stageKey = 'round-of-32') {
  const bracket = buildBracket(matches);
  const roundMatches = bracket.rounds.find((round) => round.key === stageKey)?.matches || [];
  const cards = [];
  const seen = new Set();

  roundMatches.forEach((match) => {
    ['team_a', 'team_b'].forEach((field) => {
      const side = field === 'team_a' ? 'A' : 'B';
      const label = stageKey === 'round-of-32' ? match[field] : getTeamSeedLabel(match, side, bracket.slots);
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
        stage_key: stageKey,
        placeholder: !concrete,
      });
    });
  });

  const stage = getChampionBonusStage(stageKey);
  return cards.slice(0, Number(stage.shortLabel) || 32);
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
  matches = [],
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
  const locked = isChampionBonusLocked(tournament, now, matches);
  const pickCountsByTeam = new Map();

  eligiblePicks.forEach((pick) => {
    const key = getChampionPickTeamKey(pick);
    if (!key) return;
    const stage = getChampionBonusStage(pick.stage_key);
    const groupKey = getChampionPickGroupKey(key, stage.key);
    pickCountsByTeam.set(groupKey, (pickCountsByTeam.get(groupKey) || 0) + 1);
  });

  const bonusByPlayer = new Map();
  eligiblePicks.forEach((pick) => {
    const key = getChampionPickTeamKey(pick);
    if (!key) return;
    const stage = getChampionBonusStage(pick.stage_key);
    const weight = Number(pick.stage_weight ?? stage.weight) || stage.weight;
    const groupKey = getChampionPickGroupKey(key, stage.key);
    const count = pickCountsByTeam.get(groupKey) || 1;
    const potential = roundBonus((pool * weight) / count);
    const won = finalized && teamMatchesChampion(pick, champion);
    bonusByPlayer.set(pick.player_id, {
      player_id: pick.player_id,
      pick,
      team_key: key,
      team_name: pick.team_name,
      stage_key: stage.key,
      stage_label: pick.stage_label || stage.label,
      stage_weight: weight,
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
    ...getChampionBonusStageStatus(tournament, matches, now),
    lock_at: getChampionBonusStageStatus(tournament, matches, now).openStage?.cutoff || getChampionBonusLockAt(tournament, matches),
  };
}

export function getPotentialBonusForTeam(team, bonus, stageKey = bonus?.openStage?.key || 'round-of-32') {
  const key = String(team?.slug || normalizeName(team?.name || '')).trim();
  const stage = getChampionBonusStage(stageKey);
  const count = bonus?.pickCountsByTeam?.get(getChampionPickGroupKey(key, stage.key)) || 0;
  return roundBonus(((bonus?.pool || 0) * stage.weight) / Math.max(1, count));
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
  const bonus = calculateChampionBonus({ players, matches, picks, tournament, publicOnly });
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

export function getChampionPickGroupKey(teamKey, stageKey) {
  return `${stageKey}:${teamKey}`;
}

function getStageKey(match) {
  const raw = String(match?.bracket_round || match?.stage || '').toLowerCase();
  if (raw.includes('round-of-16') || raw.includes('round of 16')) return 'round-of-16';
  if (raw.includes('quarter')) return 'quarter-finals';
  if (raw.includes('semi')) return 'semi-finals';
  if (raw.includes('round-of-32') || raw.includes('round of 32')) return 'round-of-32';
  return raw;
}

export function roundBonus(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 10) / 10;
}
