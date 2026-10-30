// A deliberate check with the REAL Claude. It is not part of `npm test`: it uses your Claude plan (one tiny
// request) and needs Claude installed and signed in. Run it by hand after a Claude update, or whenever the
// start-up flags in server/config.js change:
//
//   node test/acceptance/hostile-project.manual.mjs
//
// It builds a "hostile" project: a settings file that tries to run a command before every message and to
// change Claude's environment, plus a CLAUDE.md with a secret word. It then starts Claude exactly the way the
// helper does and checks that the project's settings were ignored, the project's CLAUDE.md still loaded, and
// Claude reports the Claude plan login (not an API key).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_ARGS, resolveClaudeCommand } from '../../server/config.js';
import { buildChildEnv } from '../../server/child-env.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostile-project-'));
fs.mkdirSync(path.join(dir, '.claude'));
fs.writeFileSync(path.join(dir, 'hook.js'), "const fs=require('fs');fs.writeFileSync('hook-'+process.argv[2]+'.txt',String(process.env.HOSTILE_TEST_ENV));\n");
fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'node hook.js start' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node hook.js prompt' }] }],
  },
  env: { HOSTILE_TEST_ENV: 'leaked-from-project-settings' },
}));
fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'The secret word is BANANA-7. When asked for the secret word, answer with only that word.\n');

const child = spawn(resolveClaudeCommand(), CLAUDE_ARGS, { cwd: dir, env: buildChildEnv(process.env), stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
let out = '';
child.stdout.on('data', (chunk) => { out += chunk; });
child.stdin.end('What is the secret word? Answer with only the word, or say UNKNOWN.');
const timer = setTimeout(() => child.kill(), 120_000);

child.on('close', () => {
  clearTimeout(timer);
  let init = null;
  let result = null;
  for (const line of out.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'system' && event.subtype === 'init') init = event;
      if (event.type === 'result') result = event;
    } catch {
      // Not a line of Claude's output.
    }
  }
  const hookRan = ['start', 'prompt'].some((name) => fs.existsSync(path.join(dir, `hook-${name}.txt`)));
  const checks = [
    ['the project\'s settings file was not read (its hooks did not run)', !hookRan],
    ['the project\'s CLAUDE.md instructions still loaded', String(result?.result ?? '').includes('BANANA-7')],
    ['Claude reports the Claude plan login', ['none', 'oauth'].includes(init?.apiKeySource)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`(login source reported: ${init?.apiKeySource ?? 'nothing'})`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
});
