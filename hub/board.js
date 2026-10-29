import crypto from 'node:crypto';
import { readJson, writeJsonAtomic } from './fs-util.js';

export const COLUMNS = ['ideas', 'todo', 'doing', 'done'];
const MAX_CARDS = 200;
const MAX_TITLE = 120;
const MAX_DETAIL = 2000;

function checkTitle(value) {
  const title = String(value ?? '').trim();
  if (!title) throw new Error('Give the card a title.');
  if (title.length > MAX_TITLE) throw new Error(`Keep the title under ${MAX_TITLE} characters.`);
  return title;
}

function checkDetail(value) {
  const detail = String(value ?? '').trim();
  if (detail.length > MAX_DETAIL) throw new Error(`Keep the details under ${MAX_DETAIL} characters.`);
  return detail;
}

function checkColumn(value) {
  if (!COLUMNS.includes(value)) throw new Error(`Pick one of: ${COLUMNS.join(', ')}.`);
  return value;
}

// A project's board of cards. The order of the cards in the file is the order on screen.
export class Board {
  #file;
  #now;
  #cards;

  constructor(file, { now = () => new Date() } = {}) {
    this.#file = file;
    this.#now = now;
    this.#cards = readJson(file, { cards: [] }).cards;
  }

  list() {
    return this.#cards.map((card) => ({ ...card }));
  }

  #save() {
    writeJsonAtomic(this.#file, { cards: this.#cards });
  }

  #find(id) {
    const card = this.#cards.find((candidate) => candidate.id === id);
    if (!card) throw new Error('That card is no longer on the board.');
    return card;
  }

  add({ title, detail = '', column = 'todo', by }) {
    if (this.#cards.length >= MAX_CARDS) throw new Error(`The board is full (${MAX_CARDS} cards). Clear some off first.`);
    const stamp = this.#now().toISOString();
    const card = {
      id: crypto.randomBytes(4).toString('hex'),
      title: checkTitle(title),
      detail: checkDetail(detail),
      column: checkColumn(column),
      createdBy: by,
      assignee: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.#cards.push(card);
    this.#save();
    return { ...card };
  }

  // Changes a card. `position` puts it at that place within its column (0 is the top).
  update(id, patch) {
    const card = this.#find(id);
    const next = { ...card };
    if ('title' in patch) next.title = checkTitle(patch.title);
    if ('detail' in patch) next.detail = checkDetail(patch.detail);
    if ('assignee' in patch) next.assignee = patch.assignee ?? null;
    if ('column' in patch) next.column = checkColumn(patch.column);
    next.updatedAt = this.#now().toISOString();

    const moved = next.column !== card.column || Number.isInteger(patch.position);
    Object.assign(card, next);
    if (moved) this.#place(card, patch.position);
    this.#save();
    return { ...card };
  }

  #place(card, position) {
    this.#cards = this.#cards.filter((candidate) => candidate !== card);
    const inColumn = this.#cards.filter((candidate) => candidate.column === card.column);
    let index;
    if (Number.isInteger(position) && position < inColumn.length) {
      index = this.#cards.indexOf(inColumn[Math.max(0, position)]);
    } else if (inColumn.length) {
      index = this.#cards.indexOf(inColumn.at(-1)) + 1;
    } else {
      index = this.#cards.length;
    }
    this.#cards.splice(index, 0, card);
  }

  remove(id) {
    const card = this.#find(id);
    this.#cards = this.#cards.filter((candidate) => candidate !== card);
    this.#save();
  }
}
