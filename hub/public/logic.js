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

// Every piece of the project screen is a tile. Chat sits in the middle; the others go on either side of it.
export const TILE_IDS = ['chat', 'board', 'preview', 'files', 'brief', 'notes'];
export const WALL_ORDER = ['board', 'preview', 'files', 'brief', 'notes'];
const FLOAT_MIN = { w: 300, h: 200 };
const SIDE_ROWS = 12;
// Which side of the chat each tile prefers. Anything else goes to whichever side has fewer.
const SIDE_OF = { board: 'left', files: 'left', preview: 'right', brief: 'right' };

// Splits `total` rows between `count` tiles as evenly as possible.
function shareRows(count, total) {
  const base = Math.floor(total / count);
  const extra = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

// Puts the docked tiles on either side of the chat, stacked top to bottom with equal heights.
// With `merge` (a narrower window) they all share one stack on the right instead.
export function packSides(ids, merge = false) {
  const left = [];
  const right = [];
  for (const id of WALL_ORDER.filter((candidate) => ids.includes(candidate))) {
    const side = merge ? 'right' : (SIDE_OF[id] ?? (left.length <= right.length ? 'left' : 'right'));
    (side === 'left' ? left : right).push(id);
  }
  const placements = {};
  for (const [side, list] of [['left', left], ['right', right]]) {
    let row = 1;
    shareRows(list.length || 1, SIDE_ROWS).slice(0, list.length).forEach((span, index) => {
      placements[list[index]] = { side, row, rowSpan: span };
      row += span;
    });
  }
  return { rows: SIDE_ROWS, hasLeft: left.length > 0, hasRight: right.length > 0, placements };
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

// Windows can be dragged partly off the stage, as long as enough of them stays on it to grab again.
const KEEP = 140;
const BAR = 40;
export function keepReachable(rect, bounds, min = FLOAT_MIN) {
  const w = Math.round(Math.max(min.w, Math.min(rect.w, bounds.w * 1.5)));
  const h = Math.round(Math.max(min.h, Math.min(rect.h, bounds.h * 1.5)));
  return {
    w,
    h,
    x: Math.round(Math.max(KEEP - w, Math.min(rect.x, bounds.w - KEEP))),
    y: Math.round(Math.max(0, Math.min(rect.y, bounds.h - BAR))),
  };
}

// Resizing from any edge or corner. `dir` is some of n, s, e, w, such as "se" or "w".
export function resizeRect(rect, dir, dx, dy, min = FLOAT_MIN) {
  let { x, y, w, h } = rect;
  if (dir.includes('e')) w = rect.w + dx;
  if (dir.includes('s')) h = rect.h + dy;
  if (dir.includes('w')) {
    w = rect.w - dx;
    x = rect.x + dx;
  }
  if (dir.includes('n')) {
    h = rect.h - dy;
    y = rect.y + dy;
  }
  if (w < min.w) {
    if (dir.includes('w')) x -= min.w - w;
    w = min.w;
  }
  if (h < min.h) {
    if (dir.includes('n')) y -= min.h - h;
    h = min.h;
  }
  return { x, y, w, h };
}

// Where each window starts: board, chat and preview side by side with chat in the middle, the rest staggered near the edges.
export function startRect(id, bounds, index = 0) {
  const gap = 14;
  const tall = Math.max(bounds.h - 6, 240);
  const side = Math.round(Math.min(Math.max(bounds.w * 0.25, 280), 420));
  const middle = Math.round(Math.min(Math.max(bounds.w - 2 * side - 2 * gap, 440), 860));
  const left = Math.max(0, Math.round((bounds.w - (side * 2 + middle + gap * 2)) / 2));
  const slots = {
    board: { x: left, y: 0, w: side, h: tall },
    chat: { x: left + side + gap, y: 0, w: middle, h: tall },
    preview: { x: left + side + gap + middle + gap, y: 0, w: side, h: tall },
  };
  if (slots[id]) return keepReachable(slots[id], bounds);
  const wide = Math.round(Math.min(Math.max(bounds.w * 0.28, 300), 440));
  const high = Math.round(Math.min(Math.max(bounds.h * 0.6, 260), 560));
  const x = id === 'brief' ? bounds.w - wide - 24 - index * 30 : 24 + index * 30;
  return keepReachable({ x, y: 36 + index * 30, w: wide, h: high }, bounds);
}

// Where the next window goes when nothing says otherwise: staggered down and to the right.
export function cascadeRect(index, bounds) {
  const w = Math.round(bounds.w * 0.44);
  const h = Math.round(bounds.h * 0.56);
  const step = 34 * (index % 6);
  return clampRect({ x: 40 + step, y: 24 + step, w, h }, bounds);
}

const DEFAULT_MODES = { chat: 'float', board: 'float', preview: 'float', files: 'closed', brief: 'closed', notes: 'closed' };
const MODES = new Set(['tiled', 'float', 'closed']);

// Turns whatever was saved last time (or nothing) into a layout that is safe to use.
export function normalizeLayout(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  const tiles = {};
  for (const id of TILE_IDS) {
    const old = source.tiles?.[id];
    const mode = MODES.has(old?.mode) ? old.mode : DEFAULT_MODES[id];
    const rect = old?.rect && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(old.rect[key])) ? { x: old.rect.x, y: old.rect.y, w: old.rect.w, h: old.rect.h } : null;
    tiles[id] = { mode, rect, auto: !rect || old?.auto === true, z: Number.isFinite(old?.z) ? old.z : 0 };
  }
  const top = Math.max(0, ...Object.values(tiles).map((tile) => tile.z));
  return { arrange: source.arrange === 'tiles' ? 'tiles' : 'windows', z: Math.max(top, Number.isFinite(source.z) ? source.z : 0), tiles };
}

// ---- snap layouts ----

// Ready-made ways to divide the stage. Each space is [left, top, width, height] as fractions of the stage.
export const SNAP_LAYOUTS = [
  { id: 'center', label: 'Side, chat, side', zones: [[0, 0, 0.26, 1], [0.26, 0, 0.48, 1], [0.74, 0, 0.26, 1]] },
  { id: 'halves', label: 'Two halves', zones: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { id: 'focus', label: 'Main and side', zones: [[0, 0, 0.65, 1], [0.65, 0, 0.35, 1]] },
  { id: 'thirds', label: 'Three columns', zones: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: 'stack', label: 'Main and two', zones: [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]] },
  { id: 'rail', label: 'Rail and two', zones: [[0, 0, 0.3, 1], [0.3, 0, 0.7, 0.5], [0.3, 0.5, 0.7, 0.5]] },
  { id: 'rows', label: 'Top and bottom', zones: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] },
  { id: 'corners', label: 'Four corners', zones: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
];

// A space in pixels, with a small gap kept between neighbours.
export function zoneRect(zone, bounds, gap = 8) {
  const [left, top, width, height] = zone;
  const x = Math.round(left * bounds.w + (left > 0.0001 ? gap / 2 : 0));
  const y = Math.round(top * bounds.h + (top > 0.0001 ? gap / 2 : 0));
  const right = Math.round((left + width) * bounds.w - (left + width < 0.9999 ? gap / 2 : 0));
  const bottom = Math.round((top + height) * bounds.h - (top + height < 0.9999 ? gap / 2 : 0));
  return { x, y, w: right - x, h: bottom - y };
}

// Which window goes in which space: the chat gets the biggest, then the others in their usual order.
export function arrangeAssign(ids, layout) {
  const spaces = layout.zones.map((zone, index) => ({ zone, index, area: zone[2] * zone[3] }))
    .sort((a, b) => b.area - a.area || a.index - b.index);
  const result = {};
  TILE_IDS.filter((id) => ids.includes(id)).slice(0, spaces.length).forEach((id, position) => {
    result[id] = spaces[position].zone;
  });
  return result;
}
