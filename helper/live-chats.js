import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

// Claude Code keeps one small file per open chat in its own folder (~/.claude/sessions): the chat's name, the
// folder it works in, whether it is busy or idle, and the address of a private mailbox that other programs
// on this computer can drop a message into. Reading those files lists every Claude chat open on this
// computer. The idea (and the mailbox message format) comes from Reason Network's engine, which is open
// source under the MIT and Apache licenses: https://github.com/reason-machines/reason-network

const SESSION_ID = /^[0-9a-zA-Z-]{8,64}$/;
const SESSION_FILE = /^\d+\.json$/;
const FIRST_READ_BYTES = 2 * 1024 * 1024;
const MAX_DOING_CHARS = 120;
const MAX_NAME_CHARS = 120;
const NOT_FOUND_RECHECK_MS = 30_000;
const WHERE = { 'claude-desktop': 'desktop', cli: 'terminal' };

export function defaultClaudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
}

// Is this program still running? ("Permission denied" still means it exists.)
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const oneLine = (value, max) => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const lastPart = (folder) => String(folder ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? '';

// Every open Claude chat on this computer, exactly as Claude Code wrote it down. These raw entries hold
// private addresses, so they stay on this computer and are never sent to the hub.
export function scanLiveChats({ claudeDir = defaultClaudeDir(), isAlive = pidAlive } = {}) {
  const dir = path.join(claudeDir, 'sessions');
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found = [];
  for (const file of files) {
    if (!SESSION_FILE.test(file)) continue;
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    if (!Number.isInteger(entry.pid) || !isAlive(entry.pid)) continue;
    if (typeof entry.sessionId !== 'string' || !SESSION_ID.test(entry.sessionId)) continue;
    if (entry.kind && entry.kind !== 'interactive') continue;
    found.push(entry);
  }
  return found;
}

// The part of a chat that is safe and useful to show on the workspace page.
export function describeChat(entry, doing = null) {
  const stamp = [entry.statusUpdatedAt, entry.updatedAt].find((value) => Number.isFinite(value)) ?? null;
  return {
    id: entry.sessionId,
    name: oneLine(entry.name, MAX_NAME_CHARS) || 'Untitled chat',
    folder: oneLine(lastPart(entry.cwd), MAX_NAME_CHARS),
    where: WHERE[entry.entrypoint] ?? 'other',
    status: entry.status === 'busy' || entry.status === 'idle' ? entry.status : 'unknown',
    doing,
    canMessage: typeof entry.messagingSocketPath === 'string' && entry.messagingSocketPath.length > 0,
    startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : null,
    updatedAt: stamp,
  };
}

// ---- what a chat is working on ----

const inProgress = (item) => ['in_progress', 'in-progress', 'active'].includes(item?.status);
const taskText = (item) => {
  for (const key of ['activeForm', 'content', 'step', 'description', 'subject', 'title']) {
    if (typeof item[key] === 'string' && item[key].trim()) return oneLine(item[key], MAX_DOING_CHARS);
  }
  return null;
};

// Finds the latest to-do list a chat wrote and returns what is in progress on it (or null).
// A list with nothing in progress means the chat is between tasks, so that clears the answer.
function visit(node, found, depth = 0) {
  if (depth > 12 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) visit(item, found, depth + 1);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (['todos', 'plan', 'items'].includes(key) && Array.isArray(value) && value.some((item) => item && typeof item === 'object' && 'status' in item)) {
      const current = value.find(inProgress);
      found.task = current ? taskText(current) : null;
    } else {
      visit(value, found, depth + 1);
    }
  }
}

// Reads a chat's own record of what happened (a file that only ever grows), and only what was added since
// the last look, so checking every few seconds stays cheap even for very long chats.
class TaskTail {
  #projectsDir;
  #now;
  #located = new Map();
  #missing = new Map();
  #state = new Map();

  constructor(projectsDir, now) {
    this.#projectsDir = projectsDir;
    this.#now = now;
  }

  #locate(sessionId) {
    const known = this.#located.get(sessionId);
    if (known && fs.existsSync(known)) return known;
    if (this.#now() - (this.#missing.get(sessionId) ?? -Infinity) < NOT_FOUND_RECHECK_MS) return null;
    const file = `${sessionId}.jsonl`;
    let folders = [];
    try {
      folders = fs.readdirSync(this.#projectsDir);
    } catch {
      // No chat history folder yet.
    }
    for (const folder of folders) {
      const candidate = path.join(this.#projectsDir, folder, file);
      if (fs.existsSync(candidate)) {
        this.#located.set(sessionId, candidate);
        this.#missing.delete(sessionId);
        return candidate;
      }
    }
    this.#missing.set(sessionId, this.#now());
    return null;
  }

  taskFor(sessionId) {
    const file = this.#locate(sessionId);
    if (!file) return null;
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return null;
    }
    let state = this.#state.get(file) ?? { offset: 0, task: null };
    if (size < state.offset) state = { offset: 0, task: null };
    if (size === state.offset) return state.task;

    const start = state.offset === 0 ? Math.max(0, size - FIRST_READ_BYTES) : state.offset;
    const buffer = Buffer.alloc(size - start);
    try {
      const fd = fs.openSync(file, 'r');
      try {
        fs.readSync(fd, buffer, 0, buffer.length, start);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return state.task;
    }
    // Only whole lines: a line still being written is read next time.
    const usable = buffer.lastIndexOf(0x0a) + 1;
    // When we start in the middle of a long file, the first line may be cut off. Skip it.
    let from = 0;
    if (state.offset === 0 && start > 0) {
      const firstBreak = buffer.indexOf(0x0a);
      from = firstBreak < 0 ? usable : firstBreak + 1;
    }
    const found = { task: state.task };
    for (const line of buffer.subarray(from, usable).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        visit(JSON.parse(line), found);
      } catch {
        // A line that is not JSON says nothing about tasks.
      }
    }
    state = { offset: start + usable, task: found.task };
    this.#state.set(file, state);
    return state.task;
  }
}

// ---- dropping a message into an open chat ----

// Claude Code on Windows leaves each chat's mailbox password in a small file next to the chat's own file.
function peerToken(sessionsDir, pid) {
  let files;
  try {
    files = fs.readdirSync(sessionsDir);
  } catch {
    return null;
  }
  for (const file of files) {
    if (!file.startsWith(`${pid}.`) || !file.endsWith('.key')) continue;
    try {
      const token = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8')).peerToken;
      if (typeof token === 'string' && token) return token;
    } catch {
      // Not readable. Try the next one.
    }
  }
  return null;
}

// Sends one line of "auth" (when the mailbox wants a password) and one line with the message. Claude Code
// puts the text into the chat between steps, or starts a turn if the chat is idle.
export function postToChat({ path: socketPath, token }, text, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A moment to let the last bytes leave before closing.
      setTimeout(() => socket.destroy(), 100).unref();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('The chat did not answer in time.'), { code: 'ETIMEDOUT' })), timeoutMs);
    socket.once('error', finish);
    socket.once('connect', () => {
      const lines = [];
      if (token) lines.push(JSON.stringify({ type: 'auth', token }));
      lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }));
      socket.end(`${lines.join('\n')}\n`, () => finish());
    });
  });
}

const NOT_THERE = new Set(['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ECONNRESET']);

// Watches this computer's open Claude chats. snapshot() is what the hub gets; send() drops a message in.
export class ChatWatcher {
  #claudeDir;
  #isAlive;
  #isWindows;
  #tail;

  constructor({
    claudeDir = defaultClaudeDir(),
    isAlive = pidAlive,
    isWindows = process.platform === 'win32',
    now = Date.now,
  } = {}) {
    this.#claudeDir = claudeDir;
    this.#isAlive = isAlive;
    this.#isWindows = isWindows;
    this.#tail = new TaskTail(path.join(claudeDir, 'projects'), now);
  }

  snapshot() {
    const chats = scanLiveChats({ claudeDir: this.#claudeDir, isAlive: this.#isAlive })
      .map((entry) => describeChat(entry, this.#tail.taskFor(entry.sessionId)));
    const rank = (chat) => (chat.status === 'busy' ? 0 : 1);
    return chats.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name));
  }

  // `who` is the person at the keyboard, so the chat can see where the message came from.
  async send(chatId, text, who) {
    const entry = scanLiveChats({ claudeDir: this.#claudeDir, isAlive: this.#isAlive }).find((candidate) => candidate.sessionId === chatId);
    if (!entry) return { ok: false, message: 'That chat is not open any more.' };
    if (typeof entry.messagingSocketPath !== 'string' || !entry.messagingSocketPath) {
      return { ok: false, message: 'That chat does not take messages from other programs.' };
    }
    const token = this.#isWindows ? peerToken(path.join(this.#claudeDir, 'sessions'), entry.pid) : null;
    const framed = `Message from ${who} in the shared workspace:\n\n${text}`;
    try {
      await postToChat({ path: entry.messagingSocketPath, token }, framed);
    } catch (error) {
      if (NOT_THERE.has(error.code)) return { ok: false, message: 'That chat closed before the message got there.' };
      return { ok: false, message: `Could not reach that chat (${error.code ?? error.message}).` };
    }
    return {
      ok: true,
      message: 'Sent. It appears in that chat as if you had typed it. If that chat skips permission prompts, Claude may hold the message until you approve it there.',
    };
  }
}
