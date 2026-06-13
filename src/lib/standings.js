import { isFinalScoreComplete } from './scoring.js';

export function calculateGroupStandings(matches = []) {
  const groups = new Map();

  matches
    .filter((match) => match.is_published)
    .filter((match) => /group/i.test(match.stage || '') || match.group_name)
    .forEach((match) => {
      const groupName = match.group_name || 'Group Stage';
      const table = groups.get(groupName) || new Map();
      const teamA = ensureRow(table, match.team_a, groupName);
      const teamB = ensureRow(table, match.team_b, groupName);
      groups.set(groupName, table);

      if (!isFinalScoreComplete(match)) return;

      const scoreA = Number(match.team_a_score);
      const scoreB = Number(match.team_b_score);

      applyResult(teamA, scoreA, scoreB);
      applyResult(teamB, scoreB, scoreA);
    });

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([groupName, rows]) => ({
      groupName,
      rows: Array.from(rows.values()).sort(compareRows).map((row, index) => ({
        ...row,
        position: index + 1,
      })),
    }));
}

export function getTeamStanding(matches = [], teamName) {
  const groups = calculateGroupStandings(matches);
  for (const group of groups) {
    const row = group.rows.find((item) => item.team === teamName);
    if (row) return row;
  }
  return null;
}

function ensureRow(table, team, groupName) {
  if (!table.has(team)) {
    table.set(team, {
      groupName,
      team,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0,
    });
  }
  return table.get(team);
}

function applyResult(row, goalsFor, goalsAgainst) {
  row.played += 1;
  row.goals_for += goalsFor;
  row.goals_against += goalsAgainst;
  row.goal_difference = row.goals_for - row.goals_against;

  if (goalsFor > goalsAgainst) {
    row.won += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.drawn += 1;
    row.points += 1;
  } else {
    row.lost += 1;
  }
}

function compareRows(a, b) {
  return b.points - a.points ||
    b.goal_difference - a.goal_difference ||
    b.goals_for - a.goals_for ||
    a.team.localeCompare(b.team);
}
