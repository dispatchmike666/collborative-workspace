import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME_CHAT_LIMIT, pickChats, seeAllChatsLabel } from '../hub/public/render.js';

// Open chats the way the hub hands them to the page: newest first is NOT guaranteed.
const makeChats = (count, { now = 1_700_000_000_000 } = {}) => Array.from({ length: count }, (_, i) => ({
  id: `chat-${String(i).padStart(4, '0')}`,
  name: `Chat ${i + 1}`,
  updatedAt: now - ((i * 7) % count) * 60_000,
}));

test('the home page shows three chats at most', () => {
  assert.equal(HOME_CHAT_LIMIT, 3);
});

test('no open chats: nothing to show and no "see all" link', () => {
  assert.deepEqual(pickChats([], { limit: HOME_CHAT_LIMIT }), { shown: [], total: 0, more: 0 });
});

test('one open chat shows on its own', () => {
  const [only] = makeChats(1);
  assert.deepEqual(pickChats([only], { limit: HOME_CHAT_LIMIT }), { shown: [only], total: 1, more: 0 });
});

test('exactly three open chats all fit, with no link', () => {
  const picked = pickChats(makeChats(3), { limit: HOME_CHAT_LIMIT });
  assert.equal(picked.shown.length, 3);
  assert.equal(picked.more, 0);
});

test('six open chats: the three most recently active show, three are left for the Chats page', () => {
  const chats = makeChats(6);
  const picked = pickChats(chats, { limit: HOME_CHAT_LIMIT });
  assert.equal(picked.total, 6);
  assert.equal(picked.more, 3);
  const newest = [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  assert.deepEqual(picked.shown, newest);
});

test('fifty open chats: still three on the home page', () => {
  const chats = makeChats(50);
  const picked = pickChats(chats, { limit: HOME_CHAT_LIMIT });
  assert.equal(picked.shown.length, 3);
  assert.equal(picked.total, 50);
  assert.equal(picked.more, 47);
  for (const chat of picked.shown) for (const other of chats) if (!picked.shown.includes(other)) assert.ok(chat.updatedAt >= other.updatedAt);
});

test('the Chats page (no limit) shows every chat, newest first', () => {
  const chats = makeChats(50);
  const picked = pickChats(chats);
  assert.equal(picked.shown.length, 50);
  assert.equal(picked.more, 0);
  for (let i = 1; i < 50; i++) assert.ok(picked.shown[i - 1].updatedAt >= picked.shown[i].updatedAt);
});

test('chats with no time go last, and ties keep the order the helper sent', () => {
  const chats = [
    { id: 'a', updatedAt: null },
    { id: 'b', updatedAt: 5 },
    { id: 'c' },
    { id: 'd', updatedAt: 5 },
  ];
  assert.deepEqual(pickChats(chats).shown.map((chat) => chat.id), ['b', 'd', 'a', 'c']);
});

test('a chat you are typing into stays on the home page after newer chats push it down', () => {
  const chats = makeChats(6);
  const oldest = [...chats].sort((a, b) => a.updatedAt - b.updatedAt)[0];
  const picked = pickChats(chats, { limit: HOME_CHAT_LIMIT, keep: [oldest.id] });
  assert.equal(picked.shown.length, 4);
  assert.equal(picked.shown.at(-1), oldest);
  assert.equal(picked.more, 2);
  // Keeping a chat that is already in the top three changes nothing.
  const top = pickChats(chats, { limit: HOME_CHAT_LIMIT }).shown[0];
  assert.equal(pickChats(chats, { limit: HOME_CHAT_LIMIT, keep: [top.id] }).shown.length, 3);
  // Keeping a chat that has closed changes nothing either.
  assert.equal(pickChats(chats, { limit: HOME_CHAT_LIMIT, keep: ['gone'] }).shown.length, 3);
});

test('the list it is given is left alone', () => {
  const chats = makeChats(6);
  const before = chats.map((chat) => chat.id);
  pickChats(chats, { limit: HOME_CHAT_LIMIT });
  assert.deepEqual(chats.map((chat) => chat.id), before);
});

test('the "see all" link counts every open chat', () => {
  assert.equal(seeAllChatsLabel(1), 'See all 1 chat');
  assert.equal(seeAllChatsLabel(6), 'See all 6 chats');
  assert.equal(seeAllChatsLabel(50), 'See all 50 chats');
});
