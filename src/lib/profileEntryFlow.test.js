import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProfileEntryState,
  getProfilePickHint,
  getRenameSummary,
  PROFILE_ENTRY_MODES,
} from './profileEntryFlow.js';

test('single-name input matching existing profile moves to single-name found mode', () => {
  const result = getProfileEntryState({
    inputName: 'Nawaf',
    players: [{ id: 'player-1', name: 'Nawaf', is_active: true }],
  });

  assert.equal(result.mode, PROFILE_ENTRY_MODES.SINGLE_NAME_FOUND);
  assert.equal(result.matches[0].id, 'player-1');
});

test('full duplicate name moves to existing profile mode', () => {
  const result = getProfileEntryState({
    inputName: 'Nawaf Dhubaib',
    players: [{ id: 'player-1', name: 'Nawaf Dhubaib', is_active: true }],
  });

  assert.equal(result.mode, PROFILE_ENTRY_MODES.EXISTING_PROFILE_FOUND);
});

test('inactive duplicate profile is ignored in entry matching', () => {
  const result = getProfileEntryState({
    inputName: 'Adil',
    players: [{ id: 'inactive', name: 'Adil', is_active: false }],
  });

  assert.equal(result.mode, PROFILE_ENTRY_MODES.ENTER_NAME);
  assert.equal(result.matches.length, 0);
});

test('rename summary explains saved picks and code reveal', () => {
  const summary = getRenameSummary({
    currentName: 'Nawaf',
    newName: 'Nawaf Dhubaib',
    willRevealCode: true,
  });

  assert.equal(summary.title, 'Update Nawaf to Nawaf Dhubaib');
  assert.match(summary.body, /saved picks/);
  assert.match(summary.codeNote, /private Top 10 code/);
});

test('profile pick hint describes saved picks', () => {
  assert.equal(getProfilePickHint({ id: 'p1' }, new Map([['p1', 3]])), 'This profile has 3 saved picks.');
  assert.equal(getProfilePickHint({ id: 'p2' }, new Map()), 'No saved picks yet.');
});
