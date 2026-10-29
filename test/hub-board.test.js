import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Board, COLUMNS } from '../hub/board.js';
import { tempDir } from './helpers.js';

function makeBoard(t) {
  const file = path.join(tempDir(t), 'board.json');
  return { board: new Board(file), file };
}

test('a card has a title, lives in a column, and remembers who made it', (t) => {
  const { board } = makeBoard(t);
  const card = board.add({ title: '  Add a footer  ', detail: 'Small and friendly', by: 'Max' });
  assert.match(card.id, /^[0-9a-f]{8}$/);
  assert.equal(card.title, 'Add a footer');
  assert.equal(card.detail, 'Small and friendly');
  assert.equal(card.column, 'todo');
  assert.equal(card.createdBy, 'Max');
  assert.equal(card.assignee, null);
  assert.deepEqual(COLUMNS, ['ideas', 'todo', 'doing', 'done']);
});

test('cards survive a restart', (t) => {
  const { board, file } = makeBoard(t);
  board.add({ title: 'One', column: 'ideas', by: 'Max' });
  board.add({ title: 'Two', by: 'Brennan' });
  const reopened = new Board(file);
  assert.deepEqual(reopened.list().map((c) => [c.title, c.column]), [['One', 'ideas'], ['Two', 'todo']]);
});

test('bad cards are refused with plain messages', (t) => {
  const { board } = makeBoard(t);
  assert.throws(() => board.add({ title: '   ', by: 'Max' }), /Give the card a title/);
  assert.throws(() => board.add({ title: 'x'.repeat(121), by: 'Max' }), /under 120/);
  assert.throws(() => board.add({ title: 'ok', detail: 'y'.repeat(2001), by: 'Max' }), /under 2000/);
  assert.throws(() => board.add({ title: 'ok', column: 'nope', by: 'Max' }), /Pick one of/);
});

test('a card can be edited and moved', (t) => {
  const { board } = makeBoard(t);
  const card = board.add({ title: 'Draft', by: 'Max' });
  const moved = board.update(card.id, { column: 'doing', assignee: 'Max' });
  assert.equal(moved.column, 'doing');
  assert.equal(moved.assignee, 'Max');
  const renamed = board.update(card.id, { title: 'Better title', detail: 'More words' });
  assert.equal(renamed.title, 'Better title');
  assert.equal(renamed.column, 'doing');
  assert.throws(() => board.update('nope', { title: 'x' }), /no longer on the board/);
  assert.throws(() => board.update(card.id, { column: 'sideways' }), /Pick one of/);
  assert.throws(() => board.update(card.id, { title: '' }), /Give the card a title/);
});

test('a card dropped in a column goes where you put it', (t) => {
  const { board } = makeBoard(t);
  const a = board.add({ title: 'A', column: 'todo', by: 'Max' });
  const b = board.add({ title: 'B', column: 'todo', by: 'Max' });
  const c = board.add({ title: 'C', column: 'todo', by: 'Max' });
  const x = board.add({ title: 'X', column: 'doing', by: 'Max' });
  board.update(c.id, { column: 'todo', position: 0 });
  assert.deepEqual(board.list().filter((card) => card.column === 'todo').map((card) => card.title), ['C', 'A', 'B']);
  board.update(x.id, { column: 'todo', position: 1 });
  assert.deepEqual(board.list().filter((card) => card.column === 'todo').map((card) => card.title), ['C', 'X', 'A', 'B']);
  board.update(a.id, { column: 'done' });
  assert.deepEqual(board.list().filter((card) => card.column === 'done').map((card) => card.title), ['A']);
  assert.ok(b.id);
});

test('a card can be removed, and the board has a size limit', (t) => {
  const { board } = makeBoard(t);
  const card = board.add({ title: 'Gone soon', by: 'Max' });
  board.remove(card.id);
  assert.deepEqual(board.list(), []);
  assert.throws(() => board.remove(card.id), /no longer on the board/);
  for (let i = 0; i < 200; i += 1) board.add({ title: `Card ${i}`, by: 'Max' });
  assert.throws(() => board.add({ title: 'One too many', by: 'Max' }), /board is full/);
});

test('list returns copies, so callers cannot change the board by accident', (t) => {
  const { board } = makeBoard(t);
  board.add({ title: 'Safe', by: 'Max' });
  board.list()[0].title = 'Changed from outside';
  assert.equal(board.list()[0].title, 'Safe');
});
