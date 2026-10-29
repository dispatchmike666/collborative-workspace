import { COLUMNS } from './board.js';
import { HttpError, readJsonBody, sendJson } from './http-util.js';
import { isSafeRelativePath } from './paths.js';

const REACTIONS = ['👍', '🎉', '😂', '🔥', '👀', '❤️'];
const REACTABLE_KINDS = new Set(['user', 'claude-text', 'team-chat', 'run-done']);
const TYPING_GAP_MS = 1500;

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// What Claude is told when a person gives it a card from the board.
function cardRequest(card) {
  const parts = [`Please work on this card from our board: "${card.title}".`];
  if (card.detail) parts.push(`Details: ${card.detail}`);
  parts.push('When you are done, tell me what you changed.');
  return parts.join('\n\n');
}

// The routes for the extra workspaces: board, brief and decisions, quick prompts, reactions,
// typing, readable files and the home page numbers. Returns true when it handled the request.
export function createWorkspaceRoutes({ store, dispatcher }) {
  const lastTyping = new Map();

  function requireProject(id) {
    if (!store.getProject(id)) throw new HttpError(404, 'No such project.');
  }

  // ---- home page ----
  function handlePulse(res, user) {
    return sendJson(res, 200, { ...store.activity(), me: user.name });
  }

  // ---- quick prompts ----
  async function handlePrompts(req, res, method, user) {
    if (method === 'GET') return sendJson(res, 200, store.prompts().list());
    if (method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 201, store.prompts().add({ title: body.title, text: body.text, emoji: body.emoji, by: user.name }));
    }
    return false;
  }

  // ---- board ----
  async function handleBoard(req, res, method, projectId, rest, user) {
    const board = store.board(projectId);
    const announce = (action, card) => store.addEvent(projectId, {
      kind: 'board-card', who: user.name, action, title: card.title, column: card.column,
    });

    if (rest === '' && method === 'GET') return sendJson(res, 200, { cards: board.list(), columns: COLUMNS });

    if (rest === 'cards' && method === 'POST') {
      const body = await readJsonBody(req);
      const card = board.add({ title: body.title, detail: body.detail, column: body.column, by: user.name });
      announce('added', card);
      store.boardChanged(projectId);
      return sendJson(res, 201, card);
    }

    const cardRoute = /^cards\/([0-9a-f]+)(?:\/(start))?$/.exec(rest);
    if (!cardRoute) return false;
    const [, cardId, action] = cardRoute;

    if (!action && method === 'PATCH') {
      const body = await readJsonBody(req);
      const before = board.list().find((card) => card.id === cardId);
      const patch = {};
      for (const key of ['title', 'detail', 'column']) if (key in body) patch[key] = body[key];
      if (Number.isInteger(body.position)) patch.position = body.position;
      const card = board.update(cardId, patch);
      if (before && before.column !== card.column) announce('moved', card);
      store.boardChanged(projectId);
      return sendJson(res, 200, card);
    }

    if (!action && method === 'DELETE') {
      const card = board.list().find((candidate) => candidate.id === cardId);
      board.remove(cardId);
      announce('removed', card);
      store.boardChanged(projectId);
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'start' && method === 'POST') {
      const card = board.update(cardId, { column: 'doing', assignee: user.name });
      announce('started', card);
      store.boardChanged(projectId);
      dispatcher.submit({ projectId, user: user.name, text: cardRequest(card), cardId });
      return sendJson(res, 202, card);
    }
    return false;
  }

  // ---- brief, decisions, notes sharing ----
  async function handleKnowledge(req, res, method, projectId, rest, user) {
    const knowledge = store.knowledge(projectId);

    if (rest === '' && method === 'GET') return sendJson(res, 200, knowledge.get());

    if (rest === 'brief' && method === 'PUT') {
      const body = await readJsonBody(req);
      if (!Number.isInteger(body.baseVersion)) throw new HttpError(400, 'Say which version of the brief you started from.');
      const result = knowledge.saveBrief({ text: body.text, baseVersion: body.baseVersion, user: user.name });
      if (!result.ok) return sendJson(res, 409, { error: 'Someone saved a newer brief. Read it, then save again.', brief: result.brief });
      store.addEvent(projectId, { kind: 'brief-saved', who: user.name, version: result.brief.version });
      store.knowledgeChanged(projectId);
      return sendJson(res, 200, { ok: true, brief: result.brief });
    }

    if (rest === 'share-notes' && method === 'PUT') {
      const body = await readJsonBody(req);
      knowledge.setShareNotes(body.value);
      store.knowledgeChanged(projectId);
      return sendJson(res, 200, { ok: true });
    }

    if (rest === 'decisions' && method === 'POST') {
      const body = await readJsonBody(req);
      const decision = knowledge.addDecision({ text: body.text, by: user.name });
      store.addEvent(projectId, { kind: 'decision-added', who: user.name, text: decision.text });
      store.knowledgeChanged(projectId);
      return sendJson(res, 201, decision);
    }

    const decisionRoute = /^decisions\/([0-9a-f]+)$/.exec(rest);
    if (decisionRoute && method === 'DELETE') {
      knowledge.removeDecision(decisionRoute[1], user.name);
      store.knowledgeChanged(projectId);
      return sendJson(res, 200, { ok: true });
    }
    return false;
  }

  // ---- reactions and typing ----
  async function handleReact(req, res, projectId, user) {
    const body = await readJsonBody(req);
    if (!REACTIONS.includes(body.emoji)) throw new HttpError(400, `Pick one of these reactions: ${REACTIONS.join(' ')}`);
    const events = store.events(projectId);
    const target = events.find((event) => event.id === body.eventId);
    if (!target) throw new HttpError(404, 'That message is no longer there.');
    if (!REACTABLE_KINDS.has(target.kind)) throw new HttpError(400, 'You can only react to messages.');
    const mine = events.filter((event) => event.kind === 'reaction' && event.target === target.id && event.emoji === body.emoji && sameName(event.who, user.name));
    const on = mine.length ? !mine.at(-1).on : true;
    store.addEvent(projectId, { kind: 'reaction', target: target.id, emoji: body.emoji, who: user.name, on });
    return sendJson(res, 200, { ok: true, on });
  }

  function handleTyping(res, projectId, user) {
    const key = `${projectId}|${user.id}`;
    const now = Date.now();
    if (now - (lastTyping.get(key) ?? 0) >= TYPING_GAP_MS) {
      lastTyping.set(key, now);
      store.broadcast(projectId, { kind: 'typing', who: user.name });
    }
    return sendJson(res, 200, { ok: true });
  }

  // ---- reading a file ----
  function handleSource(req, res, projectId) {
    const wanted = new URL(req.url, 'http://hub.invalid').searchParams.get('path');
    if (!wanted) throw new HttpError(400, 'Say which file to read.');
    const file = isSafeRelativePath(wanted) ? store.sources(projectId).get(wanted) : null;
    if (!file) throw new HttpError(404, 'That file is too big, hidden, or not text, so it cannot be shown here.');
    return sendJson(res, 200, file);
  }

  return async function handle({ req, res, pathname, method, user }) {
    if (pathname === '/api/pulse' && method === 'GET') {
      handlePulse(res, user);
      return true;
    }
    if (pathname === '/api/prompts') return (await handlePrompts(req, res, method, user)) !== false;
    const promptRoute = /^\/api\/prompts\/([0-9a-f]+)$/.exec(pathname);
    if (promptRoute && method === 'DELETE') {
      store.prompts().remove(promptRoute[1]);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const route = /^\/api\/projects\/([a-z0-9-]+)\/(board|knowledge|react|typing|source)(?:\/(.*))?$/.exec(pathname);
    if (!route) return false;
    const [, projectId, area, rest = ''] = route;
    requireProject(projectId);

    if (area === 'board') return (await handleBoard(req, res, method, projectId, rest, user)) !== false;
    if (area === 'knowledge') return (await handleKnowledge(req, res, method, projectId, rest, user)) !== false;
    if (area === 'react' && method === 'POST' && !rest) {
      await handleReact(req, res, projectId, user);
      return true;
    }
    if (area === 'typing' && method === 'POST' && !rest) {
      handleTyping(res, projectId, user);
      return true;
    }
    if (area === 'source' && method === 'GET' && !rest) {
      handleSource(req, res, projectId);
      return true;
    }
    return false;
  };
}
