import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildChildEnv } from './child-env.js';
import { killTree } from './kill-tree.js';
import { parseStreamLine } from './stream-parser.js';

// "none" and "oauth" mean Claude is signed in with a Claude plan.
// Anything else (including a missing value) means an API key or something we do not know,
// and the run is stopped on purpose.
const PLAN_LOGIN_SOURCES = new Set(['none', 'oauth']);

// Flags that must never reach Claude, whoever asks. --bare skips the Claude plan login (it only works with
// an API key). The others turn the permission checks off.
const FORBIDDEN_FLAGS = new Set(['--bare', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions']);

const SILENCE_MS = 8 * 60 * 1000;
const SILENCE_CHECK_MS = 15_000;

function describeDuration(ms) {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} min`;
  return ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
}

function checkBaseArgs(args) {
  const bad = args.find((arg) => FORBIDDEN_FLAGS.has(String(arg)));
  if (bad) throw new Error(`The flag ${bad} is never allowed here.`);
}

// The only extra flag a single message may add is an allowance for exact commands (an approval).
// Anything else is refused, so a message can never widen what Claude may do.
function checkExtraArgs(args) {
  if (!args.length) return;
  const [flag, ...rules] = args;
  if (flag !== '--allowedTools' || !rules.length || rules.some((rule) => typeof rule !== 'string' || rule.startsWith('-'))) {
    throw new Error('This run was refused: only an approval of one exact command may be added to a message.');
  }
}

// Runs Claude one message at a time. Extra messages wait in line and start by themselves.
export class ClaudeRunner {
  #command;
  #baseArgs;
  #cwd;
  #env;
  #onEvent;
  #timeoutMs;
  #silenceMs;
  #silenceCheckMs;
  #queue = [];
  #busy = false;
  #sessionId = null;
  #cancelRun = null;

  constructor({
    command,
    baseArgs = [],
    cwd,
    env = process.env,
    onEvent,
    timeoutMs = 15 * 60 * 1000,
    silenceMs = SILENCE_MS,
    silenceCheckMs = SILENCE_CHECK_MS,
  }) {
    checkBaseArgs(baseArgs);
    this.#command = command;
    this.#baseArgs = baseArgs;
    this.#cwd = cwd;
    this.#env = env;
    this.#onEvent = onEvent;
    this.#timeoutMs = timeoutMs;
    this.#silenceMs = silenceMs;
    this.#silenceCheckMs = silenceCheckMs;
  }

  get busy() {
    return this.#busy;
  }

  // Stops the run that is happening now, if any, and everything Claude started. Messages waiting in line
  // still run afterwards.
  cancel() {
    this.#cancelRun?.();
  }

  // options.extraArgs: extra Claude flags for this one message only (for example an approval).
  send(text, who, options = {}) {
    const extraArgs = options.extraArgs ?? [];
    try {
      checkExtraArgs(extraArgs);
    } catch (error) {
      this.#onEvent({ kind: 'error', text: error.message });
      this.#onEvent({ kind: 'status', state: 'idle' });
      return;
    }
    const job = { text, who, extraArgs };
    if (this.#busy) {
      this.#queue.push(job);
      this.#onEvent({ kind: 'status', state: 'queued', who, position: this.#queue.length });
      return;
    }
    this.#run(job);
  }

  #run({ text, who, extraArgs }) {
    this.#busy = true;
    this.#onEvent({ kind: 'status', state: 'working', who });

    // After the first message, keep talking in the same conversation.
    const resume = this.#sessionId ? ['--resume', this.#sessionId] : [];
    const args = [...this.#baseArgs, ...resume, ...extraArgs];
    let finished = false;
    let reportedDone = false;
    let aborted = false;
    let timedOut = false;
    let cancelled = false;
    let silent = false;
    let stderrTail = '';
    let timer = null;
    let watchdog = null;
    let child = null;
    let lastOutputAt = Date.now();
    let toolsRunning = 0;
    this.#cancelRun = () => {
      cancelled = true;
      killTree(child);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      this.#cancelRun = null;
      if (timer) clearTimeout(timer);
      if (watchdog) clearInterval(watchdog);
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
        // On Mac and Linux, make Claude the leader of its own group so a stop reaches everything it started.
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      fail(`Couldn't start Claude: ${error.message}`);
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, this.#timeoutMs);

    // A run that has printed nothing for a long while is stuck. A tool that is still running (a long test
    // run, an install) is allowed to be quiet: the overall time limit above covers that case.
    watchdog = setInterval(() => {
      if (finished || toolsRunning > 0 || Date.now() - lastOutputAt < this.#silenceMs) return;
      silent = true;
      killTree(child);
    }, this.#silenceCheckMs);
    watchdog.unref?.();

    child.on('error', (error) => fail(`Couldn't start Claude: ${error.message}`));
    child.stdin.on('error', () => {});
    // The message goes in through stdin, never on the command line, so nothing typed
    // in the window can be read as a command by the shell.
    child.stdin.end(text);
    child.stdout.on('data', () => {
      lastOutputAt = Date.now();
    });
    child.stderr.on('data', (chunk) => {
      lastOutputAt = Date.now();
      stderrTail = (stderrTail + chunk).slice(-500);
    });

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (aborted) return;
      for (const event of parseStreamLine(line)) {
        if (event.kind === 'run-start' && !PLAN_LOGIN_SOURCES.has(event.apiKeySource)) {
          aborted = true;
          killTree(child);
          this.#onEvent({
            kind: 'error',
            text: `Claude is set up to bill per use (key source: ${event.apiKeySource}). Stopped on purpose so nothing gets charged.`,
          });
          return;
        }
        if (event.kind === 'claude-step') toolsRunning += 1;
        if (event.kind === 'claude-step-result') toolsRunning = Math.max(0, toolsRunning - 1);
        if (event.sessionId) this.#sessionId = event.sessionId;
        if (event.kind === 'run-done') reportedDone = true;
        this.#onEvent(event);
      }
    });

    child.on('close', (code) => {
      if (finished) return;
      if (cancelled) {
        this.#onEvent({ kind: 'error', text: 'This run was stopped.' });
      } else if (timedOut) {
        this.#onEvent({ kind: 'error', text: `Claude took too long (over ${describeDuration(this.#timeoutMs)}) and was stopped.` });
      } else if (silent) {
        this.#onEvent({ kind: 'error', text: `Claude went quiet for ${describeDuration(this.#silenceMs)} and was stopped.` });
      } else if (!reportedDone && !aborted) {
        const detail = stderrTail.trim() ? ` ${stderrTail.trim()}` : '';
        this.#onEvent({ kind: 'error', text: `Claude stopped without finishing (exit code ${code}).${detail}` });
      }
      finish();
    });
  }
}
