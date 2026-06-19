import { getTeamMetadata, normalizeName, slugifyTeamName } from './teamMetadata.js';

export function dedupeEvents(events = []) {
  const kept = [];
  events.forEach((event) => {
    if (kept.some((existing) => areDuplicateEvents(existing, event))) return;
    kept.push(event);
  });
  return kept;
}

export function areDuplicateEvents(a, b) {
  if (getEventCategory(a) !== getEventCategory(b)) return false;
  if (getTeamKey(a.team_name) !== getTeamKey(b.team_name)) return false;
  if (!isCloseMinute(a, b)) return false;
  if (getEventCategory(a) === 'card') {
    return normalizeEventDetailForKey(a) === normalizeEventDetailForKey(b);
  }
  if (!samePerson(a.player_name, b.player_name)) return false;
  if (!samePerson(a.assist_name, b.assist_name)) return false;
  if (isGoalEvent(a) || isGoalEvent(b)) return true;
  return normalizeEventDetailForKey(a) === normalizeEventDetailForKey(b);
}

function getTeamKey(value) {
  return getTeamMetadata(value)?.slug || slugifyTeamName(value || '');
}

export function isGoalEvent(event) {
  const type = String(event.event_type || '').toLowerCase();
  const detail = String(event.event_detail || '').toLowerCase();
  if (type.includes('goal')) return true;
  if (type.includes('var') || type.includes('card') || type.includes('subst')) return false;
  return ['normal goal', 'own goal', 'penalty'].some((label) => detail.includes(label));
}

function isCloseMinute(a, b) {
  const aMinute = getEventMinute(a);
  const bMinute = getEventMinute(b);
  if (!Number.isFinite(aMinute) || !Number.isFinite(bMinute)) return (a.elapsed ?? '') === (b.elapsed ?? '');
  const tolerance = ['card', 'subst'].includes(getEventCategory(a)) ? 1 : 0;
  return Math.abs(aMinute - bMinute) <= tolerance;
}

function getEventMinute(event) {
  const elapsed = Number(event.elapsed);
  if (!Number.isFinite(elapsed)) return Number.NaN;
  const extra = Number(event.extra_time);
  return Number.isFinite(extra) ? elapsed + extra : elapsed;
}

function samePerson(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const first = getPersonParts(a);
  const second = getPersonParts(b);
  if (first.normalized === second.normalized) return true;
  if (first.tokens.length === 1) return second.tokens.includes(first.tokens[0]);
  if (second.tokens.length === 1) return first.tokens.includes(second.tokens[0]);
  if (!first.last || !second.last || first.last !== second.last) return false;
  if (first.initials.some((initial) => second.first?.startsWith(initial))) return true;
  if (second.initials.some((initial) => first.first?.startsWith(initial))) return true;
  if (!first.first || !second.first) return true;
  return first.first === second.first || first.first[0] === second.first[0];
}

function getPersonParts(value) {
  const normalized = normalizeName(value);
  const tokens = normalized
    .split(' ')
    .filter(Boolean);
  const meaningful = tokens.filter((token) => token.length > 1);
  const initials = tokens.filter((token) => token.length === 1);
  const last = meaningful.at(-1) || tokens.at(-1) || '';
  const first = meaningful.length > 1 ? meaningful[0] : '';
  return { first, last, initials, normalized, tokens };
}

function getEventCategory(event) {
  if (isGoalEvent(event)) return 'goal';
  const type = String(event.event_type || '').toLowerCase();
  if (type.includes('card')) return 'card';
  if (type.includes('subst')) return 'subst';
  if (type.includes('var')) return 'var';
  return normalizeName(event.event_type || event.event_detail || 'event');
}

function normalizeEventDetailForKey(event) {
  if (isGoalEvent(event)) return 'goal';
  return normalizeName(event.event_detail || event.event_type || '')
    .replace(/\b\d+\b/g, '')
    .trim();
}

export function splitMatchEvents(events = []) {
  const uniqueEvents = dedupeEvents(events);
  const goalEvents = uniqueEvents.filter(isGoalEvent);
  const keyEvents = uniqueEvents.filter((event) =>
    !isGoalEvent(event) &&
    ['card', 'subst', 'var'].includes(getEventCategory(event)),
  );
  return { keyEvents, goalEvents };
}

function getEventDisplayKey(event) {
  return [
    getEventMinute(event),
    getTeamKey(event.team_name),
    getPersonParts(event.player_name || '').last,
    getPersonParts(event.assist_name || '').last,
    getEventCategory(event),
    normalizeEventDetailForKey(event),
  ].join('|');
}

export function dedupeEventKeys(events = []) {
  const seen = new Set();
  return events.filter((event) => {
    const key = getEventDisplayKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
