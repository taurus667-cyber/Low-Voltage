import { isFinalScoreComplete } from './scoring.js';

export const LIVE_MATCH_WINDOW_MINUTES = 150;

export function isMatchLocked(match, now = Date.now()) {
  return Boolean(match.is_locked) || new Date(match.kickoff_time).getTime() <= now;
}

export function isMatchLive(match, now = Date.now()) {
  if (isMatchFinished(match)) return false;
  if (match.status === 'live') return true;

  const kickoff = new Date(match.kickoff_time).getTime();
  if (Number.isNaN(kickoff) || kickoff > now) return false;

  const liveWindowMs = LIVE_MATCH_WINDOW_MINUTES * 60 * 1000;
  return now - kickoff <= liveWindowMs;
}

export function isMatchUpcoming(match, now = Date.now()) {
  if (isMatchFinished(match) || isMatchLive(match, now)) return false;
  return new Date(match.kickoff_time).getTime() > now;
}

export function isMatchPlayed(match, now = Date.now()) {
  if (isMatchFinished(match)) return true;
  if (isMatchLive(match, now)) return false;
  return new Date(match.kickoff_time).getTime() <= now;
}

export function isMatchFinished(match) {
  return match.status === 'finished' || (match.status !== 'live' && isFinalScoreComplete(match));
}

export function getMatchLockReason(match, now = Date.now()) {
  if (match.is_locked) return 'Predictions are closed because the admin lock is on.';
  if (new Date(match.kickoff_time).getTime() <= now) {
    return 'Predictions are closed because kickoff time has passed. Edit the kickoff time to reopen it.';
  }
  return '';
}

export function getLiveStatusLabel(match) {
  if (match.status === 'finished' || isFinalScoreComplete(match)) return 'Finished';
  if (match.status === 'live' || isMatchLive(match)) return 'Live';
  return 'Scheduled';
}
