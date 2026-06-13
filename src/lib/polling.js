import { isMatchLive } from './matches.js';

export const LIVE_REFRESH_MS = 30 * 1000;
export const NEAR_MATCH_REFRESH_MS = 5 * 60 * 1000;
export const NEAR_MATCH_WINDOW_MS = 60 * 60 * 1000;

export function getMatchesRefreshInterval(matches = [], now = Date.now()) {
  const publishedMatches = matches.filter((match) => match.is_published);
  if (publishedMatches.some((match) => isMatchLive(match, now))) return LIVE_REFRESH_MS;

  const hasNearMatch = publishedMatches.some((match) => {
    const kickoff = new Date(match.kickoff_time).getTime();
    return !Number.isNaN(kickoff) && kickoff > now && kickoff - now <= NEAR_MATCH_WINDOW_MS;
  });

  return hasNearMatch ? NEAR_MATCH_REFRESH_MS : 0;
}

