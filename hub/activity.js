const DAY_MS = 86_400_000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

const clip = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

const CARD_ACTIONS = {
  added: 'added a card',
  moved: 'moved a card',
  started: 'gave a card to their Claude',
  removed: 'removed a card',
};

// The one-line description of an event for the "what's been happening" feed, or null to skip it.
function feedItem(event) {
  switch (event.kind) {
    case 'user':
      return { who: event.who, text: `asked: ${clip(event.text, 80)}` };
    case 'run-done':
      return { who: event.owner, text: event.ok ? 'finished a run' : 'had a run stop with a problem' };
    case 'sync':
      return /^Saved \d+ changed file/.test(event.text) ? { who: event.owner, text: event.text.replace(/\.$/, '').replace(/^Saved/, 'saved') } : null;
    case 'notes-saved':
      return { who: event.who, text: 'updated the notes' };
    case 'decision-added':
      return { who: event.who, text: `added a decision: ${clip(event.text, 80)}` };
    case 'board-card':
      return { who: event.who, text: `${CARD_ACTIONS[event.action] ?? 'changed a card'}: ${clip(event.title, 60)}` };
    case 'brief-saved':
      return { who: event.who, text: 'updated the project brief' };
    default:
      return null;
  }
}

// The numbers and the feed for the home page, worked out from every project's timeline.
export function computeActivity({ projects, eventsFor, now = Date.now(), days = 7, feedLimit = 12 }) {
  const week = Array.from({ length: days }, (_, i) => ({ day: dayKey(now - (days - 1 - i) * DAY_MS), runs: {}, cost: {} }));
  const byDay = new Map(week.map((entry) => [entry.day, entry]));
  const totals = { runs: {}, cost: {}, filesSaved: 0 };
  const feed = [];
  let sequence = 0;

  for (const project of projects) {
    for (const event of eventsFor(project.id) ?? []) {
      const bucket = byDay.get(dayKey(Date.parse(event.at)));
      if (event.kind === 'run-done' && bucket && event.owner) {
        const cost = typeof event.costUsd === 'number' ? event.costUsd : 0;
        bucket.runs[event.owner] = (bucket.runs[event.owner] ?? 0) + 1;
        bucket.cost[event.owner] = (bucket.cost[event.owner] ?? 0) + cost;
        totals.runs[event.owner] = (totals.runs[event.owner] ?? 0) + 1;
        totals.cost[event.owner] = (totals.cost[event.owner] ?? 0) + cost;
      }
      if (event.kind === 'sync' && bucket) {
        const saved = /^Saved (\d+) changed file/.exec(event.text ?? '');
        if (saved) totals.filesSaved += Number(saved[1]);
      }
      const item = feedItem(event);
      if (item) {
        sequence += 1;
        feed.push({ at: event.at, projectId: project.id, projectName: project.name, kind: event.kind, sequence, ...item });
      }
    }
  }

  feed.sort((a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence);
  return {
    week,
    totals,
    feed: feed.slice(0, feedLimit).map(({ sequence: _sequence, ...rest }) => rest),
  };
}
