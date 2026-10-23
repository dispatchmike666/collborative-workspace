import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LoginThrottle, UserStore, createSessions } from '../hub/auth.js';
import { Dispatcher } from '../hub/dispatcher.js';
import { createHubApp } from '../hub/http-app.js';
import { Store } from '../hub/store.js';
import { closeServer, listen, openStream, tempDir } from './helpers.js';

// A running hub with two people (Brennan and Max) and a small fake set of page files.
// Returns handy functions: login(name) gives a cookie, as(cookie)(route) calls the API, and so on.
export async function startHub(t, options = {}, dispatcherOptions = {}) {
  const dir = tempDir(t);
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(publicDir);
  const pages = {
    'login.html': '<title>Log in</title>',
    'app.html': '<title>Workspace</title>',
    'app.js': '//app',
    'render.js': '//render',
    'login.js': '//login',
    'styles.css': 'body{}',
  };
  for (const [file, text] of Object.entries(pages)) fs.writeFileSync(path.join(publicDir, file), text);

  const users = new UserStore(path.join(dir, 'users.json'));
  const creds = { Brennan: users.addUser('Brennan'), Max: users.addUser('Max') };
  const store = new Store(path.join(dir, 'data'));
  const dispatcher = new Dispatcher({ store, users: () => users.listNames(), ...dispatcherOptions });
  const app = createHubApp({
    store,
    dispatcher,
    users,
    sessions: createSessions('session-secret'),
    previewTokens: createSessions('preview-secret', { ttlMs: 3_600_000 }),
    throttle: new LoginThrottle(),
    publicDir,
    ...options,
  });
  const { server, port } = await listen(app);
  t.after(() => closeServer(server));
  const base = `http://127.0.0.1:${port}`;

  const json = (body, method = 'POST', headers = {}) => ({
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const login = async (name) => {
    const res = await fetch(`${base}/api/login`, json({ name, password: creds[name].password }));
    assert.equal(res.status, 200);
    return res.headers.getSetCookie()[0].split(';')[0];
  };
  const as = (cookie) => (route, init = {}) => fetch(`${base}${route}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } });
  const bearer = (name) => ({ authorization: `Bearer ${creds[name].helperToken}` });
  const connectHelper = async (name) => {
    const stream = await openStream(`${base}/helper/connect`, { headers: bearer(name) });
    assert.equal(stream.status, 200);
    await stream.waitFor((m) => m.event === 'hello');
    return stream;
  };
  const makeProject = async (cookie, body = { name: 'Map' }) => {
    const res = await as(cookie)('/api/projects', json(body));
    assert.equal(res.status, 201);
    return res.json();
  };
  return { base, port, users, creds, store, dispatcher, json, login, as, bearer, connectHelper, makeProject };
}

