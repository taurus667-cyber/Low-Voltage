import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { isAuthorized } from '../api/sync-live-scores.js';

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5173';
const isProdSmoke = Boolean(process.env.SMOKE_BASE_URL);
let server;

if (process.env.npm_lifecycle_event === 'smoke:prod' && !process.env.SMOKE_BASE_URL) {
  throw new Error('SMOKE_BASE_URL is required for npm run smoke:prod.');
}

if (!isProdSmoke) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    stdio: 'ignore',
  });
  await waitForUrl(baseUrl);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const fatalConsole = [];
page.on('console', (message) => {
  if (message.type() === 'error') fatalConsole.push(message.text());
});
page.on('pageerror', (error) => fatalConsole.push(error.message));

try {
  await page.route('**/rest/v1/players*', async (route, request) => {
    if (isProdSmoke) return route.continue();
    if (request.method() === 'GET') return route.fulfill(json([]));
    if (request.method() === 'POST') {
      return route.fulfill(json([{
        id: 'player-smoke',
        name: 'Smoke Tester',
        player_token: 'smoke-token',
        is_active: true,
        created_at: new Date().toISOString(),
      }]));
    }
    return route.continue();
  });
  await page.route('**/rest/v1/matches*', async (route) => {
    if (isProdSmoke) return route.continue();
    return route.fulfill(json(smokeMatches()));
  });
  await page.route('**/rest/v1/predictions*', async (route) => {
    if (isProdSmoke) return route.continue();
    return route.fulfill(json([]));
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await expectVisible(page, 'text=Predict FIFA World Cup 2026 scores.');

  if (!isProdSmoke) {
    await page.getByLabel('Display name').fill('Smoke Tester');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectVisible(page, 'text=Live now');
    await expectVisible(page, 'text=Canada');
    await expectVisible(page, 'text=Live: 1 - 0');
    await expectVisible(page, 'text=Predictions are closed because kickoff time has passed.');
    await expectVisible(page, 'text=Played (1)');
  } else {
    await page.goto(`${baseUrl}/matches`, { waitUntil: 'networkidle' });
    await expectVisible(page, 'text=Matches');
  }

  for (const route of ['/predictions', '/leaderboard', '/admin']) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    await expectVisible(page, route === '/predictions' ? 'text=Picks' : route === '/leaderboard' ? 'text=Leaderboard' : 'text=Admin');
  }

  if (isProdSmoke) {
    const syncResponse = await page.request.get(`${baseUrl}/api/sync-live-scores`);
    if (syncResponse.status() !== 401) {
      throw new Error(`Expected live sync endpoint to reject unauthenticated smoke request, got ${syncResponse.status()}.`);
    }
  } else {
    process.env.CRON_SECRET = 'smoke-secret';
    if (isAuthorized({ headers: {}, query: {} })) {
      throw new Error('Expected live sync endpoint authorization to reject missing CRON_SECRET.');
    }
  }

  if (fatalConsole.length) {
    throw new Error(`Fatal console errors:\n${fatalConsole.join('\n')}`);
  }
} finally {
  await browser.close();
  if (server) server.kill();
}

function smokeMatches() {
  const now = Date.now();
  const started = new Date(now - 30 * 60 * 1000).toISOString();
  const future = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const old = new Date(now - 4 * 60 * 60 * 1000).toISOString();
  return [
    {
      id: 'match-live',
      external_match_id: 'smoke-live',
      team_a: 'Canada',
      team_b: 'Mexico',
      kickoff_time: started,
      venue: 'Smoke Stadium',
      group_name: 'Group A',
      stage: 'Group Stage',
      team_a_score: null,
      team_b_score: null,
      status: 'live',
      is_locked: false,
      is_published: true,
      live_team_a_score: 1,
      live_team_b_score: 0,
      live_source: 'API-Football',
      live_minute: 34,
      live_status_note: 'First Half',
      last_synced_at: new Date().toISOString(),
    },
    {
      id: 'match-upcoming',
      external_match_id: 'smoke-upcoming',
      team_a: 'USA',
      team_b: 'Brazil',
      kickoff_time: future,
      stage: 'Group Stage',
      team_a_score: null,
      team_b_score: null,
      status: 'scheduled',
      is_locked: false,
      is_published: true,
    },
    {
      id: 'match-played',
      external_match_id: 'smoke-played',
      team_a: 'Spain',
      team_b: 'Japan',
      kickoff_time: old,
      stage: 'Group Stage',
      team_a_score: 2,
      team_b_score: 1,
      status: 'finished',
      is_locked: true,
      is_published: true,
    },
  ];
}

async function expectVisible(page, selector) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 });
}

async function waitForUrl(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function json(body) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-range',
      'content-range': '0-0/1',
    },
  };
}
