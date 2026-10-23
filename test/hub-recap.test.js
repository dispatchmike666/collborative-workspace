import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecap } from '../hub/recap.js';

let nextId = 1;
const ev = (event) => ({ id: nextId++, at: '2026-10-23T10:00:00Z', ...event });

test('nothing from other people means no recap', () => {
  const events = [
    ev({ kind: 'user', who: 'Max', text: 'my own message' }),
    ev({ kind: 'claude-step', owner: 'Max', summary: 'Write a.txt' }),
  ];
  assert.equal(buildRecap(events, 'Max'), '');
  assert.equal(buildRecap([], 'Max'), '');
});

test('the recap says what the other person asked and what their Claude did', () => {
  const events = [
    ev({ kind: 'user', who: 'Max', text: 'Make the pins color-coded' }),
    ev({ kind: 'status', state: 'working', who: 'Max' }),
    ev({ kind: 'claude-step', owner: 'Max', summary: 'Edit map.js' }),
    ev({ kind: 'claude-step', owner: 'Max', summary: 'Write legend.js' }),
    ev({ kind: 'claude-text', owner: 'Max', text: 'Pins are now colored by status.' }),
    ev({ kind: 'run-done', owner: 'Max', ok: true, text: 'Pins are now colored by status.' }),
  ];
  assert.equal(
    buildRecap(events, 'Brennan'),
    [
      'Max asked: Make the pins color-coded',
      "Max's Claude did: Edit map.js, Write legend.js",
      "Max's Claude said: Pins are now colored by status.",
    ].join('\n'),
  );
});

test('your own activity and private team chat are left out', () => {
  const events = [
    ev({ kind: 'user', who: 'Brennan', text: 'mine' }),
    ev({ kind: 'team-chat', who: 'Max', to: 'Brennan', text: 'private chat' }),
    ev({ kind: 'claude-text', owner: 'Brennan', text: 'my Claude spoke' }),
    ev({ kind: 'user', who: 'Max', text: 'visible request' }),
  ];
  assert.equal(buildRecap(events, 'brennan'), 'Max asked: visible request');
});

test('only events after the last one this Claude already knows about are included', () => {
  const old = ev({ kind: 'user', who: 'Max', text: 'old request' });
  const fresh = ev({ kind: 'user', who: 'Max', text: 'new request' });
  assert.equal(buildRecap([old, fresh], 'Brennan', { sinceId: old.id }), 'Max asked: new request');
});

test('shared notes changes are mentioned', () => {
  assert.equal(buildRecap([ev({ kind: 'notes-saved', who: 'Max', version: 3 })], 'Brennan'), 'Max updated the shared notes.');
});

test('a long list of steps is shortened', () => {
  const steps = Array.from({ length: 12 }, (_, i) => ev({ kind: 'claude-step', owner: 'Max', summary: `Write f${i}.txt` }));
  const recap = buildRecap(steps, 'Brennan');
  assert.match(recap, /Write f0\.txt/);
  assert.match(recap, /and 4 more/);
  assert.ok(!recap.includes('f11.txt'));
});

test('a very long history keeps the newest part and says older activity was left out', () => {
  const events = Array.from({ length: 200 }, (_, i) => ev({ kind: 'user', who: 'Max', text: `request number ${i} ${'x'.repeat(100)}` }));
  const recap = buildRecap(events, 'Brennan', { maxChars: 600 });
  assert.ok(recap.length <= 700, `recap was ${recap.length} characters`);
  assert.match(recap, /^\(Older activity left out\)/);
  assert.match(recap, /request number 199/);
  assert.ok(!recap.includes('request number 0 '));
});

test('long messages are clipped', () => {
  const recap = buildRecap([ev({ kind: 'user', who: 'Max', text: 'y'.repeat(1000) })], 'Brennan');
  assert.ok(recap.length < 400);
});
