import fs from 'node:fs';
import path from 'node:path';
import { parseCookies } from './auth.js';
import { HttpError, MAX_HELPER_BODY_BYTES, checkMessageText, errorStatus, readJsonBody, sendJson } from './http-util.js';
import { createWorkspaceRoutes } from './routes-workspace.js';

const COOKIE_NAME = 'ws_session';
const MAX_HELPER_EVENTS = 200;

// Page scripts, styles and pictures: plain file names only, taken from the pages folder.
const ASSET = /^\/assets\/([a-z0-9][a-z0-9._-]*\.(js|css|svg|jpg|png|webp))$/;
const ASSET_TYPES = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const PICTURE_EXTENSIONS = new Set(['svg', 'jpg', 'png', 'webp']);

const PAGE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

function redirect(res, location) {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
}

// The hub: pages, login, project API, live streams, and the endpoints helpers call.
export function createHubApp({
  store,
  dispatcher,
  users,
  sessions,
  previewTokens,
  throttle,
  publicDir,
  publicHosts = [],
  secureCookies = false,
  trustProxy = false,
}) {
  const workspace = createWorkspaceRoutes({ store, dispatcher });

  function sessionUser(req) {
    const id = sessions.verify(parseCookies(req.headers.cookie)[COOKIE_NAME]);
    if (!id) return null;
    const record = users.find(id);
    return record ? { id: record.id, name: record.name } : null;
  }

  function requireUser(req) {
    const user = sessionUser(req);
    if (!user) throw new HttpError(401, 'Please log in.');
    return user;
  }

  function helperUser(req) {
    const match = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''));
    const user = match ? users.verifyHelperToken(match[1]) : null;
    if (!user) throw new HttpError(401, 'That helper token is not valid.');
    return user;
  }

  function requireProject(id) {
    const project = store.getProject(id);
    if (!project) throw new HttpError(404, 'No such project.');
    return project;
  }

  function sendFile(res, file, type, extra = {}) {
    try {
      const body = fs.readFileSync(path.join(publicDir, file));
      res.writeHead(200, { 'content-type': type, ...PAGE_HEADERS, ...extra });
      res.end(body);
    } catch {
      sendJson(res, 500, { error: 'A page file is missing.' });
    }
  }

  function sendAsset(res, name, extension) {
    if (!fs.existsSync(path.join(publicDir, name))) return sendJson(res, 404, { error: 'Not found.' });
    // Pictures never change under the same name, so the browser may keep them for a while.
    return sendFile(res, name, ASSET_TYPES[extension], PICTURE_EXTENSIONS.has(extension) ? { 'cache-control': 'public, max-age=3600' } : {});
  }

  function startStream(res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    // Send the headers now so the other end knows it is connected before anything happens.
    res.flushHeaders();
  }

  function previewInfo(projectId) {
    return {
      previewVersion: store.getPreviewVersion(projectId),
      previewUrl: `/preview/${projectId}/${previewTokens.issue(`preview:${projectId}`)}/`,
    };
  }

  function clientIp(req) {
    if (trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress ?? 'unknown';
  }

  // ---- login ----

  async function handleLogin(req, res) {
    const body = await readJsonBody(req);
    const name = String(body.name ?? '');
    const key = `${clientIp(req)}|${name.toLowerCase()}`;
    if (throttle.isBlocked(key)) {
      return sendJson(res, 429, { error: 'Too many wrong tries. Wait a few minutes and try again.' });
    }
    const user = users.verifyPassword(name, body.password);
    if (!user) {
      throttle.recordFailure(key);
      return sendJson(res, 401, { error: 'Wrong name or password.' });
    }
    throttle.recordSuccess(key);
    const secure = secureCookies || req.headers['x-forwarded-proto'] === 'https';
    const cookie = [
      `${COOKIE_NAME}=${sessions.issue(user.id)}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      `Max-Age=${sessions.ttlSeconds}`,
      ...(secure ? ['Secure'] : []),
    ].join('; ');
    return sendJson(res, 200, { name: user.name }, { 'set-cookie': cookie });
  }

  function handleLogout(req, res) {
    const secure = secureCookies || req.headers['x-forwarded-proto'] === 'https';
    const cookie = `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
    return sendJson(res, 200, { ok: true }, { 'set-cookie': cookie });
  }

  // ---- projects ----

  async function handleCreateProject(req, res, user) {
    const body = await readJsonBody(req);
    let project;
    try {
      project = store.createProject({ name: body.name, repoUrl: body.repoUrl, createdBy: user.name });
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    return sendJson(res, 201, project);
  }

  function handleProjectDetails(res, projectId) {
    const project = requireProject(projectId);
    return sendJson(res, 200, {
      project,
      files: store.getFiles(projectId),
      notes: store.getNotes(projectId),
      presence: dispatcher.presence(),
      ...previewInfo(projectId),
    });
  }

  function handleProjectStream(req, res, projectId) {
    requireProject(projectId);
    startStream(res);
    const lastSeen = Number(req.headers['last-event-id'] ?? 0) || 0;
    const write = (event) => res.write(`${event.id ? `id: ${event.id}\n` : ''}data: ${JSON.stringify(event)}\n\n`);
    for (const event of store.events(projectId, lastSeen)) write(event);
    write({ kind: 'presence', online: dispatcher.presence() });
    write({ kind: 'files', ...store.getFiles(projectId) });
    write({ kind: 'preview', version: store.getPreviewVersion(projectId) });
    write({ kind: 'board', cards: store.board(projectId).list() });
    write({ kind: 'knowledge', ...store.knowledge(projectId).get() });
    write({ kind: 'sources', paths: store.sources(projectId).paths() });
    const unsubscribe = store.subscribe(projectId, write);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    ping.unref();
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  }

  async function handleSend(req, res, projectId, user) {
    requireProject(projectId);
    const body = await readJsonBody(req);
    const text = checkMessageText(body.text);
    const to = body.to ?? 'ai';
    if (to === 'ai') {
      dispatcher.submit({ projectId, user: user.name, text });
    } else {
      const target = users.listNames().find((name) => name.toLowerCase() === String(to).toLowerCase());
      if (!target || target.toLowerCase() === user.id) throw new HttpError(400, 'Pick another person to message.');
      store.addEvent(projectId, { kind: 'team-chat', who: user.name, to: target, text });
    }
    return sendJson(res, 202, { ok: true });
  }

  async function handleSaveNotes(req, res, projectId, user) {
    requireProject(projectId);
    const body = await readJsonBody(req);
    if (!Number.isInteger(body.baseVersion)) throw new HttpError(400, 'Say which version of the notes you started from.');
    let result;
    try {
      result = store.saveNotes(projectId, { text: body.text, baseVersion: body.baseVersion, user: user.name });
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    if (!result.ok) {
      return sendJson(res, 409, { error: 'Someone saved newer notes. Read them, then save again.', notes: result.notes });
    }
    store.addEvent(projectId, { kind: 'notes-saved', who: user.name, version: result.notes.version });
    return sendJson(res, 200, { ok: true, notes: result.notes });
  }

  async function handleApprove(req, res, projectId, user) {
    requireProject(projectId);
    const body = await readJsonBody(req);
    dispatcher.approve({ projectId, user: user.name, approvalId: String(body.approvalId ?? '') });
    return sendJson(res, 202, { ok: true });
  }

  // ---- previews ----

  function servePreview(res, projectId, token, rest) {
    if (previewTokens.verify(token) !== `preview:${projectId}` || !store.getProject(projectId)) {
      return sendJson(res, 403, { error: 'This preview link is not valid.' });
    }
    const file = store.getPreviewFile(projectId, rest || '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end('Nothing here in the preview.');
    }
    // "sandbox" cuts the previewed page off from this site and its login.
    res.writeHead(200, {
      'content-type': file.type,
      'content-security-policy': 'sandbox allow-scripts',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    });
    return res.end(file.body);
  }

  // ---- helpers ----

  function handleHelperConnect(req, res, user) {
    startStream(res);
    const write = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    write('hello', { user: user.name });
    const unregister = dispatcher.registerHelper(user.name, (message) => write(message.type, message));
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    ping.unref();
    req.on('close', () => {
      clearInterval(ping);
      unregister();
    });
  }

  async function handleHelperEvents(req, res, user) {
    const body = await readJsonBody(req, MAX_HELPER_BODY_BYTES);
    if (!Array.isArray(body.events) || body.events.length > MAX_HELPER_EVENTS) throw new HttpError(400, 'Send a list of events.');
    dispatcher.helperEvents(user.name, String(body.jobId ?? ''), body.events);
    return sendJson(res, 200, { ok: true });
  }

  async function handleHelperDone(req, res, user) {
    const body = await readJsonBody(req);
    dispatcher.helperDone(user.name, String(body.jobId ?? ''));
    return sendJson(res, 200, { ok: true });
  }

  async function handleHelperFiles(req, res) {
    const body = await readJsonBody(req);
    const projectId = String(body.projectId ?? '');
    requireProject(projectId);
    const snapshot = store.setFiles(projectId, { files: body.files, changed: body.changed });
    store.broadcast(projectId, { kind: 'files', ...snapshot });
    return sendJson(res, 200, { ok: true });
  }

  async function handleHelperPreview(req, res) {
    const body = await readJsonBody(req, MAX_HELPER_BODY_BYTES);
    const projectId = String(body.projectId ?? '');
    requireProject(projectId);
    let info;
    try {
      info = store.setPreview(projectId, body.files);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    store.broadcast(projectId, { kind: 'preview', version: info.version });
    return sendJson(res, 200, { ok: true, ...info });
  }

  async function handleHelperSources(req, res) {
    const body = await readJsonBody(req, MAX_HELPER_BODY_BYTES);
    const projectId = String(body.projectId ?? '');
    requireProject(projectId);
    let info;
    try {
      info = store.sources(projectId).set(body.files);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    store.broadcast(projectId, { kind: 'sources', paths: store.sources(projectId).paths() });
    return sendJson(res, 200, { ok: true, ...info });
  }

  // ---- routing ----

  return async function handle(req, res) {
    try {
      // Only answer requests addressed to this hub, which blocks "DNS rebinding" tricks.
      const port = req.socket.localPort;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ...publicHosts];
      if (!hosts.includes(req.headers.host)) return sendJson(res, 403, { error: 'Unknown host.' });
      const origins = hosts.flatMap((host) => [`http://${host}`, `https://${host}`]);

      const { pathname } = new URL(req.url, 'http://hub.invalid');
      const method = req.method;

      // Pages
      if (method === 'GET' && pathname === '/login') {
        return sessionUser(req) ? redirect(res, '/') : sendFile(res, 'login.html', 'text/html; charset=utf-8');
      }
      if (method === 'GET' && pathname === '/') {
        return sessionUser(req) ? sendFile(res, 'app.html', 'text/html; charset=utf-8') : redirect(res, '/login');
      }
      const asset = ASSET.exec(pathname);
      if (method === 'GET' && asset) return sendAsset(res, asset[1], asset[2]);

      // Previews (the link itself carries a signed token, because the sandboxed page cannot send cookies)
      const preview = /^\/preview\/([a-z0-9-]+)\/([^/]+)(\/.*)?$/.exec(pathname);
      if (method === 'GET' && preview) return servePreview(res, preview[1], preview[2], preview[3]);

      // Helpers (their own token, no cookies)
      if (pathname.startsWith('/helper/')) {
        const user = helperUser(req);
        if (method === 'GET' && pathname === '/helper/connect') return handleHelperConnect(req, res, user);
        if (method === 'POST' && pathname === '/helper/events') return await handleHelperEvents(req, res, user);
        if (method === 'POST' && pathname === '/helper/done') return await handleHelperDone(req, res, user);
        if (method === 'POST' && pathname === '/helper/files') return await handleHelperFiles(req, res);
        if (method === 'POST' && pathname === '/helper/preview') return await handleHelperPreview(req, res);
        if (method === 'POST' && pathname === '/helper/sources') return await handleHelperSources(req, res);
        return sendJson(res, 404, { error: 'Not found.' });
      }

      // Browser API. Anything that changes something must come from this site.
      if (pathname.startsWith('/api/')) {
        if (method !== 'GET') {
          const origin = req.headers.origin;
          if (origin && !origins.includes(origin)) throw new HttpError(403, 'Not allowed from that site.');
        }
        if (method === 'POST' && pathname === '/api/login') return await handleLogin(req, res);

        const user = requireUser(req);
        if (method === 'POST' && pathname === '/api/logout') return handleLogout(req, res);
        if (method === 'GET' && pathname === '/api/me') {
          return sendJson(res, 200, { name: user.name, users: users.listNames(), presence: dispatcher.presence() });
        }
        if (pathname === '/api/projects') {
          if (method === 'GET') return sendJson(res, 200, store.listProjects());
          if (method === 'POST') return await handleCreateProject(req, res, user);
        }
        if (await workspace({ req, res, pathname, method, user })) return undefined;
        const route = /^\/api\/projects\/([a-z0-9-]+)(?:\/(stream|send|notes|approve))?$/.exec(pathname);
        if (route) {
          const [, projectId, action] = route;
          if (!action && method === 'GET') return handleProjectDetails(res, projectId);
          if (action === 'stream' && method === 'GET') return handleProjectStream(req, res, projectId);
          if (action === 'send' && method === 'POST') return await handleSend(req, res, projectId, user);
          if (action === 'notes' && method === 'GET') {
            requireProject(projectId);
            return sendJson(res, 200, store.getNotes(projectId));
          }
          if (action === 'notes' && method === 'PUT') return await handleSaveNotes(req, res, projectId, user);
          if (action === 'approve' && method === 'POST') return await handleApprove(req, res, projectId, user);
        }
      }
      return sendJson(res, 404, { error: 'Not found.' });
    } catch (error) {
      if (res.headersSent) return undefined;
      return sendJson(res, errorStatus(error), { error: error.message });
    }
  };
}
