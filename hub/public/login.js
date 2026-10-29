import { creature } from './crew.js';
import { applyLook } from './ui.js';

applyLook();

// The crew waves hello. They stay asleep until you are in.
document.getElementById('crew').append(
  creature({ color: 'blue', mood: 'awake', size: 'big', label: 'A friendly helper' }),
  creature({ color: 'pink', mood: 'asleep', size: 'big', label: 'A sleepy helper' }),
);

const form = document.getElementById('login-form');
const errorEl = document.getElementById('error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  const name = document.getElementById('name').value.trim();
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    if (res.ok) {
      window.location.assign('/');
      return;
    }
    const body = await res.json().catch(() => ({}));
    errorEl.textContent = body.error ?? 'Could not log in. Try again.';
  } catch {
    errorEl.textContent = "Couldn't reach the workspace. Check your connection and try again.";
  }
  errorEl.hidden = false;
});
