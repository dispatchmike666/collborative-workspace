import crypto from 'node:crypto';
import { buildRecap } from './recap.js';

// What a helper may add to the timeline. Everything else it sends is ignored.
const HELPER_EVENT_KINDS = new Set(['claude-text', 'claude-step', 'claude-step-result', 'run-done', 'error', 'sync']);
const APPROVABLE_TOOLS = new Set(['Bash', 'PowerShell']);
// A command with these in it could widen what an approval allows, so it cannot be approved with a button.
const UNSAFE_COMMAND = /[*()\r\n\u0000]/;
const MAX_COMMAND_CHARS = 500;

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// Decides whose Claude runs next. One run at a time per project; extra requests wait in line;
// a person whose computer is off waits without holding up anyone else.
export class Dispatcher {
  #store;
  #users;
  #jobTimeoutMs;
  #helpers = new Map();
  #projects = new Map();
  #jobs = new Map();
  #lastKnown = new Map();

  constructor({ store, users, jobTimeoutMs = 30 * 60 * 1000 }) {
    this.#store = store;
    this.#users = users;
    this.#jobTimeoutMs = jobTimeoutMs;
  }

  // ---- who is online ----

  isOnline(user) {
    return this.#helpers.has(String(user).toLowerCase());
  }

  presence() {
    return Object.fromEntries(this.#users().map((name) => [name, this.isOnline(name)]));
  }

  // A helper connects. `send(message)` delivers a message to it. Returns the function to call
  // when that connection closes.
  registerHelper(userName, send) {
    const name = this.#canonical(userName);
    const key = name.toLowerCase();
    const connectionId = crypto.randomUUID();
    this.#helpers.set(key, { name, send, connectionId });
    this.#broadcastPresence();
    this.#dispatchAll();
    return () => {
      const current = this.#helpers.get(key);
      if (!current || current.connectionId !== connectionId) return;
      this.#helpers.delete(key);
      this.#failActiveJobsOf(name, `${name}'s computer went offline during the run.`);
      this.#broadcastPresence();
    };
  }

  // ---- jobs ----

  // A person asks their Claude to do something. Returns the job.
  submit({ projectId, user, text, kind = 'message', allowedTools = [] }) {
    const name = this.#canonical(user);
    if (!this.#store.getProject(projectId)) throw new Error(`No such project: ${projectId}`);
    const job = { id: crypto.randomBytes(8).toString('hex'), projectId, user: name, text, kind, allowedTools };
    if (kind === 'message') this.#store.addEvent(projectId, { kind: 'user', who: name, text });

    const state = this.#state(projectId);
    state.queue.push(job);
    this.#dispatch(projectId);
    if (state.queue.includes(job)) {
      const busy = Boolean(state.active);
      this.#store.addEvent(projectId, {
        kind: 'status',
        state: busy ? 'queued' : 'waiting',
        who: name,
        reason: busy ? 'busy' : 'offline',
        position: state.queue.indexOf(job) + 1,
      });
    }
    return job;
  }

  // A helper reports what its Claude is doing.
  helperEvents(userName, jobId, events) {
    const job = this.#ownedJob(userName, jobId);
    for (const event of events ?? []) {
      if (!event || !HELPER_EVENT_KINDS.has(event.kind)) continue;
      const { denials, ...rest } = event;
      this.#store.addEvent(job.projectId, { ...rest, owner: job.user });
      if (event.kind === 'run-done') {
        for (const denial of denials ?? []) this.#addApproval(job, denial);
      }
    }
  }

  // A helper reports that a run is over.
  helperDone(userName, jobId) {
    this.#finish(this.#ownedJob(userName, jobId));
  }

  // The owner of a Claude allows one blocked command to run.
  approve({ projectId, user, approvalId }) {
    const name = this.#canonical(user);
    const events = this.#store.events(projectId);
    const needed = events.find((e) => e.kind === 'approval-needed' && e.approvalId === approvalId);
    if (!needed) throw new Error('That approval is no longer available.');
    if (!sameName(needed.owner, name)) {
      throw new Error(`Only ${needed.owner} can approve this, because it runs on ${needed.owner}'s computer.`);
    }
    if (events.some((e) => e.kind === 'approval-used' && e.approvalId === approvalId)) {
      throw new Error('That approval was already used.');
    }
    if (!needed.approvable) throw new Error('This command cannot be approved with a button.');

    this.#store.addEvent(projectId, { kind: 'approval-used', approvalId, by: name, tool: needed.tool, command: needed.command });
    return this.submit({
      projectId,
      user: name,
      kind: 'approval',
      text: `Approved by ${name}. Please run that command now and tell me what it printed.`,
      allowedTools: [`${needed.tool}(${needed.command})`],
    });
  }

  // ---- inside ----

  #canonical(user) {
    const name = this.#users().find((candidate) => sameName(candidate, user));
    if (!name) throw new Error(`Unknown user: ${user}`);
    return name;
  }

  #state(projectId) {
    if (!this.#projects.has(projectId)) this.#projects.set(projectId, { queue: [], active: null });
    return this.#projects.get(projectId);
  }

  #ownedJob(userName, jobId) {
    const job = this.#jobs.get(jobId);
    if (!job || !sameName(job.user, userName)) throw new Error('That run is not yours, or it is no longer running.');
    return job;
  }

  #dispatchAll() {
    for (const project of this.#store.listProjects()) this.#dispatch(project.id);
  }

  #dispatch(projectId) {
    const state = this.#state(projectId);
    if (state.active) return;
    const index = state.queue.findIndex((job) => this.isOnline(job.user));
    if (index < 0) return;

    const [job] = state.queue.splice(index, 1);
    const helper = this.#helpers.get(job.user.toLowerCase());
    const project = this.#store.getProject(projectId);
    const knownKey = `${projectId}|${job.user.toLowerCase()}`;
    const sinceId = this.#lastKnown.get(knownKey) ?? 0;
    const recap = buildRecap(this.#store.events(projectId, sinceId), job.user, { sinceId });

    state.active = job;
    this.#jobs.set(job.id, job);
    const working = this.#store.addEvent(projectId, { kind: 'status', state: 'working', who: job.user });
    this.#lastKnown.set(knownKey, working.id);

    try {
      helper.send({
        type: 'job',
        job: {
          jobId: job.id,
          projectId,
          projectName: project.name,
          repoUrl: project.repoUrl,
          who: job.user,
          kind: job.kind,
          text: job.text,
          recap,
          allowedTools: job.allowedTools,
        },
      });
    } catch {
      // The connection is broken. Treat that computer as offline and put the job back in line.
      this.#helpers.delete(job.user.toLowerCase());
      this.#jobs.delete(job.id);
      state.active = null;
      state.queue.unshift(job);
      this.#broadcastPresence();
      this.#dispatch(projectId);
      return;
    }

    job.timer = setTimeout(() => this.#timeOut(job), this.#jobTimeoutMs);
    job.timer.unref?.();
  }

  #timeOut(job) {
    if (this.#jobs.get(job.id) !== job) return;
    this.#store.addEvent(job.projectId, { kind: 'error', owner: job.user, text: `${job.user}'s Claude took too long and was stopped.` });
    try {
      this.#helpers.get(job.user.toLowerCase())?.send({ type: 'cancel', jobId: job.id });
    } catch {
      // Nothing more to do if the helper cannot be reached.
    }
    this.#finish(job);
  }

  #failActiveJobsOf(name, message) {
    for (const job of [...this.#jobs.values()]) {
      if (!sameName(job.user, name)) continue;
      this.#store.addEvent(job.projectId, { kind: 'error', owner: job.user, text: message });
      this.#finish(job);
    }
  }

  #finish(job) {
    if (job.timer) clearTimeout(job.timer);
    this.#jobs.delete(job.id);
    const state = this.#state(job.projectId);
    if (state.active === job) state.active = null;
    this.#store.addEvent(job.projectId, { kind: 'status', state: 'idle' });
    this.#dispatch(job.projectId);
  }

  #addApproval(job, denial) {
    if (!APPROVABLE_TOOLS.has(denial?.tool) || typeof denial.command !== 'string' || !denial.command.trim()) return;
    const command = denial.command.trim();
    this.#store.addEvent(job.projectId, {
      kind: 'approval-needed',
      approvalId: crypto.randomBytes(6).toString('hex'),
      owner: job.user,
      tool: denial.tool,
      command,
      description: denial.description ?? null,
      approvable: command.length <= MAX_COMMAND_CHARS && !UNSAFE_COMMAND.test(command),
    });
  }

  #broadcastPresence() {
    const online = this.presence();
    for (const project of this.#store.listProjects()) {
      this.#store.broadcast(project.id, { kind: 'presence', online });
    }
  }
}
