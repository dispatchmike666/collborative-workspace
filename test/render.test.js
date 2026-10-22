import assert from 'node:assert/strict';
import test from 'node:test';
import { eventToView, statusText } from '../public/render.js';

test('a person\'s message shows their name', () => {
  assert.deepEqual(eventToView({ kind: 'user', who: 'Brennan', text: 'hi' }), { cls: 'user', label: 'Brennan', text: 'hi' });
});

test('Claude\'s words and steps look different from each other', () => {
  assert.equal(eventToView({ kind: 'claude-text', text: 'done' }).cls, 'claude');
  assert.equal(eventToView({ kind: 'claude-step', summary: 'Write hello.txt' }).text, 'Write hello.txt');
});

test('only failed tool results appear', () => {
  assert.equal(eventToView({ kind: 'claude-step-result', ok: true, text: 'fine' }), null);
  assert.match(eventToView({ kind: 'claude-step-result', ok: false, text: 'denied' }).text, /Problem: denied/);
});

test('a finished run shows time and plan usage, and says it is not billed', () => {
  const view = eventToView({ kind: 'run-done', ok: true, durationMs: 6741, costUsd: 0.4013575 });
  assert.equal(view.cls, 'done');
  assert.match(view.text, /Finished in 6\.7s/);
  assert.match(view.text, /\$0\.40/);
  assert.match(view.text, /not billed/);
});

test('a failed run is shown as an error', () => {
  assert.equal(eventToView({ kind: 'run-done', ok: false, durationMs: 1000 }).cls, 'error');
});

test('a queued message says it is waiting in line', () => {
  const view = eventToView({ kind: 'status', state: 'queued', who: 'Max' });
  assert.match(view.text, /Max sent a message/);
  assert.match(view.text, /waiting in line/);
});

test('working and idle change the status pill but add no row', () => {
  assert.equal(eventToView({ kind: 'status', state: 'working' }), null);
  assert.equal(statusText({ kind: 'status', state: 'working' }), 'Claude is working…');
  assert.equal(statusText({ kind: 'status', state: 'idle' }), 'Ready');
  assert.equal(statusText({ kind: 'status', state: 'queued' }), null);
  assert.equal(statusText({ kind: 'user' }), null);
});

test('errors and unknown events', () => {
  assert.deepEqual(eventToView({ kind: 'error', text: 'boom' }), { cls: 'error', label: '', text: 'boom' });
  assert.equal(eventToView({ kind: 'mystery' }), null);
});
