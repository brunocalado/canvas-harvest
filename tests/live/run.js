/*!
 * Canvas Harvest
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Live checks of Canvas Harvest against a running Foundry, a GM and a player at once.
 *
 * Needs a disposable world (a `claude-*` one, never a real game) with Canvas Harvest and Canvas Loot
 * enabled, a GM user named Gamemaster without a password, and Playwright installed:
 *
 *   cd tests && npm install
 *   node live/run.js              every case
 *   node live/run.js tool         only the cases whose name holds "tool"
 *
 * Environment: FOUNDRY_URL (http://localhost:30000), CHROME_PATH (a Chromium to use instead of
 * Playwright's own). The run makes its own scene, items, actor, Player user and resource, all
 * named "CH Test …", and leaves them for the next run.
 *
 * A case passes when it throws nothing and the clients logged no console error it didn't expect.
 * Dragging a token with the mouse is out of reach: the canvas draws at a frame or two per second
 * under software WebGL, too slow for core's drag to register.
 */

import { chromium } from "playwright";
import { cases } from "./cases.js";
import { setupWorld } from "./fixtures.js";

const URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";
const filter = process.argv[2] ?? "";
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  // Software WebGL, or the canvas never draws in a container.
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required"]
});

/** Console errors per client, emptied at the start of each case. */
const errors = [];

/**
 * @param {string} user
 * @returns {Promise<import("playwright").Page>}
 */
async function login(user) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on("console", m => { if ( m.type() === "error" ) errors.push(`[${user}] ${m.text()}`); });
  page.on("pageerror", e => errors.push(`[${user}] [pageerror] ${e.message}`));
  await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
  // The join form changed within v14: a select named userid up to ~14.365, a text field after, and a
  // select named userId again from 14.369. Attribute values match case-sensitively.
  const select = page.locator("select[name=userid], select[name=userId], #join-username");
  // A server that just started can render the form after the network goes quiet.
  await page.waitForSelector("select[name=userid], select[name=userId], #join-username, input[name=username]", { timeout: 60000 });
  if ( (await select.count()) && (await select.first().evaluate(el => el.tagName)) === "SELECT" ) {
    await select.first().selectOption({ label: user });
  }
  else await page.fill("input[name=username]", user);
  await Promise.all([page.waitForURL(/\/game/), page.click("button[name=join], button[type=submit]")]);
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120000 });
  // Foundry holds every sound until the first user gesture, and only a trusted key or click counts.
  await page.keyboard.press("Shift");
  return page;
}

/**
 * Run a function body inside a client and return its result.
 * @param {import("playwright").Page} page
 * @param {string} body
 * @returns {Promise<*>}
 */
function ev(page, body) {
  return page.evaluate(`(async () => { ${body} })()`);
}

/**
 * Record every notification a client is sent. Reading them off the screen misses some: core shows
 * five at a time and queues the rest, and removing one from the page doesn't free its place.
 * @param {import("playwright").Page} page
 */
function recordNotes(page) {
  return ev(page, `globalThis.chTestNotes = [];
    const notify = ui.notifications.notify.bind(ui.notifications);
    ui.notifications.notify = (message, type, options) => { chTestNotes.push(String(message)); return notify(message, type, options); };`);
}

/**
 * The notifications a client was sent since the last read, as the text it shows: core cleans the
 * HTML of a message and renders it.
 * @param {import("playwright").Page} page
 * @returns {Promise<string[]>}
 */
function notes(page) {
  return ev(page, `const text = chTestNotes.map(m => { const el = document.createElement("div"); el.innerHTML = foundry.utils.cleanHTML(m);
      return el.textContent.trim(); });
    chTestNotes.length = 0;
    ui.notifications.clear();
    return text;`);
}

/**
 * Wait until a condition holds in a client: an update reaches the other client a moment later.
 * @param {import("playwright").Page} page
 * @param {string} expression   a JS expression
 * @param {number} [timeout]
 */
async function until(page, expression, timeout = 10000) {
  await page.waitForFunction(expression, null, { timeout, polling: 200 });
}

/**
 * Close every framed window, such as the welcome journal a system opens after load, so it never
 * sits on top of what a case looks at.
 * @param {import("playwright").Page} page
 */
function closeWindows(page) {
  return ev(page, `for ( const app of [...foundry.applications.instances.values()] ) if ( app.hasFrame ) await app.close();`);
}

const gm = await login("Gamemaster");
await ev(gm, `if ( !game.users.getName("Player") ) await User.implementation.create({ name: "Player", role: CONST.USER_ROLES.PLAYER });`);
const pl = await login("Player");
await recordNotes(gm);
await recordNotes(pl);
const ids = await ev(gm, setupWorld);
await until(pl, `canvas.ready && canvas.scene?.id === ${JSON.stringify(ids.scene)}`, 60000);
// Late windows, such as a system's welcome journal, open a few seconds after ready.
await wait(4000);

const t = { gm, pl, ids, ev, notes, until, wait };
let failed = 0;
for ( const c of cases.filter(c => c.name.includes(filter)) ) {
  await closeWindows(gm);
  await closeWindows(pl);
  await notes(gm);
  await notes(pl);
  errors.length = 0;
  let problem = null;
  try {
    await c.run(t);
  } catch(err) {
    problem = err.message;
  }
  const unexpected = errors.filter(e => !c.expectErrors?.test(e));
  if ( !problem && unexpected.length ) problem = `console errors:\n    ${unexpected.join("\n    ")}`;
  if ( problem ) failed++;
  console.log(`${problem ? "FAIL" : "PASS"}  ${c.name}${problem ? `\n    ${problem}` : ""}`);
}

await browser.close();
process.exit(failed ? 1 : 0);
