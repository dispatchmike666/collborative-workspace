import { icon } from './icons.js';
import { arrangeAssign, keepReachable, normalizeLayout, packSides, resizeRect, SNAP_LAYOUTS, startRect, TILE_IDS, WALL_ORDER, zoneRect } from './logic.js';
import { el, prefs } from './ui.js';

const NARROW = '(max-width: 760px)';
const WIDE_AT = 1000;
const DRAG_FROM = 6;

// The project screen's tiles. They start as free windows (chat in the middle, board and preview beside it),
// can be snapped into a tidy wall, or hidden. A dock at the bottom brings them back.
// defs: [{ id, title, icon, element }]. The tiles keep their own elements, so nothing reloads when they move.
export function createTiles({ projectId, defs }) {
  const storeKey = `tideline-layout.${projectId}`;
  let layout = normalizeLayout(prefs.get(storeKey, null));
  const narrowQuery = window.matchMedia(NARROW);
  let activeNarrow = 'chat';
  let disposed = false;
  let zoomed = null;
  let activeId = 'chat';

  const stage = el('div', { class: 'stage' });
  const emptyNote = el('p', { class: 'stage-empty', text: 'Nothing is open. Use the dock below to bring a tile back.', hidden: true });
  const tileEls = new Map();
  const popButtons = new Map();
  const zoomButtons = new Map();
  const counters = new Map();
  const dockItems = new Map();
  const badges = new Map();
  const titleOf = Object.fromEntries(defs.map((def) => [def.id, def.title]));

  const save = () => prefs.set(storeKey, layout);
  const bounds = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const narrow = () => narrowQuery.matches;

  function measure(id) {
    const tile = tileEls.get(id).getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    return { x: tile.left - frame.left + stage.scrollLeft, y: tile.top - frame.top + stage.scrollTop, w: tile.width, h: tile.height };
  }

  function placeRect(tile, rect) {
    tile.style.left = `${rect.x}px`;
    tile.style.top = `${rect.y}px`;
    tile.style.width = `${rect.w}px`;
    tile.style.height = `${rect.h}px`;
  }

  // The window you are working in. The others go quiet, like inactive windows on a Mac.
  function paintActive() {
    if (layout.tiles[activeId]?.mode === 'closed') {
      activeId = TILE_IDS.find((id) => layout.tiles[id].mode !== 'closed') ?? null;
    }
    for (const [id, tile] of tileEls) tile.classList.toggle('active-window', id === activeId);
  }

  function bringFront(id) {
    activeId = id;
    paintActive();
    layout.z += 1;
    layout.tiles[id].z = layout.z;
    tileEls.get(id).style.zIndex = String(10 + layout.z);
  }

  // ---------- one tile ----------

  for (const def of defs) {
    const counter = el('span', { class: 'tile-count', hidden: true });
    const closeLight = el('button', { type: 'button', class: 'light red', 'aria-label': `Hide ${def.title}`, title: `Hide ${def.title}`, onclick: () => setMode(def.id, 'closed') }, icon('close', 8, 3));
    const popLight = el('button', { type: 'button', class: 'light yellow', onclick: () => togglePop(def.id) });
    const zoomLight = el('button', { type: 'button', class: 'light green', onclick: () => { closeSnap(); toggleZoom(def.id); } });
    // Rest on the green dot for a moment and the snap layouts appear, like on Windows.
    zoomLight.addEventListener('mouseenter', () => {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => showSnap(def.id, zoomLight), 320);
    });
    zoomLight.addEventListener('mouseleave', () => {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(closeSnap, 380);
    });
    const head = el('header', { class: 'tile-head', tabindex: '0', 'aria-label': `${def.title} bar. Arrow keys move a window, Shift and arrows resize it.` },
      el('div', { class: 'lights' }, closeLight, popLight, zoomLight),
      el('span', { class: 'tile-grip', 'aria-hidden': 'true' }),
      el('span', { class: 'tile-heading-icon', 'aria-hidden': 'true' }, icon(def.icon, 17)),
      el('h3', { class: 'tile-title', text: def.title }),
      counter,
      el('span', { class: 'lights-balance', 'aria-hidden': 'true' }));
    const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => {
      const handle = el('span', { class: `rz rz-${dir}`, 'aria-hidden': 'true' });
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || layout.tiles[def.id].mode !== 'float') return;
        bringFront(def.id);
        beginDrag(def.id, event, `resize-${dir}`, handle);
      });
      return handle;
    });
    const tile = el('section', { class: 'tile', 'data-tile': def.id, 'aria-label': def.title }, head, el('div', { class: 'tile-body' }, def.element), ...handles);
    tileEls.set(def.id, tile);
    popButtons.set(def.id, popLight);
    zoomButtons.set(def.id, zoomLight);
    counters.set(def.id, counter);

    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.light') || narrow()) return;
      if (layout.tiles[def.id].mode === 'float') {
        bringFront(def.id);
        beginDrag(def.id, event, 'move', head);
        return;
      }
      // A tile pulled out of the wall turns into a window under the pointer.
      const start = { x: event.clientX, y: event.clientY };
      const pointerId = event.pointerId;
      const watch = (move) => {
        if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_FROM) return;
        head.removeEventListener('pointermove', watch);
        head.removeEventListener('pointerup', stopWatching);
        head.removeEventListener('pointercancel', stopWatching);
        setMode(def.id, 'float', { offset: 0 });
        beginDrag(def.id, { clientX: start.x, clientY: start.y, pointerId, preventDefault() {} }, 'move', head);
      };
      const stopWatching = () => {
        head.removeEventListener('pointermove', watch);
        head.removeEventListener('pointerup', stopWatching);
        head.removeEventListener('pointercancel', stopWatching);
      };
      head.setPointerCapture?.(pointerId);
      head.addEventListener('pointermove', watch);
      head.addEventListener('pointerup', stopWatching);
      head.addEventListener('pointercancel', stopWatching);
    });
    head.addEventListener('dblclick', (event) => {
      if (!event.target.closest('.light') && !narrow()) togglePop(def.id);
    });
    head.addEventListener('keydown', (event) => {
      const state = layout.tiles[def.id];
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!arrows || state.mode !== 'float' || !state.rect) return;
      event.preventDefault();
      const step = 16;
      const next = event.shiftKey
        ? { ...state.rect, w: state.rect.w + arrows[0] * step, h: state.rect.h + arrows[1] * step }
        : { ...state.rect, x: state.rect.x + arrows[0] * step, y: state.rect.y + arrows[1] * step };
      state.rect = keepReachable(next, bounds());
      state.auto = false;
      placeRect(tile, state.rect);
      save();
    });
    tile.addEventListener('pointerdown', () => {
      if (layout.tiles[def.id].mode === 'float') bringFront(def.id);
      else {
        activeId = def.id;
        paintActive();
      }
    }, true);
    tile.addEventListener('focusin', () => {
      activeId = def.id;
      paintActive();
    });
    stage.append(tile);
  }
  stage.append(emptyNote);

  function beginDrag(id, event, kind, handle) {
    const state = layout.tiles[id];
    if (state.mode !== 'float' || !state.rect) return;
    event.preventDefault?.();
    const tile = tileEls.get(id);
    const origin = { x: event.clientX, y: event.clientY, rect: { ...state.rect } };
    tile.classList.add('dragging');
    handle.setPointerCapture?.(event.pointerId);
    state.auto = false;
    const move = (next) => {
      const dx = next.clientX - origin.x;
      const dy = next.clientY - origin.y;
      const frame = bounds();
      state.rect = kind === 'move'
        ? keepReachable({ ...origin.rect, x: origin.rect.x + dx, y: origin.rect.y + dy }, frame)
        : keepReachable(resizeRect(origin.rect, kind.slice(7), dx, dy), frame);
      placeRect(tile, state.rect);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      tile.classList.remove('dragging');
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // ---------- the dock ----------

  const dock = el('nav', { class: 'dock', 'aria-label': 'Glasshouse dock' });
  for (const def of defs) {
    const badge = el('span', { class: 'dock-badge', hidden: true });
    const item = el('button', { type: 'button', class: 'dock-item', 'aria-label': def.title, 'data-label': def.title, 'data-tile': def.id, onclick: () => focus(def.id) },
      el('span', { class: 'dock-icon' }, icon(def.icon, 20), badge),
      el('span', { class: 'dock-label', text: def.title }));
    dockItems.set(def.id, item);
    badges.set(def.id, badge);
    dock.append(item);
  }
  const tilesButton = el('button', { type: 'button', class: 'dock-item dock-mode', 'aria-label': 'Tidy everything into place', 'data-label': 'Tile everything', onclick: () => setArrange('tiles') },
    el('span', { class: 'dock-icon' }, icon('tiles', 20)), el('span', { class: 'dock-label', text: 'Tiles' }));
  const windowsButton = el('button', { type: 'button', class: 'dock-item dock-mode', 'aria-label': 'Turn everything into floating windows', 'data-label': 'Float everything', onclick: () => setArrange('windows') },
    el('span', { class: 'dock-icon' }, icon('windows', 20)), el('span', { class: 'dock-label', text: 'Windows' }));
  const resetButton = el('button', { type: 'button', class: 'dock-item dock-mode', 'aria-label': 'Put everything back the way it started', 'data-label': 'Reset', onclick: resetLayout },
    el('span', { class: 'dock-icon' }, icon('reset', 20)), el('span', { class: 'dock-label', text: 'Reset' }));
  dock.append(el('span', { class: 'dock-sep', 'aria-hidden': 'true' }), tilesButton, windowsButton, resetButton);

  // ---------- putting everything where it belongs ----------

  function apply() {
    if (disposed) return;
    const isNarrow = narrow();
    const width = stage.clientWidth;
    stage.dataset.mode = isNarrow ? 'narrow' : width >= WIDE_AT ? 'wide' : 'medium';
    const frame = bounds();

    if (isNarrow) {
      stage.style.removeProperty('grid-template-columns');
      stage.style.removeProperty('grid-template-rows');
      for (const [id, tile] of tileEls) {
        tile.hidden = false;
        tile.classList.remove('float');
        tile.classList.toggle('active', id === activeNarrow);
        for (const prop of ['left', 'top', 'width', 'height', 'z-index', 'grid-column', 'grid-row']) tile.style.removeProperty(prop);
      }
      emptyNote.hidden = true;
      zoomed = null;
      applyZoom();
      refreshChrome();
      return;
    }

    const merge = stage.dataset.mode !== 'wide';
    const docked = WALL_ORDER.filter((id) => layout.tiles[id].mode === 'tiled');
    const { rows, hasLeft, hasRight, placements } = packSides(docked, merge);
    const chatDocked = layout.tiles.chat.mode === 'tiled';
    const columns = [];
    const column = {};
    if (hasLeft) {
      column.left = columns.length + 1;
      columns.push('minmax(260px, 1fr)');
    }
    if (chatDocked) {
      column.chat = columns.length + 1;
      columns.push(merge ? 'minmax(340px, 1.4fr)' : 'minmax(420px, 1.7fr)');
    }
    if (hasRight) {
      column.right = columns.length + 1;
      columns.push(merge ? 'minmax(260px, 1fr)' : 'minmax(260px, 1fr)');
    }
    stage.style.gridTemplateColumns = columns.length ? columns.join(' ') : '1fr';
    stage.style.gridTemplateRows = `repeat(${rows}, minmax(36px, 1fr))`;

    let floating = 0;
    for (const [id, tile] of tileEls) {
      const state = layout.tiles[id];
      tile.classList.remove('active');
      tile.hidden = state.mode === 'closed';
      tile.classList.toggle('float', state.mode === 'float');
      if (state.mode === 'float') {
        if (state.auto || !state.rect) {
          state.rect = startRect(id, frame, floating);
          state.auto = true;
        } else {
          state.rect = keepReachable(state.rect, frame);
        }
        floating += 1;
        placeRect(tile, state.rect);
        tile.style.zIndex = String(10 + state.z);
        tile.style.removeProperty('grid-column');
        tile.style.removeProperty('grid-row');
      } else if (state.mode === 'tiled') {
        for (const prop of ['left', 'top', 'width', 'height', 'z-index']) tile.style.removeProperty(prop);
        if (id === 'chat') {
          tile.style.gridColumn = String(column.chat);
          tile.style.gridRow = `1 / span ${rows}`;
        } else {
          const place = placements[id];
          tile.style.gridColumn = String(column[place.side]);
          tile.style.gridRow = `${place.row} / span ${place.rowSpan}`;
        }
      }
    }
    emptyNote.hidden = TILE_IDS.some((id) => layout.tiles[id].mode !== 'closed');
    refreshChrome();
    applyZoom();
    paintActive();
  }

  function refreshChrome() {
    const isNarrow = narrow();
    for (const [id, button] of popButtons) {
      const floating = layout.tiles[id].mode === 'float';
      button.replaceChildren(icon(floating ? 'dockin' : 'pop', 8, 2.8));
      const label = floating ? `Dock ${titleOf[id]} back into the wall` : `Pop ${titleOf[id]} out into a window`;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.hidden = isNarrow;
    }
    for (const [id, item] of dockItems) {
      const open = isNarrow ? id === activeNarrow : layout.tiles[id].mode !== 'closed';
      item.classList.toggle('open', open);
      item.setAttribute('aria-pressed', String(open));
    }
    tilesButton.setAttribute('aria-pressed', String(layout.arrange === 'tiles'));
    windowsButton.setAttribute('aria-pressed', String(layout.arrange === 'windows'));
    tilesButton.hidden = isNarrow;
    windowsButton.hidden = isNarrow;
    resetButton.hidden = isNarrow;
    dock.querySelector('.dock-sep').hidden = isNarrow;
  }

  // ---------- what a person can do ----------

  function setMode(id, mode, { offset = 24 } = {}) {
    const state = layout.tiles[id];
    if (mode === 'float' && state.mode !== 'float') {
      const visible = !tileEls.get(id).hidden;
      const where = visible ? measure(id) : null;
      if (where && where.w > 50) {
        state.rect = keepReachable({ ...where, x: where.x + offset, y: where.y + offset }, bounds());
        state.auto = false;
      } else {
        state.rect = null;
        state.auto = true;
      }
      bringFront(id);
    }
    state.mode = mode;
    if (mode === 'closed' && zoomed === id) zoomed = null;
    save();
    apply();
  }

  function togglePop(id) {
    setMode(id, layout.tiles[id].mode === 'float' ? 'tiled' : 'float');
  }

  function focus(id) {
    if (narrow()) {
      activeNarrow = id;
      apply();
      return;
    }
    if (zoomed && zoomed !== id) zoomed = null;
    const state = layout.tiles[id];
    if (state.mode === 'closed') {
      setMode(id, layout.arrange === 'windows' ? 'float' : 'tiled');
    } else if (state.mode === 'float') {
      bringFront(id);
      save();
    }
    const tile = tileEls.get(id);
    tile.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    tile.classList.remove('flash');
    void tile.offsetWidth;
    tile.classList.add('flash');
    setTimeout(() => tile.classList.remove('flash'), 1000);
  }

  // The green light fills the whole stage with one tile, like full screen on a Mac. Escape or a second press goes back.
  function toggleZoom(id) {
    zoomed = zoomed === id ? null : id;
    applyZoom();
  }

  function applyZoom() {
    for (const [id, tile] of tileEls) tile.classList.toggle('zoomed', id === zoomed);
    stage.classList.toggle('has-zoom', zoomed !== null);
    for (const [id, button] of zoomButtons) {
      const label = zoomed === id ? `Leave the full view of ${titleOf[id]}` : `Fill the whole stage with ${titleOf[id]}`;
      button.replaceChildren(icon(zoomed === id ? 'shrink' : 'expand', 8, 2.8));
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  // ---------- snap layouts: the flyout from the green dot ----------

  let snapPop = null;
  let snapTimer = 0;

  function closeSnap() {
    clearTimeout(snapTimer);
    snapPop?.remove();
    snapPop = null;
  }

  function placePop(pop, anchor) {
    document.body.append(pop);
    const box = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(box.left - 10, window.innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${box.bottom + 8}px`;
  }

  function snapTo(id, rect) {
    const state = layout.tiles[id];
    state.mode = 'float';
    state.rect = keepReachable(rect, bounds());
    state.auto = false;
    if (zoomed === id) zoomed = null;
    bringFront(id);
    save();
    apply();
  }

  function showSnap(id, anchor) {
    if (narrow() || snapPop?.dataset.owner === id) return;
    closeSnap();
    const grid = el('div', { class: 'snap-grid' }, SNAP_LAYOUTS.map((definition) => el('div', { class: 'snap-layout', title: definition.label },
      definition.zones.map((zone, index) => {
        const [left, top, width, height] = zone;
        const space = el('button', { type: 'button', class: 'snap-zone', 'aria-label': `${definition.label}, space ${index + 1}`, onclick: () => choose(id, definition, index, anchor) });
        space.style.left = `calc(${left * 100}% + 1.5px)`;
        space.style.top = `calc(${top * 100}% + 1.5px)`;
        space.style.width = `calc(${width * 100}% - 3px)`;
        space.style.height = `calc(${height * 100}% - 3px)`;
        return space;
      }))));
    snapPop = el('div', { class: 'snap-pop', 'data-owner': id, role: 'dialog', 'aria-label': `Snap ${titleOf[id]} into a layout` },
      el('p', { class: 'snap-title', text: `Snap ${titleOf[id]}` }), grid);
    snapPop.addEventListener('mouseenter', () => clearTimeout(snapTimer));
    snapPop.addEventListener('mouseleave', () => {
      clearTimeout(snapTimer);
      snapTimer = setTimeout(closeSnap, 380);
    });
    placePop(snapPop, anchor);
  }

  function choose(id, definition, index, anchor) {
    snapTo(id, zoneRect(definition.zones[index], bounds()));
    showAssist(definition, new Set([index]), new Set([id]), anchor);
  }

  // After one window is snapped, offer the other open windows for the spaces that are left.
  function showAssist(definition, used, placed, anchor) {
    closeSnap();
    const next = definition.zones.findIndex((_, index) => !used.has(index));
    const others = TILE_IDS.filter((other) => !placed.has(other) && layout.tiles[other].mode !== 'closed');
    if (next < 0 || !others.length) return;
    snapPop = el('div', { class: 'snap-pop snap-assist', role: 'dialog', 'aria-label': 'Fill the other spaces' },
      el('p', { class: 'snap-title', text: 'Fill the other spaces' }),
      el('div', { class: 'snap-assist-list' }, others.map((other) => el('button', {
        type: 'button', class: 'chip', text: titleOf[other],
        onclick: () => {
          snapTo(other, zoneRect(definition.zones[next], bounds()));
          used.add(next);
          placed.add(other);
          showAssist(definition, used, placed, anchor);
        },
      }))),
      el('button', { type: 'button', class: 'btn small ghost', text: 'Done', onclick: closeSnap }));
    placePop(snapPop, anchor);
  }

  // Put every open window into a layout at once.
  function arrangeAll(layoutId) {
    const definition = SNAP_LAYOUTS.find((candidate) => candidate.id === layoutId);
    if (!definition || narrow()) return;
    closeSnap();
    const open = TILE_IDS.filter((id) => layout.tiles[id].mode !== 'closed');
    const frame = bounds();
    const spots = Object.fromEntries(open.map((id) => [id, measure(id)]));
    const assignment = arrangeAssign(open, definition);
    layout.arrange = 'windows';
    zoomed = null;
    for (const id of open) {
      const state = layout.tiles[id];
      if (assignment[id]) {
        state.rect = keepReachable(zoneRect(assignment[id], frame), frame);
        state.auto = false;
      } else if (state.mode !== 'float') {
        state.rect = keepReachable(spots[id], frame);
        state.auto = false;
      }
      state.mode = 'float';
      layout.z += 1;
      state.z = layout.z;
    }
    save();
    apply();
  }

  function setArrange(mode) {
    if (narrow()) return;
    const open = TILE_IDS.filter((id) => layout.tiles[id].mode !== 'closed');
    const spots = Object.fromEntries(open.map((id) => [id, measure(id)]));
    layout.arrange = mode;
    for (const id of open) {
      const state = layout.tiles[id];
      if (mode === 'windows') {
        if (state.mode !== 'float') {
          state.rect = keepReachable(spots[id], bounds());
          state.auto = false;
        }
        state.mode = 'float';
        layout.z += 1;
        state.z = layout.z;
      } else {
        state.mode = 'tiled';
      }
    }
    save();
    apply();
  }

  function resetLayout() {
    layout = normalizeLayout(null);
    for (const tile of tileEls.values()) tile.style.removeProperty('z-index');
    save();
    apply();
  }

  function setCount(id, value) {
    const text = value ? String(value) : '';
    counters.get(id).textContent = text;
    counters.get(id).hidden = !text;
    badges.get(id).textContent = text;
    badges.get(id).hidden = !text;
  }

  const observer = new ResizeObserver(() => requestAnimationFrame(apply));
  observer.observe(stage);
  const onMedia = () => apply();
  const onKey = (event) => {
    if (event.key === 'Escape') {
      closeSnap();
      if (zoomed) {
        zoomed = null;
        applyZoom();
      }
    }
  };
  const onPointerDown = (event) => {
    if (snapPop && !snapPop.contains(event.target) && !event.target.closest?.('.light.green')) closeSnap();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointerDown);
  narrowQuery.addEventListener('change', onMedia);
  apply();

  return {
    stage,
    dock,
    focus,
    setArrange,
    setCount,
    isNarrow: narrow,
    hide: (id) => setMode(id, 'closed'),
    arrangeAll,
    reset: resetLayout,
    isOpen: (id) => layout.tiles[id].mode !== 'closed',
    destroy() {
      disposed = true;
      observer.disconnect();
      narrowQuery.removeEventListener('change', onMedia);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
      closeSnap();
    },
  };
}
