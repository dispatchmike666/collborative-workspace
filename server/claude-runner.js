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
  #cancelRun = null;

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

  // Stops the run that is happening now, if any. Messages waiting in line still run afterwards.
  cancel() {
    this.#cancelRun?.();
  }

  // options.extraArgs: extra Claude flags for this one message only (for example an approval).
  send(text, who, options = {}) {
    const job = { text, who, extraArgs: options.extraArgs ?? [] };
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
    let stderrTail = '';
    let timer = null;
    let child = null;
    this.#cancelRun = () => {
      cancelled = true;
      child?.kill();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      this.#cancelRun = null;
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
      if (cancelled) {
        this.#onEvent({ kind: 'error', text: 'This run was stopped.' });
      } else if (timedOut) {
        this.#onEvent({ kind: 'error', text: `Claude took too long (over ${describeDuration(this.#timeoutMs)}) and was stopped.` });
      } else if (!reportedDone && !aborted) {
        const detail = stderrTail.trim() ? ` ${stderrTail.trim()}` : '';
        this.#onEvent({ kind: 'error', text: `Claude stopped without finishing (exit code ${code}).${detail}` });
      }
      finish();
    });
  }
}
