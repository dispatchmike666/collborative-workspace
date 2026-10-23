import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const FAKE_CLAUDE = path.join(import.meta.dirname, 'fake-claude.js');

// A fresh empty folder that is deleted when the test ends.
// Windows won't delete a folder a program is still using, so we retry for a moment.
export function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

// Waits until check() returns something truthy, or fails the test after a timeout.
export async function waitFor(check, { timeoutMs = 8000, label = 'the condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

export async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

// Reads the live feed and returns the events it received, stopping once until(events) is true.
export async function readEvents(url, until, { headers = {} } = {}) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
  const res = await fetch(url, { headers, signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  try {
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const dataLine = part.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
      }
    }
  } finally {
    controller.abort();
  }
  return events;
}

// Opens a live stream (the browser feed or a helper's job feed) and keeps what arrives.
// Resolves once the server has answered, so you know the connection is up.
export async function openStream(url, { headers = {} } = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  const messages = [];
  if (res.ok && res.body) {
    (async () => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop();
          for (const part of parts) {
            const message = { event: 'message', id: null, data: null };
            for (const line of part.split('\n')) {
              if (line.startsWith('event: ')) message.event = line.slice(7);
              else if (line.startsWith('id: ')) message.id = Number(line.slice(4));
              else if (line.startsWith('data: ')) message.data = JSON.parse(line.slice(6));
            }
            if (message.data !== null) messages.push(message);
          }
        }
      } catch {
        // The stream was closed on purpose.
      }
    })();
  } else {
    await res.body?.cancel();
  }
  return {
    status: res.status,
    messages,
    close: () => controller.abort(),
    waitFor: (predicate, label = 'a stream message') => waitFor(() => messages.find(predicate), { label }),
  };
}
