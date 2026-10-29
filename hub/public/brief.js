import { timeAgo } from './render.js';
import { api, el, toast } from './ui.js';

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// The project brief: standing instructions, settled decisions, and whether Claude reads the notes.
// Everything here is added to the top of every request, so each Claude always knows the ground rules.
export function createBrief(ctx) {
  let knowledge = { brief: { text: '', version: 0 }, decisions: [], shareNotes: true };
  let dirty = false;
  const base = `/api/projects/${ctx.projectId}/knowledge`;

  // ---- the brief ----
  const area = el('textarea', { rows: '7', class: 'notes', maxlength: '4000', 'aria-label': 'Project brief', placeholder: 'For example: Explain things in plain English. Keep it simple. Ask before adding anything big.' });
  area.addEventListener('input', () => { dirty = true; });
  const message = el('p', { class: 'muted small', role: 'status' });
  const choices = el('span', { class: 'row-actions' });

  async function saveBrief() {
    choices.replaceChildren();
    try {
      const result = await api(`${base}/brief`, { method: 'PUT', body: { text: area.value, baseVersion: knowledge.brief.version } });
      knowledge.brief = result.brief;
      dirty = false;
      message.textContent = 'Saved. Claude will follow this from its next request.';
    } catch (error) {
      if (error.status !== 409) {
        message.textContent = error.message;
        return;
      }
      const theirs = error.data.brief;
      message.textContent = `${theirs.updatedBy} saved a newer brief. Yours is still in the box.`;
      choices.replaceChildren(
        el('button', { type: 'button', class: 'btn small', text: 'Use theirs', onclick: () => { knowledge.brief = theirs; area.value = theirs.text; dirty = false; message.textContent = ''; choices.replaceChildren(); } }),
        el('button', { type: 'button', class: 'btn small', text: 'Save mine anyway', onclick: () => { knowledge.brief = theirs; saveBrief(); } }),
      );
    }
  }

  // ---- decisions ----
  const decisionList = el('div', { class: 'decisions' });
  const decisionInput = el('input', { type: 'text', maxlength: '300', 'aria-label': 'New decision', placeholder: 'A call you two have made, like "Buttons are blue"' });
  const decisionForm = el('form', {
    class: 'composer-line',
    onsubmit: async (event) => {
      event.preventDefault();
      const text = decisionInput.value.trim();
      if (!text) return;
      try {
        await api(`${base}/decisions`, { method: 'POST', body: { text } });
        decisionInput.value = '';
      } catch (error) {
        toast(error.message, 'bad');
      }
    },
  }, decisionInput, el('button', { type: 'submit', class: 'btn primary small', text: 'Add' }));

  function renderDecisions() {
    decisionList.replaceChildren(...(knowledge.decisions.length
      ? [...knowledge.decisions].reverse().map((decision) => el(
        'div',
        { class: 'decision' },
        el('div', { class: 'text' }, el('div', { text: decision.text }), el('div', { class: 'meta', text: `${decision.by}, ${timeAgo(decision.at)}` })),
        sameName(decision.by, ctx.me)
          ? el('button', {
            type: 'button',
            class: 'btn small ghost',
            'aria-label': `Remove decision: ${decision.text}`,
            text: '✕',
            onclick: async () => {
              try {
                await api(`${base}/decisions/${decision.id}`, { method: 'DELETE' });
              } catch (error) {
                toast(error.message, 'bad');
              }
            },
          })
          : null,
      ))
      : [el('p', { class: 'muted small', text: 'Nothing settled yet. When you two decide something, write it here so every Claude keeps to it.' })]));
  }

  // ---- notes sharing ----
  const shareBox = el('input', { type: 'checkbox' });
  shareBox.addEventListener('change', async () => {
    try {
      await api(`${base}/share-notes`, { method: 'PUT', body: { value: shareBox.checked } });
    } catch (error) {
      toast(error.message, 'bad');
      shareBox.checked = knowledge.shareNotes;
    }
  });

  // ---- what Claude is told ----
  const seen = el('pre', { class: 'code' });
  function renderSeen(notesText) {
    const parts = [];
    if (knowledge.brief.text) parts.push(`Project instructions (always follow these):\n${knowledge.brief.text}`);
    if (knowledge.decisions.length) parts.push(`Decisions the team has settled (keep to these):\n${knowledge.decisions.slice(-20).map((d) => `- ${d.text}`).join('\n')}`);
    if (knowledge.shareNotes && notesText) parts.push(`Shared project notes (for reference):\n${notesText.slice(0, 3000)}`);
    seen.textContent = parts.length ? parts.join('\n\n') : 'Nothing yet. Add a brief or a decision above.';
  }

  function render() {
    if (!dirty) area.value = knowledge.brief.text;
    shareBox.checked = knowledge.shareNotes;
    renderDecisions();
    renderSeen(ctx.getNotesText());
  }

  render();
  return {
    element: el('div', { class: 'brief-wrap' },
      el('p', { class: 'panel-intro', text: 'This is your project\'s memory. Claude reads everything here at the start of every request, for both of you.' }),
      el('section', { class: 'panel' }, el('h3', { text: 'Project brief' }), area, el('div', { class: 'row-actions' }, el('button', { type: 'button', class: 'btn primary small', text: 'Save brief', onclick: saveBrief }), choices), message),
      el('section', { class: 'panel' }, el('h3', { text: 'Settled decisions' }), decisionForm, decisionList),
      el('label', { class: 'switch' }, shareBox, el('span', { text: 'Let Claude read the shared notes too' })),
      el('details', { class: 'panel' }, el('summary', { text: 'See what Claude is told' }), seen)),
    onEvent(event) {
      if (event.kind === 'knowledge') {
        knowledge = { brief: event.brief, decisions: event.decisions, shareNotes: event.shareNotes };
        render();
      }
      if (event.kind === 'notes-changed') renderSeen(ctx.getNotesText());
    },
    count: () => knowledge.decisions.length,
  };
}
