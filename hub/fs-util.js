import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Reads a JSON file, or returns `fallback` when the file does not exist yet.
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

// Writes a JSON file safely: the new copy is written beside the old one and then swapped in,
// so a crash in the middle never leaves a half-written file.
export function writeJsonAtomic(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), mode ? { mode } : undefined);
  fs.renameSync(temp, file);
}
