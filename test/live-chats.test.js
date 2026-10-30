import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { ChatWatcher, describeChat, postToChat, scanLiveChats } from '../helper/live-chats.js';
import { tempDir, waitFor } from './helpers.js';

const ID_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ID_C = 'cccccccc-3333-4333-8333-cccccccccccc';

// A pretend ~/.claude folder with a few open chats in it.
function claudeFolder(t, chats) {
  const claudeDir = tempDir(t);
  fs.mkdirSync(path.join(claudeDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'projects', 'some-folder'), { recursive: true });
  for (const chat of chats) {
    fs.writeFileSync(path.join(claudeDir, 'sessions', `${chat.pid}.json`), JSON.stringify({
      kind: 'interactive',
      entrypoint: 'claude-desktop',
      status: 'idle',
      cwd: 'C:\\Users\\bren_\\random projects\\map-site',
      ...chat,
    }));
  }
  return claudeDir;
}

const alive = (...pids) => (pid) => pids.includes(pid);
const transcript = (claudeDir, sessionId) => path.join(claudeDir, 'projects', 'some-folder', `${sessionId}.jsonl`);
const todoLine = (todos) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos } }] } })}\n`;

// A mailbox like the one Claude Code opens for each chat: collects what is written to it.
async function openMailbox(t) {
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\ws-test-${crypto.randomBytes(6).toString('hex')}`
    : path.join(tempDir(t), 'chat.sock');
  const received = [];
  const server = net.createServer((socket) => {
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8');
    });
    socket.on('close', () => received.push(...text.split('\n').filter(Boolean).map((line) => JSON.parse(line))));
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(address, resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return { address, received };
}

test('only chats that are really open and interactive are listed', (t) => {
  const claudeDir = claudeFolder(t, [
    { pid: 101, sessionId: ID_A, name: 'Map site' },
    { pid: 102, sessionId: ID_B, name: 'Closed already' },
    { pid: 103, sessionId: ID_C, name: 'A background run', kind: 'headless' },
    { pid: 104, sessionId: 'x', name: 'Bad id' },
  ]);
  fs.writeFileSync(path.join(claudeDir, 'sessions', '101.abc123.key'), '{"peerToken":"secret"}');
  fs.writeFileSync(path.join(claudeDir, 'sessions', 'notes.json'), '{}');
  fs.writeFileSync(path.join(claudeDir, 'sessions', '999.json'), 'not json at all');

  const chats = scanLiveChats({ claudeDir, isAlive: alive(101, 103, 104) });
  assert.deepEqual(chats.map((chat) => chat.name), ['Map site']);
  assert.deepEqual(scanLiveChats({ claudeDir: path.join(claudeDir, 'nowhere') }), [], 'no folder means no chats, not an error');
});

test('what is shown about a chat leaves out its private mailbox address', () => {
  const shown = describeChat({
    pid: 1, sessionId: ID_A, name: '  Map   site\nchat ', cwd: 'C:\\Users\\bren_\\random projects\\map-site', entrypoint: 'cli',
    status: 'busy', statusUpdatedAt: 500, startedAt: 100, messagingSocketPath: '\\\\.\\pipe\\private',
  }, 'Writing tests');
  assert.deepEqual(shown, {
    id: ID_A, name: 'Map site chat', folder: 'map-site', where: 'terminal', status: 'busy', doing: 'Writing tests',
    canMessage: true, startedAt: 100, updatedAt: 500,
  });
  assert.ok(!JSON.stringify(shown).includes('pipe'));
  const plain = describeChat({ pid: 2, sessionId: ID_B, entrypoint: 'something-new', status: 'waiting' });
  assert.equal(plain.name, 'Untitled chat');
  assert.equal(plain.where, 'other');
  assert.equal(plain.status, 'unknown');
  assert.equal(plain.canMessage, false);
});

test('a chat\'s current task comes from its own to-do list, and only new lines are read after that', (t) => {
  const claudeDir = claudeFolder(t, [{ pid: 101, sessionId: ID_A, name: 'Map site' }]);
  const file = transcript(claudeDir, ID_A);
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', message: 'hello' })}\n${todoLine([
    { content: 'Write tests', status: 'completed', activeForm: 'Writing tests' },
    { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
  ])}`);
  const watcher = new ChatWatcher({ claudeDir, isAlive: alive(101) });
  assert.equal(watcher.snapshot()[0].doing, 'Running tests');

  // A line that is still being written is left until it is complete.
  const next = todoLine([{ content: 'Fix login', status: 'in_progress' }]);
  fs.appendFileSync(file, next.slice(0, 30));
  assert.equal(watcher.snapshot()[0].doing, 'Running tests');
  fs.appendFileSync(file, next.slice(30));
  assert.equal(watcher.snapshot()[0].doing, 'Fix login');

  // A newer list with nothing in progress means the chat is between tasks.
  fs.appendFileSync(file, todoLine([{ content: 'Fix login', status: 'completed' }]));
  assert.equal(watcher.snapshot()[0].doing, null);
});

test('the plan format used by the Claude desktop app is understood too, and a missing history is fine', (t) => {
  const claudeDir = claudeFolder(t, [
    { pid: 101, sessionId: ID_A, name: 'Desktop chat' },
    { pid: 102, sessionId: ID_B, name: 'No history yet' },
  ]);
  fs.writeFileSync(transcript(claudeDir, ID_A), `${JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'update_plan', input: { items: [{ content: 'Read the repo', status: 'in_progress' }, { content: 'Report', status: 'pending' }] } }] },
  })}\n`);
  const chats = new ChatWatcher({ claudeDir, isAlive: alive(101, 102) }).snapshot();
  assert.equal(chats.find((chat) => chat.id === ID_A).doing, 'Read the repo');
  assert.equal(chats.find((chat) => chat.id === ID_B).doing, null);
});

test('a very long history is only read from near its end', (t) => {
  const claudeDir = claudeFolder(t, [{ pid: 101, sessionId: ID_A, name: 'Long chat' }]);
  const padding = `${JSON.stringify({ type: 'user', message: 'x'.repeat(2000) })}\n`;
  fs.writeFileSync(transcript(claudeDir, ID_A), padding.repeat(1100) + todoLine([{ content: 'Late task', status: 'in_progress' }]));
  assert.ok(fs.statSync(transcript(claudeDir, ID_A)).size > 2 * 1024 * 1024, 'the file is longer than the first read');
  assert.equal(new ChatWatcher({ claudeDir, isAlive: alive(101) }).snapshot()[0].doing, 'Late task');
});

test('busy chats come first', (t) => {
  const claudeDir = claudeFolder(t, [
    { pid: 101, sessionId: ID_A, name: 'Quiet one', status: 'idle', statusUpdatedAt: 900 },
    { pid: 102, sessionId: ID_B, name: 'Working one', status: 'busy', statusUpdatedAt: 100 },
    { pid: 103, sessionId: ID_C, name: 'Recent idle', status: 'idle', statusUpdatedAt: 950 },
  ]);
  const names = new ChatWatcher({ claudeDir, isAlive: alive(101, 102, 103) }).snapshot().map((chat) => chat.name);
  assert.deepEqual(names, ['Working one', 'Recent idle', 'Quiet one']);
});

test('a message is written to the chat\'s mailbox as one line, with the password line first when there is one', async (t) => {
  const plain = await openMailbox(t);
  await postToChat({ path: plain.address, token: null }, 'hello there');
  await waitFor(() => plain.received.length === 1, { label: 'the plain message' });
  assert.deepEqual(plain.received, [{ type: 'user', message: { role: 'user', content: 'hello there' } }]);

  const locked = await openMailbox(t);
  await postToChat({ path: locked.address, token: 'pw-123' }, 'line one\nline two');
  await waitFor(() => locked.received.length === 2, { label: 'the locked message' });
  assert.deepEqual(locked.received, [
    { type: 'auth', token: 'pw-123' },
    { type: 'user', message: { role: 'user', content: 'line one\nline two' } },
  ]);
});

test('sending to a chat finds it by id, uses its password on Windows, and says who it came from', async (t) => {
  const mailbox = await openMailbox(t);
  const claudeDir = claudeFolder(t, [{ pid: 101, sessionId: ID_A, name: 'Map site', messagingSocketPath: mailbox.address }]);
  fs.writeFileSync(path.join(claudeDir, 'sessions', '101.deadbeef.key'), JSON.stringify({ peerToken: 'win-token' }));

  const onWindows = new ChatWatcher({ claudeDir, isAlive: alive(101), isWindows: true });
  const result = await onWindows.send(ID_A, 'add a login page', 'Brennan');
  assert.equal(result.ok, true);
  await waitFor(() => mailbox.received.length === 2, { label: 'the message' });
  assert.deepEqual(mailbox.received[0], { type: 'auth', token: 'win-token' });
  assert.equal(mailbox.received[1].message.content, 'Message from Brennan in the shared workspace:\n\nadd a login page');

  mailbox.received.length = 0;
  await new ChatWatcher({ claudeDir, isAlive: alive(101), isWindows: false }).send(ID_A, 'again', 'Max');
  await waitFor(() => mailbox.received.length === 1, { label: 'the second message' });
  assert.equal(mailbox.received[0].type, 'user', 'no password line when the system does not use one');
});

test('sending says what went wrong in plain words', async (t) => {
  const claudeDir = claudeFolder(t, [
    { pid: 101, sessionId: ID_A, name: 'No mailbox' },
    { pid: 102, sessionId: ID_B, name: 'Closed mailbox', messagingSocketPath: path.join(tempDir(t), 'gone.sock') },
  ]);
  const watcher = new ChatWatcher({ claudeDir, isAlive: alive(101, 102) });
  assert.deepEqual(await watcher.send(ID_C, 'hi', 'Max'), { ok: false, message: 'That chat is not open any more.' });
  assert.deepEqual(await watcher.send(ID_A, 'hi', 'Max'), { ok: false, message: 'That chat does not take messages from other programs.' });
  assert.deepEqual(await watcher.send(ID_B, 'hi', 'Max'), { ok: false, message: 'That chat closed before the message got there.' });
});

// ---- following a message after it is sent ----

const SAID = 'Message from Brennan in the shared workspace:\n\nadd a login page';
const queued = (content = SAID) => `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content })}\n`;
const turnWith = (content = SAID) => `${JSON.stringify({ type: 'user', message: { role: 'user', content: `Another Claude session sent a message:\n${content}\n\nThis came from another Claude session.` } })}\n`;
const reply = () => `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] } })}\n`;
const setChatStatus = (claudeDir, status) => {
  const file = path.join(claudeDir, 'sessions', '101.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), status }));
};

// An open chat with a working mailbox, a little earlier history, and a clock the test controls.
async function chatToMessage(t, { history = true } = {}) {
  const mailbox = await openMailbox(t);
  const claudeDir = claudeFolder(t, [{ pid: 101, sessionId: ID_A, name: 'Map site', messagingSocketPath: mailbox.address }]);
  const file = transcript(claudeDir, ID_A);
  if (history) fs.writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'earlier work' } })}\n`);
  const clock = { now: 1_000_000 };
  const open = new Set([101]);
  const watcher = new ChatWatcher({ claudeDir, isAlive: (pid) => open.has(pid), isWindows: false, now: () => clock.now });
  return { claudeDir, file, clock, open, watcher };
}
const progress = (watcher) => watcher.snapshot()[0]?.lastMessage?.state;

test('right after a message is sent the chat shows it as sent, without the words of the message', async (t) => {
  const { watcher, clock } = await chatToMessage(t);
  assert.equal(watcher.snapshot()[0].lastMessage, null);
  assert.equal((await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1')).ok, true);
  const [chat] = watcher.snapshot();
  assert.deepEqual(chat.lastMessage, { id: 'req-1', state: 'sent', sentAt: clock.now });
  assert.ok(!JSON.stringify(chat).includes('login page'), 'what you wrote is not reported');
});

test('a message is picked up once the chat has queued it in its own record', async (t) => {
  const { watcher, file } = await chatToMessage(t);
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  assert.equal(progress(watcher), 'sent');
  fs.appendFileSync(file, queued());
  assert.equal(progress(watcher), 'picked_up');
});

test('a message is also picked up when it only shows as a turn in the chat', async (t) => {
  const { watcher, file } = await chatToMessage(t);
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  fs.appendFileSync(file, turnWith());
  assert.equal(progress(watcher), 'picked_up');
});

test('a message is finished only after the chat started it, answered it, and went idle', async (t) => {
  const { watcher, file, claudeDir } = await chatToMessage(t);
  setChatStatus(claudeDir, 'busy');
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  fs.appendFileSync(file, queued());
  assert.equal(progress(watcher), 'picked_up');

  // An answer to older work, and an idle chat, do not finish a message the chat has not read yet.
  fs.appendFileSync(file, reply());
  setChatStatus(claudeDir, 'idle');
  assert.equal(progress(watcher), 'picked_up');

  // The chat reads it but has not answered yet.
  fs.appendFileSync(file, turnWith());
  assert.equal(progress(watcher), 'picked_up');

  // It answers while still working.
  setChatStatus(claudeDir, 'busy');
  fs.appendFileSync(file, reply());
  assert.equal(progress(watcher), 'picked_up');

  setChatStatus(claudeDir, 'idle');
  assert.equal(progress(watcher), 'finished');
  setChatStatus(claudeDir, 'busy');
  assert.equal(progress(watcher), 'finished', 'later, unrelated work does not undo it');
});

test('a message nobody picks up for two minutes is reported as waiting, and still counts if it arrives later', async (t) => {
  const { watcher, file, clock } = await chatToMessage(t);
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  clock.now += 119_000;
  assert.equal(progress(watcher), 'sent');
  clock.now += 2_000;
  assert.equal(progress(watcher), 'waiting');
  fs.appendFileSync(file, queued());
  assert.equal(progress(watcher), 'picked_up');
});

test('the same words already in the chat\'s history before sending do not count', async (t) => {
  const { watcher, file } = await chatToMessage(t);
  fs.appendFileSync(file, queued() + turnWith() + reply());
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  assert.equal(progress(watcher), 'sent');
});

test('sending a second message starts the progress over', async (t) => {
  const { watcher, file } = await chatToMessage(t);
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  fs.appendFileSync(file, queued());
  assert.equal(progress(watcher), 'picked_up');
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-2');
  assert.deepEqual(watcher.snapshot()[0].lastMessage.id, 'req-2');
  assert.equal(progress(watcher), 'sent');
});

test('a message that could not be sent leaves no progress behind', async (t) => {
  const claudeDir = claudeFolder(t, [{ pid: 101, sessionId: ID_A, name: 'Closed mailbox', messagingSocketPath: path.join(tempDir(t), 'gone.sock') }]);
  const watcher = new ChatWatcher({ claudeDir, isAlive: alive(101), isWindows: false });
  assert.equal((await watcher.send(ID_A, 'hi', 'Brennan', 'req-1')).ok, false);
  assert.equal(watcher.snapshot()[0].lastMessage, null);
});

test('progress is forgotten ten minutes after a message finishes, or half an hour after one nobody picked up', async (t) => {
  const done = await chatToMessage(t);
  await done.watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  fs.appendFileSync(done.file, turnWith() + reply());
  assert.equal(progress(done.watcher), 'finished');
  done.clock.now += 599_000;
  assert.equal(progress(done.watcher), 'finished');
  done.clock.now += 2_000;
  assert.equal(done.watcher.snapshot()[0].lastMessage, null);

  const ignored = await chatToMessage(t);
  await ignored.watcher.send(ID_A, 'add a login page', 'Brennan', 'req-2');
  ignored.clock.now += 1_801_000;
  assert.equal(ignored.watcher.snapshot()[0].lastMessage, null);
});

test('progress is forgotten when the chat closes', async (t) => {
  const { watcher, open } = await chatToMessage(t);
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  open.delete(101);
  assert.deepEqual(watcher.snapshot(), []);
  open.add(101);
  assert.equal(watcher.snapshot()[0].lastMessage, null);
});

test('a chat with no history file yet is noticed as soon as the file appears', async (t) => {
  const { watcher, file } = await chatToMessage(t, { history: false });
  watcher.snapshot();
  await watcher.send(ID_A, 'add a login page', 'Brennan', 'req-1');
  fs.writeFileSync(file, queued());
  assert.equal(progress(watcher), 'picked_up');
});
