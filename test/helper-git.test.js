import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { GitSync } from '../helper/git-sync.js';
import { tempDir } from './helpers.js';

const identity = ['user.name=Test Person', 'user.email=test@example.com'];

function git(cwd, ...args) {
  return execFileSync('git', ['-c', ...identity.flatMap((c, i) => (i ? ['-c', c] : [c])), ...args], { cwd, encoding: 'utf8' }).trim();
}

function write(dir, relative, content) {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// A pretend GitHub: an empty shared repository on this computer.
function makeRemote(t, { withFirstCommit = false } = {}) {
  const dir = tempDir(t);
  const remote = path.join(dir, 'remote.git');
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote]);
  if (withFirstCommit) {
    const seed = path.join(dir, 'seed');
    execFileSync('git', ['clone', remote, seed], { stdio: 'ignore' });
    write(seed, 'README.md', 'hello\n');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-m', 'first');
    git(seed, 'push', '-u', 'origin', 'HEAD');
  }
  return { dir, remote };
}

const sync = () => new GitSync({ configOverrides: identity });

test('without a repository address the project is a plain local folder that still keeps history', async (t) => {
  const dir = path.join(tempDir(t), 'proj');
  const gs = sync();
  const prepared = await gs.prepare({ projectDir: dir, repoUrl: null });
  assert.equal(prepared.mode, 'local');
  assert.ok(fs.existsSync(path.join(dir, '.git')));

  write(dir, 'a.txt', 'one');
  const first = await gs.finish({ projectDir: dir, repoUrl: null, message: 'add a', who: 'Max' });
  assert.deepEqual(first, { changed: ['a.txt'], committed: true, pushed: false });
  const second = await gs.finish({ projectDir: dir, repoUrl: null, message: 'nothing', who: 'Max' });
  assert.deepEqual(second, { changed: [], committed: false, pushed: false });
  assert.equal(git(dir, 'log', '--format=%s'), 'add a');
});

test('the first run copies the project from the shared repository', async (t) => {
  const { dir, remote } = makeRemote(t, { withFirstCommit: true });
  const projectDir = path.join(dir, 'max-copy');
  const prepared = await sync().prepare({ projectDir, repoUrl: remote });
  assert.equal(prepared.mode, 'shared');
  assert.equal(prepared.cloned, true);
  // Windows may turn line endings into \r\n when Git copies a file, so ignore that difference.
  assert.equal(fs.readFileSync(path.join(projectDir, 'README.md'), 'utf8').replace(/\r\n/g, '\n'), 'hello\n');
});

test('an empty shared repository works, and the first save fills it', async (t) => {
  const { dir, remote } = makeRemote(t);
  const projectDir = path.join(dir, 'brennan-copy');
  const gs = sync();
  const prepared = await gs.prepare({ projectDir, repoUrl: remote });
  assert.equal(prepared.empty, true);

  write(projectDir, 'index.html', '<h1>Hi</h1>');
  const done = await gs.finish({ projectDir, repoUrl: remote, message: "Brennan's Claude: first page", who: 'Brennan' });
  assert.deepEqual(done, { changed: ['index.html'], committed: true, pushed: true });
  assert.equal(git(remote, 'log', '--format=%s', 'main'), "Brennan's Claude: first page");
});

test('the next run picks up what the other computer saved', async (t) => {
  const { dir, remote } = makeRemote(t, { withFirstCommit: true });
  const brennanDir = path.join(dir, 'brennan');
  const maxDir = path.join(dir, 'max');
  const brennan = sync();
  const max = sync();
  await brennan.prepare({ projectDir: brennanDir, repoUrl: remote });
  await max.prepare({ projectDir: maxDir, repoUrl: remote });

  write(maxDir, 'legend.js', 'colors');
  await max.finish({ projectDir: maxDir, repoUrl: remote, message: "Max's Claude: legend", who: 'Max' });

  const prepared = await brennan.prepare({ projectDir: brennanDir, repoUrl: remote });
  assert.equal(prepared.pulled, true);
  assert.equal(fs.readFileSync(path.join(brennanDir, 'legend.js'), 'utf8'), 'colors');
});

test('if the other computer saved first, a save that does not overlap is combined and pushed', async (t) => {
  const { dir, remote } = makeRemote(t, { withFirstCommit: true });
  const brennanDir = path.join(dir, 'brennan');
  const maxDir = path.join(dir, 'max');
  const brennan = sync();
  const max = sync();
  await brennan.prepare({ projectDir: brennanDir, repoUrl: remote });
  await max.prepare({ projectDir: maxDir, repoUrl: remote });

  write(maxDir, 'max.txt', 'from max');
  await max.finish({ projectDir: maxDir, repoUrl: remote, message: 'max', who: 'Max' });
  write(brennanDir, 'brennan.txt', 'from brennan');
  const result = await brennan.finish({ projectDir: brennanDir, repoUrl: remote, message: 'brennan', who: 'Brennan' });
  assert.equal(result.pushed, true);

  const files = git(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n').sort();
  assert.deepEqual(files, ['README.md', 'brennan.txt', 'max.txt']);
});

test('if both computers changed the same lines, it stops with a plain message and leaves things tidy', async (t) => {
  const { dir, remote } = makeRemote(t, { withFirstCommit: true });
  const brennanDir = path.join(dir, 'brennan');
  const maxDir = path.join(dir, 'max');
  const brennan = sync();
  const max = sync();
  await brennan.prepare({ projectDir: brennanDir, repoUrl: remote });
  await max.prepare({ projectDir: maxDir, repoUrl: remote });

  write(maxDir, 'README.md', 'max wrote this\n');
  await max.finish({ projectDir: maxDir, repoUrl: remote, message: 'max', who: 'Max' });
  write(brennanDir, 'README.md', 'brennan wrote this\n');
  await assert.rejects(
    brennan.finish({ projectDir: brennanDir, repoUrl: remote, message: 'brennan', who: 'Brennan' }),
    /same part of a file/,
  );
  assert.equal(fs.existsSync(path.join(brennanDir, '.git', 'rebase-merge')), false, 'no half-finished merge is left behind');
  assert.equal(git(remote, 'show', 'main:README.md'), 'max wrote this');
});

test('commits use a fallback name when the computer has none set', async (t) => {
  const { dir, remote } = makeRemote(t);
  const emptyConfig = path.join(dir, 'empty-gitconfig');
  fs.writeFileSync(emptyConfig, '');
  const gs = new GitSync({ env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' } });
  const projectDir = path.join(dir, 'copy');
  await gs.prepare({ projectDir, repoUrl: remote });
  write(projectDir, 'a.txt', 'x');
  await gs.finish({ projectDir, repoUrl: remote, message: 'hi', who: 'Max' });
  assert.equal(git(remote, 'log', '-1', '--format=%an', 'main'), "Max's Claude");
});

test('a folder that is not a copy of the project is never overwritten', async (t) => {
  const { dir, remote } = makeRemote(t, { withFirstCommit: true });
  const projectDir = path.join(dir, 'occupied');
  write(projectDir, 'my-own-file.txt', 'precious');
  await assert.rejects(sync().prepare({ projectDir, repoUrl: remote }), /not a copy of the project/);
  assert.equal(fs.readFileSync(path.join(projectDir, 'my-own-file.txt'), 'utf8'), 'precious');
});

test('a wrong repository address gives a plain message', async (t) => {
  const dir = tempDir(t);
  await assert.rejects(
    sync().prepare({ projectDir: path.join(dir, 'x'), repoUrl: path.join(dir, 'does-not-exist.git') }),
    /Couldn't get the project files/,
  );
});
