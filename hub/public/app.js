import { approvalUsedText, eventToView, statusText, timeAgo } from './render.js';

const viewEl = document.getElementById('view');
const presenceEl = document.getElementById('presence');
const whoEl = document.getElementById('who');

let me = null;
let presence = {};
let cleanup = null;

// ---------- small helpers ----------

// Builds a page element. Text is always set as text, never as HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    window.location.assign('/login');
    throw new Error('Please log in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error ?? `Something went wrong (${res.status}).`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function renderPresence() {
  presenceEl.replaceChildren(
    ...Object.entries(presence).map(([name, online]) => el(
      'span',
      { class: `dot-label ${online ? 'online' : 'offline'}`, title: online ? `${name}'s helper is connected` : `${name}'s helper is not running` },
      el('span', { class: 'dot' }),
      name,
    )),
  );
}

// ---------- dashboard ----------

async function showDashboard() {
  viewEl.replaceChildren(el('p', { class: 'muted pad', text: 'Loading…' }));
  const [projects, info] = await Promise.all([api('/api/projects'), api('/api/me')]);
  presence = info.presence;
  renderPresence();

  const nameInput = el('input', { type: 'text', placeholder: 'Project name', maxlength: '60', required: true, 'aria-label': 'Project name' });
  const repoInput = el('input', { type: 'text', placeholder: 'https://github.com/owner/repo (optional)', 'aria-label': 'GitHub repository address' });
  const errorEl = el('p', { class: 'error', role: 'alert', hidden: true });
  const form = el(
    'form',
    {
      class: 'new-project',
      onsubmit: async (event) => {
        event.preventDefault();
        errorEl.hidden = true;
        try {
          const project = await api('/api/projects', { method: 'POST', body: { name: nameInput.value, repoUrl: repoInput.value } });
          window.location.hash = `#/p/${project.id}`;
        } catch (error) {
          errorEl.textContent = error.message;
          errorEl.hidden = false;
        }
      },
    },
    nameInput,
    repoInput,
    el('button', { type: 'submit', class: 'primary', text: 'Create project' }),
    errorEl,
  );

  const cards = projects.map((project) => el(
    'a',
    { class: 'card', href: `#/p/${project.id}` },
    el('h3', { text: project.name }),
    el('p', { class: 'muted', text: project.lastEventText ?? 'No activity yet' }),
    el('p', { class: 'muted small', text: [timeAgo(project.lastActivityAt), project.repoUrl ? 'Shared through GitHub' : 'Files stay on one computer'].filter(Boolean).join(' · ') }),
  ));

  viewEl.replaceChildren(el(
    'section',
    { class: 'pad' },
    el('h2', { text: 'Projects' }),
    cards.length ? el('div', { class: 'cards' }, cards) : el('p', { class: 'muted', text: 'No projects yet. Create the first one below.' }),
    el('h3', { text: 'New project' }),
    form,
    el('p', { class: 'muted small', text: "Add a GitHub address if everyone should share the project's files. Without one, the files stay on whichever computer does the work." }),
  ));
}

// ---------- project ----------

async function showProject(projectId) {
  viewEl.replaceChildren(el('p', { class: 'muted pad', text: 'Loading…' }));
  let details;
  let projects;
  try {
    [details, projects] = await Promise.all([api(`/api/projects/${projectId}`), api('/api/projects')]);
  } catch (error) {
    viewEl.replaceChildren(el('div', { class: 'pad' }, el('p', { class: 'error', text: error.status === 404 ? 'That project does not exist.' : error.message }), el('a', { href: '#/', text: 'Back to all projects' })));
    return;
  }
  presence = details.presence;
  renderPresence();

  const others = me.users.filter((name) => name.toLowerCase() !== me.name.toLowerCase());
  const approvalRows = new Map();
  let target = 'ai';
  let statusSet = false;

  // -- chat column --
  const statusEl = el('span', { class: 'pill', text: 'Connecting…' });
  const timelineEl = el('div', { class: 'timeline', 'aria-live': 'polite' });
  const bannerEl = el('p', { class: 'banner', role: 'status', hidden: true });
  const input = el('input', { type: 'text', 'aria-label': 'Message', autocomplete: 'off' });
  const segments = [
    el('button', { type: 'button', class: 'seg active', 'data-to': 'ai', text: 'My Claude' }),
    ...others.map((name) => el('button', { type: 'button', class: 'seg', 'data-to': name, text: `Just ${name}` })),
  ];
  const setTarget = (to) => {
    target = to;
    for (const segment of segments) segment.classList.toggle('active', segment.dataset.to === to);
    input.placeholder = to === 'ai' ? 'Tell your Claude what to do…' : `Message ${to}. No AI will see this.`;
  };
  for (const segment of segments) segment.addEventListener('click', () => setTarget(segment.dataset.to));
  setTarget('ai');

  function addRow(view) {
    const stick = timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight < 80;
    const row = el('div', { class: `row ${view.cls}` });
    if (view.label) row.append(el('span', { class: 'label', text: view.label }));
    row.append(el('span', { class: 'text', text: view.text }));
    if (view.approval) {
      const note = el('span', { class: 'muted small', text: view.approval.note ?? '' });
      const actions = el('span', { class: 'actions' });
      if (view.approval.canApprove) {
        const button = el('button', {
          type: 'button',
          class: 'primary small',
          text: 'Allow once',
          onclick: async () => {
            button.disabled = true;
            try {
              await api(`/api/projects/${projectId}/approve`, { method: 'POST', body: { approvalId: view.approval.id } });
            } catch (error) {
              button.disabled = false;
              note.textContent = error.message;
            }
          },
        });
        actions.append(button);
      }
      actions.append(note);
      row.append(actions);
      approvalRows.set(view.approval.id, row);
    }
    timelineEl.append(row);
    if (stick) timelineEl.scrollTop = timelineEl.scrollHeight;
  }

  function updateBanner() {
    if (presence[me.name]) {
      bannerEl.hidden = true;
      return;
    }
    bannerEl.textContent = "Your helper isn't running on your computer, so your Claude can't do work yet. Anything you send to your Claude will wait until the helper starts.";
    bannerEl.hidden = false;
  }

  const composer = el(
    'form',
    {
      class: 'composer',
      onsubmit: async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        try {
          await api(`/api/projects/${projectId}/send`, { method: 'POST', body: { text, to: target } });
        } catch (error) {
          addRow({ cls: 'error', label: '', text: `Couldn't send that: ${error.message}` });
        }
      },
    },
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Send to' }, segments),
    el('div', { class: 'composer-line' }, input, el('button', { type: 'submit', class: 'primary', text: 'Send' })),
  );

  const chat = el(
    'section',
    { class: 'chat' },
    el('div', { class: 'chat-head' }, el('h2', { text: details.project.name }), statusEl),
    el('p', { class: 'muted small head-note', text: details.project.repoUrl ? `Files are shared through ${details.project.repoUrl}` : 'This project has no GitHub address, so its files stay on whichever computer does the work.' }),
    timelineEl,
    bannerEl,
    composer,
  );

  // -- sidebar --
  const sidebar = el(
    'nav',
    { class: 'sidebar', 'aria-label': 'Projects' },
    el('a', { href: '#/', class: 'side-link', text: 'All projects' }),
    projects.map((project) => el('a', { href: `#/p/${project.id}`, class: `side-link${project.id === projectId ? ' current' : ''}`, text: project.name })),
  );

  // -- files --
  const filesEl = el('ul', { class: 'files' });
  function renderFiles({ files = [], changed = [] }) {
    filesEl.replaceChildren(...(files.length
      ? files.map((file) => el('li', { class: changed.includes(file) ? 'changed' : '', text: file }))
      : [el('li', { class: 'muted', text: 'No files yet.' })]));
  }
  renderFiles(details.files);

  // -- notes --
  let notesVersion = details.notes.version;
  let notesDirty = false;
  const notesArea = el('textarea', { class: 'notes', rows: '8', 'aria-label': 'Shared notes', placeholder: 'Notes everyone on the project can read and edit…' });
  notesArea.value = details.notes.text;
  notesArea.addEventListener('input', () => { notesDirty = true; });
  const notesMessage = el('p', { class: 'muted small', role: 'status' });
  const notesActions = el('span', { class: 'actions' });

  function setNotes(notes) {
    notesArea.value = notes.text;
    notesVersion = notes.version;
    notesDirty = false;
  }
  async function saveNotes() {
    notesActions.replaceChildren();
    try {
      const result = await api(`/api/projects/${projectId}/notes`, { method: 'PUT', body: { text: notesArea.value, baseVersion: notesVersion } });
      notesVersion = result.notes.version;
      notesDirty = false;
      notesMessage.textContent = 'Saved.';
    } catch (error) {
      if (error.status !== 409) {
        notesMessage.textContent = error.message;
        return;
      }
      const theirs = error.data.notes;
      notesMessage.textContent = `${theirs.updatedBy} saved newer notes. Nothing of yours was lost: it is still in the box.`;
      notesActions.replaceChildren(
        el('button', { type: 'button', class: 'small', text: 'Use their version', onclick: () => { setNotes(theirs); notesMessage.textContent = ''; notesActions.replaceChildren(); } }),
        el('button', { type: 'button', class: 'small', text: 'Save mine anyway', onclick: () => { notesVersion = theirs.version; saveNotes(); } }),
      );
    }
  }
  async function refreshNotesFromOthers() {
    try {
      const notes = await api(`/api/projects/${projectId}/notes`);
      if (notes.version === notesVersion) return;
      if (!notesDirty) {
        setNotes(notes);
        notesMessage.textContent = `${notes.updatedBy} updated the notes.`;
      } else {
        notesMessage.textContent = `${notes.updatedBy} saved newer notes. Saving yours will ask what to do.`;
      }
    } catch {
      // The next save will explain what is wrong.
    }
  }

  // -- preview --
  const frame = el('iframe', { class: 'preview-frame', title: 'Preview of the project', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', hidden: true });
  const previewEmpty = el('p', { class: 'muted small', text: 'No preview yet. A preview appears when the project has an index.html at the top level.' });
  function updatePreview(version) {
    const has = version > 0;
    frame.hidden = !has;
    previewEmpty.hidden = has;
    if (has) frame.src = `${details.previewUrl}?v=${version}`;
  }
  updatePreview(details.previewVersion);

  const side = el(
    'aside',
    { class: 'side' },
    el('section', { class: 'panel' }, el('h3', { text: 'Files' }), filesEl),
    el('section', { class: 'panel' }, el('h3', { text: 'Shared notes' }), notesArea, el('div', { class: 'row-actions' }, el('button', { type: 'button', class: 'small', text: 'Save notes', onclick: saveNotes }), notesActions), notesMessage),
    el('section', { class: 'panel' }, el('h3', { text: 'Preview' }), previewEmpty, frame),
  );

  viewEl.replaceChildren(el('div', { class: 'project' }, sidebar, chat, side));
  updateBanner();

  // -- live updates --
  function handleEvent(event) {
    if (event.kind === 'presence') {
      presence = event.online;
      renderPresence();
      updateBanner();
      return;
    }
    if (event.kind === 'files') return renderFiles(event);
    if (event.kind === 'preview') return updatePreview(event.version);
    if (event.kind === 'approval-used') {
      approvalRows.get(event.approvalId)?.querySelector('.actions')?.replaceChildren(el('span', { class: 'muted small', text: approvalUsedText(event) }));
      return undefined;
    }
    if (event.kind === 'notes-saved' && event.who.toLowerCase() !== me.name.toLowerCase()) refreshNotesFromOthers();
    const status = statusText(event);
    if (status) {
      statusEl.textContent = status;
      statusSet = true;
    }
    const view = eventToView(event, { me: me.name });
    if (view) addRow(view);
    return undefined;
  }

  const stream = new EventSource(`/api/projects/${projectId}/stream`);
  stream.onopen = () => { if (!statusSet) statusEl.textContent = 'Connected'; };
  stream.onerror = () => { statusEl.textContent = 'Reconnecting…'; statusSet = false; };
  stream.onmessage = (message) => handleEvent(JSON.parse(message.data));
  cleanup = () => stream.close();
}

// ---------- start ----------

async function route() {
  cleanup?.();
  cleanup = null;
  const match = /^#\/p\/([a-z0-9-]+)$/.exec(window.location.hash);
  try {
    if (match) await showProject(match[1]);
    else await showDashboard();
  } catch (error) {
    viewEl.replaceChildren(el('p', { class: 'error pad', text: error.message }));
  }
}

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  window.location.assign('/login');
});
window.addEventListener('hashchange', route);

(async () => {
  me = await api('/api/me');
  whoEl.textContent = `Signed in as ${me.name}`;
  presence = me.presence;
  renderPresence();
  await route();
})();
