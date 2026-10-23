import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { GitSync } from '../helper/git-sync.js';
import { Helper } from '../helper/helper.js';
import { FAKE_CLAUDE, openStream, tempDir, waitFor } from './helpers.js';
import { startHub } from './hub-fixture.js';

const identity = ['user.name=Test Person', 'user.email=test@example.com'];

// The whole thing at once: one hub, two people logged in, two helpers (each with their own
// Claude, here a stand-in), and a shared GitHub project (here a repository on this computer).
test('two people work on one project together: turns, chat, recap, files, notes, approvals, preview', async (t) => {
  const hub = await startHub(t);
  const remote = path.join(tempDir(t), 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);
  const rewrite = `url.${remote.replaceAll('\\', '/')}.insteadOf=https://github.com/acme/map`;

  const brennan = await hub.login('Brennan');
  const max = await hub.login('Max');
  const project = await hub.makeProject(brennan, { name: 'Map', repoUrl: 'https://github.com/acme/map' });

  for (const name of ['Brennan', 'Max']) {
    const helper = new Helper({
      hubUrl: hub.base,
      token: hub.creds[name].helperToken,
      workspaceRoot: tempDir(t),
      claudeCommand: process.execPath,
      claudeArgs: [FAKE_CLAUDE],
      gitSync: new GitSync({ configOverrides: [...identity, rewrite] }),
      sseOptions: { minDelayMs: 20 },
    });
    helper.start();
    t.after(() => helper.stop());
  }
  await waitFor(() => hub.dispatcher.isOnline('Brennan') && hub.dispatcher.isOnline('Max'), { label: 'both helpers' });

  const brennansScreen = await openStream(`${hub.base}/api/projects/${project.id}/stream`, { headers: { cookie: brennan } });
  const maxsScreen = await openStream(`${hub.base}/api/projects/${project.id}/stream`, { headers: { cookie: max } });
  t.after(() => {
    brennansScreen.close();
    maxsScreen.close();
  });
  const send = (cookie, text, to = 'ai') => hub.as(cookie)(`/api/projects/${project.id}/send`, hub.json({ text, to }));

  // Max starts a slow job. Brennan asks something right away, and chats meanwhile.
  await send(max, 'SLEEP900 WRITE:index.html');
  await send(brennan, 'PROMPTCHECK WRITE:notes.txt');
  await send(brennan, 'while I wait: how is it going?', 'Max');

  // Brennan's request is told to wait, and he is not blocked from chatting.
  await brennansScreen.waitFor((m) => m.data.kind === 'status' && m.data.state === 'queued' && m.data.who === 'Brennan');
  await maxsScreen.waitFor((m) => m.data.kind === 'team-chat' && m.data.text.startsWith('while I wait'));

  // Both finish, in order, and both people saw all of it.
  await waitFor(() => hub.store.events(project.id).filter((e) => e.kind === 'run-done').length === 2, { label: 'both runs' });
  const runOrder = hub.store.events(project.id).filter((e) => e.kind === 'run-done').map((e) => e.owner);
  assert.deepEqual(runOrder, ['Max', 'Brennan']);
  await brennansScreen.waitFor((m) => m.data.kind === 'run-done' && m.data.owner === 'Brennan');
  await maxsScreen.waitFor((m) => m.data.kind === 'run-done' && m.data.owner === 'Brennan');

  // Brennan's Claude was told what Max's Claude did, and it started with Max's files.
  const reply = hub.store.events(project.id).find((e) => e.kind === 'claude-text' && e.owner === 'Brennan').text;
  assert.match(reply, /Max's Claude did: Write index\.html/);
  assert.doesNotMatch(reply, /how is it going/, 'private team chat never reaches an AI');
  await waitFor(() => hub.store.getFiles(project.id).files.includes('notes.txt'), { label: 'the file list' });
  assert.deepEqual(hub.store.getFiles(project.id).files, ['index.html', 'notes.txt']);

  // Files reached GitHub, and the preview shows Max's page.
  const onRemote = execFileSync('git', ['ls-tree', '-r', '--name-only', 'main'], { cwd: remote, encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  assert.deepEqual(onRemote, ['index.html', 'notes.txt']);
  assert.ok(hub.store.getPreviewVersion(project.id) >= 1);

  // Shared notes: the second writer is warned instead of overwriting.
  const notes = (cookie, body) => hub.as(cookie)(`/api/projects/${project.id}/notes`, hub.json(body, 'PUT'));
  assert.equal((await notes(brennan, { text: 'Brennan was here', baseVersion: 0 })).status, 200);
  assert.equal((await notes(max, { text: 'Max was here', baseVersion: 0 })).status, 409);

  // A blocked command becomes an approval that only its owner can use.
  await send(max, 'DENY something');
  const approval = await maxsScreen.waitFor((m) => m.data.kind === 'approval-needed');
  assert.equal((await hub.as(brennan)(`/api/projects/${project.id}/approve`, hub.json({ approvalId: approval.data.approvalId }))).status, 403);
  assert.equal((await hub.as(max)(`/api/projects/${project.id}/approve`, hub.json({ approvalId: approval.data.approvalId }))).status, 202);
  await maxsScreen.waitFor((m) => m.data.kind === 'approval-used');

  // Let the approved run finish before the test cleans up after itself.
  const idles = () => hub.store.events(project.id).filter((e) => e.kind === 'status' && e.state === 'idle').length;
  await waitFor(() => idles() === 4, { label: 'every run to finish' });
});
