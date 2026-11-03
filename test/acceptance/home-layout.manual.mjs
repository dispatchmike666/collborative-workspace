// A deliberate check of the home page in a real browser. It is not part of `npm test`, because it needs
// Playwright (a browser robot), and Glasshouse installs no packages. Run it by hand after changing the home
// page or the stylesheet, on a computer that has Playwright installed (globally is fine):
//
//   node test/acceptance/home-layout.manual.mjs
//
// It starts a hub on this computer with the real page files, pretends your helper reports 0, 1, 6 and 50 open
// Claude chats (with ordinary and with very long names), and opens Home at desktop and phone width. For each it
// checks that nothing spills off the side, the home page shows at most three chats with a "See all" link,
// the feed and the projects still come right after, and the Chats page lists every chat. It also checks that a
// message you are typing is not pulled away when newer chats push that chat out of the top three.
// Nothing here uses Claude or your plan.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LoginThrottle, UserStore, createSessions } from '../../hub/auth.js';
import { LiveChats } from '../../hub/chats.js';
import { Dispatcher } from '../../hub/dispatcher.js';
import { createHubApp } from '../../hub/http-app.js';
import { Store } from '../../hub/store.js';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const entry = path.join(globalRoot, 'playwright', 'index.mjs');
    if (!fs.existsSync(entry)) {
      console.error('Playwright is not installed here, so this check cannot run. Nothing was tested.');
      process.exit(2);
    }
    return import(pathToFileURL(entry).href);
  }
}

const { chromium } = await loadPlaywright();
const publicDir = path.resolve(import.meta.dirname, '..', '..', 'hub', 'public');
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

const LONG = 'x'.repeat(90);
function fakeChats(count, long, now = Date.now()) {
  return Array.from({ length: count }, (_, i) => ({
    id: `chat-${String(i).padStart(4, '0')}-abcdef`,
    name: long ? `A chat with a very long title that keeps going ${LONG}` : `Chat ${i + 1}`,
    folder: long ? `C:\\Users\\Someone\\Documents\\random-projects\\${LONG}\\glasshouse` : 'glasshouse',
    where: i % 2 ? 'terminal' : 'desktop',
    status: i % 3 ? 'idle' : 'busy',
    doing: i % 3 ? null : (long ? 'Working on it '.repeat(12) : 'Fixing the home page'),
    canMessage: true,
    updatedAt: now - i * 60_000,
  }));
}

async function startHub(long) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-layout-'));
  const users = new UserStore(path.join(dir, 'users.json'));
  const me = long ? 'Bartholomew_Maximus' : 'Brennan';
  const creds = users.addUser(me);
  users.addUser('Max');
  const store = new Store(path.join(dir, 'data'));
  const dispatcher = new Dispatcher({ store, users: () => users.listNames() });
  dispatcher.isOnline = () => true; // as if this person's helper were running
  const chats = new LiveChats();
  const app = createHubApp({
    store, dispatcher, users, chats, publicDir,
    sessions: createSessions('layout-check'), previewTokens: createSessions('layout-preview'), throttle: new LoginThrottle(),
  });
  const projectName = long ? 'Long-distance-moving-quote-calculator-with-no-spaces-at-a' : 'Quote tool';
  for (const name of [projectName, 'Dispatch board']) {
    const project = store.createProject({ name, repoUrl: '', createdBy: me });
    store.addEvent(project.id, { kind: 'user', who: me, text: long ? `Please${LONG}${LONG}` : 'Please fix the quote form' });
  }
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, me, password: creds.password, chats, server, dir };
}

async function openPage(browser, hub, viewport, hash = '') {
  const page = await browser.newPage({ viewport });
  // No first-visit tip, so it cannot cover anything.
  await page.addInitScript(() => localStorage.setItem('ws.welcomed', 'true'));
  const login = await page.request.post(`${hub.base}/api/login`, { data: { name: hub.me, password: hub.password } });
  if (!login.ok()) throw new Error('Could not log in to the test hub.');
  await page.goto(`${hub.base}/${hash}`);
  await page.waitForSelector('.chats-section');
  await page.waitForTimeout(400);
  return page;
}

// Anything wider than the window, and the first element that sticks out past the right edge.
const spill = (page) => page.evaluate(() => {
  const view = document.getElementById('view');
  const width = document.documentElement.clientWidth;
  const out = [...view.querySelectorAll('*')].find((node) => node.getClientRects().length && node.getBoundingClientRect().right > width + 1);
  return { wide: view.scrollWidth > view.clientWidth + 1, culprit: out ? `${out.tagName.toLowerCase()}.${out.className}` : null };
});

const SIZES = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch();
const hubs = [];
try {
  for (const long of [false, true]) {
    const hub = await startHub(long);
    hubs.push(hub);
    for (const count of [0, 1, 6, 50]) {
      hub.chats.set(hub.me, fakeChats(count, long));
      for (const [sizeName, viewport] of Object.entries(SIZES)) {
        const label = `${count} chats, ${long ? 'long names' : 'short names'}, ${sizeName}`;
        const page = await openPage(browser, hub, viewport);
        const home = await page.evaluate(() => {
          const section = document.querySelector('.chats-section');
          const seeAll = section.querySelector('.see-all');
          const columns = document.querySelector('.home > .columns');
          const box = (node) => node.getBoundingClientRect();
          return {
            rows: section.querySelectorAll('.feed li').length,
            seeAll: seeAll.hidden ? null : seeAll.textContent,
            note: section.querySelector('p.muted.small')?.textContent ?? '',
            columnsBelow: Boolean(columns) && box(columns).top >= box(section).bottom - 1,
            sectionHeight: box(section).height,
            feed: Boolean(document.querySelector('.columns .feed, .columns .empty')),
            projects: document.querySelectorAll('.project-card').length,
          };
        });
        check(home.rows === Math.min(count, 3), `${label}: Home shows ${home.rows} chats, expected ${Math.min(count, 3)}`);
        check(count > 3 ? home.seeAll === `See all ${count} chats` : home.seeAll === null, `${label}: "See all" link reads ${JSON.stringify(home.seeAll)}`);
        if (count === 0) check(/No Claude chats are open/.test(home.note), `${label}: no "nothing open" note`);
        check(home.columnsBelow, `${label}: the feed and projects overlap the chats`);
        check(home.feed && home.projects === 2, `${label}: the feed or the projects are missing`);
        check(home.sectionHeight < (long ? 900 : 500), `${label}: the chats take ${Math.round(home.sectionHeight)}px of height`);
        const homeSpill = await spill(page);
        check(!homeSpill.wide && !homeSpill.culprit, `${label}: Home spills off the side (${homeSpill.culprit})`);

        if (count > 3) {
          await page.click('.see-all');
          await page.waitForSelector('.chats-page');
          await page.waitForTimeout(300);
          const rows = await page.locator('.chats-page .feed li').count();
          check(rows === count, `${label}: the Chats page shows ${rows} chats, expected ${count}`);
          const pageSpill = await spill(page);
          check(!pageSpill.wide && !pageSpill.culprit, `${label}: the Chats page spills off the side (${pageSpill.culprit})`);
        }
        await page.close();
      }
    }

    // A half-typed message survives newer chats pushing its chat off the short list.
    if (!long) {
      hub.chats.set(hub.me, fakeChats(6, false));
      const page = await openPage(browser, hub, SIZES.desktop);
      const third = page.locator('.chats-section .feed li').nth(2);
      const name = await third.locator('strong').textContent();
      await third.getByRole('button', { name: 'Message this chat' }).click();
      await third.locator('input').fill('half-typed message');
      const now = Date.now();
      hub.chats.set(hub.me, fakeChats(6, false, now).map((chat, i) => ({ ...chat, updatedAt: i === 2 ? now - 3_600_000 : now - i * 1000 + 10 * 60_000 })));
      await page.waitForTimeout(6000); // the page asks for the chats every 5 seconds
      const still = page.locator('.chats-section .feed li', { hasText: name });
      check(await still.count() === 1, 'typing: the chat being typed into dropped off the home page');
      check(await still.locator('input').inputValue() === 'half-typed message', 'typing: the half-typed message was lost');
      await page.close();
    }
  }
} finally {
  await browser.close();
  for (const hub of hubs) {
    hub.server.close();
    fs.rmSync(hub.dir, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`The home page check found ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('The home page holds up with 0, 1, 6 and 50 chats, long names, and at phone width.');
