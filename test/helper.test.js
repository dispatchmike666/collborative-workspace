import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { GitSync } from '../helper/git-sync.js';
import { Helper, composePrompt, validateJob } from '../helper/helper.js';
import { FAKE_CLAUDE, tempDir, waitFor } from './helpers.js';
import { startHub } from './hub-fixture.js';

const identity = ['user.name=Test Person', 'user.email=test@example.com'];

// A helper wired to the fake Claude, connected to the test hub.
async function startHelper(t, hub, name, { configOverrides = [], gitSync } = {}) {
  const workspaceRoot = tempDir(t);
  const helper = new Helper({
    hubUrl: hub.base,
    token: hub.creds[name].helperToken,
    workspaceRoot,
    claudeCommand: process.execPath,
    claudeArgs: [FAKE_CLAUDE],
    gitSync: gitSync ?? new GitSync({ configOverrides: [...identity, ...configOverrides] }),
    sseOptions: { minDelayMs: 20, maxDelayMs: 50 },
  });
  helper.start();
  t.after(() => helper.stop());
  await waitFor(() => hub.dispatcher.isOnline(name), { label: `${name}'s helper to connect` });
  return { helper, workspaceRoot };
}

const idleCount = (hub, projectId) => hub.store.events(projectId).filter((e) => e.kind === 'status' && e.state === 'idle').length;
const summary = (hub, projectId) => hub.store.events(projectId).map((e) => (e.state ? `${e.kind}:${e.state}` : e.kind));

test('a message becomes real work on the person\'s computer, and every step shows on the timeline', async (t) => {
  const hub = await startHub(t);
  const max = await hub.login('Max');
  const project = await hub.makeProject(max);
  const { workspaceRoot } = await startHelper(t, hub, 'Max');

  await hub.as(max)(`/api/projects/${project.id}/send`, hub.json({ text: 'WRITE:hello.txt', to: 'ai' }));
  await waitFor(() => idleCount(hub, project.id) === 1, { label: 'the run to finish' });

  assert.deepEqual(summary(hub, project.id), [
    'user', 'status:working', 'sync', 'claude-step', 'claude-step-result', 'claude-text', 'run-done', 'sync', 'status:idle',
  ]);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, project.id, 'hello.txt'), 'utf8'), 'hi');
  assert.deepEqual(hub.store.getFiles(project.id).files, ['hello.txt']);
  assert.deepEqual(hub.store.getFiles(project.id).changed, ['hello.txt']);
  assert.match(hub.store.events(project.id).filter((e) => e.kind === 'sync').at(-1).text, /Saved 1 changed file/);
  assert.equal(hub.store.events(project.id).find((e) => e.kind === 'claude-text').owner, 'Max');
});

test('a project with an index.html gets a preview', async (t) => {
  const hub = await startHub(t);
  const max = await hub.login('Max');
  const project = await hub.makeProject(max);
  await startHelper(t, hub, 'Max');
  assert.equal(hub.store.getPreviewVersion(project.id), 0);

  await hub.as(max)(`/api/projects/${project.id}/send`, hub.json({ text: 'WRITE:index.html', to: 'ai' }));
  await waitFor(() => idleCount(hub, project.id) === 1, { label: 'the run to finish' });
  assert.equal(hub.store.getPreviewVersion(project.id), 1);
  assert.equal(hub.store.getPreviewFile(project.id, '/').body.toString(), 'hi');
});

test('two computers share a project through GitHub, and the second Claude is told what the first did', async (t) => {
  const hub = await startHub(t);
  const remote = path.join(tempDir(t), 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);
  // Make git treat this GitHub address as the pretend remote on this computer.
  const rewrite = `url.${remote.replaceAll('\\', '/')}.insteadOf=https://github.com/acme/map`;

  const maxCookie = await hub.login('Max');
  const brennanCookie = await hub.login('Brennan');
  const project = await hub.makeProject(maxCookie, { name: 'Map', repoUrl: 'https://github.com/acme/map' });
  const maxSide = await startHelper(t, hub, 'Max', { configOverrides: [rewrite] });
  const brennanSide = await startHelper(t, hub, 'Brennan', { configOverrides: [rewrite] });

  await hub.as(maxCookie)(`/api/projects/${project.id}/send`, hub.json({ text: 'WRITE:a.txt', to: 'ai' }));
  await waitFor(() => idleCount(hub, project.id) === 1, { label: "Max's run" });
  assert.match(execFileSync('git', ['ls-tree', '-r', '--name-only', 'main'], { cwd: remote, encoding: 'utf8' }), /a\.txt/);
  assert.ok(fs.existsSync(path.join(maxSide.workspaceRoot, project.id, 'a.txt')));

  await hub.as(brennanCookie)(`/api/projects/${project.id}/send`, hub.json({ text: 'PROMPTCHECK WRITE:b.txt', to: 'ai' }));
  await waitFor(() => idleCount(hub, project.id) === 2, { label: "Brennan's run" });

  const brennanReply = hub.store.events(project.id).find((e) => e.kind === 'claude-text' && e.owner === 'Brennan').text;
  assert.match(brennanReply, /Max asked: WRITE:a\.txt/);
  assert.match(brennanReply, /Max's Claude did: Write a\.txt/);
  assert.match(brennanReply, /Brennan's request:\nPROMPTCHECK WRITE:b\.txt/);

  const brennanDir = path.join(brennanSide.workspaceRoot, project.id);
  assert.ok(fs.existsSync(path.join(brennanDir, 'a.txt')), "Brennan's computer received Max's file before Claude started");
  assert.ok(fs.existsSync(path.join(brennanDir, 'b.txt')));
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', 'main'], { cwd: remote, encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  assert.deepEqual(files, ['a.txt', 'b.txt']);
});

test('an approval starts a run with a one-command allowance, and blocked commands show up as approvals', async (t) => {
  const hub = await startHub(t);
  const max = await hub.login('Max');
  const project = await hub.makeProject(max);
  await startHelper(t, hub, 'Max');

  hub.dispatcher.submit({ projectId: project.id, user: 'Max', text: 'ARGSCHECK', kind: 'approval', allowedTools: ['Bash(echo hi)'] });
  await waitFor(() => idleCount(hub, project.id) === 1, { label: 'the approval run' });
  assert.equal(hub.store.events(project.id).find((e) => e.kind === 'claude-text').text, 'args:--allowedTools|Bash(echo hi)');

  await hub.as(max)(`/api/projects/${project.id}/send`, hub.json({ text: 'DENY something', to: 'ai' }));
  await waitFor(() => idleCount(hub, project.id) === 2, { label: 'the blocked run' });
  const approval = hub.store.events(project.id).find((e) => e.kind === 'approval-needed');
  assert.equal(approval.command, 'curl -s https://example.com');
  assert.equal(approval.owner, 'Max');
});

test('a job that could do something unsafe is refused before anything runs', () => {
  const good = { jobId: 'j1', projectId: 'map-1a2b3c', repoUrl: 'https://github.com/acme/map', who: 'Max', kind: 'message', text: 'hi', recap: '', allowedTools: [] };
  assert.doesNotThrow(() => validateJob(good));
  assert.doesNotThrow(() => validateJob({ ...good, repoUrl: null, allowedTools: ['Bash(echo hi)', 'PowerShell(Get-Date)'] }));
  for (const bad of [
    { projectId: '../escape' },
    { projectId: 'Has Space' },
    { repoUrl: 'file:///c:/x' },
    { repoUrl: '--upload-pack=calc' },
    { allowedTools: ['Bash(*)'] },
    { allowedTools: ['Bash(echo hi) Bash(*)'] },
    { allowedTools: ['Write(x)'] },
    { allowedTools: 'Bash(echo hi)' },
    { text: '   ' },
    { jobId: '' },
  ]) {
    assert.throws(() => validateJob({ ...good, ...bad }), /refused|not allowed|isn't valid/i, JSON.stringify(bad));
  }
});

test('stopping the helper takes that computer offline', async (t) => {
  const hub = await startHub(t);
  const { helper } = await startHelper(t, hub, 'Max');
  assert.equal(hub.dispatcher.isOnline('Max'), true);
  helper.stop();
  await waitFor(() => !hub.dispatcher.isOnline('Max'), { label: 'Max to go offline' });
});

test('when the hub gives up on a run, the helper stops it and is ready for the next one', async (t) => {
  // Long enough for a normal run (a second or so), short enough that the stuck one is cut off.
  const hub = await startHub(t, {}, { jobTimeoutMs: 2500 });
  const max = await hub.login('Max');
  const project = await hub.makeProject(max);
  const { helper } = await startHelper(t, hub, 'Max');

  await hub.as(max)(`/api/projects/${project.id}/send`, hub.json({ text: 'HANG', to: 'ai' }));
  await waitFor(() => hub.store.events(project.id).some((e) => e.kind === 'error' && /took too long/.test(e.text)), { label: 'the hub timeout' });
  await waitFor(() => helper.activeJobs === 0, { label: 'the helper to stop the run' });

  await hub.as(max)(`/api/projects/${project.id}/send`, hub.json({ text: 'hello', to: 'ai' }));
  await waitFor(() => hub.store.events(project.id).some((e) => e.kind === 'run-done'), { label: 'the next run' });
});

test('a stop that arrives before Claude has started still prevents the run', async (t) => {
  const hub = await startHub(t, {}, { jobTimeoutMs: 200 });
  const max = await hub.login('Max');
  const project = await hub.makeProject(max);
  // Getting the files ready takes a while here, so the hub gives up first.
  const slowGit = {
    prepare: async ({ projectDir }) => {
      fs.mkdirSync(projectDir, { recursive: true });
      await new Promise((resolve) => setTimeout(resolve, 700));
    },
    finish: async () => ({ changed: [], committed: false, pushed: false }),
  };
  const { helper, workspaceRoot } = await startHelper(t, hub, 'Max', { gitSync: slowGit });

  await hub.as(max)(`/api/projects/${project.id}/send`, hub.json({ text: 'WRITE:started.txt', to: 'ai' }));
  await waitFor(() => hub.store.events(project.id).some((e) => e.kind === 'error' && /took too long/.test(e.text)), { label: 'the hub timeout' });
  await waitFor(() => helper.activeJobs === 0, { label: 'the helper to finish with the job' });
  assert.equal(fs.existsSync(path.join(workspaceRoot, project.id, 'started.txt')), false, 'Claude must not run after a stop');
});

test('what Claude is told starts with the project instructions, decisions and shared notes, then the recap and the request', () => {
  const prompt = composePrompt({
    context: { brief: 'Plain English.', decisions: ['Blue buttons', 'No new packages'], notes: 'Footer next' },
    recap: 'Max asked: hello',
    who: 'Brennan',
    text: 'what changed?',
  });
  assert.equal(prompt, [
    'Project instructions (always follow these):\nPlain English.',
    'Decisions the team has settled (keep to these):\n- Blue buttons\n- No new packages',
    'Shared project notes (for reference):\nFooter next',
    'This is a shared project. Since you last worked on it, your teammates did the following (you did not do these things):\nMax asked: hello',
    "Brennan's request:\nwhat changed?",
  ].join('\n\n'));
});

test('with nothing to add, Claude is told only the request', () => {
  assert.equal(composePrompt({ context: { brief: '', decisions: [], notes: '' }, recap: '', who: 'Max', text: 'hi' }), 'hi');
  assert.equal(composePrompt({ recap: '', who: 'Max', text: 'hi' }), 'hi');
});

test('a job with an unreasonable project context is refused', () => {
  const good = { jobId: 'j1', projectId: 'map-1a2b3c', repoUrl: null, who: 'Max', kind: 'message', text: 'hi', recap: '', allowedTools: [] };
  assert.doesNotThrow(() => validateJob({ ...good, context: { brief: 'ok', decisions: ['a'], notes: '' } }));
  assert.doesNotThrow(() => validateJob(good));
  for (const context of [
    'text', { brief: 5, decisions: [], notes: '' }, { brief: 'x'.repeat(5001), decisions: [], notes: '' },
    { brief: '', decisions: 'no', notes: '' }, { brief: '', decisions: [5], notes: '' },
    { brief: '', decisions: Array(31).fill('a'), notes: '' }, { brief: '', decisions: [], notes: 'n'.repeat(4001) },
  ]) {
    assert.throws(() => validateJob({ ...good, context }), /refused/, JSON.stringify(context).slice(0, 60));
  }
});

test('the project brief and decisions really reach Claude, and the small text files can be read afterwards', async (t) => {
  const hub = await startHub(t);
  const max = await hub.login('Max');
  const project = await hub.makeProject(max);
  await startHelper(t, hub, 'Max');
  hub.store.knowledge(project.id).saveBrief({ text: 'Be kind and plain.', baseVersion: 0, user: 'Max' });
  hub.store.knowledge(project.id).addDecision({ text: 'Blue buttons', by: 'Max' });

  await hub.as(max)(`/api/projects/${project.id}/send`, hub.json({ text: 'PROMPTCHECK WRITE:notes.txt', to: 'ai' }));
  await waitFor(() => idleCount(hub, project.id) === 1, { label: 'the run to finish' });
  const reply = hub.store.events(project.id).find((e) => e.kind === 'claude-text').text;
  assert.match(reply, /^prompt:Project instructions \(always follow these\):\nBe kind and plain\./);
  assert.match(reply, /Decisions the team has settled \(keep to these\):\n- Blue buttons/);
  assert.match(reply, /Max's request:\nPROMPTCHECK WRITE:notes\.txt/);

  await waitFor(() => hub.store.sources(project.id).paths().length > 0, { label: 'the readable files' });
  assert.equal(hub.store.sources(project.id).get('notes.txt').text, 'hi');
});
