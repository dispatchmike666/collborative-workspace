export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_HELPER_BODY_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 8000;

// An error that carries the web status to answer with (404 not found, 403 not allowed, ...).
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

// Reads a JSON request body. Refuses anything that is not JSON, too big, or not an object.
export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'That is too large to send.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || typeof value !== 'object') throw new Error('not an object');
    return value;
  } catch {
    throw new HttpError(400, 'That was not valid JSON.');
  }
}

export function checkMessageText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, `Write a message of 1 to ${MAX_MESSAGE_CHARS} characters.`);
  }
  return text;
}

// Turns an ordinary error into the right web status, using what the message says.
export function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (/^Only /.test(error.message)) return 403;
  if (/not yours/.test(error.message)) return 403;
  if (/no longer|No such project/.test(error.message)) return 404;
  if (/already used/.test(error.message)) return 409;
  return 400;
}
