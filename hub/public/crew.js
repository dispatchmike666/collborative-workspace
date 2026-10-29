import { MOOD_BUBBLE, MOOD_TEXT, crewMood, initial, userColor } from './logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

// The mark in the top bar and on the login card: a cut gem.
export function brandMark() {
  const wrapper = document.createElement('span');
  wrapper.className = 'brand-mark';
  wrapper.id = 'brand-mark';
  wrapper.append(svg('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
    svg('path', { class: 'gem-a', d: 'M16 3 L28 12 L21 12 Z' }),
    svg('path', { class: 'gem-b', d: 'M16 3 L4 12 L11 12 Z' }),
    svg('path', { class: 'gem-c', d: 'M16 3 L21 12 L11 12 Z' }),
    svg('path', { class: 'gem-d', d: 'M4 12 L11 12 L16 29 Z' }),
    svg('path', { class: 'gem-e', d: 'M28 12 L21 12 L16 29 Z' }),
    svg('path', { class: 'gem-f', d: 'M11 12 L21 12 L16 29 Z' })));
  return wrapper;
}

// A person's presence: a glass orb in their colour with their initial.
// Moods: asleep (offline), awake (ready), working, happy (just finished).
export function creature({ color = 'blue', mood = 'awake', size = '', label = '', letter = '' } = {}) {
  const wrapper = document.createElement('span');
  wrapper.className = `crew crew-${color} mood-${mood}${size ? ` ${size}` : ''}`;
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', label);
  const ring = document.createElement('span');
  ring.className = 'ring';
  const orb = document.createElement('span');
  orb.className = 'orb';
  orb.textContent = letter;
  wrapper.append(ring, orb);
  return wrapper;
}

export function setMood(node, mood) {
  for (const cls of [...node.classList]) if (cls.startsWith('mood-')) node.classList.remove(cls);
  node.classList.add(`mood-${mood}`);
}

// An orb with a name and a status line. Update it with member.update({ online, working, happy }).
export function crewMember({ name, users, size = '' }) {
  const color = userColor(name, users);
  const pet = creature({ color, size, mood: 'asleep', letter: initial(name) });
  const nameEl = document.createElement('span');
  nameEl.className = 'crew-name';
  nameEl.textContent = name;
  const status = document.createElement('span');
  status.className = 'crew-status';
  const bubble = document.createElement('span');
  bubble.className = 'bubble';
  bubble.hidden = size !== 'big';

  const root = document.createElement('div');
  root.className = 'crew-member';
  root.dataset.user = name;
  root.append(pet, nameEl, status, ...(size === 'big' ? [bubble] : []));

  function update(state) {
    const mood = crewMood(state);
    setMood(pet, mood);
    pet.setAttribute('aria-label', `${name}'s Claude is ${MOOD_TEXT[mood]}`);
    status.textContent = MOOD_TEXT[mood];
    bubble.textContent = MOOD_BUBBLE[mood];
    root.classList.toggle('online', state.online);
    root.classList.toggle('working', Boolean(state.online && state.working));
    root.title = `${name}'s Claude is ${MOOD_TEXT[mood]}${state.online ? '' : " (this person's helper is not running)"}`;
  }
  update({ online: false });
  return { element: root, update };
}
