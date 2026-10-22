import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/http-app.js';
import { Timeline } from '../server/timeline.js';
import { closeServer, listen, readEvents, tempDir } from './helpers.js';

// A running copy of the web server with a pretend runner that just records what it was sent.
async function start(t) {
  const publicDir = tempDir(t);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<title>Shared workspace</title>');
  const timeline = new Timeline();
  const sent = [];
  const runner = { send: (text, who) => sent.push({ text, who }) };
  const { server, port } = await listen(createApp({ timeline, runner, publicDir, userName: 'Brennan' }));
  t.after(() => closeServer(server));
  return { base: `http://127.0.0.1:${port}`, port, timeline, sent };
}

const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('serves the page', async (t) => {
  const { base } = await start(t);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Shared workspace/);
});

test('unknown addresses are not found, and other files on the computer cannot be asked for', async (t) => {
  const { base } = await start(t);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});

test('a sent message goes on the timeline and to Claude', async (t) => {
  const { base, timeline, sent } = await start(t);
  const res = await fetch(`${base}/send`, json({ text: '  make hello.txt  ' }));
  assert.equal(res.status, 202);
  assert.deepEqual(sent, [{ text: 'make hello.txt', who: 'Brennan' }]);
  assert.deepEqual(timeline.all().map((e) => [e.kind, e.who, e.text]), [['user', 'Brennan', 'make hello.txt']]);
});

test('rejects empty, oversized and non-JSON messages without bothering Claude', async (t) => {
  const { base, sent } = await start(t);
  assert.equal((await fetch(`${base}/send`, json({ text: '   ' }))).status, 400);
  assert.equal((await fetch(`${base}/send`, json({ text: 'x'.repeat(9000) }))).status, 400);
  assert.equal((await fetch(`${base}/send`, json({ nope: 1 }))).status, 400);
  assert.equal((await fetch(`${base}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status, 400);
  assert.equal((await fetch(`${base}/send`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' })).status, 415);
  assert.equal((await fetch(`${base}/send`, json({ text: 'y'.repeat(100_000) }))).status, 413);
  assert.deepEqual(sent, []);
});

test('blocks messages that come from another website', async (t) => {
  const { base, sent } = await start(t);
  const res = await fetch(`${base}/send`, { ...json({ text: 'hi' }), headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' } });
  assert.equal(res.status, 403);
  assert.deepEqual(sent, []);
});

test('blocks requests addressed to some other host name', async (t) => {
  const { port, sent } = await start(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/send', method: 'POST', headers: { host: 'evil.example.com', 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ text: 'hi' }));
  });
  assert.equal(status, 403);
  assert.deepEqual(sent, []);
});

test('the live feed replays what happened, then streams new events', async (t) => {
  const { base, timeline } = await start(t);
  timeline.add({ kind: 'user', text: 'one' });
  const reading = readEvents(`${base}/events`, (events) => events.length >= 2);
  await new Promise((resolve) => setTimeout(resolve, 50));
  timeline.add({ kind: 'claude-text', text: 'two' });
  const events = await reading;
  assert.deepEqual(events.map((e) => e.text), ['one', 'two']);
});

test('a reconnecting browser only gets what it missed', async (t) => {
  const { base, timeline } = await start(t);
  timeline.add({ kind: 'user', text: 'one' });
  timeline.add({ kind: 'user', text: 'two' });
  const events = await readEvents(`${base}/events`, (list) => list.length >= 1, { headers: { 'last-event-id': '1' } });
  assert.deepEqual(events.map((e) => e.text), ['two']);
});
