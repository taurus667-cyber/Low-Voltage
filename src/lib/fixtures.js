export function parseFixtureCsv(text) {
  const rows = parseCsv(text.trim());
  if (!rows.length) return [];
  const [headers, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some(Boolean))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header.trim(), (row[index] || '').trim()])),
    );
}

export function parseFixtureJson(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.matches)) return parsed.matches;
  throw new Error('JSON must be an array or an object with a matches array.');
}

export function normalizeFixtureRows(rows) {
  return rows.map((row, index) => {
    const externalId = String(row.match_id || row.external_match_id || '').trim();
    const teamA = String(row.team_a || '').trim();
    const teamB = String(row.team_b || '').trim();
    const kickoff = String(row.kickoff_time || '').trim();
    if (!externalId || !teamA || !teamB || !kickoff) {
      throw new Error(`Fixture row ${index + 1} is missing match_id, team_a, team_b, or kickoff_time.`);
    }
    const kickoffDate = new Date(kickoff);
    if (Number.isNaN(kickoffDate.getTime())) {
      throw new Error(`Fixture row ${index + 1} has an invalid kickoff_time.`);
    }
    return {
      external_match_id: externalId,
      stage: row.stage || null,
      group_name: row.group_name || null,
      team_a: teamA,
      team_b: teamB,
      kickoff_time: kickoffDate.toISOString(),
      venue: row.venue || null,
      status: row.status || 'scheduled',
      is_locked: Boolean(row.is_locked ?? false),
      is_published: row.is_published === undefined ? false : Boolean(row.is_published),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((items) => items.some((item) => item.trim()));
}
