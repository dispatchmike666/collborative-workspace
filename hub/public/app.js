import { brandMark, crewMember } from './crew.js';
import { createPalette } from './palette.js';
import { showHome } from './home.js';
import { projectActions, showProject } from './project.js';
import { memberState, onCrewChange, setPresence, setUsers } from './state.js';
import { ACCENTS, ACCENT_LABELS, THEMES, THEME_LABELS, api, applyLook, currentTheme, cycleTheme, el, enableSpotlight, openSettings, prefs, toast } from './ui.js';

applyLook();
enableSpotlight();

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
  const lookName = document.getElementById('look-name');
  lookName.textContent = THEME_LABELS[currentTheme()];
  document.getElementById('cycle-look').addEventListener('click', () => { lookName.textContent = THEME_LABELS[cycleTheme()]; });
  document.getElementById('open-settings').addEventListener('click', openSettings);
  document.getElementById('open-palette').addEventListener('click', () => palette.open());
  document.getElementById('who').textContent = `Signed in as ${me}`;
  document.getElementById('logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    window.location.assign('/login');
  });
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
  }
  commands.push(
    { icon: '◐', label: 'Look and feel', hint: 'colours, dark mode', run: openSettings },
    ...THEMES.map((name) => ({ icon: '◈', label: `Look: ${THEME_LABELS[name]}`, run: () => { prefs.set('theme', name); applyLook(); document.getElementById('look-name').textContent = THEME_LABELS[name]; } })),
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
    toast('Tip: press Ctrl+K any time to jump around.', '');
  }
})();
