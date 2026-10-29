const SAFE_CHARS = /^[A-Za-z0-9._/-]+$/;

// A plain relative path like "src/app.js": no leading slash, no "..", no hidden parts like ".env",
// no empty parts and no odd characters. Used for every file path that comes from another computer.
export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return false;
  if (!SAFE_CHARS.test(value) || value.startsWith('/')) return false;
  return value.split('/').every((part) => part && !part.startsWith('.'));
}
