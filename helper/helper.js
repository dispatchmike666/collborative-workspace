import path from 'node:path';
import { ClaudeRunner } from '../server/claude-runner.js';
import { buildPreviewBundle, buildSourceBundle, listProjectFiles } from './files.js';
import { GitSync } from './git-sync.js';
import { connectSse } from './sse-client.js';

const PROJECT_ID = /^[a-z0-9-]{1,80}$/;
const REPO_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// An approval may only allow one exact Bash or PowerShell command: no wildcards, no extra rules.
const ALLOWED_RULE = /^(Bash|PowerShell)\([^*()\r\n\u0000]{1,500}\)$/;

function checkContext(context) {
  if (context === undefined) return true;
  if (!context || typeof context !== 'object') return false;
  const { brief, decisions, notes } = context;
  if (typeof brief !== 'string' || brief.length > 5000) return false;
  if (typeof notes !== 'string' || notes.length > 4000) return false;
  return Array.isArray(decisions) && decisions.length <= 30 && decisions.every((d) => typeof d === 'string' && d.length <= 400);
}

// Checks a job from the hub before anything runs, so a bad job can never touch other folders,
// fetch from other addresses, or widen what Claude is allowed to do.
export function validateJob(job) {
  const refuse = (why) => {
    throw new Error(`This job was refused: ${why}.`);
  };
  if (!job || typeof job !== 'object') refuse('it was not a job');
  if (typeof job.jobId !== 'string' || !job.jobId) refuse('it had no id');
  if (!PROJECT_ID.test(String(job.projectId))) refuse('the project id is not valid');
  if (job.repoUrl !== null && !REPO_URL.test(String(job.repoUrl))) refuse('the repository address is not valid');
  if (typeof job.text !== 'string' || !job.text.trim()) refuse('it had no message');
  if (!Array.isArray(job.allowedTools) || !job.allowedTools.every((rule) => typeof rule === 'string' && ALLOWED_RULE.test(rule))) {
    refuse('the allowed commands are not valid');
  }
  if (!checkContext(job.context)) refuse('the project context is not valid');
  return job;
}

// What Claude is actually told: the project's standing instructions and settled decisions, the shared
// notes if they are shared, a short recap of what teammates did, and then the request itself.
export function composePrompt({ context, recap, who, text }) {
  const sections = [];
  if (context?.brief) sections.push(`Project instructions (always follow these):\n${context.brief}`);
  if (context?.decisions?.length) {
    const lines = context.decisions.map((decision) => `- ${decision}`).join('\n');
    sections.push(`Decisions the team has settled (keep to these):\n${lines}`);
  }
  if (context?.notes) sections.push(`Shared project notes (for reference):\n${context.notes}`);
  if (recap) {
    sections.push(`This is a shared project. Since you last worked on it, your teammates did the following (you did not do these things):\n${recap}`);
  }
  if (!sections.length) return text;
  return [...sections, `${who}'s request:\n${text}`].join('\n\n');
}

const oneLine = (text, max) => {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

// Claude says this when the sign-in on this computer has run out. We explain it in plain words.
const SIGN_IN_PROBLEM = /failed to authenticate|oauth session expired|not logged in|please run \/login/i;
const SIGN_IN_HELP = 'Your Claude sign-in has expired on this computer. Open a terminal, run: claude   then type /login and sign in again. After that, send your request again.';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The program that runs on each person's own computer. It connects out to the hub, and when the
// hub hands it a job it runs that person's own Claude on the project, then reports back.
export class Helper {
  #hubUrl;
  #token;
  #root;
  #claudeCommand;
  #claudeArgs;
  #env;
  #git;
  #fetch;
  #log;
  #onFatal;
  #sseOptions;
  #runnerTimeoutMs;
  #liveChats;
  #chatScanMs;
  #chatTimer = null;
  #chatsSentAt = 0;
  #chatsSentText = '';
  #chatsPosting = false;
  #connected = false;
  #connection = null;
  #runners = new Map();
  #contexts = new Map();
  #active = new Map();
  #previewSent = new Set();

  // `liveChats` is a ChatWatcher (see live-chats.js). Leave it out and the helper does not look at
  // your open Claude chats at all.
  constructor({
    hubUrl,
    token,
    workspaceRoot,
    claudeCommand,
    claudeArgs,
    env = process.env,
    gitSync = new GitSync(),
    fetchImpl = fetch,
    log = () => {},
    onFatal = () => {},
    sseOptions = {},
    runnerTimeoutMs,
    liveChats = null,
    chatScanMs = 5000,
  }) {
    this.#liveChats = liveChats;
    this.#chatScanMs = chatScanMs;
    this.#onFatal = onFatal;
    this.#hubUrl = hubUrl.replace(/\/+$/, '');
    this.#token = token;
    this.#root = workspaceRoot;
    this.#claudeCommand = claudeCommand;
    this.#claudeArgs = claudeArgs;
    this.#env = env;
    this.#git = gitSync;
    this.#fetch = fetchImpl;
    this.#log = log;
    this.#sseOptions = sseOptions;
    this.#runnerTimeoutMs = runnerTimeoutMs;
  }

  get activeJobs() {
    return this.#active.size;
  }

  start() {
    this.#connection = connectSse({
      url: `${this.#hubUrl}/helper/connect`,
      headers: { authorization: `Bearer ${this.#token}` },
      fetchImpl: this.#fetch,
      onMessage: (message) => this.#onMessage(message),
      onOpen: () => {
        this.#log('Connected to the hub. Waiting for work.');
        this.#connected = true;
        this.#chatsSentAt = 0;
        this.#publishChats();
      },
      onClose: (error) => {
        this.#connected = false;
        this.#log(`Lost the connection to the hub (${error.message}). Trying again…`);
      },
      onFatal: (message) => {
        this.#log(message);
        this.#onFatal(message);
      },
      ...this.#sseOptions,
    });
    if (this.#liveChats) {
      this.#chatTimer = setInterval(() => this.#publishChats(), this.#chatScanMs);
      this.#chatTimer.unref?.();
    }
  }

  stop() {
    clearInterval(this.#chatTimer);
    this.#connection?.stop();
    for (const runner of this.#runners.values()) runner.cancel();
  }

  // Tells the hub which Claude chats are open on this computer, but only when something changed (or every
  // half minute, as a sign of life). Only the person who owns this helper ever sees the list.
  async #publishChats() {
    if (!this.#liveChats || !this.#connected || this.#chatsPosting) return;
    let chats;
    try {
      chats = this.#liveChats.snapshot();
    } catch (error) {
      this.#log(`Could not look at your open chats: ${error.message}`);
      return;
    }
    const text = JSON.stringify(chats);
    if (text === this.#chatsSentText && Date.now() - this.#chatsSentAt < 30_000) return;
    this.#chatsPosting = true;
    try {
      await this.#post('/helper/chats', { chats });
      this.#chatsSentText = text;
      this.#chatsSentAt = Date.now();
    } catch (error) {
      this.#log(`Could not send your open chats: ${error.message}`);
    } finally {
      this.#chatsPosting = false;
    }
  }

  // The hub asks this helper to drop a message into one of this person's own open chats.
  async #handleChatMessage({ requestId, chatId, text, who }) {
    let outcome = { ok: false, message: 'This computer is not set up to reach your chats.' };
    if (this.#liveChats && typeof chatId === 'string' && typeof text === 'string' && text.trim()) {
      try {
        outcome = await this.#liveChats.send(chatId, text, who ?? 'Someone', requestId ? String(requestId) : undefined);
      } catch (error) {
        outcome = { ok: false, message: `Could not reach that chat (${error.message}).` };
      }
    }
    this.#log(outcome.ok ? 'Passed a message to one of your open chats.' : `Could not pass a message on: ${outcome.message}`);
    await this.#post('/helper/chat-result', { requestId: String(requestId ?? ''), ok: outcome.ok, message: outcome.message })
      .catch((error) => this.#log(`Could not report how the message went: ${error.message}`));
    // Tell the hub right away, so the page can show the message as sent without waiting for the next look.
    this.#publishChats();
  }

  #onMessage({ event, data }) {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (event === 'job') this.#handleJob(payload.job).catch((error) => this.#log(`Something went wrong: ${error.message}`));
    else if (event === 'cancel') this.#cancel(payload.jobId);
    else if (event === 'chat-message') this.#handleChatMessage(payload).catch((error) => this.#log(`Something went wrong: ${error.message}`));
  }

  // The hub gave up on a run. Remember that, even if Claude has not started yet,
  // so it never starts afterwards; and stop it now if it is already going.
  #cancel(jobId) {
    const entry = this.#active.get(jobId);
    if (!entry) return;
    entry.cancelled = true;
    this.#runners.get(entry.projectId)?.cancel();
  }

  async #post(route, body) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await this.#fetch(`${this.#hubUrl}${route}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) return;
        // A refusal (like "that run is over") will not change by asking again.
        if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(`The hub refused it (${res.status})`), { final: true });
        lastError = new Error(`The hub answered with error ${res.status}`);
      } catch (error) {
        if (error.final) throw error;
        lastError = error;
      }
      await sleep(300 * 2 ** attempt);
    }
    throw lastError;
  }

  // Collects events and sends them to the hub in small batches, always in order.
  #makeSender(jobId) {
    const pending = [];
    let chain = Promise.resolve();
    let timer = null;
    const flush = () => {
      if (pending.length) {
        const events = pending.splice(0);
        chain = chain.then(() => this.#post('/helper/events', { jobId, events })).catch((error) => this.#log(`Could not send an update: ${error.message}`));
      }
      return chain;
    };
    return {
      add(event) {
        pending.push(event);
        if (pending.length >= 20) flush();
        else if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            flush();
          }, 250);
        }
      },
      flush() {
        clearTimeout(timer);
        timer = null;
        return flush();
      },
    };
  }

  #runnerFor(projectId, cwd) {
    if (!this.#runners.has(projectId)) {
      this.#runners.set(projectId, new ClaudeRunner({
        command: this.#claudeCommand,
        baseArgs: this.#claudeArgs,
        cwd,
        env: this.#env,
        onEvent: (event) => this.#route(projectId, event),
        ...(this.#runnerTimeoutMs ? { timeoutMs: this.#runnerTimeoutMs } : {}),
      }));
    }
    return this.#runners.get(projectId);
  }

  // Claude's events go to whichever job is running on that project.
  #route(projectId, event) {
    const context = this.#contexts.get(projectId);
    if (!context) return;
    if (event.kind === 'status') {
      if (event.state === 'idle') context.finish();
      return;
    }
    if (event.kind === 'run-start') return;
    context.sender.add(event);
    if (event.kind === 'run-done' && !event.ok && SIGN_IN_PROBLEM.test(event.text ?? '')) {
      context.sender.add({ kind: 'error', text: SIGN_IN_HELP });
      this.#log(SIGN_IN_HELP);
    }
  }

  async #handleJob(rawJob) {
    let job;
    try {
      job = validateJob(rawJob);
    } catch (error) {
      this.#log(error.message);
      if (rawJob && typeof rawJob.jobId === 'string') {
        await this.#post('/helper/events', { jobId: rawJob.jobId, events: [{ kind: 'error', text: error.message }] }).catch(() => {});
        await this.#post('/helper/done', { jobId: rawJob.jobId }).catch(() => {});
      }
      return;
    }

    this.#active.set(job.jobId, { projectId: job.projectId, cancelled: false });
    const sender = this.#makeSender(job.jobId);
    const projectDir = path.join(this.#root, job.projectId);
    this.#log(`Starting a job for ${job.who}: ${oneLine(job.text, 60)}`);
    try {
      sender.add({
        kind: 'sync',
        text: job.repoUrl ? 'Getting the latest files…' : 'Starting. This project has no GitHub copy, so its files stay on this computer.',
      });
      await sender.flush();
      await this.#git.prepare({ projectDir, repoUrl: job.repoUrl });
      await this.#runClaude(job, projectDir, sender);
      await this.#saveWork(job, projectDir, sender);
    } catch (error) {
      sender.add({ kind: 'error', text: error.message });
    } finally {
      await sender.flush();
      await this.#post('/helper/done', { jobId: job.jobId }).catch((error) => this.#log(`Could not report the job as finished: ${error.message}`));
      this.#active.delete(job.jobId);
      this.#log('Finished the job.');
    }
  }

  async #runClaude(job, projectDir, sender) {
    if (this.#active.get(job.jobId)?.cancelled) throw new Error('This run was stopped before it started.');
    const runner = this.#runnerFor(job.projectId, projectDir);
    const finished = new Promise((resolve) => {
      this.#contexts.set(job.projectId, { sender, finish: resolve });
    });
    runner.send(composePrompt(job), job.who, {
      extraArgs: job.allowedTools.length ? ['--allowedTools', ...job.allowedTools] : [],
    });
    await finished;
    this.#contexts.delete(job.projectId);
  }

  async #saveWork(job, projectDir, sender) {
    let result = { changed: [], committed: false, pushed: false };
    try {
      result = await this.#git.finish({
        projectDir,
        repoUrl: job.repoUrl,
        message: `${job.who}'s Claude: ${oneLine(job.text, 72)}`,
        who: job.who,
      });
    } catch (error) {
      sender.add({ kind: 'error', text: error.message });
    }

    const count = result.changed.length;
    if (count) {
      const noun = count === 1 ? 'file' : 'files';
      let text = `Saved ${count} changed ${noun} on this computer.`;
      if (job.repoUrl) text = result.pushed ? `Saved ${count} changed ${noun} to GitHub.` : `Saved ${count} changed ${noun} here. GitHub already had them.`;
      sender.add({ kind: 'sync', text });
    }

    await this.#post('/helper/files', { projectId: job.projectId, files: listProjectFiles(projectDir), changed: result.changed })
      .catch((error) => this.#log(`Could not send the file list: ${error.message}`));

    if (count || !this.#previewSent.has(job.projectId)) {
      await this.#post('/helper/sources', { projectId: job.projectId, files: buildSourceBundle(projectDir) })
        .catch((error) => this.#log(`Could not send the readable files: ${error.message}`));
      const bundle = buildPreviewBundle(projectDir);
      if (bundle) {
        try {
          await this.#post('/helper/preview', { projectId: job.projectId, files: bundle.files });
          this.#previewSent.add(job.projectId);
          if (bundle.truncated) sender.add({ kind: 'sync', text: 'The preview left out some large files.' });
        } catch (error) {
          this.#log(`Could not send the preview: ${error.message}`);
        }
      }
    }
  }
}
