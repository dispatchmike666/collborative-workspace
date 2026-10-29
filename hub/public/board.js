import { COLUMN_LABELS, groupBoard, userColor } from './logic.js';
import { api, el, toast } from './ui.js';

const COLUMNS = Object.keys(COLUMN_LABELS);
const EMPTY = {
  ideas: 'Park half-formed ideas here.',
  todo: "Add what's next.",
  doing: 'Nothing in progress.',
  done: 'Finished cards land here.',
};

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// The board: Ideas, To do, Doing, Done. Cards can be dragged, edited, or handed to your own Claude.
export function createBoard(ctx) {
  let cards = [];
  const root = el('div', { class: 'board' });

  const base = `/api/projects/${ctx.projectId}/board`;
  const call = async (path, options) => {
    try {
      return await api(`${base}${path}`, options);
    } catch (error) {
      toast(error.message, 'bad');
      return null;
    }
  };

  // ---- adding ----
  const titleInput = el('input', { type: 'text', maxlength: '120', placeholder: 'New card: what needs doing?', 'aria-label': 'Card title', required: true });
  const detailInput = el('textarea', { rows: '2', placeholder: 'More detail (optional)', 'aria-label': 'Card details' });
  const columnSelect = el('select', { 'aria-label': 'Put it in' }, COLUMNS.slice(0, 3).map((column) => el('option', { value: column, text: COLUMN_LABELS[column] })));
  columnSelect.value = 'todo';
  const addForm = el(
    'form',
    {
      class: 'add-card',
      onsubmit: async (event) => {
        event.preventDefault();
        const title = titleInput.value.trim();
        if (!title) return;
        const card = await call('/cards', { method: 'POST', body: { title, detail: detailInput.value, column: columnSelect.value } });
        if (card) {
          titleInput.value = '';
          detailInput.value = '';
          titleInput.focus();
        }
      },
    },
    titleInput,
    detailInput,
    el('div', { class: 'row-actions' }, columnSelect, el('button', { type: 'submit', class: 'btn primary small', text: 'Add card' })),
  );

  // ---- one card ----
  function ticket(card) {
    const node = el('article', { class: 'ticket', draggable: 'true', 'data-id': card.id, role: 'listitem' });
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', card.id);
      event.dataTransfer.effectAllowed = 'move';
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => node.classList.remove('dragging'));

    const index = COLUMNS.indexOf(card.column);
    const move = (to) => call(`/cards/${card.id}`, { method: 'PATCH', body: { column: to } });
    const actions = el('div', { class: 'row-actions' });
    if (card.column !== 'doing' && card.column !== 'done') {
      actions.append(el('button', {
        type: 'button',
        class: 'btn primary small',
        text: 'Give to my Claude',
        onclick: async () => {
          const started = await call(`/cards/${card.id}/start`, { method: 'POST', body: {} });
          if (started) toast('Handed to your Claude. Watch the chat.', 'good');
        },
      }));
    }
    if (index > 0) actions.append(el('button', { type: 'button', class: 'btn small icon', 'aria-label': `Move to ${COLUMN_LABELS[COLUMNS[index - 1]]}`, text: '◀', onclick: () => move(COLUMNS[index - 1]) }));
    if (index < COLUMNS.length - 1) actions.append(el('button', { type: 'button', class: 'btn small icon', 'aria-label': `Move to ${COLUMN_LABELS[COLUMNS[index + 1]]}`, text: '▶', onclick: () => move(COLUMNS[index + 1]) }));
    actions.append(
      el('button', { type: 'button', class: 'btn small ghost', text: 'Edit', onclick: () => edit(node, card) }),
      el('button', { type: 'button', class: 'btn small ghost danger', 'aria-label': `Delete ${card.title}`, text: 'Delete', onclick: () => call(`/cards/${card.id}`, { method: 'DELETE' }) }),
    );

    const meta = el('div', { class: 'ticket-meta' }, el('span', { text: `by ${card.createdBy}` }));
    if (card.assignee) meta.append(el('span', { class: `chip crew-${userColor(card.assignee, ctx.users)}`, text: sameName(card.assignee, ctx.me) ? 'your Claude' : `${card.assignee}'s Claude` }));
    node.append(el('div', { class: 'ticket-title', text: card.title }), card.detail ? el('div', { class: 'ticket-detail', text: card.detail }) : null, meta, actions);
    return node;
  }

  function edit(node, card) {
    const title = el('input', { type: 'text', maxlength: '120', value: card.title, 'aria-label': 'Card title' });
    const detail = el('textarea', { rows: '3', 'aria-label': 'Card details' });
    detail.value = card.detail;
    node.replaceChildren(
      title,
      detail,
      el('div', { class: 'row-actions' },
        el('button', {
          type: 'button',
          class: 'btn primary small',
          text: 'Save',
          onclick: async () => {
            const saved = await call(`/cards/${card.id}`, { method: 'PATCH', body: { title: title.value, detail: detail.value } });
            if (!saved) return;
          },
        }),
        el('button', { type: 'button', class: 'btn small ghost', text: 'Cancel', onclick: () => render() })),
    );
    node.draggable = false;
    title.focus();
  }

  // ---- the lanes ----
  function lane(column, list) {
    const section = el('section', { class: 'lane', 'data-column': column, 'aria-label': COLUMN_LABELS[column] },
      el('h4', {}, el('span', { text: COLUMN_LABELS[column] }), el('span', { text: String(list.length) })),
      list.length ? list.map(ticket) : el('p', { class: 'muted small', text: EMPTY[column] }));
    section.addEventListener('dragover', (event) => {
      event.preventDefault();
      section.classList.add('drop');
    });
    section.addEventListener('dragleave', (event) => {
      if (!section.contains(event.relatedTarget)) section.classList.remove('drop');
    });
    section.addEventListener('drop', (event) => {
      event.preventDefault();
      section.classList.remove('drop');
      const id = event.dataTransfer.getData('text/plain');
      if (!id) return;
      const others = [...section.querySelectorAll('.ticket')].filter((candidate) => candidate.dataset.id !== id);
      let position = others.findIndex((candidate) => {
        const box = candidate.getBoundingClientRect();
        return event.clientY < box.top + box.height / 2;
      });
      if (position < 0) position = others.length;
      call(`/cards/${id}`, { method: 'PATCH', body: { column, position } });
    });
    return section;
  }

  function render() {
    const grouped = groupBoard(cards);
    root.replaceChildren(...COLUMNS.map((column) => lane(column, grouped[column])));
  }

  render();
  return {
    element: el('div', { class: 'board-wrap' },
      el('p', { class: 'panel-intro', text: 'Plan the work here. Hand a card to your own Claude and it gets done, then the card moves to Done by itself.' }),
      addForm,
      root),
    onEvent(event) {
      if (event.kind !== 'board') return;
      cards = event.cards;
      render();
    },
    count: () => cards.filter((card) => card.column !== 'done').length,
  };
}
