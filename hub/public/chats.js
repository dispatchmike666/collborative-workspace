import { messageProgress, pickChats, placeInOrder, progressState, seeAllChatsLabel, timeAgo } from './render.js';
import { api, el } from './ui.js';

const WHERE_LABEL = { desktop: 'Claude desktop app', terminal: 'Terminal', other: 'Claude' };
const STATUS_LABEL = { busy: 'Working now', idle: 'Idle', unknown: 'Open' };
const POLL_MS = 5000;

// "Your open Claude chats": the chats open on your own computer right now, with what each one is
// working on, and a way to drop a message into one. Your helper reports them, and only you ever see
// this list. Rows are updated in place so a message you are typing is never wiped by a refresh.
// `limit` caps how many show (the home page shows a few, with a link to the rest); leave it out to show all.
export function createChats({ limit = null } = {}) {
  const list = el('ul', {});
  const note = el('p', { class: 'muted small' });
  const seeAll = el('a', { class: 'see-all small', href: '#/chats', hidden: true });
  const section = el('section', { class: 'chats-section' },
    el('div', { class: 'section-head' },
      el('h2', { text: 'Your open Claude chats' }),
      el('span', { class: 'section-aside' }, el('span', { class: 'muted small', text: 'Only you can see this list.' }), seeAll)),
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
    const progress = el('p', { class: 'small muted', role: 'status', hidden: true });
    const waitNote = el('p', { class: 'small muted', hidden: true });
    // Undefined until this page sends a message; then the id of the message the helper last reported, so the
    // new one shows as "sent" until the helper reports it.
    let sentAfter;
    const showProgress = () => {
      const view = messageProgress(progressState(chat.lastMessage, sentAfter));
      progress.hidden = !view;
      progress.textContent = view ? view.line : '';
      waitNote.hidden = !view?.note;
      waitNote.textContent = view?.note ?? '';
    };
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
        const before = chat.lastMessage ? chat.lastMessage.id : null;
        try {
          const outcome = await api('/api/chats/send', { method: 'POST', body: { chatId: chat.id, text } });
          if (outcome.ok) {
            input.value = '';
            sentAfter = before;
            result.hidden = true;
            showProgress();
          } else {
            result.textContent = outcome.message;
          }
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
    const li = el('li', {}, dot, el('div', { class: 'feed-text' }, el('div', {}, name, ' ', status), doing, where, toggle, form, result, progress, waitNote));

    return {
      li,
      // Someone is in the middle of a message here: the box has the cursor or has words in it.
      inUse: () => li.contains(document.activeElement) || input.value.trim() !== '',
      update(next) {
        chat = next;
        if (sentAfter !== undefined && next.lastMessage && next.lastMessage.id !== sentAfter) sentAfter = undefined;
        showProgress();
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
    // Every open chat keeps its row (and anything typed into it), even the ones not on screen right now.
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
    }
    const keep = [...rows].filter(([, row]) => row.inUse()).map(([id]) => id);
    const { shown, total, more } = pickChats(chats, { limit, keep });
    const ordered = shown.map((chat) => rows.get(chat.id).li);
    const onScreen = new Set(ordered);
    for (const li of [...list.children]) if (!onScreen.has(li)) li.remove();
    // Rows are never pulled out and put back (that drops the cursor from a box being typed in). While you are
    // typing in one, the order is left alone until you are done; new rows still appear at the end.
    if (list.contains(document.activeElement)) {
      for (const li of ordered) if (!li.parentNode) list.append(li);
    } else {
      placeInOrder(list, ordered);
    }
    panel.hidden = chats.length === 0;
    seeAll.hidden = more === 0;
    seeAll.textContent = seeAllChatsLabel(total);
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

// The Chats page (#/chats): every open chat, not only the few the home page has room for.
export function showChatsPage(viewEl) {
  const chats = createChats();
  viewEl.replaceChildren(el('div', { class: 'home chats-page' },
    el('a', { class: 'back-link small', href: '#/', text: '‹ Home' }),
    chats.element));
  return chats.stop;
}
