import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseStreamLine, summarizeToolUse } from '../server/stream-parser.js';

const sample = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample-stream.jsonl'), 'utf8').split('\n');

test('a real Claude run turns into the events the window shows, in order', () => {
  const events = sample.flatMap(parseStreamLine);
  assert.deepEqual(events.map((e) => e.kind), ['run-start', 'claude-step', 'claude-step-result', 'claude-text', 'run-done']);
});

test('run-start carries the session id and how Claude is signed in', () => {
  const [start] = sample.flatMap(parseStreamLine);
  assert.equal(start.sessionId, '54d25f2e-748a-46c5-858c-3df38061ee1a');
  assert.equal(start.apiKeySource, 'none');
});

test('a file write is described in plain words', () => {
  const step = sample.flatMap(parseStreamLine).find((e) => e.kind === 'claude-step');
  assert.equal(step.summary, 'Write hello.txt');
});

test('run-done reports success, time and the plan-usage estimate', () => {
  const done = sample.flatMap(parseStreamLine).find((e) => e.kind === 'run-done');
  assert.equal(done.ok, true);
  assert.equal(done.durationMs, 6741);
  assert.equal(done.costUsd, 0.4013575);
});

test('a failed tool result is marked not ok', () => {
  const line = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: [{ type: 'text', text: 'nope' }] }] },
  });
  assert.deepEqual(parseStreamLine(line), [{ kind: 'claude-step-result', ok: false, text: 'nope' }]);
});

test('an error result is marked not ok', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '', session_id: 's' });
  assert.equal(parseStreamLine(line)[0].ok, false);
});

test('blank lines and unknown event types are ignored', () => {
  assert.deepEqual(parseStreamLine(''), []);
  assert.deepEqual(parseStreamLine('   '), []);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'rate_limit_event' })), []);
});

test('a line that is not JSON becomes a visible error, not a silent drop', () => {
  const [event] = parseStreamLine('not json at all');
  assert.equal(event.kind, 'error');
  assert.match(event.text, /not json at all/);
});

test('tool summaries are short and readable', () => {
  assert.equal(summarizeToolUse('Edit', { file_path: 'C:\\a\\b\\map.js' }), 'Edit map.js');
  assert.equal(summarizeToolUse('Bash', { command: 'npm test' }), 'Bash: npm test');
  assert.equal(summarizeToolUse('Grep', { pattern: 'TODO' }), 'Grep TODO');
  assert.equal(summarizeToolUse('Weird'), 'Weird');
  assert.ok(summarizeToolUse('Bash', { command: 'x'.repeat(500) }).length < 100);
});
