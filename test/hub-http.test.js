import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { LoginThrottle, UserStore, createSessions } from '../hub/auth.js';
import { Dispatcher } from '../hub/dispatcher.js';
import { createHubApp } from '../hub/http-app.js';
import { Store } from '../hub/store.js';
import { closeServer, listen, openStream, tempDir, waitFor } from './helpers.js';

const b64 = (text) => Buffer.from(text).toString('base64');

// A running hub with two people (Brennan and Max) and a small fake set of page files.
async function startHub(t, options = {}) {
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
  const dispatcher = new Dispatcher({ store, users: () => users.listNames() });
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

test('the login page is public, the app needs a login, and only listed files are served', async (t) => {
  const { base, login, as } = await startHub(t);
  assert.equal((await fetch(`${base}/login`)).status, 200);
  const home = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login');
  for (const asset of ['app.js', 'render.js', 'login.js', 'styles.css']) {
    assert.equal((await fetch(`${base}/assets/${asset}`)).status, 200, asset);
  }
  assert.equal((await fetch(`${base}/assets/users.json`)).status, 404);
  assert.equal((await fetch(`${base}/nope`)).status, 404);

  const cookie = await login('Max');
  const page = await as(cookie)('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Workspace/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await as(cookie)('/login', { redirect: 'manual' })).status, 302);
});

test('requests addressed to some other host name are refused', async (t) => {
  const { port } = await startHub(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/login', headers: { host: 'evil.example.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

test('a public host name can be allowed for use behind a tunnel', async (t) => {
  const { port } = await startHub(t, { publicHosts: ['workspace.example.com'] });
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/login', headers: { host: 'workspace.example.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 200);
});

test('wrong names and passwords cannot log in, and the answer does not say which was wrong', async (t) => {
  const { base, json } = await startHub(t);
  const wrongPassword = await fetch(`${base}/api/login`, json({ name: 'Max', password: 'nope' }));
  const wrongName = await fetch(`${base}/api/login`, json({ name: 'Nobody', password: 'nope' }));
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongName.status, 401);
  assert.deepEqual(await wrongPassword.json(), await wrongName.json());
});

test('logging in sets a private cookie, /api/me knows you, and logging out ends it', async (t) => {
  const { base, json, creds, as } = await startHub(t);
  const res = await fetch(`${base}/api/login`, json({ name: 'max', password: creds.Max.password }));
  assert.equal(res.status, 200);
  const setCookie = res.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Secure/);

  const secure = await fetch(`${base}/api/login`, json({ name: 'Max', password: creds.Max.password }, 'POST', { 'x-forwarded-proto': 'https' }));
  assert.match(secure.headers.getSetCookie()[0], /Secure/);

  const cookie = setCookie.split(';')[0];
  const me = await (await as(cookie)('/api/me')).json();
  assert.deepEqual(me, { name: 'Max', users: ['Brennan', 'Max'], presence: { Brennan: false, Max: false } });

  assert.equal((await fetch(`${base}/api/me`)).status, 401);
  assert.equal((await as('ws_session=forged.value')('/api/me')).status, 401);

  const out = await as(cookie)('/api/logout', json({}));
  assert.equal(out.status, 200);
  assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);
});

test('too many wrong passwords block even the right password for a while', async (t) => {
  const { base, json, creds } = await startHub(t);
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await fetch(`${base}/api/login`, json({ name: 'Max', password: 'wrong' }))).status, 401);
  }
  const blocked = await fetch(`${base}/api/login`, json({ name: 'Max', password: creds.Max.password }));
  assert.equal(blocked.status, 429);
});

test('login only accepts JSON from this site and refuses oversized bodies', async (t) => {
  const { base, json } = await startHub(t);
  const foreign = await fetch(`${base}/api/login`, json({ name: 'Max', password: 'x' }, 'POST', { origin: 'https://evil.example.com' }));
  assert.equal(foreign.status, 403);
  const plain = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' });
  assert.equal(plain.status, 415);
  const huge = await fetch(`${base}/api/login`, json({ name: 'Max', password: 'x'.repeat(100_000) }));
  assert.equal(huge.status, 413);
});

test('the project API needs a login', async (t) => {
  const { base, json } = await startHub(t);
  assert.equal((await fetch(`${base}/api/projects`)).status, 401);
  assert.equal((await fetch(`${base}/api/projects`, json({ name: 'x' }))).status, 401);
});

test('projects can be created, listed and opened, and bad repo addresses are refused', async (t) => {
  const { login, as, json, makeProject } = await startHub(t);
  const cookie = await login('Brennan');
  const project = await makeProject(cookie, { name: 'Dispatch Map', repoUrl: 'https://github.com/acme/map' });
  assert.equal(project.createdBy, 'Brennan');

  const bad = await as(cookie)('/api/projects', json({ name: 'Bad', repoUrl: 'file:///c:/x' }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /github\.com/);

  const list = await (await as(cookie)('/api/projects')).json();
  assert.deepEqual(list.map((p) => p.name), ['Dispatch Map']);

  const details = await (await as(cookie)(`/api/projects/${project.id}`)).json();
  assert.equal(details.project.name, 'Dispatch Map');
  assert.deepEqual(details.files.files, []);
  assert.equal(details.notes.version, 0);
  assert.equal(details.previewVersion, 0);
  assert.match(details.previewUrl, new RegExp(`^/preview/${project.id}/[^/]+/$`));
  assert.deepEqual(details.presence, { Brennan: false, Max: false });

  assert.equal((await as(cookie)('/api/projects/nope')).status, 404);
});

test('a message for the AI reaches only the sender\'s own helper', async (t) => {
  const { login, as, json, makeProject, connectHelper, store } = await startHub(t);
  const max = await login('Max');
  const brennan = await login('Brennan');
  const project = await makeProject(max);
  const maxHelper = await connectHelper('Max');
  const brennanHelper = await connectHelper('Brennan');

  const sent = await as(max)(`/api/projects/${project.id}/send`, json({ text: 'make the pins blue', to: 'ai' }));
  assert.equal(sent.status, 202);
  const job = await maxHelper.waitFor((m) => m.event === 'job');
  assert.equal(job.data.job.text, 'make the pins blue');
  assert.equal(job.data.job.who, 'Max');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(brennanHelper.messages.some((m) => m.event === 'job'), false, "Brennan's helper must never get Max's job");

  const sentByBrennan = await as(brennan)(`/api/projects/${project.id}/send`, json({ text: 'and mine', to: 'ai' }));
  assert.equal(sentByBrennan.status, 202);
  assert.equal(maxHelper.messages.filter((m) => m.event === 'job').length, 1, "Max's helper must never get Brennan's job");
  assert.ok(store.events(project.id).some((e) => e.state === 'queued' && e.who === 'Brennan'));
  maxHelper.close();
  brennanHelper.close();
});

test('a team chat message goes on the timeline and to no AI', async (t) => {
  const { login, as, json, makeProject, connectHelper, store } = await startHub(t);
  const brennan = await login('Brennan');
  const project = await makeProject(brennan);
  const maxHelper = await connectHelper('Max');
  const res = await as(brennan)(`/api/projects/${project.id}/send`, json({ text: 'lunch?', to: 'Max' }));
  assert.equal(res.status, 202);
  const chat = store.events(project.id).find((e) => e.kind === 'team-chat');
  assert.deepEqual([chat.who, chat.to, chat.text], ['Brennan', 'Max', 'lunch?']);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(maxHelper.messages.some((m) => m.event === 'job'), false);
  maxHelper.close();
});

test('sending needs real text, a real project and a real recipient', async (t) => {
  const { login, as, json, makeProject } = await startHub(t);
  const cookie = await login('Brennan');
  const project = await makeProject(cookie);
  const send = (body) => as(cookie)(`/api/projects/${project.id}/send`, json(body));
  assert.equal((await send({ text: '   ', to: 'ai' })).status, 400);
  assert.equal((await send({ text: 'x'.repeat(9000), to: 'ai' })).status, 400);
  assert.equal((await send({ text: 'hi', to: 'Stranger' })).status, 400);
  assert.equal((await send({ text: 'hi', to: 'Brennan' })).status, 400);
  assert.equal((await as(cookie)('/api/projects/nope/send', json({ text: 'hi', to: 'ai' }))).status, 404);
});

test('helper endpoints need a valid helper token', async (t) => {
  const { base, json } = await startHub(t);
  assert.equal((await fetch(`${base}/helper/connect`)).status, 401);
  assert.equal((await fetch(`${base}/helper/connect`, { headers: { authorization: 'Bearer nope' } })).status, 401);
  assert.equal((await fetch(`${base}/helper/events`, json({ jobId: 'x', events: [] }))).status, 401);
  assert.equal((await fetch(`${base}/helper/done`, json({ jobId: 'x' }))).status, 401);
});

test('a helper reports its run, the timeline shows it, and finishing frees the line', async (t) => {
  const { login, as, json, makeProject, connectHelper, bearer, base, store } = await startHub(t);
  const max = await login('Max');
  const project = await makeProject(max);
  const helper = await connectHelper('Max');
  await as(max)(`/api/projects/${project.id}/send`, json({ text: 'go', to: 'ai' }));
  const { jobId } = (await helper.waitFor((m) => m.event === 'job')).data.job;

  const events = await fetch(`${base}/helper/events`, json({ jobId, events: [{ kind: 'claude-text', text: 'working on it' }] }, 'POST', bearer('Max')));
  assert.equal(events.status, 200);
  assert.equal(store.events(project.id).find((e) => e.kind === 'claude-text').owner, 'Max');

  const stranger = await fetch(`${base}/helper/events`, json({ jobId, events: [{ kind: 'claude-text', text: 'hijack' }] }, 'POST', bearer('Brennan')));
  assert.equal(stranger.status, 403);

  const done = await fetch(`${base}/helper/done`, json({ jobId }, 'POST', bearer('Max')));
  assert.equal(done.status, 200);
  assert.ok(store.events(project.id).some((e) => e.kind === 'status' && e.state === 'idle'));
  helper.close();
});

test('people watching a project see what happened, and hear when someone comes online', async (t) => {
  const { base, login, as, json, makeProject, connectHelper } = await startHub(t);
  const brennan = await login('Brennan');
  const project = await makeProject(brennan);
  await as(brennan)(`/api/projects/${project.id}/send`, json({ text: 'first', to: 'Max' }));

  const stream = await openStream(`${base}/api/projects/${project.id}/stream`, {
    headers: { cookie: brennan },
  });
  assert.equal(stream.status, 200);
  await stream.waitFor((m) => m.data.kind === 'team-chat' && m.data.text === 'first');
  const first = await stream.waitFor((m) => m.data.kind === 'presence');
  assert.deepEqual(first.data.online, { Brennan: false, Max: false });

  const helper = await connectHelper('Max');
  await stream.waitFor((m) => m.data.kind === 'presence' && m.data.online.Max === true);

  await as(brennan)(`/api/projects/${project.id}/send`, json({ text: 'second', to: 'Max' }));
  const second = await stream.waitFor((m) => m.data.text === 'second');
  assert.ok(second.id > 0);
  stream.close();
  helper.close();

  const replay = await openStream(`${base}/api/projects/${project.id}/stream`, {
    headers: { cookie: brennan, 'last-event-id': String(second.id - 1) },
  });
  await replay.waitFor((m) => m.data.text === 'second');
  assert.equal(replay.messages.some((m) => m.data.text === 'first'), false, 'only what was missed is replayed');
  replay.close();
});

test('the project stream needs a login and a real project', async (t) => {
  const { base, login, as, makeProject } = await startHub(t);
  assert.equal((await fetch(`${base}/api/projects/x/stream`)).status, 401);
  const cookie = await login('Max');
  await makeProject(cookie);
  assert.equal((await as(cookie)('/api/projects/nope/stream')).status, 404);
});

test('shared notes warn instead of overwriting', async (t) => {
  const { login, as, json, makeProject, store } = await startHub(t);
  const brennan = await login('Brennan');
  const max = await login('Max');
  const project = await makeProject(brennan);
  const notes = (cookie, body) => as(cookie)(`/api/projects/${project.id}/notes`, json(body, 'PUT'));

  const first = await notes(brennan, { text: 'plan A', baseVersion: 0 });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).notes.version, 1);

  const stale = await notes(max, { text: 'plan B', baseVersion: 0 });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.match(conflict.error, /newer/);
  assert.equal(conflict.notes.text, 'plan A');

  assert.equal((await notes(max, { text: 'plan A+B', baseVersion: 1 })).status, 200);
  const read = await (await as(max)(`/api/projects/${project.id}/notes`)).json();
  assert.equal(read.text, 'plan A+B');
  assert.deepEqual(store.events(project.id).filter((e) => e.kind === 'notes-saved').map((e) => e.who), ['Brennan', 'Max']);
  assert.equal((await notes(max, { text: 'x', baseVersion: 'one' })).status, 400);
});

test('blocked commands can be allowed once, only by the person whose computer would run them', async (t) => {
  const { login, as, json, makeProject, connectHelper, bearer, base, store } = await startHub(t);
  const max = await login('Max');
  const brennan = await login('Brennan');
  const project = await makeProject(max);
  const helper = await connectHelper('Max');
  await as(max)(`/api/projects/${project.id}/send`, json({ text: 'fetch', to: 'ai' }));
  const { jobId } = (await helper.waitFor((m) => m.event === 'job')).data.job;
  await fetch(`${base}/helper/events`, json({
    jobId,
    events: [{ kind: 'run-done', ok: true, text: 'blocked', denials: [{ tool: 'Bash', id: 'a', command: 'curl -s https://example.com', description: 'Check' }] }],
  }, 'POST', bearer('Max')));
  await fetch(`${base}/helper/done`, json({ jobId }, 'POST', bearer('Max')));
  const { approvalId } = store.events(project.id).find((e) => e.kind === 'approval-needed');

  const approve = (cookie, id) => as(cookie)(`/api/projects/${project.id}/approve`, json({ approvalId: id }));
  assert.equal((await approve(brennan, approvalId)).status, 403);
  assert.equal((await approve(max, 'nope')).status, 404);
  assert.equal((await approve(max, approvalId)).status, 202);
  const second = (await helper.waitFor((m) => m.event === 'job' && m.data.job.kind === 'approval')).data.job;
  assert.deepEqual(second.allowedTools, ['Bash(curl -s https://example.com)']);
  assert.equal((await approve(max, approvalId)).status, 409);
  helper.close();
});

test('file lists and previews uploaded by a helper are shared, and the preview is sandboxed', async (t) => {
  const { login, as, json, makeProject, bearer, base, port } = await startHub(t);
  const brennan = await login('Brennan');
  const project = await makeProject(brennan);

  const watcher = await openStream(`${base}/api/projects/${project.id}/stream`, { headers: { cookie: brennan } });
  const files = await fetch(`${base}/helper/files`, json({ projectId: project.id, files: ['index.html', 'app.js'], changed: ['app.js'] }, 'POST', bearer('Max')));
  assert.equal(files.status, 200);
  const heard = await watcher.waitFor((m) => m.data.kind === 'files' && m.data.changed?.[0] === 'app.js');
  assert.deepEqual(heard.data.files, ['index.html', 'app.js']);

  const upload = await fetch(`${base}/helper/preview`, json({
    projectId: project.id,
    files: [{ path: 'index.html', data: b64('<h1>Hello</h1><link rel="stylesheet" href="css/site.css">') }, { path: 'css/site.css', data: b64('h1{color:red}') }],
  }, 'POST', bearer('Max')));
  assert.equal(upload.status, 200);
  await watcher.waitFor((m) => m.data.kind === 'preview' && m.data.version === 1);
  watcher.close();

  const details = await (await as(brennan)(`/api/projects/${project.id}`)).json();
  assert.equal(details.previewVersion, 1);
  const page = await fetch(`${base}${details.previewUrl}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hello/);
  assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const css = await fetch(`${base}${details.previewUrl}css/site.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  assert.equal((await fetch(`${base}${details.previewUrl}missing.html`)).status, 404);
  assert.equal((await fetch(`${base}/preview/${project.id}/not-a-token/`)).status, 403);
  const otherProject = await makeProject(brennan, { name: 'Other' });
  const otherDetails = await (await as(brennan)(`/api/projects/${otherProject.id}`)).json();
  const tokenFromOther = otherDetails.previewUrl.split('/')[3];
  assert.equal((await fetch(`${base}/preview/${project.id}/${tokenFromOther}/`)).status, 403, 'a token only works for its own project');
  assert.ok(port > 0);
});

test('bad uploads from a helper are refused', async (t) => {
  const { login, json, makeProject, bearer, base } = await startHub(t);
  const project = await makeProject(await login('Max'));
  const post = (route, body) => fetch(`${base}${route}`, json(body, 'POST', bearer('Max')));
  assert.equal((await post('/helper/preview', { projectId: project.id, files: [{ path: '../evil.html', data: b64('x') }] })).status, 400);
  assert.equal((await post('/helper/preview', { projectId: 'nope', files: [] })).status, 404);
  assert.equal((await post('/helper/files', { projectId: 'nope', files: [], changed: [] })).status, 404);
});
