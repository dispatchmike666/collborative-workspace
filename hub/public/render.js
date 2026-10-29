// Turns timeline events into things to show on screen. Plain functions with no page access,
// so they can be tested. Returns null when an event should not appear as a row.

import { COLUMN_LABELS } from './logic.js';

const CARD_ACTIONS = {
  added: () => 'added a card',
  started: () => 'gave a card to their Claude',
  removed: () => 'removed a card',
  moved: (event) => `moved a card to ${COLUMN_LABELS[event.column] ?? event.column}`,
};

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

function describeRun(event) {
  const seconds = typeof event.durationMs === 'number' ? ` in ${(event.durationMs / 1000).toFixed(1)}s` : '';
  const usage = typeof event.costUsd === 'number' && event.costUsd > 0
    ? ` Used your plan allowance (worth about $${event.costUsd.toFixed(2)} at list price, not billed).`
    : '';
  return event.ok ? `Finished${seconds}.${usage}` : `Stopped with a problem${seconds}.${usage}`;
}

function approvalView(event, me) {
  const mine = sameName(me, event.owner);
  let note = null;
  if (!event.approvable) note = 'This command is too complicated to allow with a button.';
  else if (!mine) note = `Only ${event.owner} can allow this, because it would run on ${event.owner}'s computer.`;
  return {
    cls: 'approval',
    label: '',
    text: `${event.owner}'s Claude wanted to run a command but was not allowed to: ${event.command}`,
    approval: { id: event.approvalId, canApprove: Boolean(event.approvable && mine), note },
  };
}

export function eventToView(event, { me } = {}) {
  switch (event.kind) {
    case 'user':
      return { cls: 'user', label: event.who, text: event.text };
    case 'team-chat':
      return { cls: 'chat', label: `${event.who} to ${event.to}`, text: event.text };
    case 'claude-text':
      return { cls: 'claude', label: `${event.owner}'s Claude`, text: event.text };
    case 'claude-step':
      return { cls: 'step', label: '', text: event.summary };
    case 'claude-step-result':
      return event.ok ? null : { cls: 'step bad', label: '', text: `Problem: ${event.text}` };
    case 'run-done':
      return { cls: event.ok ? 'done' : 'error', label: '', text: describeRun(event) };
    case 'error':
      return { cls: 'error', label: '', text: event.text };
    case 'sync':
      return { cls: 'sync', label: '', text: event.text };
    case 'notes-saved':
      return { cls: 'sync', label: '', text: `${event.who} updated the shared notes.` };
    case 'board-card':
      return { cls: 'sync', label: '', text: `${event.who} ${(CARD_ACTIONS[event.action] ?? (() => 'changed a card'))(event)}: ${event.title}` };
    case 'decision-added':
      return { cls: 'sync', label: '', text: `${event.who} added a decision: ${event.text}` };
    case 'brief-saved':
      return { cls: 'sync', label: '', text: `${event.who} updated the project brief.` };
    case 'approval-needed':
      return approvalView(event, me);
    case 'status':
      if (event.state === 'queued') return { cls: 'sync', label: '', text: `${event.who}'s message is waiting in line and will start by itself.` };
      if (event.state === 'waiting') return { cls: 'sync', label: '', text: `${event.who}'s computer is offline. This will run as soon as it is back.` };
      return null;
    default:
      return null;
  }
}

// The words on the status line. Returns null for events that do not change it.
export function statusText(event) {
  if (event.kind !== 'status') return null;
  if (event.state === 'working') return `${event.who}'s Claude is working…`;
  if (event.state === 'idle') return 'Nobody is waiting on Claude';
  return null;
}

export function approvalUsedText(event) {
  return `${event.by} allowed it to run once.`;
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
