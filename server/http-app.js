import fs from 'node:fs';
import path from 'node:path';

// Only these files are ever served, so nobody can ask for other files on the computer.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/render.js': ['render.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 8000;

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Message too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createApp({ timeline, runner, publicDir, userName = 'You' }) {
  function serveStatic(res, [file, type]) {
    try {
      const body = fs.readFileSync(path.join(publicDir, file));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      sendJson(res, 500, { error: 'A page file is missing' });
    }
  }

  // The live feed. A reconnecting browser sends Last-Event-ID, so it only gets what it missed.
  function serveEvents(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const lastSeen = Number(req.headers['last-event-id'] ?? 0) || 0;
    const write = (event) => res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    for (const event of timeline.all()) {
      if (event.id > lastSeen) write(event);
    }
    const unsubscribe = timeline.subscribe(write);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    ping.unref();
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  }

  async function handleSend(req, res, allowedOrigins) {
    // Stops other websites from sending messages to your Claude through your browser.
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return sendJson(res, 403, { error: 'Not allowed from that site' });
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Send JSON' });
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return error.status === 413
        ? sendJson(res, 413, { error: 'Message too large' })
        : sendJson(res, 400, { error: 'That was not valid JSON' });
    }

    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text || text.length > MAX_MESSAGE_CHARS) {
      return sendJson(res, 400, { error: `Write a message of 1 to ${MAX_MESSAGE_CHARS} characters` });
    }

    timeline.add({ kind: 'user', who: userName, text });
    runner.send(text, userName);
    return sendJson(res, 202, { ok: true });
  }

  return async function handle(req, res) {
    try {
      // Only answer requests addressed to this computer, which blocks "DNS rebinding" tricks.
      const port = req.socket.localPort;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
      if (!hosts.includes(req.headers.host)) return sendJson(res, 403, { error: 'Unknown host' });

      const { pathname } = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && STATIC_FILES[pathname]) return serveStatic(res, STATIC_FILES[pathname]);
      if (req.method === 'GET' && pathname === '/events') return serveEvents(req, res);
      if (req.method === 'POST' && pathname === '/send') {
        return await handleSend(req, res, hosts.map((host) => `http://${host}`));
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong' });
    }
  };
}
