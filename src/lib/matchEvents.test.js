import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeEvents, isGoalEvent, splitMatchEvents } from './matchEvents.js';

test('dedupes repeated rendered goal events across provider wording', () => {
  const rows = dedupeEvents([
    {
      elapsed: 34,
      team_name: 'United States',
      player_name: 'Forward One',
      assist_name: 'Creator One',
      event_type: 'Goal',
      event_detail: 'Normal Goal',
    },
    {
      elapsed: 34,
      team_name: 'United States',
      player_name: 'Forward One',
      assist_name: 'Creator One',
      event_type: 'Goal',
      event_detail: 'Goal',
    },
    {
      elapsed: 61,
      team_name: 'Paraguay',
      player_name: 'Carded Player',
      event_type: 'Card',
      event_detail: 'Yellow Card',
    },
    {
      elapsed: 61,
      team_name: 'Paraguay',
      player_name: 'Carded Player',
      event_type: 'Card',
      event_detail: 'Yellow Card',
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows.filter(isGoalEvent).length, 1);
});

test('does not classify VAR or card rows as goals', () => {
  assert.equal(isGoalEvent({ event_type: 'Var', event_detail: 'Goal cancelled' }), false);
  assert.equal(isGoalEvent({ event_type: 'Card', event_detail: 'Second Yellow Card' }), false);
  assert.equal(isGoalEvent({ event_type: 'Goal', event_detail: 'Own Goal' }), true);
});

test('dedupes provider full-name and abbreviated key events', () => {
  const { keyEvents, goalEvents } = splitMatchEvents([
    {
      elapsed: 10,
      team_name: 'Paraguay',
      player_name: 'J. Caceres',
      event_type: 'Card',
      event_detail: 'Yellow Card',
    },
    {
      elapsed: 10,
      team_name: 'Paraguay',
      player_name: 'Juan Caceres',
      event_type: 'Card',
      event_detail: 'Yellow Card',
    },
    {
      elapsed: 45,
      team_name: 'USA',
      player_name: 'Christian Pulisic',
      assist_name: 'Sebastian Berhalter',
      event_type: 'subst',
      event_detail: 'Substitution 1',
    },
    {
      elapsed: 46,
      team_name: 'USA',
      player_name: 'C. Pulisic',
      assist_name: 'S. Berhalter',
      event_type: 'subst',
      event_detail: 'Substitution 1',
    },
    {
      elapsed: 45,
      team_name: 'Paraguay',
      player_name: 'Damian Bobadilla',
      assist_name: 'Mauricio Magalhaes Prado',
      event_type: 'subst',
      event_detail: 'Substitution 1',
    },
    {
      elapsed: 46,
      team_name: 'Paraguay',
      player_name: 'D. Bobadilla',
      assist_name: 'Mauricio',
      event_type: 'subst',
      event_detail: 'Substitution 1',
    },
    {
      elapsed: 28,
      team_name: 'USA',
      player_name: 'F. Balogun',
      event_type: 'Var',
      event_detail: 'Goal Disallowed - offside',
    },
  ]);

  assert.equal(goalEvents.length, 0);
  assert.equal(keyEvents.length, 4);
  assert.deepEqual(keyEvents.map((event) => event.player_name), [
    'J. Caceres',
    'Christian Pulisic',
    'Damian Bobadilla',
    'F. Balogun',
  ]);
});

test('dedupes same-team card clusters that arrive under different player names', () => {
  const { keyEvents } = splitMatchEvents([
    {
      elapsed: 32,
      team_name: 'Qatar',
      player_name: 'H. Al Amin',
      event_type: 'Card',
      event_detail: 'Red Card',
    },
    {
      elapsed: 33,
      team_name: 'Qatar',
      player_name: 'Homam Ahmed',
      event_type: 'Card',
      event_detail: 'Red Card',
    },
    {
      elapsed: 33,
      team_name: 'Qatar',
      player_name: 'H. Al Amin',
      event_type: 'Card',
      event_detail: 'Red Card',
    },
    {
      elapsed: 51,
      team_name: 'Qatar',
      player_name: 'A. O. Madibo',
      event_type: 'Card',
      event_detail: 'Yellow Card',
    },
    {
      elapsed: 53,
      team_name: 'Qatar',
      player_name: 'A. O. Madibo',
      event_type: 'Card',
      event_detail: 'Red Card',
    },
  ]);

  assert.equal(keyEvents.filter((event) => /red/i.test(event.event_detail)).length, 2);
  assert.deepEqual(
    keyEvents.filter((event) => /red/i.test(event.event_detail)).map((event) => event.player_name),
    ['H. Al Amin', 'A. O. Madibo'],
  );
});

test('dedupes provider goals when stoppage time is also sent as absolute minute', () => {
  const { goalEvents } = splitMatchEvents([
    {
      elapsed: 45,
      extra_time: 5,
      team_name: 'USA',
      player_name: 'F. Balogun',
      assist_name: 'M. Tillman',
      event_type: 'Goal',
      event_detail: 'Goal',
    },
    {
      elapsed: 50,
      team_name: 'United States',
      player_name: 'Folarin Balogun',
      assist_name: 'Malik Tillman',
      event_type: 'Goal',
      event_detail: 'Goal',
    },
    {
      elapsed: 90,
      extra_time: 8,
      team_name: 'USA',
      player_name: 'G. Reyna',
      assist_name: 'A. Freeman',
      event_type: 'Goal',
      event_detail: 'Goal',
    },
    {
      elapsed: 98,
      team_name: 'United States',
      player_name: 'Giovanni Reyna',
      assist_name: 'Alex Freeman',
      event_type: 'Goal',
      event_detail: 'Goal',
    },
  ]);

  assert.equal(goalEvents.length, 2);
  assert.deepEqual(goalEvents.map((event) => event.player_name), ['F. Balogun', 'G. Reyna']);
});

test('dedupes same stoppage-time goal when only one provider row includes an assist', () => {
  const { goalEvents } = splitMatchEvents([
    {
      elapsed: 90,
      extra_time: 2,
      team_name: 'Canada',
      player_name: 'J. David',
      assist_name: null,
      event_type: 'Goal',
      event_detail: 'Normal Goal',
    },
    {
      elapsed: 90,
      extra_time: 2,
      team_name: 'Canada',
      player_name: 'J. David',
      assist_name: 'N. Saliba',
      event_type: 'Goal',
      event_detail: 'Normal Goal',
    },
  ]);

  assert.equal(goalEvents.length, 1);
  assert.equal(goalEvents[0].player_name, 'J. David');
});
