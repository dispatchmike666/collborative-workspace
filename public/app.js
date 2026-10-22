import { eventToView, statusText } from './render.js';

const timelineEl = document.getElementById('timeline');
const statusEl = document.getElementById('status');
const form = document.getElementById('composer');
const input = document.getElementById('message');

// Adds one row to the timeline. Text is set with textContent, never as HTML.
function addRow({ cls, label, text }) {
  const stickToBottom = timelineEl.scrollHeight - timelineEl.scrollTop - timelineEl.clientHeight < 80;
  const row = document.createElement('div');
  row.className = `row ${cls}`;
  if (label) {
    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;
    row.append(labelEl);
  }
  const textEl = document.createElement('span');
  textEl.className = 'text';
  textEl.textContent = text;
  row.append(textEl);
  timelineEl.append(row);
  if (stickToBottom) timelineEl.scrollTop = timelineEl.scrollHeight;
}

const source = new EventSource('/events');
source.onopen = () => {
  statusEl.textContent = 'Connected';
};
source.onerror = () => {
  statusEl.textContent = 'Reconnecting…';
};
source.onmessage = (message) => {
  const event = JSON.parse(message.data);
  const status = statusText(event);
  if (status) statusEl.textContent = status;
  const view = eventToView(event);
  if (view) addRow(view);
};

form.addEventListener('submit', async (submitEvent) => {
  submitEvent.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    const response = await fetch('/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) addRow({ cls: 'error', label: '', text: `Couldn't send that message (error ${response.status}).` });
  } catch {
    addRow({ cls: 'error', label: '', text: "Couldn't reach the server. Is it still running?" });
  }
});
