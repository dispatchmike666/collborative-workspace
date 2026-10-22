import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ClaudeRunner } from '../server/claude-runner.js';
import { FAKE_CLAUDE, tempDir, waitFor } from './helpers.js';

// Builds a runner that talks to the fake claude and records every event.
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

test('runs a message and reports each step in order', async (t) => {
  const { runner, events, cwd, idleCount } = makeRunner(t);
  runner.send('WRITE:hello.txt', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the run to finish' });

  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, ['status', 'run-start', 'claude-step', 'claude-step-result', 'claude-text', 'run-done', 'status']);
  assert.equal(events[0].state, 'working');
  assert.equal(events.at(-1).state, 'idle');
  assert.equal(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8'), 'hi');
});

test('keeps talking in the same conversation on the next message', async (t) => {
  const { runner, events, idleCount } = makeRunner(t);
  runner.send('first', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'first run' });
  runner.send('second', 'Brennan');
  await waitFor(() => idleCount() === 2, { label: 'second run' });

  const replies = events.filter((e) => e.kind === 'claude-text').map((e) => e.text);
  assert.deepEqual(replies, ['done', 'resumed:fake-session-1']);
});

test('a message sent while Claude is busy waits in line, then starts by itself', async (t) => {
  const { runner, events, cwd, idleCount } = makeRunner(t);
  runner.send('WRITE:a.txt', 'Brennan');
  runner.send('WRITE:b.txt', 'Max');
  await waitFor(() => idleCount() === 2, { label: 'both runs' });

  const queued = events.find((e) => e.kind === 'status' && e.state === 'queued');
  assert.equal(queued.who, 'Max');
  assert.equal(queued.position, 1);
  assert.ok(events.indexOf(queued) < events.findIndex((e) => e.kind === 'run-done'));
  assert.equal(events.filter((e) => e.kind === 'run-done').length, 2);
  assert.ok(fs.existsSync(path.join(cwd, 'a.txt')));
  assert.ok(fs.existsSync(path.join(cwd, 'b.txt')));
});

test('a crash is reported clearly and the next message still works', async (t) => {
  const { runner, events, idleCount } = makeRunner(t);
  runner.send('CRASH', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the crash' });
  const error = events.find((e) => e.kind === 'error');
  assert.match(error.text, /exit code 2/);
  assert.match(error.text, /boom/);

  runner.send('hello', 'Brennan');
  await waitFor(() => idleCount() === 2, { label: 'the next run' });
  assert.ok(events.some((e) => e.kind === 'run-done'));
});

test('a run that never finishes is stopped after the time limit', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { timeoutMs: 400 });
  runner.send('HANG', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the timeout' });
  assert.match(events.find((e) => e.kind === 'error').text, /took too long/);
});

test('refuses to run if Claude would bill per use', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { env: { ...process.env, FAKE_API_KEY_SOURCE: 'user' } });
  runner.send('hello', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the refusal' });
  assert.match(events.find((e) => e.kind === 'error').text, /bill per use/);
  assert.ok(!events.some((e) => e.kind === 'claude-text'));
});

test('never passes an API key to Claude, even when one is set on the computer', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { env: { ...process.env, ANTHROPIC_API_KEY: 'pretend-key' } });
  runner.send('ENVCHECK', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the run' });
  assert.equal(events.find((e) => e.kind === 'claude-text').text, 'key:absent');
});

test('says so when Claude cannot be started at all', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { command: 'definitely-not-a-real-command-xyz', baseArgs: [] });
  runner.send('hello', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the failure' });
  assert.match(events.find((e) => e.kind === 'error').text, /Couldn't start Claude/);
});
