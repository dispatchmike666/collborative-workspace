import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKIP_FOLDERS = new Set(['node_modules', '.git', 'workspace-data']);
const TEXT_FILES = /\.(js|json|md|html|css|txt|yml|yaml|env)$/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_FOLDERS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

test('no API key appears anywhere in the project files', () => {
  const keyShape = /sk-ant-[A-Za-z0-9_-]{10,}/;
  const offenders = [];
  for (const file of walk(ROOT)) {
    const looksLikeText = TEXT_FILES.test(file) || path.basename(file).startsWith('.env');
    if (looksLikeText && keyShape.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(ROOT, file));
  }
  assert.deepEqual(offenders, []);
});

test('secret files are kept out of git', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^workspace-data\/$/m);
});
