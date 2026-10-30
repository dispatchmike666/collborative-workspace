import { timeAgo } from './render.js';
import { api, el } from './ui.js';

const WHERE_LABEL = { desktop: 'Claude desktop app', terminal: 'Terminal', other: 'Claude' };
const STATUS_LABEL = { busy: 'Working now', idle: 'Idle', unknown: 'Open' };
const POLL_MS = 5000;

// "Your open Claude chats": the chats open on your own computer right now, with what each one is
// working on, and a way to drop a message into one. Your helper reports them, and only you ever see
// this list. Rows are updated in place so a message you are typing is never wiped by a refresh.
export function createChats() {
  const list = el('ul', {});
  const note = el('p', { class: 'muted small' });
  const section = el('section', {},
    el('div', { class: 'section-head' },
      el('h2', { text: 'Your open Claude chats' }),
      el('span', { class: 'muted small', text: 'Only you can see this list.' })),
    note,
    el('div', { class: 'feed sticker', hidden: true }, list));
  const panel = section.querySelector('.feed');
  const rows = new Map();

  function makeRow(chat) {
    const dot = el('span', { class: 'avatar', 'aria-hidden': 'true' });
    const name = el('strong');
    const status = el('span', { class: 'muted small' });
    const doing = el('div', { class: 'small' });
    const where = el('div', { class: 'where small muted' });
    const result = el('p', { class: 'small muted', role: 'status', hidden: true });
    const input = el('input', { type: 'text', maxlength: '8000', placeholder: 'Message for this chat…', 'aria-label': 'Message for this chat' });
    const send = el('button', { type: 'submit', class: 'btn small primary', text: 'Send' });
    const form = el('form', {
      hidden: true,
      onsubmit: async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        result.hidden = false;
        result.textContent = 'Sending…';
        try {
          const outcome = await api('/api/chats/send', { method: 'POST', body: { chatId: chat.id, text } });
          result.textContent = outcome.message;
          if (outcome.ok) input.value = '';
        } catch (error) {
          result.textContent = error.message;
        } finally {
          send.disabled = false;
        }
      },
    }, input, send);
    const toggle = el('button', {
      type: 'button',
      class: 'btn small ghost',
      text: 'Message this chat',
      onclick: () => {
        form.hidden = !form.hidden;
        if (!form.hidden) input.focus();
      },
    });
    const li = el('li', {}, dot, el('div', { class: 'feed-text' }, el('div', {}, name, ' ', status), doing, where, toggle, form, result));

    return {
      li,
      update(next) {
        chat = next;
        dot.className = `avatar ${next.status === 'busy' ? 'mint' : 'blue'}`;
        dot.textContent = next.status === 'busy' ? '●' : '○';
        name.textContent = next.name;
        status.textContent = `· ${STATUS_LABEL[next.status]}`;
        doing.textContent = next.doing ?? '';
        doing.hidden = !next.doing;
        const ago = next.updatedAt ? timeAgo(new Date(next.updatedAt).toISOString()) : '';
        where.textContent = [WHERE_LABEL[next.where], next.folder, ago].filter(Boolean).join('  ·  ');
        toggle.hidden = !next.canMessage;
        if (!next.canMessage) form.hidden = true;
      },
    };
  }

  function show({ online, chats }) {
    const ids = new Set(chats.map((chat) => chat.id));
    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      row.li.remove();
      rows.delete(id);
    }
    for (const chat of chats) {
      let row = rows.get(chat.id);
      if (!row) {
        row = makeRow(chat);
        rows.set(chat.id, row);
      }
      row.update(chat);
      list.append(row.li);
    }
    panel.hidden = chats.length === 0;
    if (!online) note.textContent = 'Start your helper to see the Claude chats open on your computer.';
    else if (!chats.length) note.textContent = 'No Claude chats are open on your computer right now.';
    else note.textContent = '';
    note.hidden = !note.textContent;
  }

  async function refresh() {
    try {
      show(await api('/api/chats'));
    } catch {
      // The next tick tries again.
    }
  }

  refresh();
  const timer = setInterval(refresh, POLL_MS);
  return { element: section, stop: () => clearInterval(timer) };
}
