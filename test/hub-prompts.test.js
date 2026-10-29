import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Prompts } from '../hub/prompts.js';
import { tempDir } from './helpers.js';

function make(t) {
  const file = path.join(tempDir(t), 'prompts.json');
  return { prompts: new Prompts(file), file };
}

test('a new shelf starts with a handful of useful prompts', (t) => {
  const { prompts } = make(t);
  const list = prompts.list();
  assert.ok(list.length >= 5);
  for (const prompt of list) {
    assert.ok(prompt.id && prompt.title && prompt.text && prompt.emoji, JSON.stringify(prompt));
  }
});

test('the starter set is only added once, so removing one stays removed', (t) => {
  const { prompts, file } = make(t);
  const [first] = prompts.list();
  prompts.remove(first.id);
  assert.equal(new Prompts(file).list().some((p) => p.id === first.id), false);
});

test('anyone can add a prompt to the shelf', (t) => {
  const { prompts, file } = make(t);
  const added = prompts.add({ title: ' Dark mode ', text: 'Add a dark mode.', emoji: '🌙', by: 'Max' });
  assert.equal(added.title, 'Dark mode');
  assert.equal(added.by, 'Max');
  assert.ok(new Prompts(file).list().some((p) => p.id === added.id));
  assert.equal(prompts.add({ title: 'No emoji', text: 'Hello', by: 'Max' }).emoji, '✦');
});

test('bad prompts are refused with plain messages', (t) => {
  const { prompts } = make(t);
  assert.throws(() => prompts.add({ title: '', text: 'x', by: 'Max' }), /Give the prompt a title/);
  assert.throws(() => prompts.add({ title: 'x'.repeat(41), text: 'x', by: 'Max' }), /under 40/);
  assert.throws(() => prompts.add({ title: 'ok', text: '  ', by: 'Max' }), /Write what to ask/);
  assert.throws(() => prompts.add({ title: 'ok', text: 'x'.repeat(1001), by: 'Max' }), /under 1000/);
  assert.throws(() => prompts.remove('nope'), /no longer on the shelf/);
});

test('the shelf has a size limit', (t) => {
  const { prompts } = make(t);
  for (let i = prompts.list().length; i < 40; i += 1) prompts.add({ title: `P${i}`, text: 'hi', by: 'Max' });
  assert.throws(() => prompts.add({ title: 'Extra', text: 'hi', by: 'Max' }), /shelf is full/);
});
