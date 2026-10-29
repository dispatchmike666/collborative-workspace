import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Knowledge } from '../hub/knowledge.js';
import { tempDir } from './helpers.js';

function make(t) {
  const file = path.join(tempDir(t), 'knowledge.json');
  return { knowledge: new Knowledge(file), file };
}

test('a new project has an empty brief, no decisions, and notes sharing on', (t) => {
  const { knowledge } = make(t);
  assert.deepEqual(knowledge.get(), {
    brief: { text: '', version: 0, updatedBy: null, updatedAt: null },
    decisions: [],
    shareNotes: true,
  });
});

test('the brief is saved with a version, and a stale save is warned instead of overwriting', (t) => {
  const { knowledge, file } = make(t);
  const first = knowledge.saveBrief({ text: 'Keep it simple. Plain English.', baseVersion: 0, user: 'Brennan' });
  assert.equal(first.ok, true);
  assert.equal(first.brief.version, 1);
  assert.equal(first.brief.updatedBy, 'Brennan');

  const stale = knowledge.saveBrief({ text: 'Something else', baseVersion: 0, user: 'Max' });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  assert.equal(stale.brief.text, 'Keep it simple. Plain English.');

  assert.equal(new Knowledge(file).get().brief.text, 'Keep it simple. Plain English.');
  assert.throws(() => knowledge.saveBrief({ text: 'x'.repeat(4001), baseVersion: 1, user: 'Max' }), /under 4000/);
  assert.throws(() => knowledge.saveBrief({ text: 5, baseVersion: 1, user: 'Max' }), /must be text/);
});

test('decisions are added with who and when, and only their author can remove them', (t) => {
  const { knowledge } = make(t);
  const decision = knowledge.addDecision({ text: '  Use blue for buttons  ', by: 'Brennan' });
  assert.match(decision.id, /^[0-9a-f]{8}$/);
  assert.equal(decision.text, 'Use blue for buttons');
  assert.equal(decision.by, 'Brennan');
  assert.match(decision.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(knowledge.get().decisions.length, 1);

  assert.throws(() => knowledge.removeDecision(decision.id, 'Max'), /Only Brennan can remove/);
  knowledge.removeDecision(decision.id, 'Brennan');
  assert.deepEqual(knowledge.get().decisions, []);
  assert.throws(() => knowledge.removeDecision(decision.id, 'Brennan'), /no longer there/);
});

test('decisions must say something and are limited', (t) => {
  const { knowledge } = make(t);
  assert.throws(() => knowledge.addDecision({ text: '   ', by: 'Max' }), /Write the decision/);
  assert.throws(() => knowledge.addDecision({ text: 'x'.repeat(301), by: 'Max' }), /under 300/);
  for (let i = 0; i < 100; i += 1) knowledge.addDecision({ text: `Decision ${i}`, by: 'Max' });
  assert.throws(() => knowledge.addDecision({ text: 'One too many', by: 'Max' }), /too many decisions/);
});

test('sharing the notes with Claude can be switched off and on', (t) => {
  const { knowledge, file } = make(t);
  knowledge.setShareNotes(false);
  assert.equal(new Knowledge(file).get().shareNotes, false);
  knowledge.setShareNotes(true);
  assert.equal(knowledge.get().shareNotes, true);
  assert.throws(() => knowledge.setShareNotes('yes'), /true or false/);
});

test('decisions survive a restart and come back in the order they were made', (t) => {
  const { knowledge, file } = make(t);
  knowledge.addDecision({ text: 'First', by: 'Max' });
  knowledge.addDecision({ text: 'Second', by: 'Brennan' });
  assert.deepEqual(new Knowledge(file).get().decisions.map((d) => d.text), ['First', 'Second']);
});
