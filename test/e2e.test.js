import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ClaudeRunner } from '../server/claude-runner.js';
import { createApp } from '../server/http-app.js';
import { Timeline } from '../server/timeline.js';
import { FAKE_CLAUDE, closeServer, listen, readEvents, tempDir } from './helpers.js';

test('a message typed in the window makes Claude do the work and the steps stream back', async (t) => {
  const projectDir = tempDir(t);
  const timeline = new Timeline();
  const runner = new ClaudeRunner({
    command: process.execPath,
    baseArgs: [FAKE_CLAUDE],
    cwd: projectDir,
    onEvent: (event) => timeline.add(event),
  });
  const { server, port } = await listen(createApp({ timeline, runner, publicDir: projectDir, userName: 'Brennan' }));
  t.after(() => closeServer(server));
  const base = `http://127.0.0.1:${port}`;

  const sent = await fetch(`${base}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'create a file WRITE:hello.txt' }),
  });
  assert.equal(sent.status, 202);

  // Wait for "idle", which comes after "run-done" once Claude has fully stopped.
  const events = await readEvents(`${base}/events`, (list) => list.some((e) => e.kind === 'status' && e.state === 'idle'));
  const kinds = events.map((e) => e.kind);
  for (const expected of ['user', 'run-start', 'claude-step', 'claude-text', 'run-done']) {
    assert.ok(kinds.includes(expected), `missing ${expected} in ${kinds.join(', ')}`);
  }
  assert.equal(fs.readFileSync(path.join(projectDir, 'hello.txt'), 'utf8'), 'hi');
});
