import crypto from 'node:crypto';

const MAX_CHATS = 50;
const ID = /^[0-9a-zA-Z-]{8,64}$/;
const WHERE = new Set(['desktop', 'terminal', 'other']);
const STATUS = new Set(['busy', 'idle', 'unknown']);
const MESSAGE_STATE = new Set(['sent', 'picked_up', 'finished', 'waiting']);

const key = (user) => String(user).toLowerCase();
const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const stamp = (value) => (Number.isFinite(value) ? value : null);

// How far the last message to a chat has got. Only the state, an id and a time: never the message itself.
const progress = (message) => {
  if (!message || typeof message !== 'object' || !MESSAGE_STATE.has(message.state)) return null;
  return { id: text(message.id, 40), state: message.state, sentAt: stamp(message.sentAt) };
};

// What each person's helper says is open on their own computer right now. Each list is private to its
// owner: nobody else's page ever shows it. It lives in memory only and is forgotten when the helper
// disconnects, so nothing about someone's other chats is ever written to disk here.
export class LiveChats {
  #byUser = new Map();
  #pending = new Map();
  #requestTimeoutMs;

  constructor({ requestTimeoutMs = 10_000 } = {}) {
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  // Keeps only the fields we expect, trimmed to sensible lengths, whatever the helper sent.
  set(user, chats) {
    if (!Array.isArray(chats)) throw new Error('Send a list of chats.');
    const clean = [];
    for (const chat of chats.slice(0, MAX_CHATS)) {
      if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string' || !ID.test(chat.id)) continue;
      clean.push({
        id: chat.id,
        name: text(chat.name, 120) || 'Untitled chat',
        folder: text(chat.folder, 120),
        where: WHERE.has(chat.where) ? chat.where : 'other',
        status: STATUS.has(chat.status) ? chat.status : 'unknown',
        doing: chat.doing ? text(chat.doing, 160) : null,
        canMessage: chat.canMessage === true,
        lastMessage: progress(chat.lastMessage),
        startedAt: stamp(chat.startedAt),
        updatedAt: stamp(chat.updatedAt),
      });
    }
    this.#byUser.set(key(user), clean);
  }

  list(user) {
    return this.#byUser.get(key(user)) ?? [];
  }

  // The person's helper went away: forget their chats, and give up on anything still waiting for it.
  clear(user) {
    this.#byUser.delete(key(user));
    for (const [id, request] of this.#pending) {
      if (request.user !== key(user)) continue;
      this.#pending.delete(id);
      clearTimeout(request.timer);
      request.resolve({ ok: false, message: 'Your helper went offline before it could pass that on.' });
    }
  }

  // Asks the person's own helper to drop a message into one of their own open chats.
  // `deliver(message)` hands a message to that helper and returns false when it is not connected.
  send({ user, chatId, text: message, deliver }) {
    const chat = this.list(user).find((candidate) => candidate.id === chatId);
    if (!chat) return Promise.resolve({ ok: false, message: 'That chat is not open any more.' });
    if (!chat.canMessage) return Promise.resolve({ ok: false, message: 'That chat does not take messages from other programs.' });

    const requestId = crypto.randomBytes(8).toString('hex');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        resolve({ ok: false, message: 'Your helper did not answer in time. It may be busy or off.' });
      }, this.#requestTimeoutMs);
      timer.unref?.();
      this.#pending.set(requestId, { user: key(user), resolve, timer });
      let delivered = false;
      try {
        delivered = deliver({ type: 'chat-message', requestId, chatId, text: message });
      } catch {
        delivered = false;
      }
      if (!delivered) {
        this.#pending.delete(requestId);
        clearTimeout(timer);
        resolve({ ok: false, message: "Your helper isn't running. Start it to reach your chats." });
      }
    });
  }

  // The helper reports how a message went. Only the helper the request was sent to can answer it.
  result(user, requestId, outcome) {
    const request = this.#pending.get(requestId);
    if (!request || request.user !== key(user)) return false;
    this.#pending.delete(requestId);
    clearTimeout(request.timer);
    request.resolve({ ok: outcome?.ok === true, message: text(outcome?.message, 300) || (outcome?.ok === true ? 'Sent.' : 'It did not go through.') });
    return true;
  }
}
