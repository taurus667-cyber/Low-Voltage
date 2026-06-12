import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOdds, normalizePredictionAids } from './sync-prematch-data.js';

test('normalizes pre-match prediction aid data', () => {
  const rows = normalizePredictionAids(
    { id: 'match-1', tournament_id: 'tournament-1' },
    {
      predictions: [{ predictions: { advice: 'Double chance: home or draw', percent: { home: '45%' } } }],
      h2h: [
        { teams: { home: { winner: true }, away: { winner: false } } },
        { teams: { home: { winner: false }, away: { winner: true } } },
      ],
      injuries: [{ player: { name: 'Injured Player' } }],
    },
  );

  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.aid_type === 'api_prediction').summary, 'Double chance: home or draw');
  assert.equal(rows.find((row) => row.aid_type === 'injuries').summary, '1 reported absence');
});

test('normalizes match winner odds', () => {
  const rows = normalizeOdds(
    { id: 'match-1', tournament_id: 'tournament-1' },
    [{
      bookmakers: [{
        name: 'Bookmaker',
        bets: [{
          name: 'Match Winner',
          values: [
            { value: 'Home', odd: '2.10' },
            { value: 'Draw', odd: '3.20' },
            { value: 'Away', odd: '2.90' },
          ],
        }],
      }],
    }],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].home_value, '2.10');
  assert.equal(rows[0].draw_value, '3.20');
  assert.equal(rows[0].away_value, '2.90');
});
