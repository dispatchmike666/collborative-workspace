import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { Helper } from '../helper/helper.js';
import { ChatWatcher } from '../helper/live-chats.js';
import { LiveChats } from '../hub/chats.js';
import { tempDir, waitFor } from './helpers.js';
import { startHub } from './hub-fixture.js';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const chat = (overrides = {}) => ({
  id: ID_A, name: 'Map site', folder: 'map-site', where: 'desktop', status: 'idle', doing: null, canMessage: true, startedAt: 1, updatedAt: 2, ...overrides,
});

test('what a helper reports is cleaned up, kept per person, and forgotten when they go', () => {
  const chats = new LiveChats();
  chats.set('Brennan', [
    chat({ name: `  Long  ${'x'.repeat(500)}`, secret: 'nope', where: 'weird', status: 'sleeping', doing: 'y'.repeat(500) }),
    { id: 'bad id!' },
    null,
  ]);
  const [shown] = chats.list('brennan');
  assert.equal(chats.list('Brennan').length, 1, 'bad entries are dropped');
  assert.equal(shown.name.length, 120);
  assert.equal(shown.where, 'other');
  assert.equal(shown.status, 'unknown');
  assert.equal(shown.doing.length, 160);
  assert.ok(!('secret' in shown));
  assert.deepEqual(chats.list('Max'), [], "Max never sees Brennan's chats");
  assert.throws(() => chats.set('Max', 'not a list'), /list of chats/);
  chats.clear('Brennan');
  assert.deepEqual(chats.list('Brennan'), []);
});

test('a message goes to the owner\'s helper, and the helper\'s answer comes back', async () => {
  const chats = new LiveChats();
  chats.set('Brennan', [chat(), chat({ id: ID_B, canMessage: false })]);
  const sent = [];
  const pending = chats.send({ user: 'Brennan', chatId: ID_A, text: 'hello', deliver: (message) => { sent.push(message); return true; } });
  assert.equal(sent[0].type, 'chat-message');
  assert.equal(sent[0].chatId, ID_A);
  assert.equal(sent[0].text, 'hello');

  assert.equal(chats.result('Max', sent[0].requestId, { ok: true }), false, "Max's helper cannot answer for Brennan's request");
  assert.equal(chats.result('Brennan', sent[0].requestId, { ok: true, message: 'Sent.' }), true);
  assert.deepEqual(await pending, { ok: true, message: 'Sent.' });
  assert.equal(chats.result('Brennan', sent[0].requestId, { ok: true }), false, 'an answer counts once');

  assert.match((await chats.send({ user: 'Brennan', chatId: ID_B, text: 'hi', deliver: () => true })).message, /does not take messages/);
  assert.match((await chats.send({ user: 'Brennan', chatId: 'cccccccc-3333', text: 'hi', deliver: () => true })).message, /not open any more/);
  assert.match((await chats.send({ user: 'Max', chatId: ID_A, text: 'hi', deliver: () => true })).message, /not open any more/, "Max cannot reach Brennan's chat even with its id");
  assert.match((await chats.send({ user: 'Brennan', chatId: ID_A, text: 'hi', deliver: () => false })).message, /helper isn't running/);
});

test('a helper that never answers, or goes away, ends the wait', async () => {
  const slow = new LiveChats({ requestTimeoutMs: 30 });
  slow.set('Brennan', [chat()]);
  assert.match((await slow.send({ user: 'Brennan', chatId: ID_A, text: 'hi', deliver: () => true })).message, /did not answer in time/);

  const dropped = new LiveChats();
  dropped.set('Brennan', [chat()]);
  const pending = dropped.send({ user: 'Brennan', chatId: ID_A, text: 'hi', deliver: () => true });
  dropped.clear('Brennan');
  assert.match((await pending).message, /went offline/);
});

test('the page sees only its own person\'s chats, and only while their helper is connected', async (t) => {
  const hub = await startHub(t);
  const brennan = await hub.login('Brennan');
  const max = await hub.login('Max');
  const post = (route, body, who) => fetch(`${hub.base}${route}`, hub.json(body, 'POST', hub.bearer(who)));

  assert.deepEqual(await (await hub.as(brennan)('/api/chats')).json(), { online: false, chats: [] });

  const stream = await hub.connectHelper('Brennan');
  assert.equal((await post('/helper/chats', { chats: [chat()] }, 'Brennan')).status, 200);
  const mine = await (await hub.as(brennan)('/api/chats')).json();
  assert.equal(mine.online, true);
  assert.deepEqual(mine.chats.map((c) => c.name), ['Map site']);
  assert.deepEqual((await (await hub.as(max)('/api/chats')).json()).chats, [], "Max's page shows none of Brennan's chats");

  assert.equal((await post('/helper/chats', { chats: 'nope' }, 'Brennan')).status, 400);
  assert.equal((await fetch(`${hub.base}/helper/chats`, hub.json({ chats: [] }))).status, 401, 'a helper needs its token');

  stream.close();
  await waitFor(() => !hub.dispatcher.isOnline('Brennan'), { label: 'the helper to be seen as gone' });
  const after = await (await hub.as(brennan)('/api/chats')).json();
  assert.deepEqual(after, { online: false, chats: [] }, 'the list is forgotten when the helper disconnects');
});

test('sending from the page reaches the helper and returns its answer; only the owner can do it', async (t) => {
  const hub = await startHub(t);
  const brennan = await hub.login('Brennan');
  const max = await hub.login('Max');
  const stream = await hub.connectHelper('Brennan');
  await fetch(`${hub.base}/helper/chats`, hub.json({ chats: [chat()] }, 'POST', hub.bearer('Brennan')));

  const sending = hub.as(brennan)('/api/chats/send', hub.json({ chatId: ID_A, text: 'add a login page' }));
  const message = await stream.waitFor((m) => m.event === 'chat-message');
  assert.equal(message.data.chatId, ID_A);
  assert.equal(message.data.text, 'add a login page');
  assert.equal(message.data.who, 'Brennan');
  await fetch(`${hub.base}/helper/chat-result`, hub.json({ requestId: message.data.requestId, ok: true, message: 'Sent.' }, 'POST', hub.bearer('Brennan')));
  assert.deepEqual(await (await sending).json(), { ok: true, message: 'Sent.' });

  const intruder = await hub.as(max)('/api/chats/send', hub.json({ chatId: ID_A, text: 'sneaky' }));
  assert.match((await intruder.json()).message, /not open any more/);
  assert.equal(stream.messages.filter((m) => m.event === 'chat-message').length, 1, "nothing reached Brennan's helper from Max");

  assert.equal((await hub.as(brennan)('/api/chats/send', hub.json({ chatId: ID_A, text: '   ' }))).status, 400);
  assert.equal((await fetch(`${hub.base}/api/chats/send`, hub.json({ chatId: ID_A, text: 'hi' }))).status, 401, 'a login is needed');
});

// A real helper, watching a pretend Claude folder, talking to the hub.
test('a helper lists the open chats on its computer, keeps the page up to date, and passes a message into one', async (t) => {
  const hub = await startHub(t);
  const brennan = await hub.login('Brennan');

  const claudeDir = tempDir(t);
  fs.mkdirSync(path.join(claudeDir, 'sessions'));
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\ws-test-${crypto.randomBytes(6).toString('hex')}`
    : path.join(tempDir(t), 'chat.sock');
  const received = [];
  const mailbox = net.createServer((socket) => {
    let text = '';
    socket.on('data', (piece) => { text += piece.toString('utf8'); });
    socket.on('close', () => received.push(...text.split('\n').filter(Boolean).map((line) => JSON.parse(line))));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => mailbox.listen(address, resolve));
  t.after(() => new Promise((resolve) => { mailbox.closeAllConnections?.(); mailbox.close(resolve); }));
  const writeChat = (status) => fs.writeFileSync(path.join(claudeDir, 'sessions', '4242.json'), JSON.stringify({
    pid: 4242, sessionId: ID_A, name: 'Map site', cwd: '/work/map-site', kind: 'interactive', entrypoint: 'cli', status, messagingSocketPath: address,
  }));
  writeChat('idle');

  const helper = new Helper({
    hubUrl: hub.base,
    token: hub.creds.Brennan.helperToken,
    workspaceRoot: tempDir(t),
    claudeCommand: process.execPath,
    claudeArgs: [],
    liveChats: new ChatWatcher({ claudeDir, isAlive: (pid) => pid === 4242, isWindows: false }),
    chatScanMs: 40,
    sseOptions: { minDelayMs: 20, maxDelayMs: 50 },
  });
  helper.start();
  t.after(() => helper.stop());

  const listed = () => hub.as(brennan)('/api/chats').then((res) => res.json());
  let seen;
  for (let tries = 0; tries < 200 && !seen; tries += 1) {
    const now = await listed();
    if (now.chats.length === 1) seen = now.chats[0];
    else await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(seen, 'the chat shows up');
  assert.deepEqual([seen.name, seen.folder, seen.where, seen.status, seen.canMessage], ['Map site', 'map-site', 'terminal', 'idle', true]);
  assert.ok(!JSON.stringify(seen).includes(address), 'the private mailbox address never reaches the hub');

  writeChat('busy');
  let busy;
  for (let tries = 0; tries < 200 && !busy; tries += 1) {
    const now = await listed();
    if (now.chats[0]?.status === 'busy') busy = true;
    else await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(busy, 'a change in the chat shows up without restarting anything');

  const result = await (await hub.as(brennan)('/api/chats/send', hub.json({ chatId: ID_A, text: 'add a login page' }))).json();
  assert.equal(result.ok, true, result.message);
  await waitFor(() => received.length === 1, { label: "the message in the chat's mailbox" });
  assert.equal(received[0].message.content, 'Message from Brennan in the shared workspace:\n\nadd a login page');
});

test('a helper without the chat watcher says so and never looks at anyone\'s chats', async (t) => {
  const hub = await startHub(t);
  const brennan = await hub.login('Brennan');
  const helper = new Helper({
    hubUrl: hub.base, token: hub.creds.Brennan.helperToken, workspaceRoot: tempDir(t), claudeCommand: process.execPath, claudeArgs: [],
    sseOptions: { minDelayMs: 20, maxDelayMs: 50 },
  });
  helper.start();
  t.after(() => helper.stop());
  await waitFor(() => hub.dispatcher.isOnline('Brennan'), { label: 'the helper to connect' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(await (await hub.as(brennan)('/api/chats')).json(), { online: true, chats: [] });
});

test('how far a message has got is kept with the chat, cleaned up, and nothing else comes along', () => {
  const chats = new LiveChats();
  chats.set('Brennan', [
    chat({ lastMessage: { id: 'req-1', state: 'picked_up', sentAt: 5, text: 'what you wrote', address: 'private' } }),
    chat({ id: ID_B, lastMessage: { id: 'req-2', state: 'exploded', sentAt: 1 } }),
    chat({ id: 'cccccccc-3333-4333-8333-cccccccccccc' }),
  ]);
  const [first, second, third] = chats.list('Brennan');
  assert.deepEqual(first.lastMessage, { id: 'req-1', state: 'picked_up', sentAt: 5 });
  assert.equal(second.lastMessage, null, 'an unknown state is dropped');
  assert.equal(third.lastMessage, null);
  assert.deepEqual(chats.list('Max'), [], "Max never sees how Brennan's messages are going");
});

// Asks until the page shows what is expected, or gives up.
async function eventually(read, matches, label) {
  for (let tries = 0; tries < 250; tries += 1) {
    const value = await read();
    if (matches(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test('the page sees a message go from sent to picked up, without ever receiving its words', async (t) => {
  const hub = await startHub(t);
  const brennan = await hub.login('Brennan');

  const claudeDir = tempDir(t);
  fs.mkdirSync(path.join(claudeDir, 'sessions'));
  fs.mkdirSync(path.join(claudeDir, 'projects', 'map-site'), { recursive: true });
  const history = path.join(claudeDir, 'projects', 'map-site', `${ID_A}.jsonl`);
  fs.writeFileSync(history, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'earlier work' } })}\n`);
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\ws-test-${crypto.randomBytes(6).toString('hex')}`
    : path.join(tempDir(t), 'chat.sock');
  const received = [];
  const mailbox = net.createServer((socket) => {
    let text = '';
    socket.on('data', (piece) => { text += piece.toString('utf8'); });
    socket.on('close', () => received.push(...text.split('\n').filter(Boolean).map((line) => JSON.parse(line))));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => mailbox.listen(address, resolve));
  t.after(() => new Promise((resolve) => { mailbox.closeAllConnections?.(); mailbox.close(resolve); }));
  fs.writeFileSync(path.join(claudeDir, 'sessions', '4242.json'), JSON.stringify({
    pid: 4242, sessionId: ID_A, name: 'Map site', cwd: '/work/map-site', kind: 'interactive', entrypoint: 'cli', status: 'idle', messagingSocketPath: address,
  }));

  const helper = new Helper({
    hubUrl: hub.base,
    token: hub.creds.Brennan.helperToken,
    workspaceRoot: tempDir(t),
    claudeCommand: process.execPath,
    claudeArgs: [],
    liveChats: new ChatWatcher({ claudeDir, isAlive: (pid) => pid === 4242, isWindows: false }),
    chatScanMs: 40,
    sseOptions: { minDelayMs: 20, maxDelayMs: 50 },
  });
  helper.start();
  t.after(() => helper.stop());

  const listed = () => hub.as(brennan)('/api/chats').then((res) => res.json());
  await eventually(listed, (now) => now.chats.length === 1, 'the chat to show up');
  assert.equal((await listed()).chats[0].lastMessage, null, 'nothing was sent yet');

  const result = await (await hub.as(brennan)('/api/chats/send', hub.json({ chatId: ID_A, text: 'add a login page' }))).json();
  assert.equal(result.ok, true, result.message);
  const sent = await eventually(listed, (now) => now.chats[0]?.lastMessage?.state === 'sent', 'the message to show as sent');
  assert.equal(typeof sent.chats[0].lastMessage.id, 'string');

  fs.appendFileSync(history, `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: 'Message from Brennan in the shared workspace:\n\nadd a login page' })}\n`);
  const picked = await eventually(listed, (now) => now.chats[0]?.lastMessage?.state === 'picked_up', 'the message to show as picked up');
  assert.equal(picked.chats[0].lastMessage.id, sent.chats[0].lastMessage.id);
  assert.ok(!JSON.stringify(picked).includes('login page'), 'the words of the message never reach the hub or the page');
});
