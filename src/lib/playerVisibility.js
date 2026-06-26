export function isPlayerActive(player) {
  return player?.is_active !== false;
}

export function isPublicStatsPlayer(player) {
  return isPlayerActive(player) && player?.hidden_from_public_stats !== true;
}
