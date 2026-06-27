export const PREDICTION_STYLES = {
  shield_turtle: {
    key: 'shield_turtle',
    label: 'Shield Turtle',
    animal: 'Turtle',
    tone: 'Risk-averse',
    mindset: 'Careful and favorite-aware, usually protecting points by staying close to safer signals.',
    strength: 'Avoids unnecessary losses and tends to collect steady outcome points.',
    blindSpot: 'May miss big swings when an upset or bold scoreline pays off.',
  },
  tactical_fox: {
    key: 'tactical_fox',
    label: 'Tactical Fox',
    animal: 'Fox',
    tone: 'Balanced',
    mindset: 'Selective and adaptable, mixing safer picks with a few calculated surprises.',
    strength: 'Balances consistency with enough upside to move up the table.',
    blindSpot: 'Can become too middle-of-the-road when the leaderboard needs a decisive move.',
  },
  falcon_striker: {
    key: 'falcon_striker',
    label: 'Falcon Striker',
    animal: 'Falcon',
    tone: 'Risk-taker',
    mindset: 'Aggressive and upside-focused, more willing to call upsets or wider scorelines.',
    strength: 'Can gain ground quickly when bold reads land.',
    blindSpot: 'Higher variance means more zero-point picks when the safer result happens.',
  },
  lone_wolf: {
    key: 'lone_wolf',
    label: 'Lone Wolf',
    animal: 'Wolf',
    tone: 'Contrarian',
    mindset: 'Independent and consensus-resistant, often seeing a match differently from the family.',
    strength: 'Creates separation from the pack and can win when the crowd is wrong.',
    blindSpot: 'Disagreeing too often can leave easy points on the table.',
  },
};

const MIN_CONFIDENT_PICKS = 5;
const MIN_CONSENSUS_OTHER_PICKS = 2;

export function buildPredictionStyle(args) {
  return buildPredictionStylesByPlayer(args).get(args.playerId) || createStyle('tactical_fox', emptyMetrics(), {
    provisional: true,
    confidence: 'Provisional',
    score: 0,
    relativeScore: 0,
  });
}

export function buildPredictionStylesByPlayer({ players = [], matches = [], predictions = [], predictionAids = [], matchOdds = [] }) {
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const eligiblePlayerIds = new Set(players.map((player) => player.id));
  const favoriteByMatch = buildFavoriteMap(matches, predictionAids, matchOdds);
  const playerMetrics = players.map((player) => calculatePlayerMetrics({
    player,
    matchById,
    predictions,
    favoriteByMatch,
    eligiblePlayerIds,
  }));
  const comparableRows = playerMetrics.filter((row) => row.metrics.pickCount >= MIN_CONFIDENT_PICKS);
  const rowsForDistribution = comparableRows.length >= 4 ? comparableRows : playerMetrics.filter((row) => row.metrics.pickCount > 0);
  const riskValues = rowsForDistribution.map((row) => row.metrics.rawRiskScore);
  const consensusValues = rowsForDistribution.map((row) => row.metrics.consensusDistance);
  const favoriteValues = rowsForDistribution.map((row) => row.metrics.favoriteAlignment);
  const marginValues = rowsForDistribution.map((row) => row.metrics.averagePredictedMargin);

  return new Map(playerMetrics.map((row) => {
    const { player, metrics } = row;
    const provisional = metrics.pickCount < MIN_CONFIDENT_PICKS;
    const riskPercentile = percentileRank(riskValues, metrics.rawRiskScore);
    const consensusPercentile = percentileRank(consensusValues, metrics.consensusDistance);
    const favoritePercentile = percentileRank(favoriteValues, metrics.favoriteAlignment);
    const marginPercentile = percentileRank(marginValues, metrics.averagePredictedMargin);
    const score = Math.round(metrics.rawRiskScore);
    const relativeScore = Math.round(riskPercentile);
    const key = chooseStyleKey({
      provisional,
      riskPercentile,
      consensusPercentile,
      favoritePercentile,
      marginPercentile,
      metrics,
      comparableCount: rowsForDistribution.length,
    });

    return [player.id, createStyle(key, {
      ...metrics,
      riskPercentile: Math.round(riskPercentile),
      consensusPercentile: Math.round(consensusPercentile),
      favoritePercentile: Math.round(favoritePercentile),
      marginPercentile: Math.round(marginPercentile),
    }, {
      provisional,
      confidence: confidenceLabel(metrics),
      score,
      relativeScore,
    })];
  }));
}

export function auditPredictionStyleDistribution(args) {
  const styles = buildPredictionStylesByPlayer(args);
  const rows = (args.players || [])
    .map((player) => ({ player, style: styles.get(player.id) }))
    .filter((row) => row.style && row.style.metrics.pickCount > 0);
  const counts = rows.reduce((acc, row) => {
    acc[row.style.key] = (acc[row.style.key] || 0) + 1;
    return acc;
  }, {});
  const ranges = Object.fromEntries([
    'score',
    'relativeScore',
    'pickCount',
    'favoriteAlignment',
    'underdogRate',
    'consensusDistance',
    'averagePredictedMargin',
    'drawRate',
  ].map((field) => {
    const values = rows.map((row) => field in row.style ? row.style[field] : row.style.metrics[field])
      .filter((value) => Number.isFinite(value));
    return [field, summarizeRange(values)];
  }));

  return {
    playerCount: args.players?.length || 0,
    playersWithPicks: rows.length,
    counts,
    ranges,
    collapsed: Object.keys(counts).length <= 1 && rows.length >= 4,
  };
}

function calculatePlayerMetrics({ player, matchById, predictions, favoriteByMatch, eligiblePlayerIds }) {
  const playerPredictions = predictions.filter((prediction) =>
    prediction.player_id === player.id && matchById.has(prediction.match_id)
  );

  let favoriteComparable = 0;
  let favoriteAligned = 0;
  let consensusComparable = 0;
  let consensusAligned = 0;
  let drawCount = 0;
  const margins = [];

  playerPredictions.forEach((prediction) => {
    const outcome = getPredictionOutcome(prediction);
    const favorite = favoriteByMatch.get(prediction.match_id);
    const consensus = getConsensusOutcome({
      matchId: prediction.match_id,
      excludePlayerId: player.id,
      predictions,
      eligiblePlayerIds,
    });

    if (favorite && outcome) {
      favoriteComparable += 1;
      if (favorite === outcome) favoriteAligned += 1;
    }

    if (consensus && outcome) {
      consensusComparable += 1;
      if (consensus === outcome) consensusAligned += 1;
    }

    if (outcome === 'draw') drawCount += 1;
    margins.push(Math.abs(Number(prediction.predicted_team_a_score) - Number(prediction.predicted_team_b_score)));
  });

  const pickCount = playerPredictions.length;
  const favoriteAlignment = percent(favoriteAligned, favoriteComparable);
  const underdogRate = favoriteComparable ? 100 - favoriteAlignment : 0;
  const consensusDistance = consensusComparable ? 100 - percent(consensusAligned, consensusComparable) : 0;
  const averagePredictedMargin = round1(average(margins));
  const drawRate = percent(drawCount, pickCount);
  const marginVariance = standardDeviation(margins);
  const marginBoldness = clamp((averagePredictedMargin / 3) * 100, 0, 100);
  const varianceBoldness = clamp((marginVariance / 2) * 100, 0, 100);
  const rawRiskScore = Math.round(
    (underdogRate * 0.3) +
    (consensusDistance * 0.25) +
    (marginBoldness * 0.2) +
    (varianceBoldness * 0.15) +
    (drawRate * 0.1),
  );

  return {
    player,
    metrics: {
      pickCount,
      favoriteAlignment,
      underdogRate,
      consensusDistance,
      consensusComparable,
      averagePredictedMargin,
      drawRate,
      marginVariance: round1(marginVariance),
      rawRiskScore,
    },
  };
}

function chooseStyleKey({
  provisional,
  riskPercentile,
  consensusPercentile,
  favoritePercentile,
  marginPercentile,
  metrics,
  comparableCount,
}) {
  if (metrics.pickCount === 0) return 'tactical_fox';
  if (provisional) {
    if (metrics.pickCount < 3) return 'tactical_fox';
    if (metrics.consensusComparable >= 3 && metrics.consensusDistance >= 67) return 'lone_wolf';
    if (metrics.underdogRate >= 67 || metrics.averagePredictedMargin >= 3) return 'falcon_striker';
    if (metrics.favoriteAlignment >= 75 && metrics.averagePredictedMargin <= 1.5) return 'shield_turtle';
    return 'tactical_fox';
  }
  if (comparableCount < 4) {
    if (metrics.consensusDistance >= 60) return 'lone_wolf';
    if (metrics.rawRiskScore >= 55 || metrics.underdogRate >= 55) return 'falcon_striker';
    if (metrics.favoriteAlignment >= 70 && metrics.rawRiskScore <= 35) return 'shield_turtle';
    return 'tactical_fox';
  }
  if (riskPercentile >= 78 && (marginPercentile >= 70 || metrics.averagePredictedMargin >= 2.5)) return 'falcon_striker';
  if (consensusPercentile >= 82 && metrics.consensusDistance >= 20) return 'lone_wolf';
  if (riskPercentile >= 78 && metrics.underdogRate >= 35) return 'falcon_striker';
  if (riskPercentile <= 35 && favoritePercentile >= 55) return 'shield_turtle';
  return 'tactical_fox';
}

function createStyle(key, metrics, { provisional, confidence, score, relativeScore }) {
  return {
    ...PREDICTION_STYLES[key],
    score,
    relativeScore,
    confidence,
    provisional,
    metrics,
  };
}

function confidenceLabel(metrics) {
  if (metrics.pickCount < MIN_CONFIDENT_PICKS) return 'Provisional';
  if (metrics.pickCount < 10 || metrics.consensusComparable < 5) return 'Medium';
  return 'Established';
}

function emptyMetrics() {
  return {
    pickCount: 0,
    favoriteAlignment: 0,
    underdogRate: 0,
    consensusDistance: 0,
    consensusComparable: 0,
    averagePredictedMargin: 0,
    drawRate: 0,
    marginVariance: 0,
    rawRiskScore: 0,
    riskPercentile: 0,
    consensusPercentile: 0,
    favoritePercentile: 0,
    marginPercentile: 0,
  };
}

function buildFavoriteMap(matches, predictionAids, matchOdds) {
  const map = new Map();
  matches.forEach((match) => {
    const oddsFavorite = favoriteFromOdds(matchOdds.filter((odd) => odd.match_id === match.id));
    if (oddsFavorite) {
      map.set(match.id, oddsFavorite);
      return;
    }
    const aidFavorite = favoriteFromAids(match, predictionAids.filter((aid) => aid.match_id === match.id));
    if (aidFavorite) map.set(match.id, aidFavorite);
  });
  return map;
}

function favoriteFromOdds(odds) {
  const options = odds
    .flatMap((odd) => [
      ['home', parseDecimalOdd(odd.home_value)],
      ['draw', parseDecimalOdd(odd.draw_value)],
      ['away', parseDecimalOdd(odd.away_value)],
    ])
    .filter(([, value]) => value);
  if (!options.length) return null;
  return options.sort(([, a], [, b]) => a - b)[0][0];
}

function favoriteFromAids(match, aids) {
  const source = aids
    .filter((aid) => aid.aid_type === 'api_prediction' || /prediction/i.test(aid.title || ''))
    .map((aid) => `${aid.summary || ''} ${JSON.stringify(aid.payload || {})}`)
    .join(' ')
    .toLowerCase();
  if (!source) return null;
  if (source.includes('draw')) return 'draw';
  if (match.team_a && source.includes(String(match.team_a).toLowerCase())) return 'home';
  if (match.team_b && source.includes(String(match.team_b).toLowerCase())) return 'away';
  return null;
}

function getConsensusOutcome({ matchId, excludePlayerId, predictions, eligiblePlayerIds }) {
  const counts = { home: 0, draw: 0, away: 0 };
  let total = 0;
  predictions.forEach((prediction) => {
    if (prediction.match_id !== matchId) return;
    if (prediction.player_id === excludePlayerId) return;
    if (eligiblePlayerIds.size && !eligiblePlayerIds.has(prediction.player_id)) return;
    const outcome = getPredictionOutcome(prediction);
    if (!outcome) return;
    counts[outcome] += 1;
    total += 1;
  });
  if (total < MIN_CONSENSUS_OTHER_PICKS) return null;
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  if (!sorted[0]?.[1]) return null;
  if (sorted[0][1] === sorted[1]?.[1]) return null;
  return sorted[0][0];
}

function getPredictionOutcome(prediction) {
  const a = Number(prediction.predicted_team_a_score);
  const b = Number(prediction.predicted_team_b_score);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a > b) return 'home';
  if (a < b) return 'away';
  return 'draw';
}

function parseDecimalOdd(value) {
  const parsed = Number.parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function percentileRank(values, value) {
  const sorted = values.filter((item) => Number.isFinite(item)).sort((a, b) => a - b);
  if (!sorted.length) return 50;
  if (sorted.length === 1) return value >= sorted[0] ? 100 : 0;
  const below = sorted.filter((item) => item < value).length;
  const equal = sorted.filter((item) => item === value).length;
  return ((below + (equal / 2)) / sorted.length) * 100;
}

function summarizeRange(values) {
  if (!values.length) return { min: 0, max: 0, avg: 0 };
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: round1(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  return Math.sqrt(average(values.map((value) => (value - avg) ** 2)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
}
