import fs from 'node:fs';
import path from 'node:path';

const MAX_DEPTH = 6;
const MAX_PREVIEW_FILES = 200;
const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES = 5 * 1024 * 1024;
const PREVIEW_EXTENSIONS = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'woff2']);

// Every file worth showing, as paths like "src/app.js". Hidden files, .git and node_modules are skipped.
function walk(dir, prefix = '', depth = 0, out = []) {
  if (depth > MAX_DEPTH) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), relative, depth + 1, out);
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

export function listProjectFiles(dir, limit = 200) {
  return walk(dir).sort().slice(0, limit);
}

// The small set of files that make up a simple website, ready to upload for the preview.
// Returns null when the project has no index.html at its top level.
export function buildPreviewBundle(dir) {
  if (!fs.existsSync(path.join(dir, 'index.html'))) return null;
  const files = [];
  let total = 0;
  let truncated = false;
  const candidates = walk(dir).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
  for (const relative of candidates) {
    const extension = relative.split('.').pop().toLowerCase();
    if (!PREVIEW_EXTENSIONS.has(extension)) continue;
    const full = path.join(dir, relative);
    const size = fs.statSync(full).size;
    if (size > MAX_PREVIEW_FILE_BYTES || files.length >= MAX_PREVIEW_FILES || total + size > MAX_PREVIEW_TOTAL_BYTES) {
      truncated = true;
      continue;
    }
    total += size;
    files.push({ path: relative, data: fs.readFileSync(full).toString('base64') });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, truncated };
}
