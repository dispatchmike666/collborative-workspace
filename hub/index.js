import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { LoginThrottle, UserStore, createSessions, loadOrCreateSecret } from './auth.js';
import { Dispatcher } from './dispatcher.js';
import { createHubApp } from './http-app.js';
import { Store } from './store.js';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.resolve(process.env.HUB_DATA ?? path.join(root, 'hub-data'));
const port = Number(process.env.PORT ?? 3000);
// When the hub is reached through a tunnel or a web host, its public address goes here.
const publicHosts = (process.env.HUB_PUBLIC_HOST ?? '').split(',').map((host) => host.trim()).filter(Boolean);

fs.mkdirSync(dataDir, { recursive: true });
const users = new UserStore(path.join(dataDir, 'users.json'));
if (users.listNames().length === 0) {
  console.error('Nobody can log in yet.');
  console.error('Create the first person with:  npm run hub:add-user -- Brennan');
  process.exit(1);
}

const secret = loadOrCreateSecret(path.join(dataDir, 'secret.key'));
const store = new Store(path.join(dataDir, 'store'));
const dispatcher = new Dispatcher({ store, users: () => users.listNames() });
const behindHttps = publicHosts.length > 0;
const app = createHubApp({
  store,
  dispatcher,
  users,
  sessions: createSessions(secret),
  previewTokens: createSessions(`${secret}|preview`, { ttlMs: 12 * 60 * 60 * 1000 }),
  throttle: new LoginThrottle(),
  publicDir: path.join(root, 'hub', 'public'),
  publicHosts,
  secureCookies: behindHttps,
  trustProxy: behindHttps,
});

// 127.0.0.1 means "this computer only". To let others in, put a tunnel or a web host in front.
http.createServer(app).listen(port, '127.0.0.1', () => {
  console.log(`The hub is running at http://localhost:${port}`);
  console.log(`People who can log in: ${users.listNames().join(', ')}`);
  if (behindHttps) console.log(`It also answers to: ${publicHosts.join(', ')}`);
  console.log(`Its data is kept in: ${dataDir}`);
  console.log('Press Ctrl+C to stop.');
});
