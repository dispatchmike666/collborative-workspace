import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { Sources } from '../hub/sources.js';
import { isSafeRelativePath } from '../hub/paths.js';
import { tempDir } from './helpers.js';

function make(t) {
  const file = path.join(tempDir(t), 'sources.json');
  return { sources: new Sources(file), file };
}

test('safe paths are plain relative paths with no hidden parts', () => {
  for (const good of ['index.html', 'src/app.js', 'a/b/c.txt', 'my-file_1.v2.json']) assert.equal(isSafeRelativePath(good), true, good);
  for (const bad of ['', '/abs.txt', '../x', 'a/../b', 'a//b', '.env', 'a/.git/config', 'a\\b', 'sp ace.txt', 'x\u0000y']) {
    assert.equal(isSafeRelativePath(bad), false, JSON.stringify(bad));
  }
});

test('file contents are stored, listed and read back', (t) => {
  const { sources, file } = make(t);
  const info = sources.set([{ path: 'index.html', text: '<h1>Hi</h1>' }, { path: 'src/app.js', text: 'console.log(1)' }]);
  assert.deepEqual(info, { count: 2, bytes: 25 });
  assert.deepEqual(sources.paths(), ['index.html', 'src/app.js']);
  assert.deepEqual(sources.get('src/app.js'), { path: 'src/app.js', text: 'console.log(1)' });
  assert.equal(sources.get('missing.txt'), null);
  assert.equal(new Sources(file).get('index.html').text, '<h1>Hi</h1>');
});

test('setting the files again replaces what was there', (t) => {
  const { sources } = make(t);
  sources.set([{ path: 'a.txt', text: 'one' }]);
  sources.set([{ path: 'b.txt', text: 'two' }]);
  assert.deepEqual(sources.paths(), ['b.txt']);
});

test('unsafe paths, binary data and oversized uploads are refused', (t) => {
  const { sources } = make(t);
  assert.throws(() => sources.set([{ path: '../evil.txt', text: 'x' }]), /Bad file path/);
  assert.throws(() => sources.set([{ path: '.env', text: 'SECRET=1' }]), /Bad file path/);
  assert.throws(() => sources.set([{ path: 'a.bin', text: 'has\u0000nul' }]), /not text/);
  assert.throws(() => sources.set([{ path: 'a.txt', text: 5 }]), /not text/);
  assert.throws(() => sources.set([{ path: 'big.txt', text: 'x'.repeat(200 * 1024 + 1) }]), /too large/);
  const many = Array.from({ length: 101 }, (_, i) => ({ path: `f${i}.txt`, text: 'x' }));
  assert.throws(() => sources.set(many), /Too many/);
  const heavy = Array.from({ length: 9 }, (_, i) => ({ path: `h${i}.txt`, text: 'x'.repeat(190 * 1024) }));
  assert.throws(() => sources.set(heavy), /too large overall/);
});
