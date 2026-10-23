const MAX_LINE = 300;
const MAX_STEPS_SHOWN = 8;

function clip(text, max = MAX_LINE) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

const sameName = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// A short summary of what other people did since this person's Claude last worked here.
// Claudes never talk to each other, so this is how one learns what the other changed.
// Private team chat, status noise and the person's own activity are left out.
export function buildRecap(events, forUser, { sinceId = 0, maxChars = 1500 } = {}) {
  const lines = [];
  let steps = [];
  let stepOwner = null;

  const flushSteps = () => {
    if (!steps.length) return;
    const unique = [...new Set(steps)];
    const shown = unique.slice(0, MAX_STEPS_SHOWN);
    const extra = unique.length - shown.length;
    lines.push(`${stepOwner}'s Claude did: ${shown.join(', ')}${extra > 0 ? `, and ${extra} more` : ''}`);
    steps = [];
    stepOwner = null;
  };

  for (const event of events) {
    if (event.id <= sinceId) continue;

    if (event.kind === 'claude-step' && event.owner && !sameName(event.owner, forUser)) {
      if (stepOwner && stepOwner !== event.owner) flushSteps();
      stepOwner = event.owner;
      steps.push(event.summary);
      continue;
    }
    flushSteps();

    if (event.kind === 'user' && !sameName(event.who, forUser)) {
      lines.push(`${event.who} asked: ${clip(event.text)}`);
    } else if (event.kind === 'claude-text' && event.owner && !sameName(event.owner, forUser)) {
      lines.push(`${event.owner}'s Claude said: ${clip(event.text)}`);
    } else if (event.kind === 'notes-saved' && !sameName(event.who, forUser)) {
      lines.push(`${event.who} updated the shared notes.`);
    }
  }
  flushSteps();

  if (!lines.length) return '';

  // Keep the newest lines that fit.
  const kept = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (size + lines[i].length + 1 > maxChars) break;
    kept.unshift(lines[i]);
    size += lines[i].length + 1;
  }
  if (kept.length < lines.length) kept.unshift('(Older activity left out)');
  return kept.join('\n');
}
