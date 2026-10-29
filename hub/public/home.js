import { crewMember } from './crew.js';
import { formatPlan, greeting, initial, projectColor, userColor, weekBars } from './logic.js';
import { timeAgo } from './render.js';
import { crewState, memberState, onCrewChange, setPresence, setWorking } from './state.js';
import { api, el } from './ui.js';

// The home page ("Pulse"): the crew, this week in numbers, what's been happening, and the projects.
export async function showHome(viewEl, { me, users }) {
  viewEl.replaceChildren(el('p', { class: 'muted home', text: 'Loading…' }));
  const [projects, pulse, info] = await Promise.all([api('/api/projects'), api('/api/pulse'), api('/api/me')]);
  setPresence(info.presence);
  setWorking(null);

  // ---- hero: greeting and the crew ----
  const members = users.map((name) => crewMember({ name, users, size: 'big' }));
  const subtitle = el('p');
  function renderCrew() {
    for (const member of members) member.update(memberState(member.element.dataset.user));
    const asleep = users.filter((name) => !crewState.presence[name]);
    if (!asleep.length) subtitle.textContent = 'Everyone\'s here and every Claude is awake.';
    else if (asleep.length === users.length) subtitle.textContent = 'All the helpers are off, so the whole crew is asleep. Start a helper to wake yours.';
    else subtitle.textContent = `${asleep.join(' and ')}'s Claude is asleep, because their helper isn't running.`;
  }
  renderCrew();
  const stopListening = onCrewChange(renderCrew);

  const hero = el('section', { class: 'hero' },
    el('div', { class: 'hero-text' }, el('h1', { text: greeting(new Date(), me) }), subtitle),
    el('div', { class: 'crew-row', 'aria-label': 'The crew' }, members.map((member) => member.element)));

  // ---- numbers ----
  const totalRuns = Object.values(pulse.totals.runs).reduce((sum, value) => sum + value, 0);
  const totalCost = Object.values(pulse.totals.cost).reduce((sum, value) => sum + value, 0);
  const { bars, max } = weekBars(pulse.week, users);
  const chart = el('div', { class: 'chart', role: 'img', 'aria-label': `Runs per day this week: ${bars.map((bar) => `${bar.label} ${bar.total}`).join(', ')}` },
    bars.map((bar) => {
      const stack = el('div', { class: 'bar' }, bar.parts.map((part) => {
        const piece = el('div', { class: `bar-part ${userColor(part.user, users)}`, title: `${part.user}: ${part.value}` });
        piece.style.height = `${(part.value / max) * 62}px`;
        return piece;
      }));
      return el('div', { class: 'bar-col' }, stack, el('span', { class: 'bar-label', text: bar.label.slice(0, 2) }));
    }));
  const perPerson = (values, format) => users.map((name) => `${name} ${format(values[name] ?? 0)}`).join('  ·  ');
  const stats = el('section', { class: 'stats', 'aria-label': 'This week' },
    el('div', { class: 'stat sticker' }, el('span', { class: 'stat-label', text: 'Runs this week' }), el('span', { class: 'stat-value', text: String(totalRuns) }), el('span', { class: 'stat-sub', text: perPerson(pulse.totals.runs, String) }), chart),
    el('div', { class: 'stat sticker' }, el('span', { class: 'stat-label', text: 'Files saved' }), el('span', { class: 'stat-value', text: String(pulse.totals.filesSaved) }), el('span', { class: 'stat-sub', text: 'changed files your Claudes saved this week' })),
    el('div', { class: 'stat sticker' }, el('span', { class: 'stat-label', text: 'Plan used' }), el('span', { class: 'stat-value', text: formatPlan(totalCost) }), el('span', { class: 'stat-sub', text: perPerson(pulse.totals.cost, formatPlan) }), el('span', { class: 'stat-sub', text: 'At list price, this week. Not billed.' })));

  // ---- feed ----
  const feed = el('section', {},
    el('div', { class: 'section-head' }, el('h2', { text: "What's been happening" })),
    pulse.feed.length
      ? el('div', { class: 'feed sticker' }, el('ul', {}, pulse.feed.map((item) => el('li', {},
        el('span', { class: `avatar ${userColor(item.who, users)}`, 'aria-hidden': 'true', text: initial(item.who) }),
        el('div', { class: 'feed-text' },
          el('div', {}, el('strong', { text: item.who }), ` ${item.text}`),
          el('a', { class: 'where', href: `#/p/${item.projectId}`, text: `${item.projectName}  ·  ${timeAgo(item.at)}` }))))))
      : el('div', { class: 'empty sticker' }, el('div', { class: 'emoji', text: '🌱' }), el('strong', { text: 'Quiet so far' }),
        el('p', { class: 'muted small', text: 'Messages, finished runs and saved files show up here.' })));

  // ---- projects ----
  const nameInput = el('input', { type: 'text', maxlength: '60', placeholder: 'Project name', 'aria-label': 'Project name', required: true });
  const repoInput = el('input', { type: 'text', placeholder: 'https://github.com/owner/repo (optional)', 'aria-label': 'GitHub repository address' });
  const errorEl = el('p', { class: 'error small', role: 'alert', hidden: true });
  const form = el('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      errorEl.hidden = true;
      try {
        const project = await api('/api/projects', { method: 'POST', body: { name: nameInput.value, repoUrl: repoInput.value } });
        window.location.hash = `#/p/${project.id}`;
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
    },
  }, nameInput, repoInput, el('button', { type: 'submit', class: 'btn primary', text: 'Create project' }), errorEl);

  const cards = projects.map((project) => el('a', { class: `project-card sticker lift c-${projectColor(project.id)}`, href: `#/p/${project.id}` },
    el('h3', { text: project.name }),
    el('p', { class: 'muted', text: project.lastEventText ?? 'No activity yet' }),
    el('p', { class: 'muted small', text: [timeAgo(project.lastActivityAt), project.repoUrl ? 'shared through GitHub' : 'files on one computer'].filter(Boolean).join('  ·  ') })));
  const projectsSection = el('section', {},
    el('div', { class: 'section-head' }, el('h2', { text: 'Projects' })),
    el('div', { class: 'projects' }, ...cards,
      el('div', { class: 'new-project-card sticker' }, el('h3', { text: 'Start something new' }),
        el('p', { class: 'muted small', text: 'Add a GitHub address if you both should share the files.' }), form)));

  viewEl.replaceChildren(el('div', { class: 'home' }, hero, stats, el('div', { class: 'columns' }, feed, projectsSection)));

  const refresh = setInterval(async () => {
    try {
      setPresence((await api('/api/me')).presence);
    } catch {
      // The next tick tries again.
    }
  }, 12_000);
  return () => {
    clearInterval(refresh);
    stopListening();
  };
}
