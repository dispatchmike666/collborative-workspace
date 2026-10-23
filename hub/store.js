import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-util.js';

const MAX_TEXT = 8000;
const MAX_NOTES_CHARS = 100_000;
const MAX_FILES_LISTED = 200;
const MAX_PREVIEW_FILES = 200;
const MAX_PREVIEW_FILE_BYTES = 1024 * 1024;
const MAX_PREVIEW_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS_IN_MEMORY = 5000;

const REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const PREVIEW_PATH = /^[A-Za-z0-9._/-]+$/;

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
};

function contentType(filePath) {
  const extension = filePath.split('.').pop().toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

// Checks what someone typed into the "new project" form.
export function validateProjectInput({ name, repoUrl } = {}) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return { ok: false, error: 'Give the project a name.' };
  if (cleanName.length > 60) return { ok: false, error: 'Keep the project name under 60 characters.' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(cleanName)) return { ok: false, error: 'The project name has characters that are not allowed.' };

  let cleanRepo = String(repoUrl ?? '').trim().replace(/\/+$/, '');
  if (!cleanRepo) return { ok: true, name: cleanName, repoUrl: null };
  const match = REPO_URL.exec(cleanRepo);
  const dotted = match && [match[1], match[2]].some((part) => part === '.' || part === '..' || part === '.git');
  if (!match || dotted) {
    return { ok: false, error: 'The repository address must look like https://github.com/owner/repo' };
  }
  cleanRepo = match[0];
  return { ok: true, name: cleanName, repoUrl: cleanRepo };
}

function clipDeep(value) {
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map(clipDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, clipDeep(inner)]));
  }
  return value;
}

function slugify(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  return slug || 'project';
}

// Everything the hub remembers, kept in plain files under one folder.
export class Store {
  #dir;
  #now;
  #projects;
  #timelines = new Map();
  #previews = new Map();
  #listeners = new Map();

  constructor(dir, { now = () => new Date() } = {}) {
    this.#dir = dir;
    this.#now = now;
    fs.mkdirSync(dir, { recursive: true });
    this.#projects = readJson(path.join(dir, 'projects.json'), { projects: [] }).projects;
  }

  #projectDir(id) {
    return path.join(this.#dir, 'projects', id);
  }

  #require(id) {
    const project = this.getProject(id);
    if (!project) throw new Error(`No such project: ${id}`);
    return project;
  }

  // ---- projects ----

  createProject({ name, repoUrl, createdBy }) {
    const checked = validateProjectInput({ name, repoUrl });
    if (!checked.ok) throw new Error(checked.error);
    const id = `${slugify(checked.name)}-${crypto.randomBytes(3).toString('hex')}`;
    const project = {
      id,
      name: checked.name,
      repoUrl: checked.repoUrl,
      createdBy,
      createdAt: this.#now().toISOString(),
    };
    this.#projects.push(project);
    writeJsonAtomic(path.join(this.#dir, 'projects.json'), { projects: this.#projects });
    return project;
  }

  getProject(id) {
    return this.#projects.find((project) => project.id === id) ?? null;
  }

  listProjects() {
    const entries = this.#projects.map((project, index) => {
      const events = this.#timeline(project.id).events;
      const last = events.at(-1);
      const lastWords = [...events].reverse().find((e) => ['user', 'team-chat', 'claude-text'].includes(e.kind));
      return {
        ...project,
        lastActivityAt: last?.at ?? project.createdAt,
        lastEventText: lastWords ? String(lastWords.text ?? '').slice(0, 80) : null,
        hasEvents: events.length > 0,
        index,
      };
    });
    entries.sort((a, b) => (
      b.lastActivityAt.localeCompare(a.lastActivityAt) || Number(b.hasEvents) - Number(a.hasEvents) || b.index - a.index
    ));
    return entries.map(({ hasEvents, index, ...rest }) => rest);
  }

  // ---- timeline ----

  #timeline(id) {
    let timeline = this.#timelines.get(id);
    if (!timeline) {
      const file = path.join(this.#projectDir(id), 'timeline.jsonl');
      const events = [];
      try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            events.push(JSON.parse(line));
          } catch {
            // A half-written last line from a crash is skipped.
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      timeline = { file, events: events.slice(-MAX_EVENTS_IN_MEMORY), nextId: (events.at(-1)?.id ?? 0) + 1 };
      this.#timelines.set(id, timeline);
    }
    return timeline;
  }

  addEvent(projectId, event) {
    this.#require(projectId);
    const timeline = this.#timeline(projectId);
    const stored = { ...clipDeep(event), id: timeline.nextId, at: this.#now().toISOString() };
    timeline.nextId += 1;
    fs.mkdirSync(path.dirname(timeline.file), { recursive: true });
    fs.appendFileSync(timeline.file, `${JSON.stringify(stored)}\n`);
    timeline.events.push(stored);
    if (timeline.events.length > MAX_EVENTS_IN_MEMORY) timeline.events.shift();
    this.#notify(projectId, stored);
    return stored;
  }

  events(projectId, afterId = 0) {
    this.#require(projectId);
    return this.#timeline(projectId).events.filter((event) => event.id > afterId);
  }

  subscribe(projectId, listener) {
    if (!this.#listeners.has(projectId)) this.#listeners.set(projectId, new Set());
    this.#listeners.get(projectId).add(listener);
    return () => this.#listeners.get(projectId)?.delete(listener);
  }

  // Sends something to everyone watching a project without saving it (who is online, new preview).
  broadcast(projectId, event) {
    this.#notify(projectId, event);
  }

  #notify(projectId, event) {
    for (const listener of this.#listeners.get(projectId) ?? []) {
      try {
        listener(event);
      } catch {
        // A closed browser tab must not stop the others from hearing.
      }
    }
  }

  // ---- notes ----

  getNotes(projectId) {
    this.#require(projectId);
    return readJson(path.join(this.#projectDir(projectId), 'notes.json'), {
      text: '',
      version: 0,
      updatedBy: null,
      updatedAt: null,
    });
  }

  // Saves only if `baseVersion` is still the latest, so nobody's work is silently overwritten.
  saveNotes(projectId, { text, baseVersion, user }) {
    const current = this.getNotes(projectId);
    if (typeof text !== 'string') throw new Error('Notes must be text');
    if (text.length > MAX_NOTES_CHARS) throw new Error('Notes are too long');
    if (baseVersion !== current.version) return { ok: false, conflict: true, notes: current };
    const notes = { text, version: current.version + 1, updatedBy: user, updatedAt: this.#now().toISOString() };
    writeJsonAtomic(path.join(this.#projectDir(projectId), 'notes.json'), notes);
    return { ok: true, notes };
  }

  // ---- file list ----

  getFiles(projectId) {
    this.#require(projectId);
    return readJson(path.join(this.#projectDir(projectId), 'files.json'), { files: [], changed: [], updatedAt: null });
  }

  setFiles(projectId, { files, changed }) {
    this.#require(projectId);
    const clean = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string').slice(0, MAX_FILES_LISTED) : []);
    const snapshot = { files: clean(files), changed: clean(changed), updatedAt: this.#now().toISOString() };
    writeJsonAtomic(path.join(this.#projectDir(projectId), 'files.json'), snapshot);
    return snapshot;
  }

  // ---- preview ----

  #loadPreview(projectId) {
    let preview = this.#previews.get(projectId);
    if (!preview) {
      const saved = readJson(path.join(this.#projectDir(projectId), 'preview.json'), { version: 0, files: [] });
      preview = {
        version: saved.version,
        files: new Map(saved.files.map((file) => [file.path, { body: Buffer.from(file.data, 'base64'), type: contentType(file.path) }])),
      };
      this.#previews.set(projectId, preview);
    }
    return preview;
  }

  getPreviewVersion(projectId) {
    this.#require(projectId);
    return this.#loadPreview(projectId).version;
  }

  // Replaces the whole preview with the uploaded files. `files` is [{ path, data (base64) }].
  setPreview(projectId, files) {
    this.#require(projectId);
    if (!Array.isArray(files)) throw new Error('Preview files must be a list');
    if (files.length > MAX_PREVIEW_FILES) throw new Error('Too many preview files');
    let total = 0;
    const checked = files.map((file) => {
      const filePath = String(file?.path ?? '');
      const segments = filePath.split('/');
      if (!PREVIEW_PATH.test(filePath) || filePath.startsWith('/') || segments.some((part) => !part || part.startsWith('.'))) {
        throw new Error(`Bad preview path: ${filePath}`);
      }
      const body = Buffer.from(String(file.data ?? ''), 'base64');
      if (body.length > MAX_PREVIEW_FILE_BYTES) throw new Error(`Preview file too large: ${filePath}`);
      total += body.length;
      return { path: filePath, data: body.toString('base64'), body };
    });
    if (total > MAX_PREVIEW_TOTAL_BYTES) throw new Error('Preview is too large overall');

    const version = this.#loadPreview(projectId).version + 1;
    writeJsonAtomic(path.join(this.#projectDir(projectId), 'preview.json'), {
      version,
      files: checked.map(({ path: p, data }) => ({ path: p, data })),
    });
    this.#previews.set(projectId, {
      version,
      files: new Map(checked.map((file) => [file.path, { body: file.body, type: contentType(file.path) }])),
    });
    return { version, count: checked.length, bytes: total };
  }

  // Finds the file for a preview address like "/" or "/css/site.css". Returns null if not there.
  getPreviewFile(projectId, requestPath) {
    this.#require(projectId);
    let wanted;
    try {
      wanted = decodeURIComponent(String(requestPath).split('?')[0]);
    } catch {
      return null;
    }
    if (wanted.includes('\\') || wanted.split('/').includes('..')) return null;
    if (wanted.endsWith('/')) wanted += 'index.html';
    return this.#loadPreview(projectId).files.get(wanted.replace(/^\/+/, '')) ?? null;
  }
}
