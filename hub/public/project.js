import { createBoard } from './board.js';
import { createBrief } from './brief.js';
import { creature } from './crew.js';
import { createFiles, createNotes, createPreview } from './files.js';
import { icon } from './icons.js';
import {
  applyReaction, initial, projectColor, reactionChips, typingLabel, typingNames, userColor,
} from './logic.js';
import { approvalUsedText, eventToView, statusText } from './render.js';
import { cheer, crewState, setPresence, setWorking } from './state.js';
import { createTiles } from './tiles.js';
import { api, confetti, el, playSound, toast } from './ui.js';

const REACTIONS = ['👍', '🎉', '😂', '🔥', '👀', '❤️'];
const TABS = [['board', 'Board'], ['brief', 'Brief'], ['files', 'Files'], ['notes', 'Notes'], ['preview', 'Preview']];
const GUTTER = { done: '✓', error: '!', bad: '!', approval: '⚠', sync: '↺' };
const CHATTY = new Set(['user', 'team-chat', 'claude-text']);

// What the command palette can ask the open project to do.
export const projectActions = { current: null };

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// The project screen: a wall of tiles (chat, board, preview, files, brief, notes) that can pop out into windows, with a dock below.
export async function showProject(viewEl, { me, users, projectId }) {
  viewEl.replaceChildren(el('p', { class: 'muted home', text: 'Loading…' }));
  let details;
  let projects;
  let prompts;
  try {
    [details, projects, prompts] = await Promise.all([
      api(`/api/projects/${projectId}`),
      api('/api/projects'),
      api('/api/prompts'),
    ]);
  } catch (error) {
    viewEl.replaceChildren(el('div', { class: 'home' },
      el('div', { class: 'empty sticker' }, el('div', { class: 'emoji', text: '◇' }),
        el('strong', { text: error.status === 404 ? "That project isn't here" : "Couldn't open the project" }),
        el('p', { class: 'muted', text: error.status === 404 ? 'It may have been renamed, or the link is wrong.' : error.message }),
        el('a', { class: 'btn', href: '#/', text: 'Back to the home page' }))));
    return () => {};
  }
  setPresence(details.presence);
  setWorking(null);

  const others = users.filter((name) => !sameName(name, me));
  const ctx = {
    projectId, me, users, details,
    notesText: details.notes.text,
    getNotesText: () => ctx.notesText,
    noteChanged(text) {
      ctx.notesText = text;
      panels.brief?.onEvent({ kind: 'notes-changed' });
    },
  };
  const panels = {
    board: createBoard(ctx),
    brief: createBrief(ctx),
    files: createFiles(ctx),
    notes: createNotes(ctx),
    preview: createPreview(ctx),
  };

  const rows = new Map();
  const reactionState = new Map();
  const typing = new Map();
  let live = false;
  let target = 'ai';
  let shelf = prompts;

  // ---------- timeline ----------

  const timelineEl = el('div', { class: 'timeline', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });

  function renderReactions(targetId) {
    const entry = rows.get(targetId);
    if (!entry) return;
    entry.reactions.replaceChildren(...reactionChips(reactionState, targetId, me).map((chip) => el('button', {
      type: 'button',
      class: `reaction${chip.mine ? ' mine' : ''}`,
      title: chip.who.join(', '),
      'aria-pressed': String(chip.mine),
      'aria-label': `${chip.emoji} from ${chip.who.join(', ')}`,
      onclick: () => react(targetId, chip.emoji),
    }, el('span', { text: chip.emoji }), el('span', { text: String(chip.count) }))));
  }

  async function react(targetId, emoji) {
    try {
      await api(`/api/projects/${projectId}/react`, { method: 'POST', body: { eventId: targetId, emoji } });
    } catch (error) {
      toast(error.message, 'bad');
    }
  }

  function avatar(event) {
    if (event.kind === 'claude-text') {
      const owner = event.owner ?? me;
      return creature({ color: userColor(owner, users), size: 'mini', mood: 'awake', label: `${owner}'s Claude`, letter: '✦' });
    }
    const name = event.who ?? me;
    return el('span', { class: `avatar ${userColor(name, users)}`, 'aria-hidden': 'true', text: initial(name) });
  }

  function addRow(event, view) {
    const stick = timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight < 90;
    const row = el('div', { class: `row ${view.cls}` });
    if (CHATTY.has(event.kind)) {
      const reactions = el('div', { class: 'reactions' });
      const menu = el('div', { class: 'react-menu', role: 'menu', hidden: true }, REACTIONS.map((emoji) => el('button', {
        type: 'button', role: 'menuitem', text: emoji, 'aria-label': `React with ${emoji}`,
        onclick: () => { menu.hidden = true; react(event.id, emoji); },
      })));
      const trigger = el('button', {
        type: 'button', class: 'btn small ghost react-btn', 'aria-label': 'Add a reaction', 'aria-expanded': 'false', text: '☺',
        onclick: () => { menu.hidden = !menu.hidden; trigger.setAttribute('aria-expanded', String(!menu.hidden)); },
      });
      row.append(
        avatar(event),
        el('div', { class: 'body' },
          el('div', { class: 'who-line' }, el('span', { text: view.label }), el('span', { class: 'time', text: clock(event.at) })),
          el('div', { class: 'text', text: view.text }),
          reactions),
        trigger, menu);
      if (event.id) rows.set(event.id, { row, reactions });
    } else {
      row.classList.add('slim');
      const body = el('div', { class: 'body' }, el('div', { class: 'text', text: view.text }));
      if (view.approval) {
        const note = el('span', { class: 'muted small', text: view.approval.note ?? '' });
        const actions = el('div', { class: 'actions' });
        if (view.approval.canApprove) {
          const button = el('button', {
            type: 'button', class: 'btn primary small', text: 'Allow once',
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
        body.append(actions);
        approvals.set(view.approval.id, actions);
      }
      row.append(el('span', { class: 'gutter', 'aria-hidden': 'true', text: GUTTER[view.cls.split(' ')[0]] ?? '' }), body);
    }
    timelineEl.append(row);
    if (event.id) renderReactions(event.id);
    if (stick) timelineEl.scrollTop = timelineEl.scrollHeight;
  }
  const approvals = new Map();

  // ---------- status, typing, banner ----------

  const statusEl = el('span', { class: 'status-bubble' });
  function renderStatus() {
    const who = crewState.working;
    statusEl.replaceChildren(
      creature({ color: who ? userColor(who, users) : 'blue', size: 'mini', mood: who ? 'working' : 'awake', label: '' }),
      el('span', { text: who ? `${who}'s Claude is working…` : 'Nobody is waiting on Claude' }),
    );
  }

  const typingEl = el('p', { class: 'typing', 'aria-live': 'polite' });
  function renderTyping() {
    const label = typingLabel(typingNames(typing, Date.now(), { me }));
    typingEl.replaceChildren(label ? el('span', { text: label }) : '', ...(label ? [el('span', { class: 'dot' }), el('span', { class: 'dot' }), el('span', { class: 'dot' })] : []));
  }
  const typingTimer = setInterval(renderTyping, 1000);

  const bannerEl = el('p', { class: 'banner', role: 'status', hidden: true });
  function updateBanner() {
    const mine = Boolean(crewState.presence[me]);
    bannerEl.hidden = mine;
    bannerEl.textContent = mine ? '' : "Your helper isn't running on your computer, so your Claude is offline. Anything you send to your Claude will wait until the helper starts.";
  }

  // ---------- composer ----------

  const input = el('textarea', { rows: '1', 'aria-label': 'Message', placeholder: '' });
  const segments = [
    el('button', { type: 'button', class: 'chip active', 'data-to': 'ai', text: 'My Claude', 'aria-pressed': 'true' }),
    ...others.map((name) => el('button', { type: 'button', class: 'chip', 'data-to': name, text: `Just ${name}`, 'aria-pressed': 'false' })),
  ];
  function setTarget(to) {
    target = to;
    for (const segment of segments) {
      const on = segment.dataset.to === to;
      segment.classList.toggle('active', on);
      segment.setAttribute('aria-pressed', String(on));
    }
    input.placeholder = to === 'ai' ? 'Tell your Claude what to do…' : `Message ${to}. No AI will see this.`;
  }
  for (const segment of segments) segment.addEventListener('click', () => setTarget(segment.dataset.to));
  setTarget('ai');

  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  };
  let lastTyping = 0;
  input.addEventListener('input', () => {
    grow();
    if (input.value.trim() && Date.now() - lastTyping > 2500) {
      lastTyping = Date.now();
      api(`/api/projects/${projectId}/typing`, { method: 'POST', body: {} }).catch(() => {});
    }
  });

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    grow();
    try {
      await api(`/api/projects/${projectId}/send`, { method: 'POST', body: { text, to: target } });
      playSound('nudge');
    } catch (error) {
      input.value = text;
      grow();
      toast(`Couldn't send that: ${error.message}`, 'bad');
    }
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });

  // ---------- the prompt shelf ----------

  const shelfEl = el('div', { class: 'shelf', role: 'group', 'aria-label': 'Quick prompts' });
  const addBox = el('form', { class: 'add-prompt sticker', hidden: true });
  function insert(text) {
    setTarget('ai');
    input.value = input.value ? `${input.value}\n${text}` : text;
    grow();
    input.focus();
  }
  function renderShelf() {
    shelfEl.replaceChildren(
      el('button', { type: 'button', class: 'chip', text: '✦ Surprise me', onclick: () => shelf.length && insert(shelf[Math.floor(Math.random() * shelf.length)].text) }),
      ...shelf.map((prompt) => el('span', { class: 'chip-group' },
        el('button', { type: 'button', class: 'chip', title: prompt.text, onclick: () => insert(prompt.text) },
          el('span', { text: prompt.emoji }), el('span', { text: prompt.title })),
        el('button', {
          type: 'button', class: 'chip-x', 'aria-label': `Remove ${prompt.title} from the shelf`, text: '×',
          onclick: async () => {
            try {
              await api(`/api/prompts/${prompt.id}`, { method: 'DELETE' });
              shelf = shelf.filter((candidate) => candidate.id !== prompt.id);
              renderShelf();
            } catch (error) {
              toast(error.message, 'bad');
            }
          },
        }))),
      el('button', { type: 'button', class: 'chip', text: '＋ Save a prompt', onclick: () => { addBox.hidden = !addBox.hidden; } }),
    );
  }
  const promptTitle = el('input', { type: 'text', maxlength: '40', placeholder: 'Name, like "Add dark mode"', 'aria-label': 'Prompt name' });
  const promptText = el('textarea', { rows: '2', maxlength: '1000', placeholder: 'What to ask your Claude', 'aria-label': 'Prompt text' });
  const promptEmoji = el('input', { type: 'text', maxlength: '4', placeholder: '✦', 'aria-label': 'Symbol', value: '✦' });
  addBox.append(
    el('div', { class: 'composer-line' }, promptEmoji, promptTitle),
    promptText,
    el('div', { class: 'row-actions' }, el('button', { type: 'submit', class: 'btn primary small', text: 'Save to the shelf' }), el('button', { type: 'button', class: 'btn small ghost', text: 'Cancel', onclick: () => { addBox.hidden = true; } })));
  addBox.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const added = await api('/api/prompts', { method: 'POST', body: { title: promptTitle.value, text: promptText.value, emoji: promptEmoji.value } });
      shelf = [...shelf, added];
      promptTitle.value = '';
      promptText.value = '';
      addBox.hidden = true;
      renderShelf();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });
  renderShelf();

  // ---------- layout ----------

  const note = details.project.repoUrl ? `Files are shared through ${details.project.repoUrl}` : 'No GitHub address, so the files stay on whichever computer does the work.';

  const chatContent = el('div', { class: 'chat' },
    timelineEl,
    typingEl,
    bannerEl,
    el('div', { class: 'composer' }, shelfEl, addBox,
      el('div', { class: 'segmented', role: 'group', 'aria-label': 'Send to' }, segments),
      el('div', { class: 'composer-line' }, input, el('button', { type: 'button', class: 'btn primary', text: 'Send', onclick: send }))));

  const tiles = createTiles({
    projectId,
    defs: [
      { id: 'chat', title: 'Chat', icon: 'chat', element: chatContent },
      ...TABS.map(([key, label]) => ({ id: key, title: label, icon: key, element: panels[key].element })),
    ],
  });
  function refreshCounts() {
    for (const [key] of TABS) tiles.setCount(key, panels[key].count());
  }

  // The project switcher: a small menu in the bar above the tiles.
  const menu = el('div', { class: 'menu', role: 'menu', hidden: true },
    projects.map((project) => el('a', { class: `menu-item${project.id === projectId ? ' current' : ''}`, role: 'menuitem', href: `#/p/${project.id}` },
      el('span', { class: `swatch c-${projectColor(project.id)}` }), el('span', { text: project.name }))),
    el('a', { class: 'menu-item', role: 'menuitem', href: '#/' }, icon('home', 15), el('span', { text: 'All projects' })));
  const switchButton = el('button', {
    type: 'button', class: 'project-switch', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: () => { menu.hidden = !menu.hidden; switchButton.setAttribute('aria-expanded', String(!menu.hidden)); },
  }, el('span', { class: 'project-name', text: details.project.name }), icon('chevron', 16));
  const closeSwitcher = () => { menu.hidden = true; switchButton.setAttribute('aria-expanded', 'false'); };
  const projectBar = el('div', { class: 'project-bar' },
    el('a', { class: 'crumb', href: '#/', 'aria-label': 'All projects', title: 'All projects' }, icon('home', 16)),
    el('span', { class: 'crumb-sep', 'aria-hidden': 'true', text: '/' }),
    el('div', { class: 'switch-wrap' }, switchButton, menu),
    el('span', { class: 'project-note', text: note, title: note }),
    el('span', { class: 'spacer' }),
    statusEl);

  const root = el('div', { class: 'project' }, projectBar, tiles.stage, el('div', { class: 'dock-space' }), tiles.dock);
  viewEl.replaceChildren(root);
  renderStatus();
  updateBanner();
  refreshCounts();

  // ---------- live updates ----------

  function handleEvent(event) {
    switch (event.kind) {
      case 'presence':
        live = true;
        setPresence(event.online);
        updateBanner();
        return;
      case 'files': case 'sources': panels.files.onEvent(event); refreshCounts(); return;
      case 'preview': panels.preview.onEvent(event); refreshCounts(); return;
      case 'board': panels.board.onEvent(event); refreshCounts(); return;
      case 'knowledge': panels.brief.onEvent(event); refreshCounts(); return;
      case 'typing': typing.set(event.who, Date.now()); renderTyping(); return;
      case 'reaction': applyReaction(reactionState, event); renderReactions(event.target); return;
      case 'approval-used':
        approvals.get(event.approvalId)?.replaceChildren(el('span', { class: 'muted small', text: approvalUsedText(event) }));
        return;
      default:
    }

    if (event.kind === 'status') {
      const text = statusText(event);
      if (text) {
        setWorking(event.state === 'working' ? event.who : null);
        renderStatus();
      }
    }
    if (event.kind === 'notes-saved') panels.notes.onEvent(event);
    if (event.kind === 'run-done' && live) {
      cheer(event.owner);
      if (event.ok && sameName(event.owner, me)) {
        confetti();
        playSound('done');
        toast('Nice! Your Claude finished.', 'good');
      }
    }
    if (live && CHATTY.has(event.kind) && !sameName(event.who ?? event.owner, me)) {
      playSound('message');
      typing.delete(event.who ?? event.owner);
      renderTyping();
    }
    const view = eventToView(event, { me });
    if (view) addRow(event, view);
  }

  const stream = new EventSource(`/api/projects/${projectId}/stream`);
  stream.onmessage = (message) => handleEvent(JSON.parse(message.data));
  stream.onerror = () => {
    live = false;
  };

  const onKey = (event) => {
    const typingInField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (event.key === 'Escape') closeSwitcher();
    if (event.key === '/' && !typingInField && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      focusComposer();
    }
  };
  document.addEventListener('keydown', onKey);

  function focusComposer() {
    tiles.focus('chat');
    input.focus();
  }
  projectActions.current = {
    projectId,
    openTab: (key) => tiles.focus(key),
    focusComposer,
    arrange: (mode) => tiles.setArrange(mode),
    tabs: TABS,
  };

  // Close click-away reaction menus.
  const closeMenus = (event) => {
    if (!event.target.closest?.('.switch-wrap')) closeSwitcher();
    if (event.target.closest?.('.react-btn, .react-menu')) return;
    for (const menu of timelineEl.querySelectorAll('.react-menu')) menu.hidden = true;
    for (const button of timelineEl.querySelectorAll('.react-btn')) button.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('click', closeMenus);

  return () => {
    stream.close();
    tiles.destroy();
    clearInterval(typingTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', closeMenus);
    projectActions.current = null;
  };
}
