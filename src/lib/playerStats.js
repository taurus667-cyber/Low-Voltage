import { calculateLeaderboard, isFinalScoreComplete, predictionPoints } from './scoring.js';
import { calculateLiveLeaderboard } from './livePoints.js';
import { isMatchLocked, isMatchUpcoming, isPlayerFacingMatch } from './matches.js';

export function buildPlayerStats({ playerId, players = [], matches = [], predictions = [], now = Date.now() }) {
  const player = players.find((item) => item.id === playerId) || null;
  const playerFacingMatches = matches.filter(isPlayerFacingMatch);
  const matchById = new Map(playerFacingMatches.map((match) => [match.id, match]));
  const playerPredictions = predictions.filter((prediction) =>
    prediction.player_id === playerId && matchById.has(prediction.match_id)
  );
  const predictionByMatch = new Map(playerPredictions.map((prediction) => [prediction.match_id, prediction]));
  const leaderboard = calculateLeaderboard(players, playerFacingMatches, predictions);
  const visibleLeaderboard = leaderboard.filter((row) => row.predictions_submitted_count > 0);
  const playerRow = leaderboard.find((row) => row.player_id === playerId) || {
    player_id: playerId,
    name: player?.name || 'Player',
    total_points: 0,
    exact_score_count: 0,
    correct_outcome_count: 0,
    predictions_submitted_count: 0,
  };
  const rank = visibleLeaderboard.findIndex((row) => row.player_id === playerId) + 1 || null;
  const liveRows = calculateLiveLeaderboard(players, playerFacingMatches, predictions);
  const completedResults = playerPredictions
    .map((prediction) => {
      const match = matchById.get(prediction.match_id);
      if (!match || !isFinalScoreComplete(match)) return null;
      const points = predictionPoints(prediction, match);
      return { prediction, match, points };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.match.kickoff_time).getTime() - new Date(a.match.kickoff_time).getTime());

  const zeroPointCount = completedResults.filter((result) => result.points === 0).length;
  const scoringPickCount = playerRow.exact_score_count + playerRow.correct_outcome_count;
  const openPicks = playerFacingMatches
    .filter((match) => isMatchUpcoming(match, now) && !isMatchLocked(match, now) && !predictionByMatch.has(match.id))
    .sort((a, b) => new Date(a.kickoff_time).getTime() - new Date(b.kickoff_time).getTime());
  const bestResult = [...completedResults].sort((a, b) =>
    b.points - a.points ||
    new Date(b.match.kickoff_time).getTime() - new Date(a.match.kickoff_time).getTime()
  )[0] || null;

  return {
    player,
    row: playerRow,
    rank,
    totalPlayers: visibleLeaderboard.length,
    livePoints: liveRows.get(playerId)?.live_points || 0,
    picksSubmitted: playerRow.predictions_submitted_count,
    openPicksRemaining: openPicks.length,
    completionRate: ratio(playerRow.predictions_submitted_count, playerFacingMatches.length),
    completedPickCount: completedResults.length,
    exactScoreCount: playerRow.exact_score_count,
    correctOutcomeCount: playerRow.correct_outcome_count,
    zeroPointCount,
    accuracyRate: ratio(scoringPickCount, completedResults.length),
    exactRate: ratio(playerRow.exact_score_count, completedResults.length),
    averagePointsPerCompletedPick: completedResults.length ? round1(playerRow.total_points / completedResults.length) : 0,
    bestResult,
    recentForm: completedResults.slice(0, 5),
    comparison: buildComparison(playerRow, leaderboard, visibleLeaderboard, rank),
    nearbyLeaderboard: buildNearbyRows(visibleLeaderboard, playerId),
    upcomingGaps: openPicks.slice(0, 3),
  };
}

function buildComparison(playerRow, leaderboard, visibleLeaderboard, rank) {
  const activeRows = leaderboard.filter((row) => row.predictions_submitted_count > 0);
  const leader = visibleLeaderboard[0] || null;
  const rankAbove = rank && rank > 1 ? visibleLeaderboard[rank - 2] : null;
  const tenth = visibleLeaderboard[9] || null;
  const average = (field) => round1(activeRows.reduce((total, row) => total + row[field], 0) / (activeRows.length || 1));
  const averageAccuracy = round1(activeRows.reduce((total, row) => {
    const completed = row.exact_score_count + row.correct_outcome_count;
    return total + ratio(completed, row.predictions_submitted_count);
  }, 0) / (activeRows.length || 1));

  return {
    groupAveragePoints: average('total_points'),
    groupAveragePicks: average('predictions_submitted_count'),
    groupAverageExact: average('exact_score_count'),
    groupAverageAccuracy: averageAccuracy,
    pointsBehindRankAbove: rankAbove ? Math.max(0, rankAbove.total_points - playerRow.total_points) : 0,
    pointsBehindLeader: leader ? Math.max(0, leader.total_points - playerRow.total_points) : 0,
    pointsToTop10: rank && rank <= 10 ? 0 : tenth ? Math.max(0, tenth.total_points - playerRow.total_points + 1) : 0,
  };
}

function buildNearbyRows(rows, playerId) {
  const index = rows.findIndex((row) => row.player_id === playerId);
  if (index < 0) return [];
  return rows.slice(Math.max(0, index - 2), index + 3).map((row, offset) => ({
    ...row,
    rank: Math.max(0, index - 2) + offset + 1,
    isCurrentPlayer: row.player_id === playerId,
  }));
}

function ratio(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function round1(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
}
