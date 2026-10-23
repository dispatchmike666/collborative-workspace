import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { LoginThrottle, UserStore, createSessions, loadOrCreateSecret, parseCookies } from '../hub/auth.js';
import { tempDir } from './helpers.js';

function makeStore(t) {
  const dir = tempDir(t);
  const file = path.join(dir, 'users.json');
  return { store: new UserStore(file), file, dir };
}

test('adding a user returns a password and a helper token, and stores only scrambled copies', (t) => {
  const { store, file } = makeStore(t);
  const created = store.addUser('Brennan');
  assert.equal(created.name, 'Brennan');
  assert.ok(created.password.length >= 16);
  assert.ok(created.helperToken.length >= 32);
  const saved = fs.readFileSync(file, 'utf8');
  assert.ok(!saved.includes(created.password));
  assert.ok(!saved.includes(created.helperToken));
  assert.deepEqual(store.listNames(), ['Brennan']);
});

test('only the right name and password get in, and names are not case sensitive', (t) => {
  const { store } = makeStore(t);
  const { password } = store.addUser('Max');
  assert.deepEqual(store.verifyPassword('max', password), { id: 'max', name: 'Max' });
  assert.equal(store.verifyPassword('Max', 'wrong-password'), null);
  assert.equal(store.verifyPassword('Nobody', password), null);
  assert.equal(store.verifyPassword('Max', ''), null);
});

test('only the right helper token identifies a helper', (t) => {
  const { store } = makeStore(t);
  const brennan = store.addUser('Brennan');
  const max = store.addUser('Max');
  assert.deepEqual(store.verifyHelperToken(brennan.helperToken), { id: 'brennan', name: 'Brennan' });
  assert.deepEqual(store.verifyHelperToken(max.helperToken), { id: 'max', name: 'Max' });
  assert.equal(store.verifyHelperToken('not-a-token'), null);
  assert.equal(store.verifyHelperToken(''), null);
});

test('duplicate and badly shaped names are refused', (t) => {
  const { store } = makeStore(t);
  store.addUser('Max');
  assert.throws(() => store.addUser('max'), /already exists/);
  assert.throws(() => store.addUser('a'), /Names must be/);
  assert.throws(() => store.addUser('has space'), /Names must be/);
  assert.throws(() => store.addUser('../etc'), /Names must be/);
});

test('resetting a password or token makes the old one stop working', (t) => {
  const { store } = makeStore(t);
  const first = store.addUser('Max');
  const newPassword = store.resetPassword('Max');
  assert.equal(store.verifyPassword('Max', first.password), null);
  assert.ok(store.verifyPassword('Max', newPassword));
  const newToken = store.newHelperToken('Max');
  assert.equal(store.verifyHelperToken(first.helperToken), null);
  assert.ok(store.verifyHelperToken(newToken));
  assert.throws(() => store.resetPassword('Nobody'), /No such user/);
});

test('a session cookie proves who you are until it expires or is tampered with', () => {
  let clock = 1_000_000;
  const sessions = createSessions('test-secret', { ttlMs: 1000, now: () => clock });
  const cookie = sessions.issue('max');
  assert.equal(sessions.verify(cookie), 'max');

  const [payload, signature] = cookie.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'brennan', e: clock + 1000 })).toString('base64url');
  assert.equal(sessions.verify(`${forged}.${signature}`), null);
  assert.equal(sessions.verify(`${payload}.${'0'.repeat(signature.length)}`), null);
  assert.equal(sessions.verify('garbage'), null);
  assert.equal(sessions.verify(undefined), null);
  assert.equal(createSessions('other-secret', { now: () => clock }).verify(cookie), null);

  clock += 1001;
  assert.equal(sessions.verify(cookie), null);
});

test('the signing secret is created once and then reused', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'secret.key');
  const first = loadOrCreateSecret(file);
  assert.ok(first.length >= 32);
  assert.equal(loadOrCreateSecret(file), first);
});

test('too many wrong passwords in a row block further tries for a while', () => {
  let clock = 0;
  const throttle = new LoginThrottle({ max: 3, windowMs: 1000, now: () => clock });
  assert.equal(throttle.isBlocked('ip|max'), false);
  throttle.recordFailure('ip|max');
  throttle.recordFailure('ip|max');
  assert.equal(throttle.isBlocked('ip|max'), false);
  throttle.recordFailure('ip|max');
  assert.equal(throttle.isBlocked('ip|max'), true);
  assert.equal(throttle.isBlocked('ip|brennan'), false);
  clock += 1001;
  assert.equal(throttle.isBlocked('ip|max'), false);
});

test('a good login clears the failure count', () => {
  const throttle = new LoginThrottle({ max: 2, windowMs: 1000, now: () => 0 });
  throttle.recordFailure('k');
  throttle.recordSuccess('k');
  throttle.recordFailure('k');
  assert.equal(throttle.isBlocked('k'), false);
});

test('cookies are read from the header', () => {
  assert.deepEqual(parseCookies('a=1; ws_session=abc.def; b=hello%20there'), { a: '1', ws_session: 'abc.def', b: 'hello there' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});
