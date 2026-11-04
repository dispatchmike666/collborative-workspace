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

test('docked tiles go on either side of the chat, stacked with equal heights', async () => {
  const { packSides } = await import('../hub/public/logic.js');
  const usual = packSides(['board', 'preview']);
  assert.equal(usual.hasLeft && usual.hasRight, true);
  assert.deepEqual(usual.placements.board, { side: 'left', row: 1, rowSpan: 12 });
  assert.deepEqual(usual.placements.preview, { side: 'right', row: 1, rowSpan: 12 });
  const more = packSides(['board', 'preview', 'files', 'brief', 'notes']);
  assert.deepEqual([more.placements.board, more.placements.files, more.placements.notes].map((place) => [place.side, place.row, place.rowSpan]),
    [['left', 1, 4], ['left', 5, 4], ['left', 9, 4]]);
  assert.deepEqual([more.placements.preview, more.placements.brief].map((place) => [place.side, place.row, place.rowSpan]),
    [['right', 1, 6], ['right', 7, 6]]);
});

test('an empty side disappears, and a lone tile takes its whole side', async () => {
  const { packSides } = await import('../hub/public/logic.js');
  const onlyPreview = packSides(['preview']);
  assert.equal(onlyPreview.hasLeft, false);
  assert.equal(onlyPreview.hasRight, true);
  assert.deepEqual(onlyPreview.placements.preview, { side: 'right', row: 1, rowSpan: 12 });
  const none = packSides([]);
  assert.equal(none.hasLeft || none.hasRight, false);
});

test('notes go to whichever side has fewer tiles, and no two tiles overlap', async () => {
  const { packSides } = await import('../hub/public/logic.js');
  assert.equal(packSides(['board', 'files', 'preview', 'notes']).placements.notes.side, 'right');
  for (const ids of [['board'], ['board', 'files', 'notes'], ['preview', 'brief', 'files', 'board', 'notes']]) {
    const result = packSides(ids);
    for (const side of ['left', 'right']) {
      const used = new Set();
      for (const place of Object.values(result.placements).filter((candidate) => candidate.side === side)) {
        for (let row = place.row; row < place.row + place.rowSpan; row += 1) {
          assert.ok(!used.has(row), `row ${row} used twice on the ${side}`);
          used.add(row);
        }
      }
      if (used.size) assert.equal(used.size, 12, 'a side that has tiles uses every row');
    }
  }
});

test('in a narrower window everything shares one stack beside the chat', async () => {
  const { packSides } = await import('../hub/public/logic.js');
  const merged = packSides(['board', 'preview', 'files'], true);
  assert.equal(merged.hasLeft, false);
  assert.deepEqual(Object.values(merged.placements).map((place) => [place.side, place.rowSpan]), [['right', 4], ['right', 4], ['right', 4]]);
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
  assert.deepEqual(TILE_IDS.filter((id) => fresh.tiles[id].mode === 'closed'), ['board', 'files', 'brief', 'notes']);
  assert.equal(fresh.arrange, 'windows');
  assert.deepEqual(['chat', 'team', 'progress', 'preview'].map((id) => fresh.tiles[id].mode), ['float', 'float', 'float', 'float']);
  assert.equal(fresh.tiles.chat.auto, true);
  const messy = normalizeLayout({ arrange: 'sideways', z: 'x', tiles: { chat: { mode: 'float', rect: { x: 1, y: 2, w: 300, h: 200 }, z: 4 }, board: { mode: 'banana', rect: { x: 'a' } } } });
  assert.equal(messy.arrange, 'windows');
  assert.equal(messy.tiles.chat.mode, 'float');
  assert.deepEqual(messy.tiles.chat.rect, { x: 1, y: 2, w: 300, h: 200 });
  assert.equal(messy.tiles.board.mode, 'closed');
  assert.equal(messy.tiles.team.mode, 'closed');
  assert.equal(messy.tiles.board.rect, null);
  assert.equal(messy.z, 4);
});

test('a window can be dragged partly off the stage but never lost', async () => {
  const { keepReachable } = await import('../hub/public/logic.js');
  const bounds = { w: 1000, h: 600 };
  assert.deepEqual(keepReachable({ x: 900, y: 590, w: 400, h: 300 }, bounds), { x: 860, y: 560, w: 400, h: 300 });
  assert.deepEqual(keepReachable({ x: -900, y: -50, w: 400, h: 300 }, bounds), { x: -260, y: 0, w: 400, h: 300 });
  assert.deepEqual(keepReachable({ x: 10, y: 10, w: 50, h: 50 }, bounds), { x: 10, y: 10, w: 300, h: 200 });
});

test('a window can be resized from any edge or corner, and the opposite edge stays put', async () => {
  const { resizeRect } = await import('../hub/public/logic.js');
  const start = { x: 100, y: 100, w: 400, h: 300 };
  assert.deepEqual(resizeRect(start, 'se', 50, 20), { x: 100, y: 100, w: 450, h: 320 });
  assert.deepEqual(resizeRect(start, 'nw', 40, 30), { x: 140, y: 130, w: 360, h: 270 });
  assert.deepEqual(resizeRect(start, 'e', -30, 99), { x: 100, y: 100, w: 370, h: 300 });
  assert.deepEqual(resizeRect(start, 'w', -60, 0), { x: 40, y: 100, w: 460, h: 300 });
  const squeezed = resizeRect(start, 'nw', 390, 290);
  assert.equal(squeezed.w, 300);
  assert.equal(squeezed.h, 200);
  assert.equal(squeezed.x + squeezed.w, 500, 'the right edge did not move');
  assert.equal(squeezed.y + squeezed.h, 400, 'the bottom edge did not move');
});

test('team and progress start stacked to the left of the conversation and preview', async () => {
  const { startRect } = await import('../hub/public/logic.js');
  const bounds = { w: 1500, h: 800 };
  const team = startRect('team', bounds);
  const progress = startRect('progress', bounds);
  const chat = startRect('chat', bounds);
  const preview = startRect('preview', bounds);
  assert.ok(team.x + team.w <= chat.x && chat.x + chat.w <= preview.x, 'left to right with no overlap');
  assert.equal(team.x, progress.x);
  assert.ok(team.y + team.h <= progress.y, 'left panels do not overlap');
  assert.ok(chat.w > team.w && chat.w > preview.w, 'the chat is the widest');
  assert.ok(chat.x < bounds.w / 2 && chat.x + chat.w > bounds.w / 2, 'the chat crosses the center');
  const files = startRect('files', bounds, 0);
  const notes = startRect('notes', bounds, 1);
  assert.ok(notes.x > files.x && notes.y > files.y, 'extra windows are staggered');
});

test('every snap layout covers the stage exactly, with no spaces overlapping', async () => {
  const { SNAP_LAYOUTS } = await import('../hub/public/logic.js');
  assert.equal(new Set(SNAP_LAYOUTS.map((layout) => layout.id)).size, SNAP_LAYOUTS.length, 'ids are unique');
  assert.ok(SNAP_LAYOUTS.length >= 6, 'plenty to choose from');
  for (const layout of SNAP_LAYOUTS) {
    let area = 0;
    for (const [left, top, width, height] of layout.zones) {
      assert.ok(left >= 0 && top >= 0 && left + width <= 1.0000001 && top + height <= 1.0000001, `${layout.id} stays inside`);
      area += width * height;
    }
    assert.ok(Math.abs(area - 1) < 1e-9, `${layout.id} fills the whole stage`);
    for (let a = 0; a < layout.zones.length; a += 1) {
      for (let b = a + 1; b < layout.zones.length; b += 1) {
        const [ax, ay, aw, ah] = layout.zones[a];
        const [bx, by, bw, bh] = layout.zones[b];
        const apart = ax + aw <= bx + 1e-9 || bx + bw <= ax + 1e-9 || ay + ah <= by + 1e-9 || by + bh <= ay + 1e-9;
        assert.ok(apart, `${layout.id} spaces ${a} and ${b} do not overlap`);
      }
    }
  }
});

test('a snap space turns into pixels with a small gap between neighbours', async () => {
  const { zoneRect, SNAP_LAYOUTS } = await import('../hub/public/logic.js');
  const halves = SNAP_LAYOUTS.find((layout) => layout.id === 'halves');
  assert.deepEqual(zoneRect(halves.zones[0], { w: 1000, h: 600 }), { x: 0, y: 0, w: 496, h: 600 });
  assert.deepEqual(zoneRect(halves.zones[1], { w: 1000, h: 600 }), { x: 504, y: 0, w: 496, h: 600 });
});

test('when everything is arranged, the chat takes the biggest space and the rest follow in order', async () => {
  const { arrangeAssign, SNAP_LAYOUTS } = await import('../hub/public/logic.js');
  const center = SNAP_LAYOUTS.find((layout) => layout.id === 'center');
  const placed = arrangeAssign(['preview', 'chat', 'board'], center);
  assert.deepEqual(placed.chat, [0.26, 0, 0.48, 1]);
  assert.deepEqual(placed.board, [0, 0, 0.26, 1]);
  assert.deepEqual(placed.preview, [0.74, 0, 0.26, 1]);
  const halves = SNAP_LAYOUTS.find((layout) => layout.id === 'halves');
  assert.deepEqual(Object.keys(arrangeAssign(['chat', 'board', 'preview', 'files'], halves)), ['chat', 'board'], 'extra windows are left alone');
});
