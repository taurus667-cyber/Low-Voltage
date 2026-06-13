import test from 'node:test';
import assert from 'node:assert/strict';
import { getTeamMetadata, teamIdentity } from './teamMetadata.js';

test('maps common provider aliases to verified flag metadata', () => {
  assert.equal(getTeamMetadata('USA').country_code, 'us');
  assert.equal(getTeamMetadata('Korea Republic').name, 'South Korea');
  assert.equal(getTeamMetadata('Czech Republic').slug, 'czechia');
  assert.equal(getTeamMetadata('Egypt').flag_url, 'https://flagcdn.com/w80/eg.png');
  assert.equal(getTeamMetadata('Bosnia and Herzegovina').country_code, 'ba');
  assert.equal(getTeamMetadata('Curacao').country_code, 'cw');
  assert.equal(getTeamMetadata('Sweden').country_code, 'se');
});

test('combines provider team logo with static flag metadata', () => {
  const team = teamIdentity('United States', [{
    name: 'United States',
    provider: 'API-Football',
    provider_team_id: '2384',
    logo_url: 'https://example.com/logo.png',
  }]);

  assert.equal(team.slug, 'united-states');
  assert.equal(team.country_code, 'us');
  assert.equal(team.logo_url, 'https://example.com/logo.png');
  assert.equal(team.provider_team_id, '2384');
});
