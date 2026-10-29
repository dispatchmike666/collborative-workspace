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

export function applyLook() {
  const root = document.documentElement;
  const mode = prefs.get('mode', 'auto');
  if (mode === 'auto') root.removeAttribute('data-mode');
  else root.setAttribute('data-mode', mode);
  root.setAttribute('data-accent', prefs.get('accent', 'blue'));
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

const CONFETTI = ['#3b5bff', '#ff4f8b', '#ffc93c', '#2fd1a0', '#ff7a2f', '#8b5cf6'];

export function confetti() {
  if (!prefs.get('confetti', true) || reducedMotion()) return;
  const canvas = el('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(canvas);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const pieces = Array.from({ length: 90 }, () => ({
    x: window.innerWidth * (0.3 + Math.random() * 0.4),
    y: window.innerHeight * 0.75,
    vx: (Math.random() - 0.5) * 11,
    vy: -(8 + Math.random() * 10),
    size: 6 + Math.random() * 7,
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
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
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
  const mode = prefs.get('mode', 'auto');
  const accent = prefs.get('accent', 'blue');
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
        'aria-label': name,
        'aria-pressed': String(accent === name),
        onclick: () => {
          prefs.set('accent', name);
          applyLook();
          dialog.close();
          openSettings();
        },
      }))),
    toggle('Confetti when my Claude finishes something', 'confetti', true),
    toggle('Soft sounds for new messages and finished runs', 'sound', false),
    el('div', { class: 'row-actions' },
      el('button', { type: 'button', class: 'btn primary', text: 'Done', onclick: () => dialog.close() }),
      el('button', { type: 'button', class: 'btn ghost', text: 'Log out', onclick: () => document.getElementById('logout')?.click() }))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
