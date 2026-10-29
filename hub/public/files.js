import { api, el, toast } from './ui.js';

// ---------- files: the list, and click a file to read it ----------

export function createFiles(ctx) {
  let files = ctx.details.files.files ?? [];
  let changed = ctx.details.files.changed ?? [];
  let readable = new Set();
  const root = el('div', { class: 'files-wrap' });

  async function open(path) {
    try {
      const file = await api(`/api/projects/${ctx.projectId}/source?path=${encodeURIComponent(path)}`);
      root.replaceChildren(
        el('div', { class: 'panel-title' },
          el('button', { type: 'button', class: 'btn small', text: '← All files', onclick: render }),
          el('button', {
            type: 'button',
            class: 'btn small',
            text: 'Copy',
            onclick: async () => {
              try {
                await navigator.clipboard.writeText(file.text);
                toast('Copied.', 'good');
              } catch {
                toast("Couldn't copy. Select the text and copy it by hand.", 'bad');
              }
            },
          })),
        el('h3', { class: 'mono-title', text: file.path }),
        el('pre', { class: 'code', tabindex: '0', text: file.text }),
      );
    } catch (error) {
      toast(error.message, 'bad');
    }
  }

  function render() {
    root.replaceChildren(
      el('p', { class: 'panel-intro', text: 'Everything in the project. A green dot means it changed in the latest run. Click a file to read it.' }),
      files.length
        ? el('ul', { class: 'files' }, files.map((path) => el('li', {}, el('button', {
          type: 'button',
          class: `file${changed.includes(path) ? ' changed' : ''}`,
          onclick: () => (readable.has(path) ? open(path) : toast("That file is too big, or not text, so it can't be shown here.", 'bad')),
        }, el('span', { class: 'dot' }), el('span', { text: path }), readable.has(path) ? el('span', { class: 'view', text: 'read' }) : null))))
        : el('div', { class: 'empty' }, el('div', { class: 'emoji', text: '📂' }), el('strong', { text: 'No files yet' }), el('p', { class: 'muted small', text: 'Ask your Claude to make something and its files show up here.' })),
    );
  }

  render();
  return {
    element: root,
    onEvent(event) {
      if (event.kind === 'files') {
        files = event.files ?? [];
        changed = event.changed ?? [];
        render();
      }
      if (event.kind === 'sources') {
        readable = new Set(event.paths);
        render();
      }
    },
    count: () => files.length,
  };
}

// ---------- notes ----------

export function createNotes(ctx) {
  let version = ctx.details.notes.version;
  let dirty = false;
  const area = el('textarea', { class: 'notes', rows: '10', 'aria-label': 'Shared notes', placeholder: 'Scratch space for the two of you: ideas, links, reminders…' });
  area.value = ctx.details.notes.text;
  area.addEventListener('input', () => { dirty = true; ctx.noteChanged(area.value); });
  const message = el('p', { class: 'muted small', role: 'status' });
  const choices = el('span', { class: 'row-actions' });
  const base = `/api/projects/${ctx.projectId}/notes`;

  function set(notes) {
    area.value = notes.text;
    version = notes.version;
    dirty = false;
    ctx.noteChanged(notes.text);
  }

  async function save() {
    choices.replaceChildren();
    try {
      const result = await api(base, { method: 'PUT', body: { text: area.value, baseVersion: version } });
      version = result.notes.version;
      dirty = false;
      message.textContent = 'Saved.';
      ctx.noteChanged(area.value);
    } catch (error) {
      if (error.status !== 409) {
        message.textContent = error.message;
        return;
      }
      const theirs = error.data.notes;
      message.textContent = `${theirs.updatedBy} saved newer notes. Nothing of yours was lost: it's still in the box.`;
      choices.replaceChildren(
        el('button', { type: 'button', class: 'btn small', text: 'Use their version', onclick: () => { set(theirs); message.textContent = ''; choices.replaceChildren(); } }),
        el('button', { type: 'button', class: 'btn small', text: 'Save mine anyway', onclick: () => { version = theirs.version; save(); } }),
      );
    }
  }

  async function refreshFromOthers() {
    try {
      const notes = await api(base);
      if (notes.version === version) return;
      if (!dirty) {
        set(notes);
        message.textContent = `${notes.updatedBy} updated the notes.`;
      } else {
        message.textContent = `${notes.updatedBy} saved newer notes. Saving yours will ask what to do.`;
      }
    } catch {
      // The next save will explain what is wrong.
    }
  }

  return {
    element: el('div', { class: 'notes-wrap' },
      el('p', { class: 'panel-intro', text: 'A shared page for loose thoughts. Both of you can edit it. If you both save at once, the second person is warned instead of overwriting.' }),
      area,
      el('div', { class: 'row-actions' }, el('button', { type: 'button', class: 'btn primary small', text: 'Save notes', onclick: save }), choices),
      message),
    onEvent(event) {
      if (event.kind === 'notes-saved' && event.who.toLowerCase() !== ctx.me.toLowerCase()) refreshFromOthers();
    },
    text: () => area.value,
    count: () => 0,
  };
}

// ---------- preview ----------

export function createPreview(ctx) {
  let version = ctx.details.previewVersion;
  const frame = el('iframe', { class: 'preview-frame', title: 'Preview of the project', sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', hidden: true });
  const empty = el('div', { class: 'empty' },
    el('div', { class: 'emoji', text: '🖼️' }),
    el('strong', { text: 'Nothing to preview yet' }),
    el('p', { class: 'muted small', text: 'When the project has an index.html in its top folder, the page shows up here.' }));
  const link = el('a', { class: 'btn small', target: '_blank', rel: 'noopener', text: 'Open in a new tab', hidden: true });

  function show() {
    const has = version > 0;
    frame.hidden = !has;
    link.hidden = !has;
    empty.hidden = has;
    if (has) {
      frame.src = `${ctx.details.previewUrl}?v=${version}`;
      link.href = `${ctx.details.previewUrl}?v=${version}`;
    }
  }

  show();
  return {
    element: el('div', { class: 'preview-wrap' },
      el('p', { class: 'panel-intro', text: 'The page your Claude built, shown in a safe box that can\'t touch anything else.' }),
      el('div', { class: 'row-actions' }, el('button', { type: 'button', class: 'btn small', text: 'Reload', onclick: show }), link),
      empty,
      frame),
    onEvent(event) {
      if (event.kind === 'preview') {
        version = event.version;
        show();
      }
    },
    count: () => (version > 0 ? 1 : 0),
  };
}
