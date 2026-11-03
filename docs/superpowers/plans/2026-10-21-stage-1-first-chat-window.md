# Stage 1: The First Chat Window - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One person, one computer: type a message in a web page, the person's own Claude (signed in with their Claude plan) does the work in a project folder, and every step streams back into the page live.

**Architecture:** A tiny Node.js web server (no installed packages) serves one page and a live feed (Server-Sent Events: the browser holds a connection open and the server pushes events down it). Messages are POSTed to the server. A `ClaudeRunner` starts the real `claude` program once per message in non-interactive mode, sends the message through stdin (never the command line), reads its line-by-line JSON output, converts each line into a simple event, and adds it to an in-memory `Timeline` that the page subscribes to. Messages that arrive while Claude is busy wait in line and start by themselves.

**Tech Stack:** Node.js 24 (works on 22+), plain JavaScript modules, Node's built-in test runner (`node --test`), no npm dependencies, plain HTML/CSS/JS in the browser. Claude Code 2.1.235 on Windows.

**Spec:** `docs/superpowers/specs/2026-10-14-shared-workspace-design.md` (this plan implements Stage 1 of section 9, "the risky test").

## Scope

The spec has five stages. This plan covers **Stage 1 only**, on purpose. Stage 1 exists to prove the riskiest idea: that a small program can drive each person's own Claude and stream its steps live. The later stages (Max joins, shared files and turns, dashboard, live preview) each get their own plan, written after this one passes, so they can use what Stage 1 teaches us. Stage 1 is local-only: no hosting, no logins, no GitHub.

## Global Constraints

- No API key anywhere: not in code, settings, tests, docs, or the environment passed to Claude. Claude must run on the person's Claude plan login only. (Spec section 6.)
- No npm packages. Brennan does not want more things installed. Use only what ships with Node.
- Windows is the target (Brennan and Max both use Windows). Do not spawn the `claude.cmd` wrapper; spawn the real `claude.exe`.
- The message always reaches Claude through stdin, never as a command-line argument.
- The server listens on `127.0.0.1` only. Nothing on the network can reach it.
- Never add `--bare` (it only works with an API key) or `--dangerously-skip-permissions` to the Claude flags.
- Anything shown to a person is plain English: no jargon, no raw error codes without a sentence around them.
- One Claude run at a time. Extra messages queue in the background and start by themselves; nobody is blocked from typing.

## Event reference

Every event is a plain object with a `kind`. The timeline adds `id` (a rising number) and `at` (a timestamp).

| kind | fields | meaning |
|---|---|---|
| `user` | `who`, `text` | a person's message |
| `status` | `state` (`working`, `idle`, `queued`), `who`, `position` (queued only) | what the runner is doing |
| `run-start` | `sessionId`, `model`, `apiKeySource` | Claude started; says how it is signed in |
| `claude-text` | `text` | words from Claude |
| `claude-step` | `tool`, `summary` | Claude is using a tool, e.g. "Write hello.txt" |
| `claude-step-result` | `ok`, `text` | the tool finished |
| `run-done` | `ok`, `text`, `sessionId`, `durationMs`, `costUsd` | the message is finished |
| `error` | `text` | something went wrong, in plain English |

## File Structure

```
Glasshouse/
  package.json              scripts only, no dependencies
  .gitignore
  CLAUDE.md                 standing rules for this project
  README.md                 how to start it, in plain English
  server/
    child-env.js            removes anything that could bill per use before Claude starts
    config.js               Claude flags, finding claude.exe, port and project folder
    stream-parser.js        one line of Claude output -> events for the window
    timeline.js             the ordered record of events, with live subscribers
    claude-runner.js        starts Claude, one message at a time, with a waiting line
    http-app.js             the web server: page, live feed, send endpoint, safety checks
    index.js                wires everything together and starts listening
  public/
    index.html              the page
    styles.css              looks
    render.js               event -> what to show (pure, tested)
    app.js                  browser code: live feed in, messages out
  test/
    helpers.js              temp folders, waiting, tiny server and live-feed reader
    fake-claude.js          stand-in for `claude` so tests never use the real one
    fixtures/sample-stream.jsonl   trimmed real Claude output (Claude Code 2.1.235)
    *.test.js               one test file per module, plus e2e and no-api-key
  docs/superpowers/stage-1-results.md   measured results, written in Task 10
```

All commands run from the repo folder (now `C:\Users\bren_\Glasshouse`).

---

### Task 1: Project scaffold and the "no API key" guard

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `CLAUDE.md`
- Create: `test/no-api-key.test.js`

**Interfaces:**
- Produces: `npm test` (runs every `test/**/*.test.js`) and `npm start` (runs `server/index.js`, created in Task 9).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "shared-workspace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node server/index.js",
    "test": "node --test \"test/**/*.test.js\""
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
.env
.env.*
workspace-data/
```

- [ ] **Step 3: Write `CLAUDE.md`**

```markdown
# Shared workspace

## What this is

A website where Brennan and Max work on software projects together in one
shared window: both talk to the AI, talk to each other, and watch the AI build
the project live. Spec: docs/superpowers/specs/2026-10-14-shared-workspace-design.md

## Standing constraints

- Never use an API key (a secret password that bills per use). Claude runs on
  each person's own Claude plan login only. The runner removes API-key settings
  from Claude's environment and refuses to run if Claude reports an API key.
- No npm packages unless there is no other way. Brennan does not want more installs.
- Windows is the target. Spawn the real claude.exe, not claude.cmd.
- A person's message goes to Claude through stdin, never the command line.
- Anything a person reads is plain English.
- Never add --bare or --dangerously-skip-permissions to the Claude flags.

## Decisions

Settled decisions live in `C:\Users\bren_\random projects\DECISIONS.md` (outside this repo). Read
it before changing behavior a past session already ruled on.
```

- [ ] **Step 4: Write `test/no-api-key.test.js`**

```js
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
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS, 2 tests. (This is a guard test: it passes now and fails later if anyone adds a key.)

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore CLAUDE.md test/no-api-key.test.js
git commit -m "Scaffold project and add the no-API-key guard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remove anything that could bill per use

**Files:**
- Create: `server/child-env.js`
- Test: `test/child-env.test.js`

**Interfaces:**
- Produces: `buildChildEnv(env: object): object`. Returns a copy of `env` without `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY` (matched case-insensitively). Keeps `CLAUDE_CODE_OAUTH_TOKEN` (that is the plan login). Never changes the input object.

- [ ] **Step 1: Write the failing test `test/child-env.test.js`**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChildEnv } from '../server/child-env.js';

test('removes every setting that could make Claude bill per use', () => {
  const clean = buildChildEnv({
    PATH: '/bin',
    anthropic_api_key: 'x',
    ANTHROPIC_AUTH_TOKEN: 'y',
    ANTHROPIC_BASE_URL: 'z',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_USE_FOUNDRY: '1',
    HOME: '/home/me',
  });
  assert.deepEqual(clean, { PATH: '/bin', HOME: '/home/me' });
});

test('keeps the Claude plan login token', () => {
  const clean = buildChildEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'plan-token' });
  assert.deepEqual(clean, { CLAUDE_CODE_OAUTH_TOKEN: 'plan-token' });
});

test('does not change the object it was given', () => {
  const original = { ANTHROPIC_API_KEY: 'x', PATH: '/bin' };
  buildChildEnv(original);
  assert.deepEqual(original, { ANTHROPIC_API_KEY: 'x', PATH: '/bin' });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/child-env.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/child-env.js`.

- [ ] **Step 3: Write `server/child-env.js`**

```js
// Settings that would make Claude bill per use (an API key, or a cloud provider).
// We remove them before starting Claude, so it can only use the Claude plan login.
const BLOCKED = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
]);

export function buildChildEnv(env) {
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    if (!BLOCKED.has(key.toUpperCase())) clean[key] = value;
  }
  return clean;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/child-env.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/child-env.js test/child-env.test.js
git commit -m "Strip API-key settings before starting Claude" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settings and finding Claude

**Files:**
- Create: `server/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `CLAUDE_ARGS: string[]`, `resolveClaudeCommand(env?, platform?, exists?): string`, `loadConfig({ root, env? }): { port: number, projectDir: string, userName: string, claudeCommand: string, claudeArgs: string[] }`.
- Environment variables read: `CLAUDE_BIN` (full path to claude), `PORT` (default 3000), `PROJECT_DIR` (default `<root>/workspace-data/demo`), `WORKSPACE_USER` (default `Brennan`).

- [ ] **Step 1: Write the failing test `test/config.test.js`**

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/config.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/config.js`.

- [ ] **Step 3: Write `server/config.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

// How we start Claude for each message. Every flag here is on purpose:
//  -p + stream-json + --verbose   run once and print each step as it happens
//  --permission-mode acceptEdits  Claude may create and edit files without asking
//  --setting-sources project      ignore personal hooks and skills, so runs stay lean
//  --disable-slash-commands       turn off skills
//  --strict-mcp-config            ignore other connected tools
// Never add --bare (it only works with an API key) or --dangerously-skip-permissions.
export const CLAUDE_ARGS = [
  '-p',
  '--output-format', 'stream-json',
  '--verbose',
  '--permission-mode', 'acceptEdits',
  '--setting-sources', 'project',
  '--disable-slash-commands',
  '--strict-mcp-config',
];

// On Windows the `claude` command is a small wrapper that Node cannot start directly,
// so we point at the real claude.exe that npm installs next to it.
export function resolveClaudeCommand(env = process.env, platform = process.platform, exists = fs.existsSync) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  if (platform === 'win32' && env.APPDATA) {
    const exe = path.join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (exists(exe)) return exe;
  }
  return 'claude';
}

export function loadConfig({ root, env = process.env }) {
  return {
    port: Number(env.PORT ?? 3000),
    projectDir: path.resolve(env.PROJECT_DIR ?? path.join(root, 'workspace-data', 'demo')),
    userName: env.WORKSPACE_USER ?? 'Brennan',
    claudeCommand: resolveClaudeCommand(env),
    claudeArgs: CLAUDE_ARGS,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/config.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/config.js test/config.test.js
git commit -m "Add settings and the Claude flags" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Understand Claude's live output

**Files:**
- Create: `test/fixtures/sample-stream.jsonl`
- Create: `server/stream-parser.js`
- Test: `test/stream-parser.test.js`

**Interfaces:**
- Produces: `parseStreamLine(line: string): Event[]` and `summarizeToolUse(name: string, input?: object): string`. Event kinds produced: `run-start`, `claude-text`, `claude-step`, `claude-step-result`, `run-done`, `error` (see the Event reference).
- Background: this fixture is trimmed from a real run of Claude Code 2.1.235 on 2026-10-21 (`claude -p --output-format stream-json --verbose`). Real output also contains hook, thinking-token, summary and rate-limit lines; the parser ignores them.

- [ ] **Step 1: Write the fixture `test/fixtures/sample-stream.jsonl`** (one JSON object per line, exactly as below)

```
{"type":"system","subtype":"hook_started","hook_name":"SessionStart","session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a"}
{"type":"system","subtype":"init","cwd":"C:\\probe","session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a","model":"claude-sonnet-5","permissionMode":"acceptEdits","apiKeySource":"none","claude_code_version":"2.1.235"}
{"type":"system","subtype":"thinking_tokens","estimated_tokens":12,"session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"","signature":"abc"}]},"session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"Write","input":{"file_path":"C:\\probe\\hello.txt","content":"hi"}}]},"session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a"}
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour"},"session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a"}
{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01","type":"tool_result","content":"File created successfully at: C:\\probe\\hello.txt"}]},"session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a"}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done. Created `hello.txt` with \"hi\" in the probe folder."}]},"session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a"}
{"type":"result","subtype":"success","is_error":false,"duration_ms":6741,"num_turns":2,"result":"Done. Created `hello.txt` with \"hi\" in the probe folder.","session_id":"54d25f2e-748a-46c5-858c-3df38061ee1a","total_cost_usd":0.4013575}
```

- [ ] **Step 2: Write the failing test `test/stream-parser.test.js`**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseStreamLine, summarizeToolUse } from '../server/stream-parser.js';

const sample = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample-stream.jsonl'), 'utf8').split('\n');

test('a real Claude run turns into the events the window shows, in order', () => {
  const events = sample.flatMap(parseStreamLine);
  assert.deepEqual(events.map((e) => e.kind), ['run-start', 'claude-step', 'claude-step-result', 'claude-text', 'run-done']);
});

test('run-start carries the session id and how Claude is signed in', () => {
  const [start] = sample.flatMap(parseStreamLine);
  assert.equal(start.sessionId, '54d25f2e-748a-46c5-858c-3df38061ee1a');
  assert.equal(start.apiKeySource, 'none');
});

test('a file write is described in plain words', () => {
  const step = sample.flatMap(parseStreamLine).find((e) => e.kind === 'claude-step');
  assert.equal(step.summary, 'Write hello.txt');
});

test('run-done reports success, time and the plan-usage estimate', () => {
  const done = sample.flatMap(parseStreamLine).find((e) => e.kind === 'run-done');
  assert.equal(done.ok, true);
  assert.equal(done.durationMs, 6741);
  assert.equal(done.costUsd, 0.4013575);
});

test('a failed tool result is marked not ok', () => {
  const line = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: [{ type: 'text', text: 'nope' }] }] },
  });
  assert.deepEqual(parseStreamLine(line), [{ kind: 'claude-step-result', ok: false, text: 'nope' }]);
});

test('an error result is marked not ok', () => {
  const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '', session_id: 's' });
  assert.equal(parseStreamLine(line)[0].ok, false);
});

test('blank lines and unknown event types are ignored', () => {
  assert.deepEqual(parseStreamLine(''), []);
  assert.deepEqual(parseStreamLine('   '), []);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'rate_limit_event' })), []);
});

test('a line that is not JSON becomes a visible error, not a silent drop', () => {
  const [event] = parseStreamLine('not json at all');
  assert.equal(event.kind, 'error');
  assert.match(event.text, /not json at all/);
});

test('tool summaries are short and readable', () => {
  assert.equal(summarizeToolUse('Edit', { file_path: 'C:\\a\\b\\map.js' }), 'Edit map.js');
  assert.equal(summarizeToolUse('Bash', { command: 'npm test' }), 'Bash: npm test');
  assert.equal(summarizeToolUse('Grep', { pattern: 'TODO' }), 'Grep TODO');
  assert.equal(summarizeToolUse('Weird'), 'Weird');
  assert.ok(summarizeToolUse('Bash', { command: 'x'.repeat(500) }).length < 100);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `node --test test/stream-parser.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/stream-parser.js`.

- [ ] **Step 4: Write `server/stream-parser.js`**

```js
const MAX_TEXT = 400;

function clip(value, max = MAX_TEXT) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function fileName(filePath) {
  return String(filePath ?? '').split(/[\\/]/).pop();
}

function blocks(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n');
  }
  return '';
}

// A short human description of what Claude is doing, e.g. "Write hello.txt".
export function summarizeToolUse(name, input = {}) {
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return `${name} ${fileName(input.file_path)}`;
    case 'NotebookEdit':
      return `${name} ${fileName(input.notebook_path)}`;
    case 'Bash':
      return `Bash: ${clip(input.command, 80)}`;
    case 'Glob':
    case 'Grep':
      return `${name} ${clip(input.pattern, 60)}`;
    default:
      return String(name);
  }
}

// Turns one line of Claude's live output into zero or more events for the window.
export function parseStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ kind: 'error', text: `Unreadable line from Claude: ${clip(trimmed, 120)}` }];
  }

  if (obj.type === 'system' && obj.subtype === 'init') {
    return [{ kind: 'run-start', sessionId: obj.session_id, model: obj.model, apiKeySource: obj.apiKeySource }];
  }

  if (obj.type === 'assistant') {
    const events = [];
    for (const block of blocks(obj.message)) {
      if (block.type === 'text' && block.text?.trim()) {
        events.push({ kind: 'claude-text', text: block.text });
      } else if (block.type === 'tool_use') {
        events.push({ kind: 'claude-step', tool: block.name, summary: summarizeToolUse(block.name, block.input) });
      }
    }
    return events;
  }

  if (obj.type === 'user') {
    return blocks(obj.message)
      .filter((block) => block.type === 'tool_result')
      .map((block) => ({ kind: 'claude-step-result', ok: !block.is_error, text: clip(toolResultText(block.content)) }));
  }

  if (obj.type === 'result') {
    return [{
      kind: 'run-done',
      ok: obj.subtype === 'success' && !obj.is_error,
      text: obj.result ?? '',
      sessionId: obj.session_id,
      durationMs: obj.duration_ms,
      costUsd: obj.total_cost_usd,
    }];
  }

  return [];
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `node --test test/stream-parser.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add server/stream-parser.js test/stream-parser.test.js test/fixtures/sample-stream.jsonl
git commit -m "Turn Claude's live output into window events" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The timeline

**Files:**
- Create: `server/timeline.js`
- Test: `test/timeline.test.js`

**Interfaces:**
- Produces: `class Timeline` with `constructor({ max = 2000 } = {})`, `add(event): StoredEvent` (adds `id`, `at`; returns the stored copy), `all(): StoredEvent[]`, `subscribe(listener: (event: StoredEvent) => void): () => void` (returns the unsubscribe function).

- [ ] **Step 1: Write the failing test `test/timeline.test.js`**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { Timeline } from '../server/timeline.js';

test('gives each event a rising id and a timestamp', () => {
  const timeline = new Timeline();
  const first = timeline.add({ kind: 'user', text: 'hi' });
  const second = timeline.add({ kind: 'user', text: 'again' });
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.match(first.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(timeline.all().map((e) => e.text), ['hi', 'again']);
});

test('tells listeners about new events until they unsubscribe', () => {
  const timeline = new Timeline();
  const seen = [];
  const unsubscribe = timeline.subscribe((event) => seen.push(event.text));
  timeline.add({ text: 'a' });
  unsubscribe();
  timeline.add({ text: 'b' });
  assert.deepEqual(seen, ['a']);
});

test('one broken listener does not stop the others', () => {
  const timeline = new Timeline();
  const seen = [];
  timeline.subscribe(() => {
    throw new Error('closed tab');
  });
  timeline.subscribe((event) => seen.push(event.text));
  timeline.add({ text: 'a' });
  assert.deepEqual(seen, ['a']);
});

test('keeps only the newest events once it is full', () => {
  const timeline = new Timeline({ max: 3 });
  for (const text of ['1', '2', '3', '4']) timeline.add({ text });
  assert.deepEqual(timeline.all().map((e) => e.text), ['2', '3', '4']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/timeline.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/timeline.js`.

- [ ] **Step 3: Write `server/timeline.js`**

```js
// The running record of everything that happened in a project, oldest first.
// New events are pushed to anyone listening (the browser windows).
export class Timeline {
  #events = [];
  #listeners = new Set();
  #nextId = 1;
  #max;

  constructor({ max = 2000 } = {}) {
    this.#max = max;
  }

  add(event) {
    const stored = { ...event, id: this.#nextId++, at: new Date().toISOString() };
    this.#events.push(stored);
    if (this.#events.length > this.#max) this.#events.shift();
    for (const listener of this.#listeners) {
      try {
        listener(stored);
      } catch {
        // One broken listener (a closed browser tab) must not stop the others.
      }
    }
    return stored;
  }

  all() {
    return [...this.#events];
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/timeline.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/timeline.js test/timeline.test.js
git commit -m "Add the timeline" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Run Claude one message at a time

**Files:**
- Create: `test/fake-claude.js`
- Create: `test/helpers.js`
- Create: `server/claude-runner.js`
- Test: `test/claude-runner.test.js`

**Interfaces:**
- Consumes: `buildChildEnv` (Task 2), `parseStreamLine` (Task 4).
- Produces: `class ClaudeRunner` with `constructor({ command, baseArgs = [], cwd, env = process.env, onEvent, timeoutMs = 900000 })`, `send(text: string, who: string): void`, getter `busy: boolean`. It calls `onEvent(event)` for: `status` (`working`, `queued` with `who` and `position`, `idle`), every parsed Claude event, and `error` events. The message is written to the child's stdin. After the first run, later runs add `--resume <sessionId>` so the conversation continues. If Claude reports a key source other than `none` or `oauth`, the run is killed and an `error` is emitted.
- Produces (test helpers): `FAKE_CLAUDE` (path), `tempDir(t)`, `waitFor(check, opts)`, `listen(handler)`, `closeServer(server)`, `readEvents(url, until, opts)`.
- `fake-claude.js` behavior (the message text steers it): `WRITE:<name>` creates that file in the working folder; `ENVCHECK` replies with whether `ANTHROPIC_API_KEY` reached it; `CRASH` exits with code 2 and prints to stderr; `HANG` never finishes. Env `FAKE_API_KEY_SOURCE` sets the reported `apiKeySource` (default `none`). A `--resume <id>` argument makes it reply `resumed:<id>`.

- [ ] **Step 1: Write the stand-in `test/fake-claude.js`**

```js
// A stand-in for the real `claude` command, used only by the tests.
// It reads the message from stdin and prints the same kind of live output Claude prints.
// Special words in the message change what it does:
//   WRITE:<name>  creates a file called <name> in the current folder
//   ENVCHECK      reports whether ANTHROPIC_API_KEY reached it
//   CRASH         exits with an error
//   HANG          never finishes
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const resumeIndex = args.indexOf('--resume');
const resumeId = resumeIndex >= 0 ? args[resumeIndex + 1] : null;
const sessionId = resumeId ?? 'fake-session-1';

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const assistant = (block) => ({ type: 'assistant', message: { role: 'assistant', content: [block] }, session_id: sessionId });

function run(prompt) {
  if (prompt.includes('HANG')) {
    setInterval(() => {}, 1000);
    return;
  }
  if (prompt.includes('CRASH')) {
    process.stderr.write('boom: simulated crash');
    process.exitCode = 2;
    return;
  }

  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake', apiKeySource: process.env.FAKE_API_KEY_SOURCE ?? 'none' });

  const match = prompt.match(/WRITE:(\S+)/);
  if (match) {
    const file = path.join(process.cwd(), match[1]);
    fs.writeFileSync(file, 'hi');
    out(assistant({ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: file, content: 'hi' } }));
    out({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `File created successfully at: ${file}` }] },
      session_id: sessionId,
    });
  }

  let text = resumeId ? `resumed:${resumeId}` : 'done';
  if (prompt.includes('ENVCHECK')) text = `key:${process.env.ANTHROPIC_API_KEY ?? 'absent'}`;
  out(assistant({ type: 'text', text }));
  out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId, duration_ms: 5, total_cost_usd: 0 });
}

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', () => run(prompt));
```

- [ ] **Step 2: Write the test helpers `test/helpers.js`**

```js
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const FAKE_CLAUDE = path.join(import.meta.dirname, 'fake-claude.js');

// A fresh empty folder that is deleted when the test ends.
// Windows won't delete a folder a program is still using, so we retry for a moment.
export function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  return dir;
}

// Waits until check() returns something truthy, or fails the test after a timeout.
export async function waitFor(check, { timeoutMs = 8000, label = 'the condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

export async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

// Reads the live feed and returns the events it received, stopping once until(events) is true.
export async function readEvents(url, until, { headers = {} } = {}) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
  const res = await fetch(url, { headers, signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  try {
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const dataLine = part.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
      }
    }
  } finally {
    controller.abort();
  }
  return events;
}
```

- [ ] **Step 3: Write the failing test `test/claude-runner.test.js`**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ClaudeRunner } from '../server/claude-runner.js';
import { FAKE_CLAUDE, tempDir, waitFor } from './helpers.js';

// Builds a runner that talks to the fake claude and records every event.
function makeRunner(t, overrides = {}) {
  const cwd = tempDir(t);
  const events = [];
  const runner = new ClaudeRunner({
    command: process.execPath,
    baseArgs: [FAKE_CLAUDE],
    cwd,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  const idleCount = () => events.filter((e) => e.kind === 'status' && e.state === 'idle').length;
  return { runner, events, cwd, idleCount };
}

test('runs a message and reports each step in order', async (t) => {
  const { runner, events, cwd, idleCount } = makeRunner(t);
  runner.send('WRITE:hello.txt', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the run to finish' });

  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, ['status', 'run-start', 'claude-step', 'claude-step-result', 'claude-text', 'run-done', 'status']);
  assert.equal(events[0].state, 'working');
  assert.equal(events.at(-1).state, 'idle');
  assert.equal(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8'), 'hi');
});

test('keeps talking in the same conversation on the next message', async (t) => {
  const { runner, events, idleCount } = makeRunner(t);
  runner.send('first', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'first run' });
  runner.send('second', 'Brennan');
  await waitFor(() => idleCount() === 2, { label: 'second run' });

  const replies = events.filter((e) => e.kind === 'claude-text').map((e) => e.text);
  assert.deepEqual(replies, ['done', 'resumed:fake-session-1']);
});

test('a message sent while Claude is busy waits in line, then starts by itself', async (t) => {
  const { runner, events, cwd, idleCount } = makeRunner(t);
  runner.send('WRITE:a.txt', 'Brennan');
  runner.send('WRITE:b.txt', 'Max');
  await waitFor(() => idleCount() === 2, { label: 'both runs' });

  const queued = events.find((e) => e.kind === 'status' && e.state === 'queued');
  assert.equal(queued.who, 'Max');
  assert.equal(queued.position, 1);
  assert.ok(events.indexOf(queued) < events.findIndex((e) => e.kind === 'run-done'));
  assert.equal(events.filter((e) => e.kind === 'run-done').length, 2);
  assert.ok(fs.existsSync(path.join(cwd, 'a.txt')));
  assert.ok(fs.existsSync(path.join(cwd, 'b.txt')));
});

test('a crash is reported clearly and the next message still works', async (t) => {
  const { runner, events, idleCount } = makeRunner(t);
  runner.send('CRASH', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the crash' });
  const error = events.find((e) => e.kind === 'error');
  assert.match(error.text, /exit code 2/);
  assert.match(error.text, /boom/);

  runner.send('hello', 'Brennan');
  await waitFor(() => idleCount() === 2, { label: 'the next run' });
  assert.ok(events.some((e) => e.kind === 'run-done'));
});

test('a run that never finishes is stopped after the time limit', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { timeoutMs: 400 });
  runner.send('HANG', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the timeout' });
  assert.match(events.find((e) => e.kind === 'error').text, /took too long/);
});

test('refuses to run if Claude would bill per use', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { env: { ...process.env, FAKE_API_KEY_SOURCE: 'user' } });
  runner.send('hello', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the refusal' });
  assert.match(events.find((e) => e.kind === 'error').text, /bill per use/);
  assert.ok(!events.some((e) => e.kind === 'claude-text'));
});

test('never passes an API key to Claude, even when one is set on the computer', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { env: { ...process.env, ANTHROPIC_API_KEY: 'pretend-key' } });
  runner.send('ENVCHECK', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the run' });
  assert.equal(events.find((e) => e.kind === 'claude-text').text, 'key:absent');
});

test('says so when Claude cannot be started at all', async (t) => {
  const { runner, events, idleCount } = makeRunner(t, { command: 'definitely-not-a-real-command-xyz', baseArgs: [] });
  runner.send('hello', 'Brennan');
  await waitFor(() => idleCount() === 1, { label: 'the failure' });
  assert.match(events.find((e) => e.kind === 'error').text, /Couldn't start Claude/);
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `node --test test/claude-runner.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/claude-runner.js`.

- [ ] **Step 5: Write `server/claude-runner.js`**

```js
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildChildEnv } from './child-env.js';
import { parseStreamLine } from './stream-parser.js';

// "none" and "oauth" mean Claude is signed in with a Claude plan.
// Anything else means an API key, which bills per use.
const PLAN_LOGIN_SOURCES = new Set(['none', 'oauth']);

function describeDuration(ms) {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${ms / 1000}s`;
}

// Runs Claude one message at a time. Extra messages wait in line and start by themselves.
export class ClaudeRunner {
  #command;
  #baseArgs;
  #cwd;
  #env;
  #onEvent;
  #timeoutMs;
  #queue = [];
  #busy = false;
  #sessionId = null;

  constructor({ command, baseArgs = [], cwd, env = process.env, onEvent, timeoutMs = 15 * 60 * 1000 }) {
    this.#command = command;
    this.#baseArgs = baseArgs;
    this.#cwd = cwd;
    this.#env = env;
    this.#onEvent = onEvent;
    this.#timeoutMs = timeoutMs;
  }

  get busy() {
    return this.#busy;
  }

  send(text, who) {
    if (this.#busy) {
      this.#queue.push({ text, who });
      this.#onEvent({ kind: 'status', state: 'queued', who, position: this.#queue.length });
      return;
    }
    this.#run({ text, who });
  }

  #run({ text, who }) {
    this.#busy = true;
    this.#onEvent({ kind: 'status', state: 'working', who });

    // After the first message, keep talking in the same conversation.
    const args = this.#sessionId ? [...this.#baseArgs, '--resume', this.#sessionId] : [...this.#baseArgs];
    let finished = false;
    let reportedDone = false;
    let aborted = false;
    let timedOut = false;
    let stderrTail = '';
    let timer = null;
    let child = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      this.#busy = false;
      this.#onEvent({ kind: 'status', state: 'idle' });
      const next = this.#queue.shift();
      if (next) this.#run(next);
    };

    const fail = (message) => {
      this.#onEvent({ kind: 'error', text: message });
      finish();
    };

    try {
      child = spawn(this.#command, args, {
        cwd: this.#cwd,
        env: buildChildEnv(this.#env),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      fail(`Couldn't start Claude: ${error.message}`);
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, this.#timeoutMs);

    child.on('error', (error) => fail(`Couldn't start Claude: ${error.message}`));
    child.stdin.on('error', () => {});
    // The message goes in through stdin, never on the command line, so nothing typed
    // in the window can be read as a command by the shell.
    child.stdin.end(text);
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-500);
    });

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (aborted) return;
      for (const event of parseStreamLine(line)) {
        if (event.kind === 'run-start' && !PLAN_LOGIN_SOURCES.has(event.apiKeySource)) {
          aborted = true;
          child.kill();
          this.#onEvent({
            kind: 'error',
            text: `Claude is set up to bill per use (key source: ${event.apiKeySource}). Stopped on purpose so nothing gets charged.`,
          });
          return;
        }
        if (event.sessionId) this.#sessionId = event.sessionId;
        if (event.kind === 'run-done') reportedDone = true;
        this.#onEvent(event);
      }
    });

    child.on('close', (code) => {
      if (finished) return;
      if (timedOut) {
        this.#onEvent({ kind: 'error', text: `Claude took too long (over ${describeDuration(this.#timeoutMs)}) and was stopped.` });
      } else if (!reportedDone && !aborted) {
        const detail = stderrTail.trim() ? ` ${stderrTail.trim()}` : '';
        this.#onEvent({ kind: 'error', text: `Claude stopped without finishing (exit code ${code}).${detail}` });
      }
      finish();
    });
  }
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `node --test test/claude-runner.test.js`
Expected: PASS, 8 tests, in about 2 seconds.

- [ ] **Step 7: Commit**

```bash
git add server/claude-runner.js test/claude-runner.test.js test/fake-claude.js test/helpers.js
git commit -m "Run Claude one message at a time with a waiting line and safety stops" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: What each event looks like on screen

**Files:**
- Create: `public/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Produces: `eventToView(event): { cls: string, label: string, text: string } | null` and `statusText(event): string | null`. `cls` values: `user`, `claude`, `step`, `step bad`, `done`, `error`. `statusText` returns `Claude is working…` for `working`, `Ready` for `idle`, otherwise `null`. A queued status event becomes a row saying the message is waiting in line.
- This file is loaded by the browser as an ES module and by the tests, so it must not touch `document` or `window`.

- [ ] **Step 1: Write the failing test `test/render.test.js`**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { eventToView, statusText } from '../public/render.js';

test('a person\'s message shows their name', () => {
  assert.deepEqual(eventToView({ kind: 'user', who: 'Brennan', text: 'hi' }), { cls: 'user', label: 'Brennan', text: 'hi' });
});

test('Claude\'s words and steps look different from each other', () => {
  assert.equal(eventToView({ kind: 'claude-text', text: 'done' }).cls, 'claude');
  assert.equal(eventToView({ kind: 'claude-step', summary: 'Write hello.txt' }).text, 'Write hello.txt');
});

test('only failed tool results appear', () => {
  assert.equal(eventToView({ kind: 'claude-step-result', ok: true, text: 'fine' }), null);
  assert.match(eventToView({ kind: 'claude-step-result', ok: false, text: 'denied' }).text, /Problem: denied/);
});

test('a finished run shows time and plan usage, and says it is not billed', () => {
  const view = eventToView({ kind: 'run-done', ok: true, durationMs: 6741, costUsd: 0.4013575 });
  assert.equal(view.cls, 'done');
  assert.match(view.text, /Finished in 6\.7s/);
  assert.match(view.text, /\$0\.40/);
  assert.match(view.text, /not billed/);
});

test('a failed run is shown as an error', () => {
  assert.equal(eventToView({ kind: 'run-done', ok: false, durationMs: 1000 }).cls, 'error');
});

test('a queued message says it is waiting in line', () => {
  const view = eventToView({ kind: 'status', state: 'queued', who: 'Max' });
  assert.match(view.text, /Max sent a message/);
  assert.match(view.text, /waiting in line/);
});

test('working and idle change the status pill but add no row', () => {
  assert.equal(eventToView({ kind: 'status', state: 'working' }), null);
  assert.equal(statusText({ kind: 'status', state: 'working' }), 'Claude is working…');
  assert.equal(statusText({ kind: 'status', state: 'idle' }), 'Ready');
  assert.equal(statusText({ kind: 'status', state: 'queued' }), null);
  assert.equal(statusText({ kind: 'user' }), null);
});

test('errors and unknown events', () => {
  assert.deepEqual(eventToView({ kind: 'error', text: 'boom' }), { cls: 'error', label: '', text: 'boom' });
  assert.equal(eventToView({ kind: 'mystery' }), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/render.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `public/render.js`.

- [ ] **Step 3: Write `public/render.js`**

```js
// Turns an event from the timeline into something to show on screen.
// Returns null when the event should not appear as a row.

function describeRun(event) {
  const seconds = typeof event.durationMs === 'number' ? ` in ${(event.durationMs / 1000).toFixed(1)}s` : '';
  const usage = typeof event.costUsd === 'number' && event.costUsd > 0
    ? ` Used your plan allowance (worth about $${event.costUsd.toFixed(2)} at list price, not billed).`
    : '';
  return event.ok ? `Finished${seconds}.${usage}` : `Stopped with a problem${seconds}.${usage}`;
}

export function eventToView(event) {
  switch (event.kind) {
    case 'user':
      return { cls: 'user', label: event.who, text: event.text };
    case 'claude-text':
      return { cls: 'claude', label: 'Claude', text: event.text };
    case 'claude-step':
      return { cls: 'step', label: '', text: event.summary };
    case 'claude-step-result':
      return event.ok ? null : { cls: 'step bad', label: '', text: `Problem: ${event.text}` };
    case 'run-done':
      return { cls: event.ok ? 'done' : 'error', label: '', text: describeRun(event) };
    case 'error':
      return { cls: 'error', label: '', text: event.text };
    case 'status':
      return event.state === 'queued'
        ? { cls: 'step', label: '', text: `${event.who} sent a message. It's waiting in line and will start by itself.` }
        : null;
    default:
      return null;
  }
}

// The words in the little status pill at the top. Returns null for events that don't change it.
export function statusText(event) {
  if (event.kind !== 'status') return null;
  if (event.state === 'working') return 'Claude is working…';
  if (event.state === 'idle') return 'Ready';
  return null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/render.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add public/render.js test/render.test.js
git commit -m "Decide how each event looks on screen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The web server, with safety checks

**Files:**
- Create: `server/http-app.js`
- Test: `test/http-app.test.js`

**Interfaces:**
- Consumes: `Timeline` (Task 5), a runner with `send(text, who)` (Task 6), and test helpers (Task 6).
- Produces: `createApp({ timeline, runner, publicDir, userName = 'You' }): (req, res) => Promise<void>`, a request handler for `http.createServer`. Routes: `GET /`, `/app.js`, `/render.js`, `/styles.css` (only these four files are ever served, from `publicDir`); `GET /events` (live feed; honors `Last-Event-ID`; each message is `id: <n>\ndata: <json>\n\n`); `POST /send` with JSON `{ "text": "..." }` returns 202 and adds a `user` event to the timeline then calls `runner.send(text, userName)`.
- Safety it enforces: requests whose `Host` is not `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>` get 403; `POST /send` with an `Origin` from any other site gets 403; non-JSON content type gets 415; body over 64 KB gets 413; empty or over 8000 characters or invalid JSON gets 400.

- [ ] **Step 1: Write the failing test `test/http-app.test.js`**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/http-app.js';
import { Timeline } from '../server/timeline.js';
import { closeServer, listen, readEvents, tempDir } from './helpers.js';

// A running copy of the web server with a pretend runner that just records what it was sent.
async function start(t) {
  const publicDir = tempDir(t);
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<title>Shared workspace</title>');
  const timeline = new Timeline();
  const sent = [];
  const runner = { send: (text, who) => sent.push({ text, who }) };
  const { server, port } = await listen(createApp({ timeline, runner, publicDir, userName: 'Brennan' }));
  t.after(() => closeServer(server));
  return { base: `http://127.0.0.1:${port}`, port, timeline, sent };
}

const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('serves the page', async (t) => {
  const { base } = await start(t);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Shared workspace/);
});

test('unknown addresses are not found, and other files on the computer cannot be asked for', async (t) => {
  const { base } = await start(t);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});

test('a sent message goes on the timeline and to Claude', async (t) => {
  const { base, timeline, sent } = await start(t);
  const res = await fetch(`${base}/send`, json({ text: '  make hello.txt  ' }));
  assert.equal(res.status, 202);
  assert.deepEqual(sent, [{ text: 'make hello.txt', who: 'Brennan' }]);
  assert.deepEqual(timeline.all().map((e) => [e.kind, e.who, e.text]), [['user', 'Brennan', 'make hello.txt']]);
});

test('rejects empty, oversized and non-JSON messages without bothering Claude', async (t) => {
  const { base, sent } = await start(t);
  assert.equal((await fetch(`${base}/send`, json({ text: '   ' }))).status, 400);
  assert.equal((await fetch(`${base}/send`, json({ text: 'x'.repeat(9000) }))).status, 400);
  assert.equal((await fetch(`${base}/send`, json({ nope: 1 }))).status, 400);
  assert.equal((await fetch(`${base}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status, 400);
  assert.equal((await fetch(`${base}/send`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' })).status, 415);
  assert.equal((await fetch(`${base}/send`, json({ text: 'y'.repeat(100_000) }))).status, 413);
  assert.deepEqual(sent, []);
});

test('blocks messages that come from another website', async (t) => {
  const { base, sent } = await start(t);
  const res = await fetch(`${base}/send`, { ...json({ text: 'hi' }), headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' } });
  assert.equal(res.status, 403);
  assert.deepEqual(sent, []);
});

test('blocks requests addressed to some other host name', async (t) => {
  const { port, sent } = await start(t);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/send', method: 'POST', headers: { host: 'evil.example.com', 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ text: 'hi' }));
  });
  assert.equal(status, 403);
  assert.deepEqual(sent, []);
});

test('the live feed replays what happened, then streams new events', async (t) => {
  const { base, timeline } = await start(t);
  timeline.add({ kind: 'user', text: 'one' });
  const reading = readEvents(`${base}/events`, (events) => events.length >= 2);
  await new Promise((resolve) => setTimeout(resolve, 50));
  timeline.add({ kind: 'claude-text', text: 'two' });
  const events = await reading;
  assert.deepEqual(events.map((e) => e.text), ['one', 'two']);
});

test('a reconnecting browser only gets what it missed', async (t) => {
  const { base, timeline } = await start(t);
  timeline.add({ kind: 'user', text: 'one' });
  timeline.add({ kind: 'user', text: 'two' });
  const events = await readEvents(`${base}/events`, (list) => list.length >= 1, { headers: { 'last-event-id': '1' } });
  assert.deepEqual(events.map((e) => e.text), ['two']);
});

test('the live feed answers right away, even before anything has happened', async (t) => {
  const { base } = await start(t);
  const controller = new AbortController();
  const res = await fetch(`${base}/events`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  controller.abort();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/http-app.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/http-app.js`.

- [ ] **Step 3: Write `server/http-app.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

// Only these files are ever served, so nobody can ask for other files on the computer.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/render.js': ['render.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 8000;

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Message too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createApp({ timeline, runner, publicDir, userName = 'You' }) {
  function serveStatic(res, [file, type]) {
    try {
      const body = fs.readFileSync(path.join(publicDir, file));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      sendJson(res, 500, { error: 'A page file is missing' });
    }
  }

  // The live feed. A reconnecting browser sends Last-Event-ID, so it only gets what it missed.
  function serveEvents(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    // Send the headers now, so the browser knows it is connected even before anything happens.
    res.flushHeaders();
    const lastSeen = Number(req.headers['last-event-id'] ?? 0) || 0;
    const write = (event) => res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    for (const event of timeline.all()) {
      if (event.id > lastSeen) write(event);
    }
    const unsubscribe = timeline.subscribe(write);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    ping.unref();
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  }

  async function handleSend(req, res, allowedOrigins) {
    // Stops other websites from sending messages to your Claude through your browser.
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return sendJson(res, 403, { error: 'Not allowed from that site' });
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return sendJson(res, 415, { error: 'Send JSON' });
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return error.status === 413
        ? sendJson(res, 413, { error: 'Message too large' })
        : sendJson(res, 400, { error: 'That was not valid JSON' });
    }

    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text || text.length > MAX_MESSAGE_CHARS) {
      return sendJson(res, 400, { error: `Write a message of 1 to ${MAX_MESSAGE_CHARS} characters` });
    }

    timeline.add({ kind: 'user', who: userName, text });
    runner.send(text, userName);
    return sendJson(res, 202, { ok: true });
  }

  return async function handle(req, res) {
    try {
      // Only answer requests addressed to this computer, which blocks "DNS rebinding" tricks.
      const port = req.socket.localPort;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
      if (!hosts.includes(req.headers.host)) return sendJson(res, 403, { error: 'Unknown host' });

      const { pathname } = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && STATIC_FILES[pathname]) return serveStatic(res, STATIC_FILES[pathname]);
      if (req.method === 'GET' && pathname === '/events') return serveEvents(req, res);
      if (req.method === 'POST' && pathname === '/send') {
        return await handleSend(req, res, hosts.map((host) => `http://${host}`));
      }
      return sendJson(res, 404, { error: 'Not found' });
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong' });
    }
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --test test/http-app.test.js`
Expected: PASS, 9 tests.

(Found while running this plan: the first version had no `res.flushHeaders()` and no ninth test, so the page's status badge stayed on "Connecting…" until the first message arrived. Both are now included above.)

- [ ] **Step 5: Commit**

```bash
git add server/http-app.js test/http-app.test.js
git commit -m "Add the web server with host and origin safety checks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The page, the start-up file, and the end-to-end test

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `server/index.js`
- Test: `test/e2e.test.js`

**Interfaces:**
- Consumes: `loadConfig` (Task 3), `Timeline` (Task 5), `ClaudeRunner` (Task 6), `createApp` (Task 8), `eventToView` and `statusText` (Task 7).
- Produces: `npm start` runs the whole thing on `http://localhost:3000` (port from `PORT`), listening on `127.0.0.1` only. Claude works inside `PROJECT_DIR` (default `workspace-data/demo`), which is created if missing.

- [ ] **Step 1: Write the failing end-to-end test `test/e2e.test.js`**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ClaudeRunner } from '../server/claude-runner.js';
import { createApp } from '../server/http-app.js';
import { Timeline } from '../server/timeline.js';
import { FAKE_CLAUDE, closeServer, listen, readEvents, tempDir } from './helpers.js';

test('a message typed in the window makes Claude do the work and the steps stream back', async (t) => {
  const projectDir = tempDir(t);
  const timeline = new Timeline();
  const runner = new ClaudeRunner({
    command: process.execPath,
    baseArgs: [FAKE_CLAUDE],
    cwd: projectDir,
    onEvent: (event) => timeline.add(event),
  });
  const { server, port } = await listen(createApp({ timeline, runner, publicDir: projectDir, userName: 'Brennan' }));
  t.after(() => closeServer(server));
  const base = `http://127.0.0.1:${port}`;

  const sent = await fetch(`${base}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'create a file WRITE:hello.txt' }),
  });
  assert.equal(sent.status, 202);

  // Wait for "idle", which comes after "run-done" once Claude has fully stopped.
  const events = await readEvents(`${base}/events`, (list) => list.some((e) => e.kind === 'status' && e.state === 'idle'));
  const kinds = events.map((e) => e.kind);
  for (const expected of ['user', 'run-start', 'claude-step', 'claude-text', 'run-done']) {
    assert.ok(kinds.includes(expected), `missing ${expected} in ${kinds.join(', ')}`);
  }
  assert.equal(fs.readFileSync(path.join(projectDir, 'hello.txt'), 'utf8'), 'hi');
});
```

- [ ] **Step 2: Run it**

Run: `node --test test/e2e.test.js`
Expected: PASS (every module it needs already exists). This test locks in that the pieces fit together before the page and start-up file are added.

- [ ] **Step 3: Write `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shared workspace</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header>
    <h1>Shared workspace</h1>
    <span id="status" class="pill">Connecting…</span>
  </header>
  <main id="timeline" aria-live="polite"></main>
  <form id="composer" autocomplete="off">
    <input id="message" type="text" placeholder="Tell Claude what to do, for example: create a file called hello.txt" aria-label="Message to Claude" autofocus>
    <button type="submit">Send</button>
  </form>
  <script type="module" src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write `public/styles.css`**

```css
:root {
  color-scheme: light dark;
  --line: color-mix(in srgb, currentColor 18%, transparent);
  --bad: #b3261e;
  --claude: #6750a4;
  --person: #0b57d0;
}
@media (prefers-color-scheme: dark) {
  :root { --bad: #f2b8b5; --claude: #d0bcff; --person: #a8c7fa; }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  font: 16px/1.5 system-ui, sans-serif;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
h1 { margin: 0; font-size: 18px; font-weight: 600; }
.pill { font-size: 13px; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; }
#timeline { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; gap: 8px; max-width: 760px; }
.row .label { font-weight: 600; flex: none; }
.row .text { white-space: pre-wrap; overflow-wrap: anywhere; }
.row.user .label { color: var(--person); }
.row.claude .label { color: var(--claude); }
.row.step, .row.done { font-size: 14px; opacity: 0.75; }
.row.step .text::before { content: "› "; }
.row.bad .text, .row.error .text { color: var(--bad); }
#composer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); }
#message { flex: 1; font: inherit; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; }
button { font: inherit; padding: 8px 16px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
```

- [ ] **Step 5: Write `public/app.js`**

```js
import { eventToView, statusText } from './render.js';

const timelineEl = document.getElementById('timeline');
const statusEl = document.getElementById('status');
const form = document.getElementById('composer');
const input = document.getElementById('message');

// Adds one row to the timeline. Text is set with textContent, never as HTML.
function addRow({ cls, label, text }) {
  const stickToBottom = timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight < 80;
  const row = document.createElement('div');
  row.className = `row ${cls}`;
  if (label) {
    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;
    row.append(labelEl);
  }
  const textEl = document.createElement('span');
  textEl.className = 'text';
  textEl.textContent = text;
  row.append(textEl);
  timelineEl.append(row);
  if (stickToBottom) timelineEl.scrollTop = timelineEl.scrollHeight;
}

const source = new EventSource('/events');
source.onopen = () => {
  statusEl.textContent = 'Connected';
};
source.onerror = () => {
  statusEl.textContent = 'Reconnecting…';
};
source.onmessage = (message) => {
  const event = JSON.parse(message.data);
  const status = statusText(event);
  if (status) statusEl.textContent = status;
  const view = eventToView(event);
  if (view) addRow(view);
};

form.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    const response = await fetch('/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) addRow({ cls: 'error', label: '', text: `Couldn't send that message (error ${response.status}).` });
  } catch {
    addRow({ cls: 'error', label: '', text: "Couldn't reach the server. Is it still running?" });
  }
});
```

- [ ] **Step 6: Write `server/index.js`**

```js
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ClaudeRunner } from './claude-runner.js';
import { loadConfig } from './config.js';
import { createApp } from './http-app.js';
import { Timeline } from './timeline.js';

const root = path.resolve(import.meta.dirname, '..');
const config = loadConfig({ root });
fs.mkdirSync(config.projectDir, { recursive: true });

const timeline = new Timeline();
const runner = new ClaudeRunner({
  command: config.claudeCommand,
  baseArgs: config.claudeArgs,
  cwd: config.projectDir,
  onEvent: (event) => timeline.add(event),
});
const app = createApp({
  timeline,
  runner,
  publicDir: path.join(root, 'public'),
  userName: config.userName,
});

// 127.0.0.1 means "this computer only": nothing else on the network can reach it.
http.createServer(app).listen(config.port, '127.0.0.1', () => {
  console.log(`Shared workspace is running at http://localhost:${config.port}`);
  console.log(`Claude works in this folder: ${config.projectDir}`);
  console.log('Press Ctrl+C to stop.');
});
```

- [ ] **Step 7: Run every test**

Run: `npm test`
Expected: PASS, 50 tests, 0 failures.

- [ ] **Step 8: Check the server starts and serves the page**

Run (in one terminal): `npm start`
Expected output includes: `Shared workspace is running at http://localhost:3000`

Run (in a second terminal): `curl -s -o NUL -w "%{http_code}" http://localhost:3000/` (on Windows PowerShell use `curl.exe`)
Expected: `200`. Then stop the server with Ctrl+C.

- [ ] **Step 9: Commit**

```bash
git add public server/index.js test/e2e.test.js
git commit -m "Add the page and the start-up file" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The real test with your own Claude, and writing down what we learn

This is the Stage 1 pass/fail check from the spec. It uses the real Claude on this PC, so it spends a little of the Claude plan allowance (about the equivalent of a few cents to under a dollar per message at list price, not billed). Everything before this used the fake.

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/stage-1-results.md`

**Interfaces:**
- Consumes: the running app from Task 9.

- [ ] **Step 1: Write `README.md`**

```markdown
# Shared workspace

A web page where you type a message and your own Claude does the work in a
project folder, while you watch every step appear live.

## Start it

1. Open a terminal in this folder.
2. Run `npm start`.
3. Open http://localhost:3000 in your browser.
4. Type what you want, for example: Create a file called hello.txt containing the word hi.

Claude works inside `workspace-data/demo`. To use another folder, set
`PROJECT_DIR` before starting. To stop it, press Ctrl+C in the terminal.

## What it will and won't do

- It uses your Claude plan login. It never uses an API key, and it refuses to run if
  Claude says it is set up to bill per use.
- Claude can create and edit files without asking, and can run simple harmless
  commands. Anything riskier, like reaching the internet, is blocked. Claude will
  say so, but there is no approve button yet.
- Only this computer can reach the page.

## Run the tests

`npm test` (they use a fake Claude, so they cost nothing).
```

- [ ] **Step 2: Start the app and open the page**

Run: `npm start`, then open http://localhost:3000 in the browser pane or your own browser.
Expected: header "Shared workspace", status pill "Connected" (then "Ready" after the first run), an empty timeline, a message box.

- [ ] **Step 3: Check 1 - Claude does a real job and the steps stream back**

Type: `Create a file called hello.txt containing the word hi.`
Expected, in order: a row "Brennan: Create a file called hello.txt ..."; pill changes to "Claude is working…"; a step row "› Write hello.txt"; a Claude row (for example "Done. Created hello.txt ..."); a row "Finished in N.Ns. Used your plan allowance (worth about $X.XX at list price, not billed)."; pill returns to "Ready". The first step must appear within a few seconds of sending.

Then check the file: `type workspace-data\demo\hello.txt` (PowerShell: `Get-Content workspace-data\demo\hello.txt`).
Expected: `hi`.

- [ ] **Step 4: Check 2 - Claude remembers the conversation (the real `--resume`)**

Type: `What file did you just create, and what is in it?`
Expected: Claude's answer mentions `hello.txt` and `hi`. If it says it does not know, `--resume` is not working with the real Claude: stop and record that in Step 7 instead of working around it.

- [ ] **Step 5: Check 3 - waiting in line**

Send two messages quickly, one after the other, for example `Create a file called one.txt containing 1.` then immediately `Create a file called two.txt containing 2.`
Expected: a row saying "Brennan sent a message. It's waiting in line and will start by itself."; the first finishes; the second starts without you doing anything; both files exist; you could keep typing the whole time.

- [ ] **Step 6: Check 4 - what happens when Claude wants to run a command**

Type: `Run the command echo hello and tell me what it printed.`
Expected: not a pass/fail. Record exactly what appears (a "Problem:" row about permission, Claude saying it cannot, or the command running). This tells us how to handle commands in a later plan.

- [ ] **Step 7: Write down what we measured in `docs/superpowers/stage-1-results.md`**

Copy the structure below and replace each `<...>` with the real value you observed. Do not leave any `<...>` in the saved file.

```markdown
# Stage 1 results

Date: <today's date>
Claude Code version: <output of `claude --version`>

| Check (from spec section 9, Stage 1) | Result |
|---|---|
| Message in window -> Claude does it -> steps appear within a few seconds | <PASS or FAIL, and seconds until the first step row> |
| The file exists on this computer afterward | <PASS or FAIL> |
| No API key appears anywhere in the code or settings | <PASS or FAIL: result of `npm test`> |

## Also measured

- Claude remembers the previous message (real `--resume`): <yes or no, and what Claude said>
- A message sent while busy waits in line and then runs by itself: <yes or no>
- Time for the hello.txt message start to finish: <seconds>
- Plan usage shown per message (list-price estimate): <first message $X.XX, later messages $X.XX>
- What happened when Claude wanted to run a command: <exactly what appeared>
- Anything surprising: <one line each, or "nothing">

## What this means for Stage 2

<2 to 4 plain sentences: does the helper idea hold up, what to change in the next plan, and whether plan usage per message is acceptable.>
```

- [ ] **Step 8: Stop the server and commit**

Press Ctrl+C in the terminal running `npm start`. Then:

```bash
git add README.md docs/superpowers/stage-1-results.md
git commit -m "Stage 1 passes: README and measured results" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

If any of the three spec checks in Step 7 is FAIL, do not commit "passes". Commit with the message `Stage 1 results: <which check failed>` and stop. Tell Brennan in plain English what failed before doing anything else.

---

## After this plan

Each of these is its own plan, written after the one before it passes, using what Stage 1 teaches us:

1. **Stage 2 - Max joins.** Put the page online (hosting plus logins that only let Brennan and Max in), turn this server into a small helper on each computer that connects out to the website, and make each person's messages reach only their own Claude. Before starting: re-read Anthropic's current wording on using a Claude plan this way, and decide how Max installs the helper.
2. **Stage 3 - Shared files and turns.** GitHub folder per project, recap passed to each Claude, one Claude edits at a time across both computers with the quiet waiting line.
3. **Stage 4 - Dashboard and team talk.** Project home page, "Just Max" messages that skip the AI, shared notes.
4. **Stage 5 - Live preview (stretch).**

## Self-review against the spec (Stage 1)

- Spec "message in window -> Claude does it -> steps within seconds": Tasks 6, 8, 9 (tested with the fake) and Task 10 Step 3 (real).
- Spec "file exists on the computer afterward": Task 6 and Task 9 (fake), Task 10 Step 3 (real).
- Spec "no API key anywhere": Task 1 guard test, Task 2 (`buildChildEnv`), Task 6 (refuses non-plan login, never passes a key).
- Spec rule 4 (queue quietly, nobody blocked): Task 6 (waiting line), Task 7 and 9 (shown in the window), Task 10 Step 5 (real).
- Spec rule 7 (only calls out / nothing reaches in): Stage 1 is local-only; Task 8 locks the server to this computer. The outbound helper is Stage 2.
- Event names, function names and file names were checked to match across tasks (see the Event reference).
