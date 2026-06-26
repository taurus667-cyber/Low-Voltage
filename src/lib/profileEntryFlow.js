import { normalizePlayerName, validatePlayerFullName } from './playerNames.js';

export const PROFILE_ENTRY_MODES = {
  ENTER_NAME: 'enter-name',
  SINGLE_NAME_FOUND: 'single-name-found',
  CONFIRM_RENAME: 'confirm-rename',
  PROTECTED_CODE_REQUIRED: 'protected-code-required',
  EXISTING_PROFILE_FOUND: 'existing-profile-found',
  SAVE_ERROR: 'save-error',
};

export function getProfileEntryState({ inputName, players = [] }) {
  const validation = validatePlayerFullName(inputName);
  const normalizedInput = normalizePlayerName(validation.name);
  const activePlayers = players.filter((player) => player?.is_active !== false);
  const exactMatches = activePlayers.filter((player) =>
    normalizePlayerName(player.name) === normalizedInput
  );

  if (!validation.valid) {
    return {
      mode: exactMatches.length ? PROFILE_ENTRY_MODES.SINGLE_NAME_FOUND : PROFILE_ENTRY_MODES.ENTER_NAME,
      validation,
      matches: exactMatches,
    };
  }

  return {
    mode: exactMatches.length ? PROFILE_ENTRY_MODES.EXISTING_PROFILE_FOUND : PROFILE_ENTRY_MODES.ENTER_NAME,
    validation,
    matches: exactMatches,
  };
}

export function getProfilePickHint(player, predictionCounts = new Map()) {
  const count = predictionCounts.get(player?.id) || 0;
  if (!count) return 'No saved picks yet.';
  if (count === 1) return 'This profile has 1 saved pick.';
  return `This profile has ${count} saved picks.`;
}

export function getRenameSummary({ currentName, newName, willRevealCode = false }) {
  return {
    title: `Update ${currentName} to ${newName}`,
    body: 'Your saved picks, leaderboard history, and Top 10 status stay with this profile.',
    codeNote: willRevealCode
      ? 'After this update, we will show your private Top 10 code. Save it.'
      : '',
  };
}
