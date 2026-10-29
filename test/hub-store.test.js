import assert from 'node:assert/strict';
import test from 'node:test';
import { Store, validateProjectInput } from '../hub/store.js';
import { tempDir } from './helpers.js';

const b64 = (text) => Buffer.from(text).toString('base64');

test('creating a project gives it a safe id and keeps it after a restart', (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  const project = store.createProject({ name: 'Dispatch Map', repoUrl: 'https://github.com/acme/dispatch-map', createdBy: 'Brennan' });
  assert.match(project.id, /^dispatch-map-[0-9a-f]{6}$/);
  assert.equal(project.repoUrl, 'https://github.com/acme/dispatch-map');
  assert.equal(project.createdBy, 'Brennan');

  const second = store.createProject({ name: 'Dispatch Map', createdBy: 'Max' });
  assert.notEqual(second.id, project.id);
  assert.equal(second.repoUrl, null);

  const reopened = new Store(dir);
  assert.deepEqual(reopened.listProjects().map((p) => p.name), ['Dispatch Map', 'Dispatch Map']);
  assert.equal(reopened.getProject(project.id).repoUrl, 'https://github.com/acme/dispatch-map');
  assert.equal(reopened.getProject('nope'), null);
});

test('project names and repo addresses are checked', () => {
  assert.equal(validateProjectInput({ name: '  ' }).ok, false);
  assert.equal(validateProjectInput({ name: 'x'.repeat(61) }).ok, false);
  assert.equal(validateProjectInput({ name: 'Bad\nname' }).ok, false);
  for (const repoUrl of [
    'file:///c:/secrets',
    'git@github.com:acme/repo.git',
    'http://github.com/acme/repo',
    'https://evil.example.com/acme/repo',
    'https://github.com/acme',
    'https://github.com/acme/repo/extra',
    '--upload-pack=calc',
    'https://github.com/acme/repo with space',
    'https://github.com/acme/../repo',
  ]) {
    const result = validateProjectInput({ name: 'Ok', repoUrl });
    assert.equal(result.ok, false, `should refuse ${repoUrl}`);
  }
  const good = validateProjectInput({ name: ' Ok ', repoUrl: 'https://github.com/acme/repo.git/' });
  assert.equal(good.ok, true);
  assert.equal(good.name, 'Ok');
  assert.equal(good.repoUrl, 'https://github.com/acme/repo.git');
  assert.equal(validateProjectInput({ name: 'Ok', repoUrl: '' }).repoUrl, null);
});

test('timeline events get rising ids, survive a restart, and can be read from a point', (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  const { id } = store.createProject({ name: 'P', createdBy: 'Max' });
  const first = store.addEvent(id, { kind: 'user', who: 'Max', text: 'hi' });
  const second = store.addEvent(id, { kind: 'claude-text', owner: 'Max', text: 'hello' });
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.match(first.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(store.events(id, 1).map((e) => e.text), ['hello']);

  const reopened = new Store(dir);
  assert.deepEqual(reopened.events(id).map((e) => e.text), ['hi', 'hello']);
  assert.equal(reopened.addEvent(id, { kind: 'user', who: 'Max', text: 'again' }).id, 3);
});

test('very long text is cut short and unknown projects are refused', (t) => {
  const store = new Store(tempDir(t));
  const { id } = store.createProject({ name: 'P', createdBy: 'Max' });
  const stored = store.addEvent(id, { kind: 'claude-text', text: 'x'.repeat(20000) });
  assert.ok(stored.text.length < 9000);
  assert.throws(() => store.addEvent('nope', { kind: 'user' }), /No such project/);
});

test('listeners hear stored and live-only events, and stop when unsubscribed', (t) => {
  const store = new Store(tempDir(t));
  const { id } = store.createProject({ name: 'P', createdBy: 'Max' });
  const heard = [];
  const stop = store.subscribe(id, (event) => heard.push(event));
  store.addEvent(id, { kind: 'user', text: 'one' });
  store.broadcast(id, { kind: 'presence', online: { max: true } });
  stop();
  store.addEvent(id, { kind: 'user', text: 'two' });
  assert.deepEqual(heard.map((e) => e.kind), ['user', 'presence']);
  assert.equal(heard[0].id, 1);
  assert.equal(heard[1].id, undefined);
  assert.equal(store.events(id).length, 2);
});

test('project list shows the latest activity', (t) => {
  const store = new Store(tempDir(t));
  const quiet = store.createProject({ name: 'Quiet', createdBy: 'Max' });
  const busy = store.createProject({ name: 'Busy', createdBy: 'Max' });
  store.addEvent(busy.id, { kind: 'user', who: 'Max', text: 'build the thing' });
  const list = store.listProjects();
  const busyEntry = list.find((p) => p.id === busy.id);
  assert.equal(busyEntry.lastEventText, 'build the thing');
  assert.ok(busyEntry.lastActivityAt);
  assert.equal(list.find((p) => p.id === quiet.id).lastEventText, null);
  assert.equal(list[0].id, busy.id);
});

test('notes refuse to overwrite someone else\'s newer save', (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  const { id } = store.createProject({ name: 'P', createdBy: 'Max' });
  assert.deepEqual(store.getNotes(id), { text: '', version: 0, updatedBy: null, updatedAt: null });

  const first = store.saveNotes(id, { text: 'plan A', baseVersion: 0, user: 'Brennan' });
  assert.equal(first.ok, true);
  assert.equal(first.notes.version, 1);

  const stale = store.saveNotes(id, { text: 'plan B', baseVersion: 0, user: 'Max' });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  assert.equal(stale.notes.text, 'plan A');
  assert.equal(stale.notes.updatedBy, 'Brennan');

  const next = store.saveNotes(id, { text: 'plan A+B', baseVersion: 1, user: 'Max' });
  assert.equal(next.notes.version, 2);
  assert.equal(new Store(dir).getNotes(id).text, 'plan A+B');
  assert.throws(() => store.saveNotes(id, { text: 'x'.repeat(100001), baseVersion: 2, user: 'Max' }), /too long/);
});

test('the file list is remembered and limited', (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  const { id } = store.createProject({ name: 'P', createdBy: 'Max' });
  assert.deepEqual(store.getFiles(id), { files: [], changed: [], updatedAt: null });
  store.setFiles(id, { files: ['index.html', 'app.js'], changed: ['app.js'] });
  assert.deepEqual(new Store(dir).getFiles(id).files, ['index.html', 'app.js']);
  store.setFiles(id, { files: Array.from({ length: 500 }, (_, i) => `f${i}.txt`), changed: [] });
  assert.equal(store.getFiles(id).files.length, 200);
});

test('a preview is served from what the helper uploaded', (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  const { id } = store.createProject({ name: 'P', createdBy: 'Max' });
  assert.equal(store.getPreviewVersion(id), 0);
  assert.equal(store.getPreviewFile(id, '/'), null);

  const info = store.setPreview(id, [
    { path: 'index.html', data: b64('<h1>Hi</h1>') },
    { path: 'css/site.css', data: b64('h1{color:red}') },
    { path: 'logo.png', data: b64('png-bytes') },
  ]);
  assert.equal(info.version, 1);
  assert.equal(info.count, 3);

  const page = store.getPreviewFile(id, '/');
  assert.equal(page.body.toString(), '<h1>Hi</h1>');
  assert.match(page.type, /text\/html/);
  assert.match(store.getPreviewFile(id, '/css/site.css').type, /text\/css/);
  assert.equal(store.getPreviewFile(id, '/logo.png').type, 'image/png');
  assert.equal(store.getPreviewFile(id, '/missing.html'), null);
  assert.equal(store.getPreviewFile(id, '/../projects.json'), null);

  assert.equal(new Store(dir).getPreviewFile(id, '/').body.toString(), '<h1>Hi</h1>');
  assert.equal(store.setPreview(id, [{ path: 'index.html', data: b64('v2') }]).version, 2);
  assert.equal(store.getPreviewFile(id, '/css/site.css'), null);
});

test('a preview upload with bad paths or too much data is refused', (t) => {
  const store = new Store(tempDir(t));
  const { id } = store.createProject({ name: 'P', createdBy: 'Max' });
  for (const path of ['../evil.html', '/abs.html', 'a\\b.html', 'a/../../b.html', '', 'sp ace.html']) {
    assert.throws(() => store.setPreview(id, [{ path, data: b64('x') }]), /path/i, `should refuse "${path}"`);
  }
  const big = Buffer.alloc(1024 * 1024 + 1).toString('base64');
  assert.throws(() => store.setPreview(id, [{ path: 'big.bin', data: big }]), /too large/i);
  const many = Array.from({ length: 201 }, (_, i) => ({ path: `f${i}.txt`, data: b64('x') }));
  assert.throws(() => store.setPreview(id, many), /too many/i);
});

test('each project gets its own board, brief and readable files, and they persist', (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  const one = store.createProject({ name: 'One', createdBy: 'Max' });
  const two = store.createProject({ name: 'Two', createdBy: 'Max' });

  store.board(one.id).add({ title: 'Card for one', by: 'Max' });
  store.knowledge(one.id).addDecision({ text: 'Blue buttons', by: 'Max' });
  store.sources(one.id).set([{ path: 'a.txt', text: 'hello' }]);

  assert.equal(store.board(two.id).list().length, 0);
  assert.equal(store.knowledge(two.id).get().decisions.length, 0);
  assert.deepEqual(store.sources(two.id).paths(), []);
  assert.equal(store.board(one.id), store.board(one.id), 'the same board object is reused');

  const reopened = new Store(dir);
  assert.equal(reopened.board(one.id).list()[0].title, 'Card for one');
  assert.equal(reopened.knowledge(one.id).get().decisions[0].text, 'Blue buttons');
  assert.equal(reopened.sources(one.id).get('a.txt').text, 'hello');
  assert.throws(() => store.board('nope'), /No such project/);
  assert.throws(() => store.knowledge('nope'), /No such project/);
  assert.throws(() => store.sources('nope'), /No such project/);
});

test('the quick prompts shelf is shared by every project', (t) => {
  const dir = tempDir(t);
  const store = new Store(dir);
  const added = store.prompts().add({ title: 'Hello', text: 'Say hello', by: 'Max' });
  assert.ok(new Store(dir).prompts().list().some((p) => p.id === added.id));
});

test('the home page numbers come from every project', (t) => {
  const store = new Store(tempDir(t), { now: () => new Date('2026-10-29T10:00:00Z') });
  const project = store.createProject({ name: 'P', createdBy: 'Max' });
  store.addEvent(project.id, { kind: 'run-done', owner: 'Max', ok: true, costUsd: 0.1 });
  const { totals, feed, week } = store.activity({ now: Date.parse('2026-10-29T12:00:00Z') });
  assert.deepEqual(totals.runs, { Max: 1 });
  assert.equal(feed[0].projectName, 'P');
  assert.equal(week.length, 7);
});
