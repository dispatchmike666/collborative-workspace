import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-util.js';

const NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_-]{1,19}$/;
// No look-alike characters (0/O, 1/l/I) so a password is easy to read off a screen.
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomPassword(length = 16) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const DUMMY_HASH = hashPassword('not-a-real-password');

// The people allowed in. Only scrambled copies of passwords and helper tokens are stored.
export class UserStore {
  #file;

  constructor(file) {
    this.#file = file;
  }

  #load() {
    return readJson(this.#file, { users: [] });
  }

  #save(data) {
    writeJsonAtomic(this.#file, data, 0o600);
  }

  #require(data, name) {
    const user = data.users.find((u) => u.id === String(name).toLowerCase());
    if (!user) throw new Error(`No such user: ${name}`);
    return user;
  }

  listNames() {
    return this.#load().users.map((user) => user.name);
  }

  find(name) {
    const id = String(name).toLowerCase();
    return this.#load().users.find((user) => user.id === id) ?? null;
  }

  addUser(name) {
    if (!NAME_SHAPE.test(name)) {
      throw new Error('Names must be 2 to 20 letters, numbers, - or _, starting with a letter');
    }
    const data = this.#load();
    const id = name.toLowerCase();
    if (data.users.some((user) => user.id === id)) throw new Error(`${name} already exists`);
    const password = randomPassword();
    const helperToken = crypto.randomBytes(32).toString('base64url');
    data.users.push({ id, name, passwordHash: hashPassword(password), helperTokenHash: sha256(helperToken) });
    this.#save(data);
    return { name, password, helperToken };
  }

  resetPassword(name) {
    const data = this.#load();
    const user = this.#require(data, name);
    const password = randomPassword();
    user.passwordHash = hashPassword(password);
    this.#save(data);
    return password;
  }

  newHelperToken(name) {
    const data = this.#load();
    const user = this.#require(data, name);
    const helperToken = crypto.randomBytes(32).toString('base64url');
    user.helperTokenHash = sha256(helperToken);
    this.#save(data);
    return helperToken;
  }

  // Returns { id, name } for a correct name and password, otherwise null.
  verifyPassword(name, password) {
    const user = this.find(name);
    // Do the same amount of work whether or not the name exists, so timing gives nothing away.
    const ok = checkPassword(String(password), user?.passwordHash ?? DUMMY_HASH);
    return user && ok ? { id: user.id, name: user.name } : null;
  }

  // Returns { id, name } for a correct helper token, otherwise null.
  verifyHelperToken(token) {
    const presented = Buffer.from(sha256(String(token)), 'hex');
    let match = null;
    for (const user of this.#load().users) {
      if (crypto.timingSafeEqual(presented, Buffer.from(user.helperTokenHash, 'hex'))) {
        match = { id: user.id, name: user.name };
      }
    }
    return match;
  }
}

// The secret that signs login cookies. Created on first start, kept in a private file.
export function loadOrCreateSecret(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// Login cookies: "<who and expiry>.<signature>". Nobody can change them without the secret.
export function createSessions(secret, { ttlMs = 7 * 24 * 60 * 60 * 1000, now = Date.now } = {}) {
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return {
    ttlSeconds: Math.floor(ttlMs / 1000),
    issue(userId) {
      const payload = Buffer.from(JSON.stringify({ u: userId, e: now() + ttlMs })).toString('base64url');
      return `${payload}.${sign(payload)}`;
    },
    // Returns the user id, or null if the cookie is missing, forged or expired.
    verify(value) {
      if (typeof value !== 'string') return null;
      const [payload, signature] = value.split('.');
      if (!payload || !signature) return null;
      const expected = Buffer.from(sign(payload), 'hex');
      const given = Buffer.from(signature, 'hex');
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
      try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data.e > now() ? data.u : null;
      } catch {
        return null;
      }
    },
  };
}

// Blocks guessing: after `max` wrong tries inside the time window, further tries are refused.
export class LoginThrottle {
  #failures = new Map();
  #max;
  #windowMs;
  #now;

  constructor({ max = 5, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  #recent(key) {
    const cutoff = this.#now() - this.#windowMs;
    const recent = (this.#failures.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length) this.#failures.set(key, recent);
    else this.#failures.delete(key);
    return recent;
  }

  isBlocked(key) {
    return this.#recent(key).length >= this.#max;
  }

  recordFailure(key) {
    const recent = this.#recent(key);
    recent.push(this.#now());
    this.#failures.set(key, recent);
  }

  recordSuccess(key) {
    this.#failures.delete(key);
  }
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[key] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}
