// Small pure helpers for the pages: nothing here touches the page, so all of it is tested.

export const COLUMN_LABELS = { ideas: 'Ideas', todo: 'To do', doing: 'Doing', done: 'Done' };
export const USER_COLORS = ['blue', 'pink', 'mint', 'tangerine', 'grape'];

export function groupBoard(cards, columns = Object.keys(COLUMN_LABELS)) {
  const grouped = Object.fromEntries(columns.map((column) => [column, []]));
  for (const card of cards) grouped[card.column]?.push(card);
  return grouped;
}

// Each person keeps their colour: the first person added is blue, the second pink, and so on.
export function userColor(name, users) {
  const index = users.findIndex((candidate) => candidate.toLowerCase() === String(name).toLowerCase());
  if (index >= 0) return USER_COLORS[index % USER_COLORS.length];
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length];
}

export function initial(name) {
  return String(name ?? '').trim().charAt(0).toUpperCase() || '?';
}

// ---- reactions ----
// state: Map of message id -> Map of emoji -> Set of people who reacted

export function applyReaction(state, { target, emoji, who, on }) {
  if (!state.has(target)) state.set(target, new Map());
  const byEmoji = state.get(target);
  if (!byEmoji.has(emoji)) byEmoji.set(emoji, new Set());
  const people = byEmoji.get(emoji);
  if (on) people.add(who);
  else people.delete(who);
  if (!people.size) byEmoji.delete(emoji);
  if (!byEmoji.size) state.delete(target);
  return state;
}

export function reactionChips(state, target, me) {
  const byEmoji = state.get(target);
  if (!byEmoji) return [];
  return [...byEmoji].map(([emoji, people]) => ({
    emoji,
    count: people.size,
    mine: [...people].some((person) => person.toLowerCase() === String(me).toLowerCase()),
    who: [...people],
  }));
}

// ---- command palette ----

function score(label, query) {
  const text = label.toLowerCase();
  if (text.startsWith(query)) return 100;
  if (text.split(/\s+/).some((word) => word.startsWith(query))) return 80;
  if (text.includes(query)) return 60;
  let position = 0;
  let gaps = 0;
  for (const char of query) {
    const found = text.indexOf(char, position);
    if (found < 0) return 0;
    gaps += found - position;
    position = found + 1;
  }
  return Math.max(1, 30 - gaps);
}

export function filterCommands(commands, rawQuery) {
  const query = String(rawQuery ?? '').trim().toLowerCase();
  if (!query) return commands;
  return commands
    .map((command, order) => ({ command, order, value: score(command.label, query) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .map((entry) => entry.command);
}

// ---- typing ----

export function typingNames(typing, now, { me = '', windowMs = 4000 } = {}) {
  return [...typing]
    .filter(([name, at]) => name.toLowerCase() !== me.toLowerCase() && now - at <= windowMs)
    .map(([name]) => name);
}

export function typingLabel(names) {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are typing…`;
}

// ---- numbers ----

export function formatPlan(costUsd) {
  const value = typeof costUsd === 'number' ? costUsd : 0;
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

export function weekBars(week, users) {
  const bars = week.map((entry) => {
    const parts = users.filter((user) => entry.runs[user]).map((user) => ({ user, value: entry.runs[user] }));
    const label = new Date(`${entry.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return { day: entry.day, label, parts, total: parts.reduce((sum, part) => sum + part.value, 0) };
  });
  return { bars, max: Math.max(1, ...bars.map((bar) => bar.total)) };
}

export function greeting(date, name) {
  const hour = date.getHours();
  if (hour < 5) return `Up late, ${name}?`;
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 18) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

// ---- the crew ----

export function crewMood({ online, working, happy }) {
  if (!online) return 'asleep';
  if (working) return 'working';
  if (happy) return 'happy';
  return 'awake';
}

export const MOOD_TEXT = { asleep: 'offline', awake: 'ready', working: 'working', happy: 'just finished' };
export const MOOD_BUBBLE = { asleep: 'Helper is off', awake: 'Ready when you are', working: 'Working on it', happy: 'Finished' };

// Each project gets a colour of its own, the same on every screen.
export const PROJECT_COLORS = ['blue', 'pink', 'mint', 'tangerine', 'grape', 'sun'];

export function projectColor(projectId) {
  let hash = 0;
  for (const char of String(projectId)) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length];
}

// ---- the tile wall ----

// Every piece of the project screen is a tile. Chat is always in the left column; the others share the wall.
export const TILE_IDS = ['chat', 'board', 'preview', 'files', 'brief', 'notes'];
export const WALL_ORDER = ['board', 'preview', 'files', 'brief', 'notes'];
// How big each tile likes to be on the wall: [columns wide, rows tall].
const WALL_SIZES = { board: [2, 1], preview: [1, 2], files: [1, 1], brief: [1, 1], notes: [1, 1] };
const FLOAT_MIN = { w: 300, h: 200 };

// Fits the docked tiles onto a grid that is `columns` wide, then stretches tiles into any empty cells
// beside or below them. Positions start at 1, like CSS grid lines.
export function packTiles(ids, columns = 2) {
  const wanted = WALL_ORDER.filter((id) => ids.includes(id));
  const taken = new Set();
  const fits = (row, col, wide, tall) => {
    for (let r = 0; r < tall; r += 1) {
      for (let c = 0; c < wide; c += 1) {
        if (col + c > columns || taken.has(`${row + r},${col + c}`)) return false;
      }
    }
    return true;
  };
  const mark = (place) => {
    for (let r = 0; r < place.rowSpan; r += 1) for (let c = 0; c < place.colSpan; c += 1) taken.add(`${place.row + r},${place.col + c}`);
  };
  const placements = {};
  for (const id of wanted) {
    const wide = Math.min(WALL_SIZES[id][0], columns);
    const tall = WALL_SIZES[id][1];
    let placed = null;
    for (let row = 1; !placed; row += 1) {
      for (let col = 1; col <= columns - wide + 1 && !placed; col += 1) {
        if (fits(row, col, wide, tall)) placed = { col, row, colSpan: wide, rowSpan: tall };
      }
    }
    placements[id] = placed;
    mark(placed);
  }
  const rows = Object.values(placements).reduce((most, place) => Math.max(most, place.row + place.rowSpan - 1), 0);
  const isFree = (row, col) => row >= 1 && row <= rows && col >= 1 && col <= columns && !taken.has(`${row},${col}`);
  for (const id of wanted) {
    const place = placements[id];
    const rowCells = (col) => Array.from({ length: place.rowSpan }, (_, r) => isFree(place.row + r, col));
    while (place.col + place.colSpan <= columns && rowCells(place.col + place.colSpan).every(Boolean)) {
      for (let r = 0; r < place.rowSpan; r += 1) taken.add(`${place.row + r},${place.col + place.colSpan}`);
      place.colSpan += 1;
    }
    const belowFree = () => Array.from({ length: place.colSpan }, (_, c) => isFree(place.row + place.rowSpan, place.col + c)).every(Boolean);
    while (place.row + place.rowSpan <= rows && belowFree()) {
      for (let c = 0; c < place.colSpan; c += 1) taken.add(`${place.row + place.rowSpan},${place.col + c}`);
      place.rowSpan += 1;
    }
  }
  return { rows, placements };
}

// Keeps a floating window inside the stage and no smaller than it can usefully be.
export function clampRect(rect, bounds, min = FLOAT_MIN) {
  const w = Math.round(Math.max(Math.min(min.w, bounds.w), Math.min(rect.w, bounds.w)));
  const h = Math.round(Math.max(Math.min(min.h, bounds.h), Math.min(rect.h, bounds.h)));
  return {
    w,
    h,
    x: Math.round(Math.max(0, Math.min(rect.x, bounds.w - w))),
    y: Math.round(Math.max(0, Math.min(rect.y, bounds.h - h))),
  };
}

// Where the next window goes when nothing says otherwise: staggered down and to the right.
export function cascadeRect(index, bounds) {
  const w = Math.round(bounds.w * 0.44);
  const h = Math.round(bounds.h * 0.56);
  const step = 34 * (index % 6);
  return clampRect({ x: 40 + step, y: 24 + step, w, h }, bounds);
}

const DEFAULT_MODES = { chat: 'tiled', board: 'tiled', preview: 'tiled', files: 'tiled', brief: 'tiled', notes: 'closed' };
const MODES = new Set(['tiled', 'float', 'closed']);

// Turns whatever was saved last time (or nothing) into a layout that is safe to use.
export function normalizeLayout(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const tiles = {};
  for (const id of TILE_IDS) {
    const old = source.tiles?.[id];
    const mode = MODES.has(old?.mode) ? old.mode : DEFAULT_MODES[id];
    const rect = old?.rect && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(old.rect[key])) ? { x: old.rect.x, y: old.rect.y, w: old.rect.w, h: old.rect.h } : null;
    tiles[id] = { mode, rect, z: Number.isFinite(old?.z) ? old.z : 0 };
  }
  const top = Math.max(0, ...Object.values(tiles).map((tile) => tile.z));
  return { arrange: source.arrange === 'windows' ? 'windows' : 'tiles', z: Math.max(top, Number.isFinite(source.z) ? source.z : 0), tiles };
}
