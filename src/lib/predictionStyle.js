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

export function buildPredictionStyle({ playerId, players = [], matches = [], predictions = [], predictionAids = [], matchOdds = [] }) {
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const eligiblePlayerIds = new Set(players.map((player) => player.id));
  const playerPredictions = predictions.filter((prediction) =>
    prediction.player_id === playerId && matchById.has(prediction.match_id)
  );
  const favoriteByMatch = buildFavoriteMap(matches, predictionAids, matchOdds);
  const consensusByMatch = buildConsensusMap(predictions, eligiblePlayerIds);

  let favoriteComparable = 0;
  let favoriteAligned = 0;
  let consensusComparable = 0;
  let consensusAligned = 0;
  let drawCount = 0;
  const margins = [];

  playerPredictions.forEach((prediction) => {
    const match = matchById.get(prediction.match_id);
    const outcome = getPredictionOutcome(prediction);
    const favorite = favoriteByMatch.get(prediction.match_id);
    const consensus = consensusByMatch.get(prediction.match_id);

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
  const score = Math.round(
    (underdogRate * 0.3) +
    (consensusDistance * 0.25) +
    (marginBoldness * 0.2) +
    (varianceBoldness * 0.15) +
    (drawRate * 0.1),
  );
  const provisional = pickCount < MIN_CONFIDENT_PICKS;
  const key = provisional
    ? 'tactical_fox'
    : consensusDistance >= 65
      ? 'lone_wolf'
      : score >= 55
        ? 'falcon_striker'
        : score <= 35 && (!favoriteComparable || favoriteAlignment >= 60)
          ? 'shield_turtle'
          : 'tactical_fox';

  return {
    ...PREDICTION_STYLES[key],
    score,
    confidence: provisional ? 'Provisional' : 'Established',
    provisional,
    metrics: {
      pickCount,
      favoriteAlignment,
      underdogRate,
      consensusDistance,
      averagePredictedMargin,
      drawRate,
      marginVariance: round1(marginVariance),
    },
  };
}

export function buildPredictionStylesByPlayer(args) {
  return new Map((args.players || []).map((player) => [
    player.id,
    buildPredictionStyle({ ...args, playerId: player.id }),
  ]));
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

function buildConsensusMap(predictions, eligiblePlayerIds) {
  const countsByMatch = new Map();
  predictions.forEach((prediction) => {
    if (eligiblePlayerIds.size && !eligiblePlayerIds.has(prediction.player_id)) return;
    const outcome = getPredictionOutcome(prediction);
    if (!outcome) return;
    const counts = countsByMatch.get(prediction.match_id) || { home: 0, draw: 0, away: 0 };
    counts[outcome] += 1;
    countsByMatch.set(prediction.match_id, counts);
  });
  return new Map([...countsByMatch.entries()].map(([matchId, counts]) => {
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
    if (!sorted[0]?.[1]) return [matchId, null];
    if (sorted[0][1] === sorted[1]?.[1]) return [matchId, null];
    return [matchId, sorted[0][0]];
  }));
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
