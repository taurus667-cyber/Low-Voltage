import { isFinalScoreComplete } from './scoring.js';
import { calculateGroupStandings } from './standings.js';
import { teamIdentity } from './teamMetadata.js';

export const BRACKET_ROUNDS = [
  { key: 'round-of-32', label: 'Round of 32', order: 1, stagePatterns: [/round of 32/i, /last 32/i] },
  { key: 'round-of-16', label: 'Round of 16', order: 2, stagePatterns: [/round of 16/i, /last 16/i] },
  { key: 'quarter-finals', label: 'Quarter-finals', order: 3, stagePatterns: [/quarter/i] },
  { key: 'semi-finals', label: 'Semi-finals', order: 4, stagePatterns: [/semi/i] },
  { key: 'final', label: 'Final', order: 5, stagePatterns: [/^final$/i] },
];

export const THIRD_PLACE_ROUND = {
  key: 'third-place',
  label: 'Third-place match',
  order: 6,
  stagePatterns: [/third.?place/i, /3rd.?place/i],
};

const ROUND_BY_KEY = new Map([...BRACKET_ROUNDS, THIRD_PLACE_ROUND].map((round) => [round.key, round]));
const PLACEHOLDER_DATE = '2026-06-28T12:00:00Z';

export const OFFICIAL_KNOCKOUT_PLACEHOLDERS = [
  placeholder('M73', 'round-of-32', 'June 28, 2026', 'Winner Group A', 'Runner-up Group C', 'M89', 'A'),
  placeholder('M74', 'round-of-32', 'June 28, 2026', 'Winner Group B', 'Best 3rd Group A/C/D/E/F', 'M90', 'A'),
  placeholder('M75', 'round-of-32', 'June 29, 2026', 'Runner-up Group A', 'Runner-up Group B', 'M89', 'B'),
  placeholder('M76', 'round-of-32', 'June 29, 2026', 'Winner Group F', 'Runner-up Group C', 'M91', 'A'),
  placeholder('M77', 'round-of-32', 'June 30, 2026', 'Winner Group C', 'Best 3rd Group H/I/J/K/L', 'M90', 'B'),
  placeholder('M78', 'round-of-32', 'June 30, 2026', 'Runner-up Group E', 'Runner-up Group I', 'M91', 'B'),
  placeholder('M79', 'round-of-32', 'July 1, 2026', 'Winner Group E', 'Best 3rd Group A/B/C/D/F', 'M92', 'A'),
  placeholder('M80', 'round-of-32', 'July 1, 2026', 'Winner Group I', 'Best 3rd Group C/D/F/G/H', 'M92', 'B'),
  placeholder('M81', 'round-of-32', 'July 1, 2026', 'Winner Group D', 'Best 3rd Group B/E/F/I/J', 'M94', 'A'),
  placeholder('M82', 'round-of-32', 'July 2, 2026', 'Runner-up Group J', 'Runner-up Group L', 'M94', 'B'),
  placeholder('M83', 'round-of-32', 'July 2, 2026', 'Winner Group G', 'Best 3rd Group A/E/H/I/J', 'M93', 'A'),
  placeholder('M84', 'round-of-32', 'July 2, 2026', 'Winner Group L', 'Runner-up Group E', 'M93', 'B'),
  placeholder('M85', 'round-of-32', 'July 3, 2026', 'Winner Group H', 'Runner-up Group K', 'M96', 'A'),
  placeholder('M86', 'round-of-32', 'July 3, 2026', 'Winner Group J', 'Runner-up Group H', 'M95', 'A'),
  placeholder('M87', 'round-of-32', 'July 3, 2026', 'Winner Group K', 'Best 3rd Group D/E/I/J/L', 'M96', 'B'),
  placeholder('M88', 'round-of-32', 'July 3, 2026', 'Runner-up Group D', 'Runner-up Group G', 'M95', 'B'),
  placeholder('M89', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M97', 'A', 'M73', 'M75'),
  placeholder('M90', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M97', 'B', 'M74', 'M77'),
  placeholder('M91', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M99', 'A', 'M76', 'M78'),
  placeholder('M92', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M99', 'B', 'M79', 'M80'),
  placeholder('M93', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M98', 'A', 'M83', 'M84'),
  placeholder('M94', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M98', 'B', 'M81', 'M82'),
  placeholder('M95', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M100', 'A', 'M86', 'M88'),
  placeholder('M96', 'round-of-16', 'July 4-7, 2026', 'TBD', 'TBD', 'M100', 'B', 'M85', 'M87'),
  placeholder('M97', 'quarter-finals', 'July 9-11, 2026', 'TBD', 'TBD', 'M101', 'A', 'M89', 'M90'),
  placeholder('M98', 'quarter-finals', 'July 9-11, 2026', 'TBD', 'TBD', 'M101', 'B', 'M93', 'M94'),
  placeholder('M99', 'quarter-finals', 'July 9-11, 2026', 'TBD', 'TBD', 'M102', 'A', 'M91', 'M92'),
  placeholder('M100', 'quarter-finals', 'July 9-11, 2026', 'TBD', 'TBD', 'M102', 'B', 'M95', 'M96'),
  placeholder('M101', 'semi-finals', 'July 14, 2026', 'TBD', 'TBD', 'M104', 'A', 'M97', 'M98'),
  placeholder('M102', 'semi-finals', 'July 15, 2026', 'TBD', 'TBD', 'M104', 'B', 'M99', 'M100'),
  placeholder('M103', 'third-place', 'July 18, 2026', 'Loser M101', 'Loser M102', '', '', 'M101', 'M102'),
  placeholder('M104', 'final', 'July 19, 2026', 'TBD', 'TBD', '', '', 'M101', 'M102'),
];

export function normalizeBracketRound(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const slug = raw.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ROUND_BY_KEY.has(slug)) return slug;
  const match = [...BRACKET_ROUNDS, THIRD_PLACE_ROUND].find((round) =>
    round.stagePatterns.some((pattern) => pattern.test(raw)),
  );
  return match?.key || slug;
}

export function getBracketRound(match) {
  return normalizeBracketRound(match?.bracket_round || match?.stage);
}

export function isKnockoutMatch(match) {
  const round = getBracketRound(match);
  if (ROUND_BY_KEY.has(round)) return true;
  return /(knockout|round of|quarter|semi|final|third.?place|3rd.?place)/i.test(match?.stage || '');
}

export function isPlaceholderTeam(value) {
  return /^(tbd|winner\b|runner-up\b|best 3rd\b|loser\b)/i.test(String(value || '').trim());
}

export function getBracketRoundMeta(roundKey) {
  return ROUND_BY_KEY.get(normalizeBracketRound(roundKey)) || null;
}

export function getBracketSlot(match) {
  return String(match?.bracket_slot || match?.external_match_id || match?.id || '').trim();
}

export function buildBracket(matches = [], options = {}) {
  const includePlaceholders = options.includePlaceholders !== false;
  const groupStandings = options.groupStandings || calculateGroupStandings(matches);
  const knockoutMatches = matches
    .filter((match) => match.is_published)
    .filter(isKnockoutMatch)
    .map((match) => ({
      ...match,
      bracket_round: getBracketRound(match),
      bracket_slot: getBracketSlot(match),
    }));

  const realBySlot = new Map(knockoutMatches.map((match) => [match.bracket_slot, match]));
  const concreteTeamNames = getConcreteKnockoutTeamNames(knockoutMatches);
  const mergedMatches = includePlaceholders
    ? OFFICIAL_KNOCKOUT_PLACEHOLDERS.map((item) => {
      const real = realBySlot.get(item.bracket_slot);
      return real ? { ...item, ...real, is_placeholder: false } : resolveGroupSeeds(item, groupStandings, concreteTeamNames);
    })
      .concat(knockoutMatches.filter((match) => !OFFICIAL_KNOCKOUT_PLACEHOLDERS.some((item) => item.bracket_slot === match.bracket_slot)))
    : knockoutMatches;
  const slots = new Map(mergedMatches.map((match) => [match.bracket_slot, match]));
  mergedMatches.forEach((source) => {
    const target = slots.get(String(source.winner_to_slot || '').trim());
    if (!target) return;
    const side = String(source.winner_to_side || '').trim().toUpperCase();
    if (side === 'B') target.source_b_slot = source.bracket_slot;
    else if (side === 'A') target.source_a_slot = source.bracket_slot;
    else if (!target.source_a_slot) target.source_a_slot = source.bracket_slot;
    else if (!target.source_b_slot) target.source_b_slot = source.bracket_slot;
  });

  const rounds = BRACKET_ROUNDS.map((round) => ({
    ...round,
    matches: mergedMatches
      .filter((match) => match.bracket_round === round.key)
      .sort(compareBracketMatches),
  }));
  const thirdPlace = mergedMatches
    .filter((match) => match.bracket_round === THIRD_PLACE_ROUND.key)
    .sort(compareBracketMatches);

  return { rounds, thirdPlace, slots, hasRealMatches: knockoutMatches.length > 0 };
}

export function compareBracketMatches(a, b) {
  return compareSlot(a.bracket_slot, b.bracket_slot) ||
    new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime() ||
    String(a.team_a).localeCompare(String(b.team_a));
}

export function getMatchWinner(match) {
  if (!isFinalScoreComplete(match)) return null;
  const scoreA = Number(match.team_a_score);
  const scoreB = Number(match.team_b_score);
  if (scoreA > scoreB) return { side: 'A', team: match.team_a, score: scoreA };
  if (scoreB > scoreA) return { side: 'B', team: match.team_b, score: scoreB };
  return null;
}

export function getMatchLoser(match) {
  if (!isFinalScoreComplete(match)) return null;
  const scoreA = Number(match.team_a_score);
  const scoreB = Number(match.team_b_score);
  if (scoreA < scoreB) return { side: 'A', team: match.team_a, score: scoreA };
  if (scoreB < scoreA) return { side: 'B', team: match.team_b, score: scoreB };
  return null;
}

export function getTeamSeedLabel(match, side, slots = new Map()) {
  const team = side === 'A' ? match?.team_a : match?.team_b;
  if (team && !/^tbd$/i.test(team)) return team;
  const sourceSlot = side === 'A' ? match?.source_a_slot : match?.source_b_slot;
  const sourceMatch = sourceSlot ? slots.get(sourceSlot) : null;
  const winner = sourceMatch ? getMatchWinner(sourceMatch) : null;
  if (winner?.team) return winner.team;
  if (sourceSlot) return `Winner ${sourceSlot}`;
  return 'TBD';
}

export function getBracketHealth(matches = []) {
  const knockout = matches.filter(isKnockoutMatch);
  const slotCounts = new Map();
  knockout.forEach((match) => {
    const slot = getBracketSlot(match);
    if (!slot) return;
    slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
  });
  const duplicateSlots = [...slotCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([slot]) => slot);

  return {
    total: knockout.length,
    missingSlots: knockout.filter((match) => !match.bracket_slot).length,
    duplicateSlots,
    missingNextLinks: knockout.filter((match) => {
      const round = getBracketRound(match);
      if (round === 'final' || round === 'third-place') return false;
      return !match.winner_to_slot;
    }).length,
    unpublished: knockout.filter((match) => !match.is_published).length,
    missingOfficialData: knockout.filter((match) =>
      !match.external_match_id || !match.kickoff_time || !match.venue
    ).length,
  };
}

function compareSlot(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const leftNumber = Number(left.match(/\d+/)?.[0]);
  const rightNumber = Number(right.match(/\d+/)?.[0]);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, undefined, { numeric: true });
}

function placeholder(slot, round, dateLabel, teamA, teamB, winnerToSlot = '', winnerToSide = '', sourceA = '', sourceB = '') {
  return {
    id: `placeholder-${slot}`,
    external_match_id: slot,
    bracket_slot: slot,
    bracket_round: round,
    stage: getBracketRoundMeta(round)?.label || round,
    team_a: teamA,
    team_b: teamB,
    kickoff_time: PLACEHOLDER_DATE,
    date_label: dateLabel,
    venue: 'Venue TBD',
    status: 'scheduled',
    is_locked: false,
    is_published: true,
    team_a_score: null,
    team_b_score: null,
    winner_to_slot: winnerToSlot || null,
    winner_to_side: winnerToSide || null,
    source_a_slot: sourceA || null,
    source_b_slot: sourceB || null,
    is_placeholder: true,
  };
}

function resolveGroupSeeds(match, groupStandings = [], concreteTeamNames = new Set()) {
  const teamA = resolveDirectGroupSeed(match.team_a, groupStandings, concreteTeamNames);
  const teamB = resolveDirectGroupSeed(match.team_b, groupStandings, concreteTeamNames);
  if (teamA === match.team_a && teamB === match.team_b) return match;
  return {
    ...match,
    team_a: teamA,
    team_b: teamB,
    group_seed_resolved: true,
  };
}

function resolveDirectGroupSeed(label, groupStandings = [], concreteTeamNames = new Set()) {
  const raw = String(label || '').trim();
  const match = raw.match(/^(Winner|Runner-up)\s+Group\s+([A-L])$/i);
  if (!match) return label;

  const [, seedType, groupLetter] = match;
  const group = groupStandings.find((item) =>
    String(item.groupName || '').trim().toLowerCase() === `group ${groupLetter.toLowerCase()}`,
  );
  if (!isCompleteGroup(group)) return label;

  const position = /^winner$/i.test(seedType) ? 1 : 2;
  const resolvedTeam = group.rows.find((row) => row.position === position)?.team;
  if (!resolvedTeam) return label;
  if (concreteTeamNames.has(teamIdentity(resolvedTeam).slug)) return label;
  return resolvedTeam;
}

function isCompleteGroup(group) {
  if (!group?.rows?.length) return false;
  return group.rows.length >= 4 && group.rows.every((row) => Number(row.played) >= 3);
}

function getConcreteKnockoutTeamNames(matches = []) {
  const names = new Set();
  matches.forEach((match) => {
    [match.team_a, match.team_b].forEach((team) => {
      if (!isPlaceholderTeam(team)) names.add(teamIdentity(team).slug);
    });
  });
  return names;
}
