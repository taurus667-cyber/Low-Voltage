import { getOutcome } from './scoring.js';

export function livePredictionPoints(prediction, match) {
  if (!prediction) return null;
  const scoreA = match.live_team_a_score;
  const scoreB = match.live_team_b_score;
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) return null;

  const exact =
    prediction.predicted_team_a_score === scoreA &&
    prediction.predicted_team_b_score === scoreB;
  if (exact) return 3;

  const predictedOutcome = getOutcome(prediction.predicted_team_a_score, prediction.predicted_team_b_score);
  const liveOutcome = getOutcome(scoreA, scoreB);
  return predictedOutcome === liveOutcome ? 1 : 0;
}

export function calculateLiveLeaderboard(players, matches, predictions) {
  const matchMap = new Map(matches.map((match) => [match.id, match]));
  const rows = new Map(
    players
      .filter((player) => player.is_active !== false)
      .map((player) => [player.id, { player_id: player.id, live_points: 0 }]),
  );

  predictions.forEach((prediction) => {
    const row = rows.get(prediction.player_id);
    const match = matchMap.get(prediction.match_id);
    if (!row || !match || match.status !== 'live') return;
    const points = livePredictionPoints(prediction, match);
    if (points !== null) row.live_points += points;
  });

  return rows;
}
