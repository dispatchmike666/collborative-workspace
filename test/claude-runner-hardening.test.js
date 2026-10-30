import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ClaudeRunner } from '../server/claude-runner.js';
import { CLAUDE_ARGS } from '../server/config.js';
import { killTree } from '../server/kill-tree.js';
import { FAKE_CLAUDE, tempDir, waitFor } from './helpers.js';

function makeRunner(t, overrides = {}) {
  const cwd = tempDir(t);
  const events = [];
  const runner = new ClaudeRunner({
    command: process.execPath,
    baseArgs: [FAKE_CLAUDE],
    cwd,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  const idleCount = () => events.filter((e) => e.kind === 'status' && e.state === 'idle').length;
  return { runner, events, cwd, idleCount };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

// ---- what Claude is started with ----

test('Claude is told to read no settings files, so a shared project cannot run commands or change its setup', () => {
  const at = CLAUDE_ARGS.indexOf('--setting-sources');
  assert.ok(at >= 0, 'the flag is there');
  assert.equal(CLAUDE_ARGS[at + 1], '', 'with an empty list of sources');
  assert.ok(!CLAUDE_ARGS.includes('project'), 'the project\'s own settings are not read');
});

test('the flags that skip the Claude plan login or the permission checks are never in the start-up flags', () => {
  for (const flag of ['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions']) {
    assert.ok(!CLAUDE_ARGS.includes(flag), `${flag} must not be used`);
  }
});

test('a runner refuses to be built with a forbidden flag', () => {
  for (const flag of ['--bare', '--dangerously-skip-permissions']) {
    assert.throws(() => new ClaudeRunner({ command: 'x', baseArgs: ['-p', flag], cwd: '.', onEvent: () => {} }), /never allowed/);
  }
});

test('a single message can only add an approval of one exact command, nothing else', async (t) => {
  const { runner, events, idleCount } = makeRunner(t);
  for (const extraArgs of [['--bare'], ['--permission-mode', 'bypassPermissions'], ['--allowedTools'], ['--allowedTools', '--bare'], ['--settings', '{}']]) {
    const before = idleCount();
    runner.send('hello', 'Max', { extraArgs });
    await waitFor(() => idleCount() === before + 1, { label: `the refusal of ${extraArgs.join(' ')}` });
  }
  assert.equal(events.filter((e) => e.kind === 'error' && /refused/.test(e.text)).length, 5);
  assert.ok(!events.some((e) => e.kind === 'run-start'), 'Claude was never started for any of them');

  const before = idleCount();
  runner.send('ARGSCHECK', 'Max', { extraArgs: ['--allowedTools', 'Bash(echo hi)'] });
  await waitFor(() => idleCount() === before + 1, { label: 'an allowed approval' });
  assert.match(events.find((e) => e.kind === 'claude-text').text, /--allowedTools\|Bash\(echo hi\)/);
});

test('a login source we do not recognise is refused, including a missing one', async (t) => {
  for (const source of ['/login managed key', 'apiKeyHelper', '']) {
    const { runner, events, idleCount } = makeRunner(t, { env: { ...process.env, FAKE_API_KEY_SOURCE: source } });
    runner.send('hello', 'Brennan');
    await waitFor(() => idleCount() === 1, { label: `the refusal for "${source}"` });
    assert.match(events.find((e) => e.kind === 'error').text, /bill per use/, `source "${source}" is refused`);
    assert.ok(!events.some((e) => e.kind === 'claude-text'));
  }
});

// ---- Stop really stops ----

test('stopping a program also stops the programs it started', async (t) => {
  const dir = tempDir(t);
  const parentScript = path.join(dir, 'parent.js');
  fs.writeFileSync(parentScript, [
    "const { spawn } = require('node:child_process');",
    "const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    'console.log(kid.pid);',
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const parent = spawn(process.execPath, [parentScript], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, detached: process.platform !== 'win32' });
  let text = '';
  parent.stdout.on('data', (chunk) => { text += chunk; });
  await waitFor(() => /\d+\n/.test(text), { label: 'the parent to start its child' });
  const kidPid = Number(text.trim());
  assert.ok(alive(parent.pid) && alive(kidPid), 'both are running');

  killTree(parent);
  await waitFor(() => !alive(parent.pid) && !alive(kidPid), { timeoutMs: 8000, label: 'both programs to stop' });
});

test('Stop on a run also stops what Claude started', async (t) => {
  const { runner, events, cwd, idleCount } = makeRunner(t);
  runner.send('GRANDCHILD', 'Brennan');
  const pidFile = path.join(cwd, 'grandchild.pid');
  await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim(), { label: 'the helper program to start' });
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(alive(grandchild));

  runner.cancel();
  await waitFor(() => idleCount() === 1, { label: 'the stop' });
  await waitFor(() => !alive(grandchild), { timeoutMs: 8000, label: 'the program Claude started to stop' });
  assert.match(events.find((e) => e.kind === 'error').text, /was stopped/);
});

// ---- a stuck run is caught ----

test('a run that goes silent is stopped long before the overall time limit', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { silenceMs: 300, silenceCheckMs: 40, timeoutMs: 60_000 });
  runner.send('HANG', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the quiet run to be stopped' });
  assert.match(events.find((e) => e.kind === 'error').text, /went quiet/);
});

test('a command that is still running is allowed to be quiet', async (t) => {
  // The quiet limit is longer than a slow computer needs to start the program, so only the command's
  // own quiet is being tested.
  const { runner, events, idleCount } = makeRunner(t, { silenceMs: 1200, silenceCheckMs: 50, timeoutMs: 60_000 });
  runner.send('HANGTOOL', 'Brennan');
  await waitFor(() => events.some((e) => e.kind === 'claude-step'), { label: 'the command to start' });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal(idleCount(), 0, 'still running after being quiet for longer than the limit');
  assert.ok(!events.some((e) => e.kind === 'error'));

  runner.cancel();
  await waitFor(() => idleCount() === 1, { label: 'the stop' });
});

test('a run that keeps printing is not mistaken for a stuck one', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { silenceMs: 2000, silenceCheckMs: 30 });
  runner.send('SLEEP300', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the run' });
  assert.ok(events.some((e) => e.kind === 'run-done'));
  assert.ok(!events.some((e) => e.kind === 'error'));
});
