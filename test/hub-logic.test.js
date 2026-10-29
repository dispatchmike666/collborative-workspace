import assert from 'node:assert/strict';
import test from 'node:test';
import {
  USER_COLORS, applyReaction, filterCommands, formatPlan, greeting, groupBoard, initial,
  reactionChips, typingLabel, typingNames, userColor, weekBars,
} from '../hub/public/logic.js';

test('cards are grouped by column and keep their order', () => {
  const cards = [
    { id: 'a', column: 'todo' }, { id: 'b', column: 'done' }, { id: 'c', column: 'todo' }, { id: 'd', column: 'ideas' },
  ];
  const grouped = groupBoard(cards);
  assert.deepEqual(Object.keys(grouped), ['ideas', 'todo', 'doing', 'done']);
  assert.deepEqual(grouped.todo.map((c) => c.id), ['a', 'c']);
  assert.deepEqual(grouped.doing, []);
});

test('each person keeps the same colour, in the order they were added', () => {
  const users = ['Brennan', 'Max'];
  assert.equal(userColor('Brennan', users), USER_COLORS[0]);
  assert.equal(userColor('max', users), USER_COLORS[1]);
  assert.equal(userColor('Stranger', users), userColor('Stranger', users), 'unknown names are stable too');
  assert.ok(USER_COLORS.includes(userColor('Stranger', users)));
  assert.equal(initial('  max'), 'M');
  assert.equal(initial(''), '?');
});

test('reactions add up per emoji, remember who, and switch off again', () => {
  const state = new Map();
  applyReaction(state, { target: 5, emoji: '🎉', who: 'Max', on: true });
  applyReaction(state, { target: 5, emoji: '🎉', who: 'Brennan', on: true });
  applyReaction(state, { target: 5, emoji: '🔥', who: 'Max', on: true });
  applyReaction(state, { target: 9, emoji: '👍', who: 'Max', on: true });

  assert.deepEqual(reactionChips(state, 5, 'Max'), [
    { emoji: '🎉', count: 2, mine: true, who: ['Max', 'Brennan'] },
    { emoji: '🔥', count: 1, mine: true, who: ['Max'] },
  ]);
  assert.deepEqual(reactionChips(state, 5, 'Brennan').map((c) => [c.emoji, c.mine]), [['🎉', true], ['🔥', false]]);

  applyReaction(state, { target: 5, emoji: '🎉', who: 'Max', on: false });
  assert.deepEqual(reactionChips(state, 5, 'Max').map((c) => [c.emoji, c.count]), [['🎉', 1], ['🔥', 1]]);
  applyReaction(state, { target: 5, emoji: '🎉', who: 'Brennan', on: false });
  assert.deepEqual(reactionChips(state, 5, 'Max').map((c) => c.emoji), ['🔥']);
  assert.deepEqual(reactionChips(state, 123, 'Max'), []);
});

test('the command palette finds things by start, by word, by part, or by letters in order', () => {
  const commands = ['Go to Pulse', 'Go to Board', 'Open the brief', 'New project', 'Switch to dark mode'].map((label) => ({ label }));
  assert.deepEqual(filterCommands(commands, '').map((c) => c.label), commands.map((c) => c.label));
  assert.equal(filterCommands(commands, 'new')[0].label, 'New project');
  assert.equal(filterCommands(commands, 'bo')[0].label, 'Go to Board', 'a word that starts with it beats a match in the middle');
  assert.deepEqual(filterCommands(commands, 'brief').map((c) => c.label), ['Open the brief']);
  assert.equal(filterCommands(commands, 'sdm')[0].label, 'Switch to dark mode', 'letters in order');
  assert.deepEqual(filterCommands(commands, 'zzz'), []);
  assert.equal(filterCommands(commands, '  PULSE ')[0].label, 'Go to Pulse');
});

test('typing shows the other people who typed in the last few seconds', () => {
  const typing = new Map([['Max', 10_000], ['Sam', 6_000], ['Brennan', 10_500]]);
  assert.deepEqual(typingNames(typing, 11_000, { me: 'Brennan' }), ['Max']);
  assert.deepEqual(typingNames(typing, 11_500, { me: 'Brennan', windowMs: 5000 }), ['Max']);
  assert.deepEqual(typingNames(typing, 13_000, { me: 'Brennan' }), ['Max']);
  assert.deepEqual(typingNames(typing, 20_000, { me: 'Brennan' }), []);
  assert.equal(typingLabel([]), '');
  assert.equal(typingLabel(['Max']), 'Max is typing…');
  assert.equal(typingLabel(['Max', 'Sam']), 'Max and Sam are typing…');
  assert.equal(typingLabel(['Max', 'Sam', 'Lee']), 'Max, Sam and Lee are typing…');
});

test('plan usage is shown as a rounded dollar amount', () => {
  assert.equal(formatPlan(0.4013575), '$0.40');
  assert.equal(formatPlan(12), '$12.00');
  assert.equal(formatPlan(0), '$0.00');
  assert.equal(formatPlan(0.004), '<$0.01');
  assert.equal(formatPlan(undefined), '$0.00');
});

test('the week chart turns days into labelled bars scaled to the busiest day', () => {
  const week = [
    { day: '2026-10-26', runs: { Brennan: 2 }, cost: {} },
    { day: '2026-10-27', runs: {}, cost: {} },
    { day: '2026-10-28', runs: { Brennan: 1, Max: 3 }, cost: {} },
  ];
  const { bars, max } = weekBars(week, ['Brennan', 'Max']);
  assert.equal(max, 4);
  assert.deepEqual(bars.map((b) => b.label), ['Mon', 'Tue', 'Wed']);
  assert.deepEqual(bars[2].parts, [{ user: 'Brennan', value: 1 }, { user: 'Max', value: 3 }]);
  assert.equal(bars[1].total, 0);
  assert.equal(weekBars([], ['Max']).max, 1, 'an empty chart never divides by zero');
});

test('the greeting follows the time of day', () => {
  const at = (hour) => new Date(2026, 9, 29, hour, 0, 0);
  assert.equal(greeting(at(8), 'Brennan'), 'Good morning, Brennan');
  assert.equal(greeting(at(13), 'Brennan'), 'Good afternoon, Brennan');
  assert.equal(greeting(at(19), 'Brennan'), 'Good evening, Brennan');
  assert.equal(greeting(at(2), 'Brennan'), 'Up late, Brennan?');
});

test('a crew member is asleep when the computer is off, and otherwise shows what it is up to', async () => {
  const { crewMood, MOOD_TEXT, MOOD_BUBBLE } = await import('../hub/public/logic.js');
  assert.equal(crewMood({ online: false, working: true, happy: true }), 'asleep');
  assert.equal(crewMood({ online: true, working: true, happy: true }), 'working');
  assert.equal(crewMood({ online: true, working: false, happy: true }), 'happy');
  assert.equal(crewMood({ online: true, working: false, happy: false }), 'awake');
  for (const mood of ['asleep', 'awake', 'working', 'happy']) {
    assert.ok(MOOD_TEXT[mood] && MOOD_BUBBLE[mood], mood);
  }
});

test('a project keeps the same colour every time', async () => {
  const { projectColor, PROJECT_COLORS } = await import('../hub/public/logic.js');
  assert.equal(projectColor('demo-site-034bd3'), projectColor('demo-site-034bd3'));
  assert.ok(PROJECT_COLORS.includes(projectColor('anything')));
  const seen = new Set(['a-1', 'b-2', 'c-3', 'd-4', 'e-5', 'f-6', 'g-7', 'h-8'].map(projectColor));
  assert.ok(seen.size >= 3, 'different projects get a mix of colours');
});

test('docked tiles fill the wall: board across the top, preview tall on the left, small ones stacked beside it', async () => {
  const { packTiles } = await import('../hub/public/logic.js');
  const full = packTiles(['board', 'preview', 'files', 'brief'], 2);
  assert.equal(full.rows, 3);
  assert.deepEqual(full.placements.board, { col: 1, row: 1, colSpan: 2, rowSpan: 1 });
  assert.deepEqual(full.placements.preview, { col: 1, row: 2, colSpan: 1, rowSpan: 2 });
  assert.deepEqual(full.placements.files, { col: 2, row: 2, colSpan: 1, rowSpan: 1 });
  assert.deepEqual(full.placements.brief, { col: 2, row: 3, colSpan: 1, rowSpan: 1 });
});

test('a tile left alone stretches to fill the space, and nothing overlaps', async () => {
  const { packTiles } = await import('../hub/public/logic.js');
  assert.deepEqual(packTiles(['preview'], 2).placements.preview, { col: 1, row: 1, colSpan: 2, rowSpan: 2 });
  const noBoard = packTiles(['preview', 'files'], 2);
  assert.deepEqual(noBoard.placements.preview, { col: 1, row: 1, colSpan: 1, rowSpan: 2 });
  assert.deepEqual(noBoard.placements.files, { col: 2, row: 1, colSpan: 1, rowSpan: 2 });
  assert.equal(packTiles([], 2).rows, 0);
  for (const columns of [1, 2]) {
    const result = packTiles(['board', 'preview', 'files', 'brief', 'notes'], columns);
    const seen = new Set();
    for (const place of Object.values(result.placements)) {
      for (let r = 0; r < place.rowSpan; r += 1) {
        for (let c = 0; c < place.colSpan; c += 1) {
          const cell = `${place.row + r},${place.col + c}`;
          assert.ok(!seen.has(cell), `cell ${cell} used twice with ${columns} columns`);
          assert.ok(place.col + c <= columns);
          seen.add(cell);
        }
      }
    }
  }
});

test('on a narrow wall every tile gets its own row', async () => {
  const { packTiles } = await import('../hub/public/logic.js');
  const one = packTiles(['board', 'files', 'notes'], 1);
  assert.deepEqual(Object.values(one.placements).map((place) => place.col), [1, 1, 1]);
  assert.equal(one.rows, 3);
});

test('a floating window stays inside the stage and keeps a usable size', async () => {
  const { clampRect, cascadeRect } = await import('../hub/public/logic.js');
  const bounds = { w: 1000, h: 600 };
  assert.deepEqual(clampRect({ x: 900, y: 590, w: 400, h: 300 }, bounds), { x: 600, y: 300, w: 400, h: 300 });
  assert.deepEqual(clampRect({ x: -50, y: -20, w: 100, h: 50 }, bounds), { x: 0, y: 0, w: 300, h: 200 });
  assert.deepEqual(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, bounds), { x: 0, y: 0, w: 1000, h: 600 });
  const a = cascadeRect(0, bounds);
  const b = cascadeRect(1, bounds);
  assert.ok(b.x > a.x && b.y > a.y, 'each new window sits a little lower and further right');
});

test('a saved layout is repaired before use, and a missing one gets the usual start', async () => {
  const { normalizeLayout, TILE_IDS } = await import('../hub/public/logic.js');
  const fresh = normalizeLayout(null);
  assert.deepEqual(TILE_IDS.filter((id) => fresh.tiles[id].mode === 'closed'), ['notes']);
  assert.equal(fresh.arrange, 'tiles');
  const messy = normalizeLayout({ arrange: 'sideways', z: 'x', tiles: { chat: { mode: 'float', rect: { x: 1, y: 2, w: 300, h: 200 }, z: 4 }, board: { mode: 'banana', rect: { x: 'a' } } } });
  assert.equal(messy.arrange, 'tiles');
  assert.equal(messy.tiles.chat.mode, 'float');
  assert.deepEqual(messy.tiles.chat.rect, { x: 1, y: 2, w: 300, h: 200 });
  assert.equal(messy.tiles.board.mode, 'tiled');
  assert.equal(messy.tiles.board.rect, null);
  assert.equal(messy.z, 4);
});
