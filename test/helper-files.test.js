import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildPreviewBundle, buildSourceBundle, listProjectFiles } from '../helper/files.js';
import { tempDir } from './helpers.js';

function write(dir, relative, content = 'x') {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('the file list skips hidden files, git data and installed packages, and is sorted', (t) => {
  const dir = tempDir(t);
  write(dir, 'index.html');
  write(dir, 'src/app.js');
  write(dir, 'src/deep/more.js');
  write(dir, '.git/config');
  write(dir, '.env', 'SECRET=1');
  write(dir, 'node_modules/pkg/index.js');
  assert.deepEqual(listProjectFiles(dir), ['index.html', 'src/app.js', 'src/deep/more.js']);
});

test('the file list is limited', (t) => {
  const dir = tempDir(t);
  for (let i = 0; i < 30; i += 1) write(dir, `f${String(i).padStart(2, '0')}.txt`);
  assert.equal(listProjectFiles(dir, 10).length, 10);
  assert.deepEqual(listProjectFiles(path.join(dir, 'missing')), []);
});

test('there is no preview unless the project has an index.html at the top', (t) => {
  const dir = tempDir(t);
  write(dir, 'src/index.html');
  write(dir, 'app.js');
  assert.equal(buildPreviewBundle(dir), null);
});

test('a preview includes the site files, as base64, and leaves out everything else', (t) => {
  const dir = tempDir(t);
  write(dir, 'index.html', '<h1>Hi</h1>');
  write(dir, 'css/site.css', 'h1{}');
  write(dir, 'img/logo.png', 'png');
  write(dir, 'server.exe', 'binary');
  write(dir, '.env', 'SECRET=1');
  write(dir, 'node_modules/a.js', 'x');
  const bundle = buildPreviewBundle(dir);
  assert.deepEqual(bundle.files.map((f) => f.path), ['css/site.css', 'img/logo.png', 'index.html']);
  assert.equal(Buffer.from(bundle.files.find((f) => f.path === 'index.html').data, 'base64').toString(), '<h1>Hi</h1>');
  assert.equal(bundle.truncated, false);
});

test('files that are too big are skipped and the preview says it was cut short', (t) => {
  const dir = tempDir(t);
  write(dir, 'index.html', '<h1>Hi</h1>');
  write(dir, 'huge.js', 'x'.repeat(1024 * 1024 + 1));
  const bundle = buildPreviewBundle(dir);
  assert.deepEqual(bundle.files.map((f) => f.path), ['index.html']);
  assert.equal(bundle.truncated, true);
});

test('a preview stops growing at the overall limit', (t) => {
  const dir = tempDir(t);
  write(dir, 'index.html', '<h1>Hi</h1>');
  for (let i = 0; i < 7; i += 1) write(dir, `big${i}.js`, 'x'.repeat(900 * 1024));
  const bundle = buildPreviewBundle(dir);
  const total = bundle.files.reduce((sum, f) => sum + Buffer.from(f.data, 'base64').length, 0);
  assert.ok(total <= 5 * 1024 * 1024);
  assert.equal(bundle.truncated, true);
  assert.ok(bundle.files.some((f) => f.path === 'index.html'), 'the main page always makes it in');
});

test('readable files are the small text files of the project, without hidden or binary ones', (t) => {
  const dir = tempDir(t);
  write(dir, 'index.html', '<h1>Hi</h1>');
  write(dir, 'src/app.js', 'console.log(1)');
  write(dir, 'README.md', '# Title');
  write(dir, 'data.bin', 'abc\u0000def');
  write(dir, 'photo.png', 'not really a picture');
  write(dir, 'tool.exe', 'binary');
  write(dir, '.env', 'SECRET=1');
  write(dir, 'node_modules/x/index.js', 'x');
  write(dir, 'big.js', 'x'.repeat(200 * 1024 + 1));
  const files = buildSourceBundle(dir);
  assert.deepEqual(files.map((f) => f.path), ['README.md', 'index.html', 'src/app.js']);
  assert.equal(files.find((f) => f.path === 'src/app.js').text, 'console.log(1)');
});

test('readable files stop at the overall limits', (t) => {
  const dir = tempDir(t);
  for (let i = 0; i < 120; i += 1) write(dir, `f${String(i).padStart(3, '0')}.txt`, 'x');
  assert.equal(buildSourceBundle(dir).length, 100);
  const heavy = tempDir(t);
  for (let i = 0; i < 9; i += 1) write(heavy, `h${i}.txt`, 'x'.repeat(190 * 1024));
  const total = buildSourceBundle(heavy).reduce((sum, f) => sum + Buffer.byteLength(f.text), 0);
  assert.ok(total <= 1.5 * 1024 * 1024);
});
