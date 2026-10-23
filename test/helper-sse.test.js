import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { connectSse, createSseParser } from '../helper/sse-client.js';
import { closeServer, waitFor } from './helpers.js';

test('the parser rebuilds messages from pieces, names, ids, comments and CRLF', () => {
  const got = [];
  const parser = createSseParser((message) => got.push(message));
  parser.push('event: job\ndata: {"a"');
  parser.push(':1}\n\n: ping\n\nid: 7\ndata: one\ndata: two\n\n');
  parser.push('data: crlf\r\n\r\n');
  parser.push('event: half\ndata: not finished');
  assert.deepEqual(got, [
    { event: 'job', id: null, data: '{"a":1}' },
    { event: 'message', id: '7', data: 'one\ntwo' },
    { event: 'message', id: null, data: 'crlf' },
  ]);
});

// A tiny server that sends one message per connection and then hangs up.
function startServer(t, handler) {
  return new Promise((resolve) => {
    const state = { connections: 0, headers: [] };
    const server = http.createServer((req, res) => {
      state.connections += 1;
      state.headers.push(req.headers);
      handler(req, res, state);
    });
    server.listen(0, '127.0.0.1', () => {
      t.after(() => closeServer(server));
      resolve({ url: `http://127.0.0.1:${server.address().port}/stream`, state });
    });
  });
}

test('messages arrive, and a dropped connection is re-opened by itself', async (t) => {
  const { url, state } = await startServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`event: hello\ndata: {"n":${state.connections}}\n\n`);
    setTimeout(() => res.end(), 30);
  });
  const got = [];
  let opens = 0;
  const connection = connectSse({
    url,
    headers: { authorization: 'Bearer abc' },
    onMessage: (m) => got.push(m),
    onOpen: () => { opens += 1; },
    minDelayMs: 20,
    maxDelayMs: 50,
  });
  t.after(() => connection.stop());
  await waitFor(() => got.length >= 2, { label: 'two messages over two connections' });
  assert.deepEqual(got.slice(0, 2).map((m) => JSON.parse(m.data).n), [1, 2]);
  assert.ok(opens >= 2);
  assert.equal(state.headers[0].authorization, 'Bearer abc');
});

test('a refused token stops the retrying and says so', async (t) => {
  const { url, state } = await startServer(t, (req, res) => {
    res.writeHead(401);
    res.end();
  });
  let fatal = null;
  const connection = connectSse({ url, onMessage: () => {}, onFatal: (message) => { fatal = message; }, minDelayMs: 10 });
  t.after(() => connection.stop());
  await waitFor(() => fatal, { label: 'the refusal' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(fatal, /token/i);
  assert.equal(state.connections, 1);
});

test('a connection that goes silent is dropped and re-opened', async (t) => {
  const { url, state } = await startServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': hello\n\n');
  });
  const connection = connectSse({ url, onMessage: () => {}, staleMs: 150, checkMs: 30, minDelayMs: 20 });
  t.after(() => connection.stop());
  await waitFor(() => state.connections >= 2, { label: 'a second connection' });
});

test('stopping ends the connection for good', async (t) => {
  const { url, state } = await startServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {}\n\n');
  });
  const got = [];
  const connection = connectSse({ url, onMessage: (m) => got.push(m), minDelayMs: 10 });
  await waitFor(() => got.length >= 1, { label: 'the first message' });
  connection.stop();
  const count = state.connections;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(state.connections, count);
});
