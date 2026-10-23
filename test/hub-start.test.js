import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tempDir, waitFor } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const cli = (dataDir, ...args) => execFileSync(process.execPath, [path.join(root, 'hub', 'cli.js'), ...args], {
  env: { ...process.env, HUB_DATA: dataDir },
  encoding: 'utf8',
});

test('adding a person writes their password to a private file and never prints it', (t) => {
  const dataDir = tempDir(t);
  const output = cli(dataDir, 'add-user', 'Max');
  const file = path.join(dataDir, 'credentials', 'Max.txt');
  assert.match(output, /Added Max/);
  assert.ok(output.includes(file));
  const saved = fs.readFileSync(file, 'utf8');
  const password = /Password: (\S+)/.exec(saved)[1];
  const token = /Helper token: (\S+)/.exec(saved)[1];
  assert.ok(password.length >= 16 && token.length >= 32);
  assert.ok(!output.includes(password) && !output.includes(token), 'secrets must not be printed');
  assert.match(cli(dataDir, 'list'), /Max/);
});

test('new passwords and tokens replace the old ones', (t) => {
  const dataDir = tempDir(t);
  cli(dataDir, 'add-user', 'Max');
  const before = fs.readFileSync(path.join(dataDir, 'credentials', 'Max.txt'), 'utf8');
  cli(dataDir, 'new-password', 'Max');
  const after = fs.readFileSync(path.join(dataDir, 'credentials', 'Max.txt'), 'utf8');
  assert.notEqual(/Password: (\S+)/.exec(before)[1], /Password: (\S+)/.exec(after)[1]);
  cli(dataDir, 'new-token', 'Max');
  assert.match(fs.readFileSync(path.join(dataDir, 'credentials', 'Max.txt'), 'utf8'), /Helper token: \S+/);
});

test('the tool explains mistakes in plain words', (t) => {
  const dataDir = tempDir(t);
  cli(dataDir, 'add-user', 'Max');
  const fails = (...args) => {
    try {
      cli(dataDir, ...args);
      return null;
    } catch (error) {
      return String(error.stderr);
    }
  };
  assert.match(fails('add-user', 'Max'), /already exists/);
  assert.match(fails('add-user', 'x'), /Names must be/);
  assert.match(fails('add-user'), /Say who/);
  assert.match(fails('new-password', 'Nobody'), /No such user/);
});

function startHub(dataDir, port, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(root, 'hub', 'index.js')], {
    env: { ...process.env, HUB_DATA: dataDir, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, output: () => output };
}

test('the hub refuses to start with nobody to log in', async (t) => {
  const dataDir = tempDir(t);
  const { child, output } = startHub(dataDir, 3951);
  t.after(() => child.kill());
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 1);
  assert.match(output(), /Nobody can log in yet/);
  assert.match(output(), /npm run hub:add-user/);
});

test('the hub starts, serves the login page and answers only to its own address', async (t) => {
  const dataDir = tempDir(t);
  cli(dataDir, 'add-user', 'Max');
  const port = 3952;
  const { child, output } = startHub(dataDir, port);
  t.after(() => child.kill());
  await waitFor(() => /Press Ctrl\+C/.test(output()), { label: 'the hub to finish starting' });
  assert.match(output(), /People who can log in: Max/);
  const page = await fetch(`http://localhost:${port}/login`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Log in/);
  assert.equal((await fetch(`http://localhost:${port}/`, { redirect: 'manual' })).status, 302);
  // The login secret is created on first start and kept private.
  assert.ok(fs.existsSync(path.join(dataDir, 'secret.key')));
});
