// Building blocks shared by every page: elements, talking to the hub, preferences, toasts,
// confetti, sounds and the "look and feel" dialog.

// ---------- elements ----------

// Builds a page element. Text is always set as text, never as HTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- talking to the hub ----------

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

// ---------- preferences kept in this browser ----------

export const prefs = {
  get(key, fallback) {
    try {
      const value = window.localStorage.getItem(`ws.${key}`);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(`ws.${key}`, JSON.stringify(value));
    } catch {
      // Private windows may refuse. The setting then lasts until the page closes.
    }
  },
};

export const ACCENTS = ['blue', 'pink', 'mint', 'tangerine', 'grape'];
export const ACCENT_LABELS = { blue: 'Azure', pink: 'Coral', mint: 'Teal', tangerine: 'Amber', grape: 'Violet' };

export const BACKGROUNDS = [['bands', 'Light bands'], ['spotlight', 'Spotlight'], ['grid', 'Grid'], ['ripples', 'Ripples'], ['dots', 'Dots'], ['aurora', 'Aurora'], ['plain', 'Plain black']];

export function applyLook() {
  const root = document.documentElement;
  root.setAttribute('data-mode', prefs.get('mode', 'dark'));
  root.setAttribute('data-accent', prefs.get('accent', 'pink'));
  const background = prefs.get('bg', 'bands');
  root.setAttribute('data-bg', BACKGROUNDS.some(([key]) => key === background) ? background : 'bands');
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- toasts ----------

export function toast(text, kind = '') {
  const holder = document.getElementById('toasts');
  if (!holder) return;
  const node = el('div', { class: `toast ${kind}`, role: 'status', text });
  holder.append(node);
  setTimeout(() => node.remove(), 4200);
}

// ---------- sounds (off until switched on) ----------

let audio = null;

function blip(frequency, start, length, type = 'triangle', volume = 0.06) {
  const now = audio.currentTime + start;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + length + 0.02);
}

export function playSound(name) {
  if (!prefs.get('sound', false)) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    if (name === 'message') blip(880, 0, 0.09);
    if (name === 'done') [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => blip(hz, i * 0.09, 0.16));
    if (name === 'nudge') blip(440, 0, 0.12, 'sine');
  } catch {
    // Sounds are a nice extra. If the browser says no, carry on quietly.
  }
}

// ---------- confetti ----------

// A short burst of small cut diamonds. Off unless switched on in settings.
const CONFETTI = ['#5b9dff', '#9d82ff', '#38d0b0', '#f0a53c', '#f0709f', '#ffffff'];

export function confetti() {
  if (!prefs.get('confetti', false) || reducedMotion()) return;
  const canvas = el('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(canvas);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const pieces = Array.from({ length: 80 }, () => ({
    x: window.innerWidth * (0.3 + Math.random() * 0.4),
    y: window.innerHeight * 0.75,
    vx: (Math.random() - 0.5) * 9,
    vy: -(7 + Math.random() * 9),
    size: 4 + Math.random() * 5,
    turn: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.4,
    color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
  }));
  const started = performance.now();
  function frame(now) {
    const age = now - started;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const piece of pieces) {
      piece.vy += 0.32;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.turn += piece.spin;
      context.save();
      context.globalAlpha = Math.max(0, 1 - age / 1700);
      context.translate(piece.x, piece.y);
      context.rotate(piece.turn);
      context.fillStyle = piece.color;
      context.beginPath();
      context.moveTo(0, -piece.size);
      context.lineTo(piece.size * 0.6, 0);
      context.lineTo(0, piece.size);
      context.lineTo(-piece.size * 0.6, 0);
      context.closePath();
      context.fill();
      context.restore();
    }
    if (age < 1700) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

// ---------- look and feel dialog ----------

export function openSettings() {
  const dialog = el('dialog', { 'aria-label': 'Look and feel' });
  const choice = (label, key, value, current) => el('button', {
    type: 'button',
    class: `chip${current === value ? ' active' : ''}`,
    text: label,
    onclick: () => {
      prefs.set(key, value);
      applyLook();
      dialog.close();
      openSettings();
    },
  });
  const mode = prefs.get('mode', 'dark');
  const accent = prefs.get('accent', 'pink');
  const toggle = (label, key, fallback) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = prefs.get(key, fallback);
    box.addEventListener('change', () => prefs.set(key, box.checked));
    return el('label', { class: 'switch' }, box, el('span', { text: label }));
  };
  dialog.append(el('div', { class: 'settings-box' },
    el('h2', { text: 'Look and feel' }),
    el('div', { class: 'segmented', role: 'group', 'aria-label': 'Light or dark' },
      choice('Match my computer', 'mode', 'auto', mode), choice('Light', 'mode', 'light', mode), choice('Dark', 'mode', 'dark', mode)),
    el('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent colour' },
      ACCENTS.map((name) => el('button', {
        type: 'button',
        class: `swatch-btn ${name}`,
        'aria-label': ACCENT_LABELS[name],
        'aria-pressed': String(accent === name),
        onclick: () => {
          prefs.set('accent', name);
          applyLook();
          dialog.close();
          openSettings();
        },
      }))),
    toggle('A celebration when my Claude finishes something', 'confetti', false),
    toggle('Soft sounds for new messages and finished runs', 'sound', false),
    el('div', { class: 'row-actions' },
      el('button', { type: 'button', class: 'btn primary', text: 'Done', onclick: () => dialog.close() }),
      el('button', { type: 'button', class: 'btn ghost', text: 'Log out', onclick: () => document.getElementById('logout')?.click() }))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

// ---------- the glow that finds your mouse ----------

// Windows, cards and the dock light up along their edges as the pointer gets close, and brightest where it is.
export function enableProximityGlow() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const SURFACES = '.tile, .sticker, .dock';
  const REACH = 240;
  let pointer = null;
  let frame = 0;
  const paint = () => {
    frame = 0;
    for (const node of document.querySelectorAll(SURFACES)) {
      if (!pointer) {
        node.style.setProperty('--near', '0');
        continue;
      }
      const box = node.getBoundingClientRect();
      const gap = Math.hypot(Math.max(box.left - pointer.x, 0, pointer.x - box.right), Math.max(box.top - pointer.y, 0, pointer.y - box.bottom));
      const closeness = Math.max(0, 1 - gap / REACH);
      node.style.setProperty('--near', (closeness * closeness * (3 - 2 * closeness)).toFixed(3));
      node.style.setProperty('--mx', `${pointer.x - box.left}px`);
      node.style.setProperty('--my', `${pointer.y - box.top}px`);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => {
    pointer = null;
    schedule();
  });
}
