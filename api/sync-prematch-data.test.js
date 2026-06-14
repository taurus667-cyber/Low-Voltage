import test from 'node:test';
import assert from 'node:assert/strict';
import { findProviderFixture, normalizeOdds, normalizePredictionAids, normalizeProviderTeams } from './sync-prematch-data.js';

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

test('normalizes provider teams with profile and visual metadata', () => {
  const rows = normalizeProviderTeams(
    [{
      team: {
        id: 2384,
        name: 'USA',
        country: 'USA',
        logo: 'https://example.com/usa.png',
      },
      venue: { name: 'Home Stadium' },
    }],
    { id: 'tournament-1' },
    new Date('2026-06-13T00:00:00Z'),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider_team_id, '2384');
  assert.equal(rows[0].slug, 'united-states');
  assert.equal(rows[0].country_code, 'us');
  assert.equal(rows[0].flag_url, 'https://flagcdn.com/w80/us.png');
  assert.equal(rows[0].profile_payload.venue.name, 'Home Stadium');
});

test('pre-match fixture matching tolerates provider accents and aliases', () => {
  const cases = [
    ['Germany', 'Curacao', 'Germany', 'Curaçao'],
    ['Spain', 'Cape Verde', 'Spain', 'Cabo Verde'],
    ['Portugal', 'DR Congo', 'Portugal', 'Congo DR'],
    ['Belgium', 'Iran', 'Belgium', 'IR Iran'],
    ['Canada', 'Bosnia & Herzegovina', 'Canada', 'Bosnia and Herzegovina'],
    ['Ivory Coast', 'Ecuador', "Côte d'Ivoire", 'Ecuador'],
    ['United States', 'Australia', 'USA', 'Australia'],
    ['South Korea', 'Czechia', 'Korea Republic', 'Czech Republic'],
    ['Turkiye', 'Paraguay', 'Turkey', 'Paraguay'],
  ];

  cases.forEach(([teamA, teamB, providerHome, providerAway], index) => {
    const fixture = findProviderFixture(
      {
        team_a: teamA,
        team_b: teamB,
        kickoff_time: '2026-06-14T17:00:00Z',
      },
      [{
        fixture: { id: 12345 + index, date: '2026-06-14T17:00:00Z' },
        teams: {
          home: { name: providerHome },
          away: { name: providerAway },
        },
      }],
    );

    assert.equal(fixture.fixture.id, 12345 + index, `${teamA} v ${teamB}`);
  });
});
