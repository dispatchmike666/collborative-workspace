import assert from 'node:assert/strict';
import test from 'node:test';
import { Timeline } from '../server/timeline.js';

test('gives each event a rising id and a timestamp', () => {
  const timeline = new Timeline();
  const first = timeline.add({ kind: 'user', text: 'hi' });
  const second = timeline.add({ kind: 'user', text: 'again' });
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.match(first.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(timeline.all().map((e) => e.text), ['hi', 'again']);
});

test('tells listeners about new events until they unsubscribe', () => {
  const timeline = new Timeline();
  const seen = [];
  const unsubscribe = timeline.subscribe((event) => seen.push(event.text));
  timeline.add({ text: 'a' });
  unsubscribe();
  timeline.add({ text: 'b' });
  assert.deepEqual(seen, ['a']);
});

test('one broken listener does not stop the others', () => {
  const timeline = new Timeline();
  const seen = [];
  timeline.subscribe(() => {
    throw new Error('closed tab');
  });
  timeline.subscribe((event) => seen.push(event.text));
  timeline.add({ text: 'a' });
  assert.deepEqual(seen, ['a']);
});

test('keeps only the newest events once it is full', () => {
  const timeline = new Timeline({ max: 3 });
  for (const text of ['1', '2', '3', '4']) timeline.add({ text });
  assert.deepEqual(timeline.all().map((e) => e.text), ['2', '3', '4']);
});
