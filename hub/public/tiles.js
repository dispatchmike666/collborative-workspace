import { icon } from './icons.js';
import { cascadeRect, clampRect, normalizeLayout, packTiles, TILE_IDS, WALL_ORDER } from './logic.js';
import { el, prefs } from './ui.js';

const NARROW = '(max-width: 760px)';
const WIDE_AT = 960;
const DRAG_FROM = 6;

// The project screen's tile wall. Every tile is docked in the wall, floating as a window, or hidden.
// A dock at the bottom brings tiles back and switches the whole screen between wall and windows.
// defs: [{ id, title, icon, element }]. The tiles keep their own elements, so nothing reloads when they move.
export function createTiles({ projectId, defs }) {
  const storeKey = `layout.${projectId}`;
  let layout = normalizeLayout(prefs.get(storeKey, null));
  const narrowQuery = window.matchMedia(NARROW);
  let activeNarrow = 'chat';
  let disposed = false;

  const stage = el('div', { class: 'stage' });
  const emptyNote = el('p', { class: 'stage-empty', text: 'Nothing is open. Use the dock below to bring a tile back.', hidden: true });
  const tileEls = new Map();
  const popButtons = new Map();
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

  function bringFront(id) {
    layout.z += 1;
    layout.tiles[id].z = layout.z;
    tileEls.get(id).style.zIndex = String(10 + layout.z);
  }

  // ---------- one tile ----------

  for (const def of defs) {
    const counter = el('span', { class: 'tile-count', hidden: true });
    const popButton = el('button', { type: 'button', class: 'tile-btn', onclick: () => togglePop(def.id) });
    const closeButton = el('button', { type: 'button', class: 'tile-btn', 'aria-label': `Hide ${def.title}`, title: `Hide ${def.title}`, onclick: () => setMode(def.id, 'closed') }, icon('close', 15));
    const head = el('header', { class: 'tile-head', tabindex: '0', 'aria-label': `${def.title} bar. Arrow keys move a window, Shift and arrows resize it.` },
      el('span', { class: 'tile-icon' }, icon(def.icon, 16)),
      el('h3', { class: 'tile-title', text: def.title }),
      counter,
      el('span', { class: 'spacer' }),
      popButton,
      closeButton);
    const tile = el('section', { class: 'tile', 'data-tile': def.id, 'aria-label': def.title }, head, el('div', { class: 'tile-body' }, def.element), el('span', { class: 'tile-resize', 'aria-hidden': 'true' }));
    tileEls.set(def.id, tile);
    popButtons.set(def.id, popButton);
    counters.set(def.id, counter);

    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.tile-btn') || narrow()) return;
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
      if (!event.target.closest('.tile-btn') && !narrow()) togglePop(def.id);
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
      state.rect = clampRect(next, bounds());
      placeRect(tile, state.rect);
      save();
    });
    tile.addEventListener('pointerdown', () => {
      if (layout.tiles[def.id].mode === 'float') bringFront(def.id);
    }, true);
    tile.querySelector('.tile-resize').addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || layout.tiles[def.id].mode !== 'float') return;
      bringFront(def.id);
      beginDrag(def.id, event, 'resize', event.currentTarget);
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
    const move = (next) => {
      const dx = next.clientX - origin.x;
      const dy = next.clientY - origin.y;
      const frame = bounds();
      state.rect = kind === 'move'
        ? clampRect({ ...origin.rect, x: origin.rect.x + dx, y: origin.rect.y + dy }, frame)
        : clampRect({ ...origin.rect, w: Math.min(origin.rect.w + dx, frame.w - origin.rect.x), h: Math.min(origin.rect.h + dy, frame.h - origin.rect.y) }, frame);
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

  const dock = el('nav', { class: 'dock', 'aria-label': 'Workspace dock' });
  for (const def of defs) {
    const badge = el('span', { class: 'dock-badge', hidden: true });
    const item = el('button', { type: 'button', class: 'dock-item', title: def.title, 'data-tile': def.id, onclick: () => focus(def.id) },
      el('span', { class: 'dock-icon' }, icon(def.icon, 20), badge),
      el('span', { class: 'dock-label', text: def.title }));
    dockItems.set(def.id, item);
    badges.set(def.id, badge);
    dock.append(item);
  }
  const tilesButton = el('button', { type: 'button', class: 'dock-item dock-mode', title: 'Tidy everything into the wall', onclick: () => setArrange('tiles') },
    el('span', { class: 'dock-icon' }, icon('tiles', 20)), el('span', { class: 'dock-label', text: 'Tiles' }));
  const windowsButton = el('button', { type: 'button', class: 'dock-item dock-mode', title: 'Turn everything into floating windows', onclick: () => setArrange('windows') },
    el('span', { class: 'dock-icon' }, icon('windows', 20)), el('span', { class: 'dock-label', text: 'Windows' }));
  const resetButton = el('button', { type: 'button', class: 'dock-item dock-mode', title: 'Put everything back the way it started', onclick: resetLayout },
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
      refreshChrome();
      return;
    }

    const wallCols = stage.dataset.mode === 'wide' ? 2 : 1;
    const docked = WALL_ORDER.filter((id) => layout.tiles[id].mode === 'tiled');
    const { rows, placements } = packTiles(docked, wallCols);
    const chatDocked = layout.tiles.chat.mode === 'tiled';
    const offset = chatDocked ? 1 : 0;
    stage.style.gridTemplateColumns = chatDocked ? `minmax(340px, 1.15fr) repeat(${wallCols}, minmax(0, 1fr))` : `repeat(${wallCols}, minmax(0, 1fr))`;
    stage.style.gridTemplateRows = `repeat(${Math.max(rows, 1)}, minmax(190px, 1fr))`;

    let floating = 0;
    for (const [id, tile] of tileEls) {
      const state = layout.tiles[id];
      tile.classList.remove('active');
      tile.hidden = state.mode === 'closed';
      tile.classList.toggle('float', state.mode === 'float');
      if (state.mode === 'float') {
        state.rect = clampRect(state.rect ?? cascadeRect(floating, frame), frame);
        floating += 1;
        placeRect(tile, state.rect);
        tile.style.zIndex = String(10 + state.z);
        tile.style.removeProperty('grid-column');
        tile.style.removeProperty('grid-row');
      } else if (state.mode === 'tiled') {
        for (const prop of ['left', 'top', 'width', 'height', 'z-index']) tile.style.removeProperty(prop);
        if (id === 'chat') {
          tile.style.gridColumn = '1';
          tile.style.gridRow = `1 / span ${Math.max(rows, 1)}`;
        } else {
          const place = placements[id];
          tile.style.gridColumn = `${place.col + offset} / span ${place.colSpan}`;
          tile.style.gridRow = `${place.row} / span ${place.rowSpan}`;
        }
      }
    }
    emptyNote.hidden = TILE_IDS.some((id) => layout.tiles[id].mode !== 'closed');
    refreshChrome();
  }

  function refreshChrome() {
    const isNarrow = narrow();
    for (const [id, button] of popButtons) {
      const floating = layout.tiles[id].mode === 'float';
      button.replaceChildren(icon(floating ? 'dockin' : 'pop', 15));
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
      const frame = bounds();
      const where = tileEls.get(id).hidden ? null : measure(id);
      state.rect = clampRect(where && where.w > 50 ? { ...where, x: where.x + offset, y: where.y + offset } : cascadeRect(TILE_IDS.filter((other) => layout.tiles[other].mode === 'float').length, frame), frame);
      bringFront(id);
    }
    state.mode = mode;
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

  function setArrange(mode) {
    if (narrow()) return;
    const open = TILE_IDS.filter((id) => layout.tiles[id].mode !== 'closed');
    const spots = Object.fromEntries(open.map((id) => [id, measure(id)]));
    layout.arrange = mode;
    for (const id of open) {
      const state = layout.tiles[id];
      if (mode === 'windows') {
        if (state.mode !== 'float') state.rect = clampRect(spots[id], bounds());
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
  narrowQuery.addEventListener('change', onMedia);
  apply();

  return {
    stage,
    dock,
    focus,
    setArrange,
    setCount,
    isNarrow: narrow,
    isOpen: (id) => layout.tiles[id].mode !== 'closed',
    destroy() {
      disposed = true;
      observer.disconnect();
      narrowQuery.removeEventListener('change', onMedia);
    },
  };
}
