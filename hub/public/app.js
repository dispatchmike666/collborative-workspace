import { brandMark, crewMember } from './crew.js';
import { icon } from './icons.js';
import { createPalette } from './palette.js';
import { showHome } from './home.js';
import { projectActions, showProject } from './project.js';
import { memberState, onCrewChange, setPresence, setUsers } from './state.js';
import { SNAP_LAYOUTS } from './logic.js';
import { ACCENTS, ACCENT_LABELS, BACKGROUNDS, api, applyLook, chooseWallpaper, el, enableProximityGlow, openSettings, prefs, removeWallpaper, toast } from './ui.js';

applyLook();
enableProximityGlow();

const viewEl = document.getElementById('view');
let me = null;
let users = [];
let projects = [];
let cleanup = null;

// ---------- the top bar ----------

function buildTopbar() {
  document.getElementById('brand-mark').replaceWith(brandMark());
  const crew = document.getElementById('crew');
  const members = users.map((name) => crewMember({ name, users }));
  crew.replaceChildren(...members.map((member) => member.element));
  const paint = () => members.forEach((member) => member.update(memberState(member.element.dataset.user)));
  paint();
  onCrewChange(paint);

  const sound = document.getElementById('toggle-sound');
  const paintSound = () => {
    const on = prefs.get('sound', false);
    sound.textContent = '♪';
    sound.setAttribute('aria-pressed', String(on));
    sound.setAttribute('aria-label', on ? 'Sounds are on' : 'Sounds are off');
    sound.title = sound.getAttribute('aria-label');
  };
  paintSound();
  sound.addEventListener('click', () => {
    prefs.set('sound', !prefs.get('sound', false));
    paintSound();
  });
  document.getElementById('open-settings').addEventListener('click', openSettings);
  const paletteButton = document.getElementById('open-palette');
  paletteButton.replaceChildren(icon('search', 15, 2));
  paletteButton.addEventListener('click', () => palette.open());
  buildMenus();
  const clock = document.getElementById('clock');
  const tick = () => { clock.textContent = new Date().toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }); };
  tick();
  setInterval(tick, 20_000);
  document.getElementById('who').textContent = me;
  document.getElementById('logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    window.location.assign('/login');
  });
}

// ---------- the menu bar ----------

const MODE_CHOICES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match system']];

function menuDefinitions() {
  const here = projectActions.current;
  const mode = prefs.get('mode', 'dark');
  const accent = prefs.get('accent', 'pink');
  const background = prefs.get('bg', 'bands');
  const go = (hash) => () => { window.location.hash = hash; };
  const setLook = (key, value) => () => { prefs.set(key, value); applyLook(); };
  return [
    {
      label: 'Workspace',
      bold: true,
      items: [
        { label: 'All projects', run: go('#/') },
        ...projects.map((project) => ({ label: project.name, run: go(`#/p/${project.id}`), checked: here?.projectId === project.id })),
        '-',
        { label: 'Look and feel…', run: openSettings },
        '-',
        { label: 'Log out', run: () => document.getElementById('logout').click() },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'Tidy into a wall', run: () => here.arrange('tiles'), disabled: !here },
        { label: 'Float everything', run: () => here.arrange('windows'), disabled: !here },
        { label: 'Reset layout', run: () => here.reset(), disabled: !here },
        '-',
        { heading: 'Arrange everything' },
        ...SNAP_LAYOUTS.map((layout) => ({ label: layout.label, run: () => here.snapAll(layout.id), disabled: !here })),
        '-',
        { heading: 'Windows' },
        ...(here ? here.windows() : [['chat', 'Chat'], ['board', 'Board'], ['brief', 'Brief'], ['files', 'Files'], ['notes', 'Notes'], ['preview', 'Preview']].map(([key, label]) => ({ key, label, open: false, off: true })))
          .map((win) => ({ label: win.label, checked: win.open, disabled: !here, run: () => here.toggleWindow(win.key) })),
      ],
    },
    {
      label: 'View',
      items: [
        { heading: 'Appearance' },
        ...MODE_CHOICES.map(([value, label]) => ({ label, checked: mode === value, run: setLook('mode', value) })),
        '-',
        { heading: 'Accent colour' },
        ...ACCENTS.map((name) => ({ label: ACCENT_LABELS[name], checked: accent === name, run: setLook('accent', name) })),
        '-',
        { heading: 'Background' },
        ...BACKGROUNDS.map(([key, label]) => ({ label, checked: background === key, run: setLook('bg', key) })),
        ...(prefs.get('wallpaper', null) ? [{ label: 'Your picture', checked: background === 'picture', run: setLook('bg', 'picture') }, { label: 'Remove my picture', run: removeWallpaper }] : []),
        { label: 'Choose a picture…', run: chooseWallpaper },
        '-',
        { label: 'Sounds', checked: prefs.get('sound', false), run: () => document.getElementById('toggle-sound').click() },
        { label: 'Celebrate finished runs', checked: prefs.get('confetti', false), run: () => prefs.set('confetti', !prefs.get('confetti', false)) },
      ],
    },
  ];
}

function buildMenus() {
  const nav = document.getElementById('menus');
  let openButton = null;
  let popup = null;

  const close = () => {
    popup?.remove();
    popup = null;
    openButton?.setAttribute('aria-expanded', 'false');
    openButton = null;
  };
  const open = (button, index) => {
    close();
    const definition = menuDefinitions()[index];
    popup = el('div', { class: 'menu-pop', role: 'menu' }, definition.items.map((item) => {
      if (item === '-') return el('div', { class: 'menu-sep', role: 'separator' });
      if (item.heading) return el('div', { class: 'menu-heading', role: 'presentation', text: item.heading });
      return el('button', {
        type: 'button', class: 'menu-row', role: 'menuitem', disabled: item.disabled || undefined,
        onclick: () => { close(); item.run(); },
      }, el('span', { class: 'menu-check', 'aria-hidden': 'true', text: item.checked ? '✓' : '' }), el('span', { text: item.label }));
    }));
    const box = button.getBoundingClientRect();
    popup.style.left = `${box.left}px`;
    popup.style.top = `${box.bottom + 1}px`;
    document.body.append(popup);
    openButton = button;
    button.setAttribute('aria-expanded', 'true');
  };

  menuDefinitions().forEach((definition, index) => {
    const button = el('button', { type: 'button', class: `menu-title${definition.bold ? ' bold' : ''}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', text: definition.label });
    button.addEventListener('click', () => (openButton === button ? close() : open(button, index)));
    // Once one menu is open, sliding across the bar opens its neighbours, like on a Mac.
    button.addEventListener('mouseenter', () => { if (openButton && openButton !== button) open(button, index); });
    nav.append(button);
  });
  document.addEventListener('pointerdown', (event) => {
    if (popup && !event.target.closest('.menu-pop, .menu-title')) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  window.addEventListener('hashchange', close);
}

// ---------- the command palette ----------

const palette = createPalette(() => {
  const commands = [
    { icon: '⌂', label: 'Go to the home page', hint: 'Pulse', run: () => { window.location.hash = '#/'; } },
    ...projects.map((project) => ({ icon: '◇', label: `Open ${project.name}`, hint: 'project', run: () => { window.location.hash = `#/p/${project.id}`; } })),
    { icon: '＋', label: 'Start a new project', run: () => { window.location.hash = '#/'; setTimeout(() => document.querySelector('.new-project-card input')?.focus(), 250); } },
  ];
  if (projectActions.current) {
    const here = projectActions.current;
    commands.push({ icon: '✎', label: 'Write a message', hint: '/', run: here.focusComposer });
    for (const [key, label] of here.tabs) commands.push({ icon: '▤', label: `Show ${label}`, hint: 'this project', run: () => here.openTab(key) });
    commands.push(
      { icon: '▦', label: 'Tidy everything into the wall', hint: 'this project', run: () => here.arrange('tiles') },
      { icon: '▭', label: 'Turn everything into floating windows', hint: 'this project', run: () => here.arrange('windows') },
    );
  }
  commands.push(
    { icon: '◐', label: 'Look and feel', hint: 'colours, dark mode', run: openSettings },
    { icon: '☾', label: 'Switch to dark mode', run: () => { prefs.set('mode', 'dark'); applyLook(); } },
    { icon: '☼', label: 'Switch to light mode', run: () => { prefs.set('mode', 'light'); applyLook(); } },
    { icon: '▭', label: 'Match my computer (light or dark)', run: () => { prefs.set('mode', 'auto'); applyLook(); } },
    ...ACCENTS.map((name) => ({ icon: '●', label: `Accent: ${ACCENT_LABELS[name]}`, run: () => { prefs.set('accent', name); applyLook(); } })),
    { icon: '♪', label: prefs.get('sound', false) ? 'Turn sounds off' : 'Turn sounds on', run: () => document.getElementById('toggle-sound').click() },
    { icon: '⎋', label: 'Log out', run: () => document.getElementById('logout').click() },
  );
  return commands;
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    palette.open();
  }
});

// ---------- routing ----------

async function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  try {
    projects = await api('/api/projects');
    const match = /^#\/p\/([a-z0-9-]+)$/.exec(window.location.hash);
    cleanup = match
      ? await showProject(viewEl, { me, users, projectId: match[1] })
      : await showHome(viewEl, { me, users });
  } catch (error) {
    viewEl.replaceChildren(el('div', { class: 'home' }, el('p', { class: 'error', text: error.message })));
  }
}
window.addEventListener('hashchange', route);

(async () => {
  const info = await api('/api/me');
  me = info.name;
  users = info.users;
  setUsers(users);
  setPresence(info.presence);
  buildTopbar();
  await route();
  if (!prefs.get('welcomed', false)) {
    prefs.set('welcomed', true);
    if (window.matchMedia('(hover: hover)').matches) toast('Tip: press Ctrl+K any time to jump around.', '');
  }
})();
