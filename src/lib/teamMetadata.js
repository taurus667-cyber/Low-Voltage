const FLAG_SOURCE_URL = 'https://flagcdn.com/';
const FLAG_SOURCE_CHECKED_AT = '2026-06-13';

const TEAM_METADATA = [
  ['Algeria', 'dz'],
  ['Argentina', 'ar'],
  ['Australia', 'au'],
  ['Austria', 'at'],
  ['Belgium', 'be'],
  ['Bosnia & Herzegovina', 'ba', ['Bosnia and Herzegovina']],
  ['Brazil', 'br'],
  ['Canada', 'ca'],
  ['Cape Verde', 'cv'],
  ['Colombia', 'co'],
  ['Costa Rica', 'cr'],
  ['Croatia', 'hr'],
  ['Curacao', 'cw', ['Curacao']],
  ['Czechia', 'cz', ['Czech Republic']],
  ['Denmark', 'dk'],
  ['DR Congo', 'cd', ['Congo DR', 'Democratic Republic of the Congo']],
  ['Ecuador', 'ec'],
  ['Egypt', 'eg'],
  ['England', 'gb-eng'],
  ['France', 'fr'],
  ['Germany', 'de'],
  ['Ghana', 'gh'],
  ['Haiti', 'ht'],
  ['Iran', 'ir'],
  ['Iraq', 'iq'],
  ['Italy', 'it'],
  ['Ivory Coast', 'ci', ['Cote d Ivoire', "Cote d'Ivoire"]],
  ['Japan', 'jp'],
  ['Jordan', 'jo'],
  ['Mexico', 'mx'],
  ['Morocco', 'ma'],
  ['Netherlands', 'nl'],
  ['New Zealand', 'nz'],
  ['Nigeria', 'ng'],
  ['Norway', 'no'],
  ['Panama', 'pa'],
  ['Paraguay', 'py'],
  ['Portugal', 'pt'],
  ['Qatar', 'qa'],
  ['Saudi Arabia', 'sa'],
  ['Scotland', 'gb-sct'],
  ['Senegal', 'sn'],
  ['Serbia', 'rs'],
  ['South Africa', 'za'],
  ['South Korea', 'kr', ['Korea Republic', 'Korea Rep']],
  ['Spain', 'es'],
  ['Sweden', 'se'],
  ['Switzerland', 'ch'],
  ['Tunisia', 'tn'],
  ['Turkiye', 'tr', ['Turkey', 'Türkiye']],
  ['United States', 'us', ['USA', 'United States of America', 'US']],
  ['Uruguay', 'uy'],
  ['Uzbekistan', 'uz'],
];

const BY_SLUG = new Map();
const BY_NAME = new Map();

TEAM_METADATA.forEach(([name, countryCode, aliases = []]) => {
  const item = {
    name,
    slug: slugifyTeamName(name),
    country_code: countryCode,
    flag_url: flagUrl(countryCode),
    source_url: FLAG_SOURCE_URL,
    source_checked_at: FLAG_SOURCE_CHECKED_AT,
  };
  BY_SLUG.set(item.slug, item);
  [name, ...aliases].forEach((alias) => BY_NAME.set(normalizeName(alias), item));
});

export function getTeamMetadata(teamName) {
  return BY_NAME.get(normalizeName(teamName)) || null;
}

export function getTeamMetadataBySlug(slug) {
  return BY_SLUG.get(String(slug || '').toLowerCase()) || null;
}

export function slugifyTeamName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function enrichTeam(team) {
  const metadata = getTeamMetadata(team?.name);
  const slug = team?.slug || metadata?.slug || slugifyTeamName(team?.name);
  return {
    ...(metadata || {}),
    ...(team || {}),
    slug,
    country_code: team?.country_code || metadata?.country_code || '',
    flag_url: team?.flag_url || metadata?.flag_url || '',
    source_url: team?.source_url || metadata?.source_url || '',
    source_checked_at: team?.source_checked_at || metadata?.source_checked_at || '',
  };
}

export function teamIdentity(teamName, teams = []) {
  const metadata = getTeamMetadata(teamName);
  const normalized = normalizeName(teamName);
  const providerTeam = teams.find((team) => normalizeName(team.name) === normalized);
  return enrichTeam({
    ...(metadata || {}),
    ...(providerTeam || {}),
    name: providerTeam?.name || metadata?.name || teamName,
  });
}

export function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function flagUrl(countryCode) {
  if (!countryCode) return '';
  return `https://flagcdn.com/w80/${countryCode.toLowerCase()}.png`;
}
