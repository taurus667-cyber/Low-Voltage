# Codex Built-In Browser Runbook

Use this whenever the user asks to run, open, inspect, or verify this app in the built-in Codex browser.

## Start The Local App

From the repo root:

```powershell
npm.cmd run dev
```

If the turn needs to continue while the server runs, start it hidden from PowerShell:

```powershell
Start-Process npm.cmd -ArgumentList 'run','dev' -WorkingDirectory (Get-Location) -WindowStyle Hidden
```

Default local URL:

```text
http://127.0.0.1:5173/
```

If the browser shows `127.0.0.1 refused to connect`, the dev server is not running or is still starting.

## Connect To The Built-In Browser

Use the `browser:control-in-app-browser` skill, then discover `node_repl js` if the JS tool is not visible.

Initialize the in-app browser exactly once per fresh Node REPL session:

```js
if (globalThis.agent?.browsers == null) {
  const { setupBrowserRuntime } = await import("C:/Users/7X3D/.codex/plugins/cache/openai-bundled/browser/26.623.42026/scripts/browser-client.mjs");
  await setupBrowserRuntime({ globals: globalThis });
}
globalThis.browser = await agent.browsers.get("iab");
nodeRepl.write(await browser.documentation());
```

After documentation is read, select or create the active tab:

```js
await browser.nameSession("FIFA 2026 app browser");
await (await browser.capabilities.get("visibility")).set(true);
globalThis.tab = await browser.tabs.selected() || await browser.tabs.new();
```

Open the local app:

```js
await tab.goto("http://127.0.0.1:5173/");
await tab.playwright.waitForLoadState({ state: "networkidle", timeoutMs: 15000 });
nodeRepl.write(JSON.stringify({ url: await tab.url(), title: await tab.title() }, null, 2));
```

## Useful Checks

Read a DOM snapshot:

```js
globalThis.snapshot = await tab.playwright.domSnapshot();
nodeRepl.write(snapshot.slice(0, 4000));
```

Reload after code changes:

```js
await tab.reload();
await tab.playwright.waitForLoadState({ state: "networkidle", timeoutMs: 15000 });
```

Navigate to a page:

```js
await tab.goto("http://127.0.0.1:5173/champion-bonus");
await tab.playwright.waitForLoadState({ state: "networkidle", timeoutMs: 15000 });
```

Take a screenshot if visual verification matters:

```js
const png = await tab.screenshot({ fullPage: false });
await nodeRepl.emitImage(png);
```

## Interaction Rules

- Prefer Playwright locators and DOM snapshots over coordinate clicks.
- Before clicking/filling, confirm the locator resolves to exactly one element unless uniqueness is obvious.
- Do not use regex names with `getByRole`; use plain string names.
- If a locator fails, take a fresh `domSnapshot()` and rebuild the locator.
