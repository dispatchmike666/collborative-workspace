import { MOOD_BUBBLE, MOOD_TEXT, crewMood, userColor } from './logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  for (const child of children) node.append(child);
  return node;
}

// One mood = one set of eyes and a mouth. CSS shows the set that matches the creature's mood class.
function face() {
  const eyesAwake = svg('g', { class: 'only-awake eye-white-group' },
    svg('circle', { class: 'eye-white', cx: 24, cy: 32, r: 6 }), svg('circle', { class: 'eye-white', cx: 40, cy: 32, r: 6 }),
    svg('circle', { class: 'pupil', cx: 25, cy: 33, r: 2.6 }), svg('circle', { class: 'pupil', cx: 41, cy: 33, r: 2.6 }));
  const eyesWorking = svg('g', { class: 'only-working' },
    svg('circle', { class: 'eye-white', cx: 24, cy: 32, r: 6 }), svg('circle', { class: 'eye-white', cx: 40, cy: 32, r: 6 }),
    svg('circle', { class: 'pupil', cx: 25, cy: 35, r: 2.8 }), svg('circle', { class: 'pupil', cx: 41, cy: 35, r: 2.8 }));
  const eyesAsleep = svg('g', { class: 'only-asleep' },
    svg('path', { class: 'line', d: 'M18 33 q6 5 12 0' }), svg('path', { class: 'line', d: 'M34 33 q6 5 12 0' }));
  const eyesHappy = svg('g', { class: 'only-happy' },
    svg('path', { class: 'line', d: 'M18 34 q6 -8 12 0' }), svg('path', { class: 'line', d: 'M34 34 q6 -8 12 0' }));
  const mouths = [
    svg('path', { class: 'line only-awake', d: 'M28 42 q4 4 8 0' }),
    svg('path', { class: 'line only-working', d: 'M29 43 h6' }),
    svg('ellipse', { class: 'mouth-fill only-asleep', cx: 32, cy: 43, rx: 2.2, ry: 1.6 }),
    svg('path', { class: 'mouth-fill only-happy', d: 'M26 41 q6 10 12 0 z' }),
  ];
  return [eyesAwake, eyesWorking, eyesAsleep, eyesHappy, ...mouths];
}

// A little helper creature in a person's colour. Moods: asleep, awake, working, happy.
export function creature({ color = 'blue', mood = 'awake', size = '', label = '' } = {}) {
  const wrapper = document.createElement('span');
  wrapper.className = `crew crew-${color} mood-${mood}${size ? ` ${size}` : ''}`;
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', label);

  const text = (cls, x, y, value) => {
    const node = svg('text', { class: cls, x, y });
    node.textContent = value;
    return node;
  };
  const sparkle = (d) => svg('path', { class: 'spark', d });
  const body = svg('g', { class: 'body-group' },
    svg('path', { class: 'line', d: 'M32 13 V7' }),
    svg('circle', { class: 'antenna-ball', cx: 32, cy: 5, r: 3.4 }),
    svg('ellipse', { class: 'feet', cx: 22, cy: 55, rx: 6, ry: 3.2 }),
    svg('ellipse', { class: 'feet', cx: 42, cy: 55, rx: 6, ry: 3.2 }),
    svg('path', { class: 'body', d: 'M10 36 C10 21 20 12 32 12 C44 12 54 21 54 36 V44 C54 50 50 54 44 54 H20 C14 54 10 50 10 44 Z' }),
    svg('circle', { class: 'blush', cx: 17, cy: 41, r: 3.2 }),
    svg('circle', { class: 'blush', cx: 47, cy: 41, r: 3.2 }),
    ...face(),
    text('z one', 48, 14, 'z'),
    text('z two', 54, 8, 'Z'),
    sparkle('M54 14 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z'),
    sparkle('M8 18 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z'));
  wrapper.append(svg('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' }, body));
  return wrapper;
}

export function setMood(node, mood) {
  for (const cls of [...node.classList]) if (cls.startsWith('mood-')) node.classList.remove(cls);
  node.classList.add(`mood-${mood}`);
}

// A creature with a name and a status line. Update it with member.update({ online, working, happy }).
export function crewMember({ name, users, size = '' }) {
  const color = userColor(name, users);
  const pet = creature({ color, size, mood: 'asleep' });
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
  root.append(...(size === 'big' ? [bubble] : []), pet, nameEl, status);

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
