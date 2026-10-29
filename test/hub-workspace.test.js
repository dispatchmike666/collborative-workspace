import assert from 'node:assert/strict';
import test from 'node:test';
import { openStream } from './helpers.js';
import { startHub } from './hub-fixture.js';

// A hub with Brennan logged in and one project, plus handy shortcuts for the new routes.
async function setup(t) {
  const hub = await startHub(t);
  const brennan = await hub.login('Brennan');
  const max = await hub.login('Max');
  const project = await hub.makeProject(brennan, { name: 'Map' });
  const call = (cookie, route, method = 'GET', body) => hub.as(cookie)(route, body === undefined ? { method } : hub.json(body, method));
  const url = (rest = '') => `/api/projects/${project.id}${rest}`;
  return { ...hub, brennan, max, project, call, url };
}

test('every new route needs a login', async (t) => {
  const { base, json, project } = await setup(t);
  const routes = [
    ['GET', '/api/pulse'], ['GET', '/api/prompts'], ['POST', '/api/prompts'], ['DELETE', '/api/prompts/x'],
    ['GET', `/api/projects/${project.id}/board`], ['POST', `/api/projects/${project.id}/board/cards`],
    ['PATCH', `/api/projects/${project.id}/board/cards/x`], ['DELETE', `/api/projects/${project.id}/board/cards/x`],
    ['POST', `/api/projects/${project.id}/board/cards/x/start`],
    ['GET', `/api/projects/${project.id}/knowledge`], ['PUT', `/api/projects/${project.id}/knowledge/brief`],
    ['PUT', `/api/projects/${project.id}/knowledge/share-notes`], ['POST', `/api/projects/${project.id}/knowledge/decisions`],
    ['DELETE', `/api/projects/${project.id}/knowledge/decisions/x`], ['POST', `/api/projects/${project.id}/react`],
    ['POST', `/api/projects/${project.id}/typing`], ['GET', `/api/projects/${project.id}/source?path=a.txt`],
  ];
  for (const [method, route] of routes) {
    const res = await fetch(`${base}${route}`, method === 'GET' ? undefined : json({}, method));
    assert.equal(res.status, 401, `${method} ${route}`);
  }
});

test('cards can be added, edited, moved and removed, and each change is announced', async (t) => {
  const { brennan, call, url, project, store } = await setup(t);
  const created = await call(brennan, url('/board/cards'), 'POST', { title: 'Add a footer', detail: 'Friendly', column: 'ideas' });
  assert.equal(created.status, 201);
  const card = await created.json();
  assert.equal(card.column, 'ideas');
  assert.equal(card.createdBy, 'Brennan');

  const board = await (await call(brennan, url('/board'))).json();
  assert.deepEqual(board.columns, ['ideas', 'todo', 'doing', 'done']);
  assert.equal(board.cards.length, 1);

  const moved = await call(brennan, url(`/board/cards/${card.id}`), 'PATCH', { column: 'todo' });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).column, 'todo');
  const renamed = await call(brennan, url(`/board/cards/${card.id}`), 'PATCH', { title: 'Add a nicer footer' });
  assert.equal(renamed.status, 200);

  const kinds = store.events(project.id).filter((e) => e.kind === 'board-card').map((e) => [e.action, e.title, e.column]);
  assert.deepEqual(kinds, [['added', 'Add a footer', 'ideas'], ['moved', 'Add a footer', 'todo']], 'a rename is not announced, a move is');

  assert.equal((await call(brennan, url(`/board/cards/${card.id}`), 'DELETE')).status, 200);
  assert.equal((await call(brennan, url(`/board/cards/${card.id}`), 'DELETE')).status, 404);
  assert.equal((await call(brennan, url('/board/cards/nope'), 'PATCH', { title: 'x' })).status, 404);
});

test('bad cards get a plain refusal', async (t) => {
  const { brennan, call, url } = await setup(t);
  assert.equal((await call(brennan, url('/board/cards'), 'POST', { title: '   ' })).status, 400);
  assert.equal((await call(brennan, url('/board/cards'), 'POST', { title: 'ok', column: 'sideways' })).status, 400);
  const refusal = await (await call(brennan, url('/board/cards'), 'POST', { title: '' })).json();
  assert.match(refusal.error, /Give the card a title/);
  assert.equal((await call(brennan, '/api/projects/nope/board/cards', 'POST', { title: 'x' })).status, 404);
});

test('giving a card to my Claude starts a run on my own helper and moves the card to Doing', async (t) => {
  const { max, call, url, connectHelper, store, project } = await setup(t);
  const maxHelper = await connectHelper('Max');
  const brennanHelper = await connectHelper('Brennan');
  const card = await (await call(max, url('/board/cards'), 'POST', { title: 'Add a footer', detail: 'Small and friendly' })).json();

  const started = await call(max, url(`/board/cards/${card.id}/start`), 'POST', {});
  assert.equal(started.status, 202);
  const job = (await maxHelper.waitFor((m) => m.event === 'job')).data.job;
  assert.match(job.text, /Add a footer/);
  assert.match(job.text, /Small and friendly/);
  assert.equal(brennanHelper.messages.some((m) => m.event === 'job'), false, 'it went only to Max\'s helper');

  const now = store.board(project.id).list()[0];
  assert.equal(now.column, 'doing');
  assert.equal(now.assignee, 'Max');
  assert.ok(store.events(project.id).some((e) => e.kind === 'board-card' && e.action === 'started'));

  maxHelper.close();
  brennanHelper.close();
});

test('the brief is shared and versioned, and a stale save is warned', async (t) => {
  const { brennan, max, call, url, store, project } = await setup(t);
  const fresh = await (await call(brennan, url('/knowledge'))).json();
  assert.deepEqual(fresh.brief.version, 0);
  assert.equal(fresh.shareNotes, true);

  const first = await call(brennan, url('/knowledge/brief'), 'PUT', { text: 'Plain English.', baseVersion: 0 });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).brief.version, 1);

  const stale = await call(max, url('/knowledge/brief'), 'PUT', { text: 'Other', baseVersion: 0 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).brief.text, 'Plain English.');

  assert.equal((await call(max, url('/knowledge/brief'), 'PUT', { text: 'x', baseVersion: 'one' })).status, 400);
  assert.equal((await call(max, url('/knowledge/brief'), 'PUT', { text: 'x'.repeat(4001), baseVersion: 1 })).status, 400);
  assert.ok(store.events(project.id).some((e) => e.kind === 'brief-saved' && e.who === 'Brennan'));

  assert.equal((await call(max, url('/knowledge/share-notes'), 'PUT', { value: false })).status, 200);
  assert.equal((await (await call(max, url('/knowledge'))).json()).shareNotes, false);
  assert.equal((await call(max, url('/knowledge/share-notes'), 'PUT', { value: 'nope' })).status, 400);
});

test('decisions are added for everyone, and only their author can remove them', async (t) => {
  const { brennan, max, call, url, store, project } = await setup(t);
  const added = await call(brennan, url('/knowledge/decisions'), 'POST', { text: 'Blue buttons' });
  assert.equal(added.status, 201);
  const decision = await added.json();
  assert.equal(decision.by, 'Brennan');
  assert.ok(store.events(project.id).some((e) => e.kind === 'decision-added' && e.text === 'Blue buttons'));

  assert.equal((await call(brennan, url('/knowledge/decisions'), 'POST', { text: '  ' })).status, 400);
  assert.equal((await call(max, url(`/knowledge/decisions/${decision.id}`), 'DELETE')).status, 403);
  assert.equal((await call(brennan, url(`/knowledge/decisions/${decision.id}`), 'DELETE')).status, 200);
  assert.equal((await call(brennan, url(`/knowledge/decisions/${decision.id}`), 'DELETE')).status, 404);
});

test('the quick prompts shelf can be read, added to and trimmed', async (t) => {
  const { brennan, max, call } = await setup(t);
  const list = await (await call(brennan, '/api/prompts')).json();
  assert.ok(list.length >= 5);

  const added = await call(max, '/api/prompts', 'POST', { title: 'Dark mode', text: 'Add a dark mode.', emoji: '🌙' });
  assert.equal(added.status, 201);
  const prompt = await added.json();
  assert.equal(prompt.by, 'Max');
  assert.equal((await call(brennan, '/api/prompts', 'POST', { title: '', text: 'x' })).status, 400);

  assert.equal((await call(brennan, `/api/prompts/${prompt.id}`, 'DELETE')).status, 200);
  assert.equal((await call(brennan, `/api/prompts/${prompt.id}`, 'DELETE')).status, 404);
});

test('reactions switch on and off, and only on things people said', async (t) => {
  const { brennan, max, call, url, store, project } = await setup(t);
  await call(brennan, url('/send'), 'POST', { text: 'hello team', to: 'Max' });
  const message = store.events(project.id).find((e) => e.kind === 'team-chat');

  const on = await call(max, url('/react'), 'POST', { eventId: message.id, emoji: '🎉' });
  assert.equal(on.status, 200);
  assert.equal((await on.json()).on, true);
  const off = await call(max, url('/react'), 'POST', { eventId: message.id, emoji: '🎉' });
  assert.equal((await off.json()).on, false);
  const again = await call(max, url('/react'), 'POST', { eventId: message.id, emoji: '🎉' });
  assert.equal((await again.json()).on, true);

  const reactions = store.events(project.id).filter((e) => e.kind === 'reaction');
  assert.deepEqual(reactions.map((e) => [e.target, e.emoji, e.who, e.on]), [
    [message.id, '🎉', 'Max', true], [message.id, '🎉', 'Max', false], [message.id, '🎉', 'Max', true],
  ]);

  assert.equal((await call(max, url('/react'), 'POST', { eventId: message.id, emoji: '💩' })).status, 400, 'only the shelf of emoji');
  assert.equal((await call(max, url('/react'), 'POST', { eventId: 99999, emoji: '🎉' })).status, 404);
  const status = store.events(project.id).find((e) => e.kind === 'reaction');
  assert.ok(status);
  const notReactable = store.addEvent(project.id, { kind: 'status', state: 'idle' });
  assert.equal((await call(max, url('/react'), 'POST', { eventId: notReactable.id, emoji: '🎉' })).status, 400);
});

test('typing is announced to the other people watching, but not stored and not too often', async (t) => {
  const { base, brennan, max, call, url, store, project } = await setup(t);
  const watcher = await openStream(`${base}${url('/stream')}`, { headers: { cookie: brennan } });
  await watcher.waitFor((m) => m.data.kind === 'preview');

  assert.equal((await call(max, url('/typing'), 'POST', {})).status, 200);
  const heard = await watcher.waitFor((m) => m.data.kind === 'typing');
  assert.equal(heard.data.who, 'Max');
  assert.equal(heard.id, null, 'typing has no id because it is not stored');

  await call(max, url('/typing'), 'POST', {});
  await call(max, url('/typing'), 'POST', {});
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(watcher.messages.filter((m) => m.data.kind === 'typing').length, 1, 'rapid repeats are dropped');
  assert.equal(store.events(project.id).some((e) => e.kind === 'typing'), false);
  watcher.close();
});

test('a project stream starts with the board, the brief and the readable files', async (t) => {
  const { base, brennan, call, url, bearer, json } = await setup(t);
  await call(brennan, url('/board/cards'), 'POST', { title: 'First card' });
  await call(brennan, url('/knowledge/decisions'), 'POST', { text: 'Be kind' });
  await fetch(`${base}/helper/sources`, json({ projectId: url().split('/').pop(), files: [{ path: 'a.txt', text: 'hello' }] }, 'POST', bearer('Max')));

  const watcher = await openStream(`${base}${url('/stream')}`, { headers: { cookie: brennan } });
  const board = await watcher.waitFor((m) => m.data.kind === 'board');
  assert.equal(board.data.cards[0].title, 'First card');
  const knowledge = await watcher.waitFor((m) => m.data.kind === 'knowledge');
  assert.equal(knowledge.data.decisions[0].text, 'Be kind');
  const sources = await watcher.waitFor((m) => m.data.kind === 'sources');
  assert.deepEqual(sources.data.paths, ['a.txt']);
  watcher.close();
});

test('helpers upload readable files, and people can read them', async (t) => {
  const { base, brennan, call, url, bearer, json, project } = await setup(t);
  const watcher = await openStream(`${base}${url('/stream')}`, { headers: { cookie: brennan } });
  const upload = await fetch(`${base}/helper/sources`, json({ projectId: project.id, files: [{ path: 'src/app.js', text: 'console.log(1)' }] }, 'POST', bearer('Max')));
  assert.equal(upload.status, 200);
  await watcher.waitFor((m) => m.data.kind === 'sources' && m.data.paths?.includes('src/app.js'));

  const read = await call(brennan, url('/source?path=src/app.js'));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { path: 'src/app.js', text: 'console.log(1)' });
  assert.equal((await call(brennan, url('/source?path=missing.txt'))).status, 404);
  assert.equal((await call(brennan, url('/source?path=../users.json'))).status, 404);
  assert.equal((await call(brennan, url('/source?path=.env'))).status, 404);
  assert.equal((await call(brennan, url('/source'))).status, 400);

  const bad = await fetch(`${base}/helper/sources`, json({ projectId: project.id, files: [{ path: '../evil', text: 'x' }] }, 'POST', bearer('Max')));
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${base}/helper/sources`, json({ projectId: 'nope', files: [] }, 'POST', bearer('Max')))).status, 404);
  assert.equal((await fetch(`${base}/helper/sources`, json({ projectId: project.id, files: [] }))).status, 401);
  watcher.close();
});

test('the home page numbers and feed come from every project', async (t) => {
  const { brennan, call, url, store, project } = await setup(t);
  store.addEvent(project.id, { kind: 'run-done', owner: 'Brennan', ok: true, costUsd: 0.12 });
  await call(brennan, url('/send'), 'POST', { text: 'hi', to: 'Max' });
  const pulse = await (await call(brennan, '/api/pulse')).json();
  assert.equal(pulse.week.length, 7);
  assert.deepEqual(pulse.totals.runs, { Brennan: 1 });
  assert.ok(Array.isArray(pulse.feed));
  assert.equal(pulse.feed[0].projectName, 'Map');
  assert.equal(pulse.me, 'Brennan');
});

test('page script files are served from the page folder, but nothing else is', async (t) => {
  const { base } = await setup(t);
  assert.equal((await fetch(`${base}/assets/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/assets/styles.css`)).status, 200);
  assert.equal((await fetch(`${base}/assets/nope.js`)).status, 404);
  assert.equal((await fetch(`${base}/assets/app.html`)).status, 404, 'pages are not assets');
  assert.equal((await fetch(`${base}/assets/users.json`)).status, 404);
  assert.equal((await fetch(`${base}/assets/..%2Fusers.json`)).status, 404);
  assert.equal((await fetch(`${base}/assets/.hidden.js`)).status, 404);
});
