import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalUsedText, eventToView, statusText, timeAgo } from '../hub/public/render.js';

test('messages, team chat and Claude\'s words say who is speaking', () => {
  assert.deepEqual(eventToView({ kind: 'user', who: 'Max', text: 'hi' }), { cls: 'user', label: 'Max', text: 'hi' });
  assert.deepEqual(eventToView({ kind: 'team-chat', who: 'Max', to: 'Brennan', text: 'lunch?' }), { cls: 'chat', label: 'Max to Brennan', text: 'lunch?' });
  assert.deepEqual(eventToView({ kind: 'claude-text', owner: 'Max', text: 'done' }), { cls: 'claude', label: "Max's Claude", text: 'done' });
});

test('steps, sync notes and notes changes are small quiet rows', () => {
  assert.equal(eventToView({ kind: 'claude-step', owner: 'Max', summary: 'Write a.txt' }).text, 'Write a.txt');
  assert.equal(eventToView({ kind: 'sync', text: 'Saved 1 changed file to GitHub.' }).cls, 'sync');
  assert.equal(eventToView({ kind: 'notes-saved', who: 'Max' }).text, 'Max updated the shared notes.');
});

test('only failed tool results appear', () => {
  assert.equal(eventToView({ kind: 'claude-step-result', ok: true, text: 'fine' }), null);
  assert.match(eventToView({ kind: 'claude-step-result', ok: false, text: 'denied' }).text, /Problem: denied/);
});

test('a finished run shows time and plan usage and says it is not billed', () => {
  const view = eventToView({ kind: 'run-done', ok: true, durationMs: 6741, costUsd: 0.4013575 });
  assert.equal(view.cls, 'done');
  assert.match(view.text, /Finished in 6\.7s/);
  assert.match(view.text, /\$0\.40/);
  assert.match(view.text, /not billed/);
  assert.equal(eventToView({ kind: 'run-done', ok: false, durationMs: 1000 }).cls, 'error');
});

test('waiting messages explain why they are waiting', () => {
  assert.match(eventToView({ kind: 'status', state: 'queued', who: 'Max', reason: 'busy' }).text, /Max's message is waiting in line/);
  assert.match(eventToView({ kind: 'status', state: 'waiting', who: 'Max', reason: 'offline' }).text, /Max's computer is offline/);
  assert.equal(eventToView({ kind: 'status', state: 'working', who: 'Max' }), null);
  assert.equal(eventToView({ kind: 'status', state: 'idle' }), null);
});

test('the status line says whose Claude is working', () => {
  assert.equal(statusText({ kind: 'status', state: 'working', who: 'Max' }), "Max's Claude is working…");
  assert.equal(statusText({ kind: 'status', state: 'idle' }), 'Nobody is waiting on Claude');
  assert.equal(statusText({ kind: 'status', state: 'queued' }), null);
  assert.equal(statusText({ kind: 'user' }), null);
});

test('a blocked command can be allowed only by its owner and only if it is simple enough', () => {
  const event = { kind: 'approval-needed', approvalId: 'a1', owner: 'Max', tool: 'Bash', command: 'curl -s https://example.com', approvable: true };
  const mine = eventToView(event, { me: 'Max' });
  assert.equal(mine.cls, 'approval');
  assert.match(mine.text, /Max's Claude wanted to run a command/);
  assert.match(mine.text, /curl -s https:\/\/example\.com/);
  assert.deepEqual(mine.approval, { id: 'a1', canApprove: true, note: null });

  const theirs = eventToView(event, { me: 'Brennan' });
  assert.equal(theirs.approval.canApprove, false);
  assert.match(theirs.approval.note, /Only Max can allow this/);

  const complex = eventToView({ ...event, approvable: false }, { me: 'Max' });
  assert.equal(complex.approval.canApprove, false);
  assert.match(complex.approval.note, /too complicated/);
});

test('an used approval says who allowed it', () => {
  assert.equal(approvalUsedText({ kind: 'approval-used', by: 'Max' }), 'Max allowed it to run once.');
});

test('times are shown the way people say them', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  assert.equal(timeAgo('2026-10-23T11:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-10-23T11:55:00Z', now), '5 min ago');
  assert.equal(timeAgo('2026-10-23T09:00:00Z', now), '3 h ago');
  assert.equal(timeAgo('2026-10-21T12:00:00Z', now), '2 days ago');
  assert.equal(timeAgo('2026-10-23T11:59:00Z', now), '1 min ago');
  assert.equal(timeAgo(null, now), '');
});
