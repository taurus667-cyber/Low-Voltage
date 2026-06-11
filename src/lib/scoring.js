export function isFinalScoreComplete(match) {
  return Number.isInteger(match.team_a_score) && Number.isInteger(match.team_b_score);
}

export function getOutcome(teamAScore, teamBScore) {
  if (teamAScore > teamBScore) return 'team_a';
  if (teamBScore > teamAScore) return 'team_b';
  return 'draw';
}

export function predictionPoints(prediction, match) {
  if (!prediction || !isFinalScoreComplete(match)) return 0;
  if (new Date(prediction.submitted_at).getTime() > new Date(match.kickoff_time).getTime()) return 0;

  const exact =
    prediction.predicted_team_a_score === match.team_a_score &&
    prediction.predicted_team_b_score === match.team_b_score;
  if (exact) return 3;

  const predictedOutcome = getOutcome(prediction.predicted_team_a_score, prediction.predicted_team_b_score);
  const actualOutcome = getOutcome(match.team_a_score, match.team_b_score);
  return predictedOutcome === actualOutcome ? 1 : 0;
}

export function calculateLeaderboard(players, matches, predictions) {
  const matchMap = new Map(matches.map((match) => [match.id, match]));
  const rows = new Map(
    players.map((player) => [
      player.id,
      {
        player_id: player.id,
        name: player.name,
        total_points: 0,
        exact_score_count: 0,
        correct_outcome_count: 0,
        predictions_submitted_count: 0,
      },
    ]),
  );

  predictions.forEach((prediction) => {
    const row = rows.get(prediction.player_id);
    const match = matchMap.get(prediction.match_id);
    if (!row || !match || !isFinalScoreComplete(match)) return;
    if (new Date(prediction.submitted_at).getTime() > new Date(match.kickoff_time).getTime()) return;

    row.predictions_submitted_count += 1;
    const points = predictionPoints(prediction, match);
    row.total_points += points;
    if (points === 3) row.exact_score_count += 1;
    if (points === 1) row.correct_outcome_count += 1;
  });

  return Array.from(rows.values())
    .filter((row) => row.predictions_submitted_count > 0 || row.total_points > 0)
    .sort((a, b) =>
      b.total_points - a.total_points ||
      b.exact_score_count - a.exact_score_count ||
      b.correct_outcome_count - a.correct_outcome_count ||
      a.name.localeCompare(b.name),
    );
}
