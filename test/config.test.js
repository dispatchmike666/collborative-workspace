import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { CLAUDE_ARGS, loadConfig, resolveClaudeCommand } from '../server/config.js';

test('CLAUDE_BIN wins when it is set', () => {
  assert.equal(resolveClaudeCommand({ CLAUDE_BIN: 'C:/tools/claude.exe' }, 'win32', () => false), 'C:/tools/claude.exe');
});

test('on Windows, uses the real claude.exe that npm installed', () => {
  const found = resolveClaudeCommand({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', () => true);
  assert.ok(found.endsWith(path.join('@anthropic-ai', 'claude-code', 'bin', 'claude.exe')));
});

test('falls back to plain "claude" when claude.exe is not there or on other systems', () => {
  assert.equal(resolveClaudeCommand({ APPDATA: 'C:\\x' }, 'win32', () => false), 'claude');
  assert.equal(resolveClaudeCommand({}, 'linux', () => true), 'claude');
});

test('the Claude flags keep runs lean and never use API-key-only or skip-permission modes', () => {
  assert.ok(CLAUDE_ARGS.includes('--setting-sources'));
  assert.ok(CLAUDE_ARGS.includes('acceptEdits'));
  assert.ok(!CLAUDE_ARGS.includes('--bare'));
  assert.ok(!CLAUDE_ARGS.includes('--dangerously-skip-permissions'));
});

test('loadConfig fills in sensible defaults', () => {
  const config = loadConfig({ root: path.resolve('/repo'), env: {} });
  assert.equal(config.port, 3000);
  assert.equal(config.userName, 'Brennan');
  assert.equal(config.projectDir, path.resolve('/repo', 'workspace-data', 'demo'));
});

test('loadConfig reads PORT, PROJECT_DIR and WORKSPACE_USER', () => {
  const config = loadConfig({ root: '/repo', env: { PORT: '4000', PROJECT_DIR: '/elsewhere', WORKSPACE_USER: 'Max' } });
  assert.equal(config.port, 4000);
  assert.equal(config.projectDir, path.resolve('/elsewhere'));
  assert.equal(config.userName, 'Max');
});
