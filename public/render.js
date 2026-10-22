// Turns an event from the timeline into something to show on screen.
// Returns null when the event should not appear as a row.

function describeRun(event) {
  const seconds = typeof event.durationMs === 'number' ? ` in ${(event.durationMs / 1000).toFixed(1)}s` : '';
  const usage = typeof event.costUsd === 'number' && event.costUsd > 0
    ? ` Used your plan allowance (worth about $${event.costUsd.toFixed(2)} at list price, not billed).`
    : '';
  return event.ok ? `Finished${seconds}.${usage}` : `Stopped with a problem${seconds}.${usage}`;
}

export function eventToView(event) {
  switch (event.kind) {
    case 'user':
      return { cls: 'user', label: event.who, text: event.text };
    case 'claude-text':
      return { cls: 'claude', label: 'Claude', text: event.text };
    case 'claude-step':
      return { cls: 'step', label: '', text: event.summary };
    case 'claude-step-result':
      return event.ok ? null : { cls: 'step bad', label: '', text: `Problem: ${event.text}` };
    case 'run-done':
      return { cls: event.ok ? 'done' : 'error', label: '', text: describeRun(event) };
    case 'error':
      return { cls: 'error', label: '', text: event.text };
    case 'status':
      return event.state === 'queued'
        ? { cls: 'step', label: '', text: `${event.who} sent a message. It's waiting in line and will start by itself.` }
        : null;
    default:
      return null;
  }
}

// The words in the little status pill at the top. Returns null for events that don't change it.
export function statusText(event) {
  if (event.kind !== 'status') return null;
  if (event.state === 'working') return 'Claude is working…';
  if (event.state === 'idle') return 'Ready';
  return null;
}
