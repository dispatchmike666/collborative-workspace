import { createChats } from './chats.js';
import { icon } from './icons.js';
import { crewMember } from './crew.js';
import { formatPlan, initial, projectColor, userColor } from './logic.js';
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
    const offline = users.filter((name) => !crewState.presence[name]);
    if (!offline.length) subtitle.textContent = 'Everyone is here and every Claude is ready.';
    else if (offline.length === users.length) subtitle.textContent = 'All the helpers are off. Start your helper to bring your Claude online.';
    else subtitle.textContent = `${offline.join(' and ')}'s Claude is offline, because their helper isn't running.`;
  }
  renderCrew();
  const stopListening = onCrewChange(renderCrew);

  const hero = el('section', { class: 'home-welcome' },
    el('div', {}, el('h1', {}, 'Welcome back, ', el('em', { text: me }), '.'),
      el('p', { class: 'muted', text: 'Pick up where you left off.' })),
    el('button', { type: 'button', class: 'btn primary', onclick: () => newProject.showModal() },
      icon('plus', 16), 'New project'));
  const crew = el('section', { class: 'home-card sticker' },
    el('h2', { text: 'Your team' }),
    el('div', { class: 'crew-row', 'aria-label': 'The crew' }, members.map((member) => member.element)),
    subtitle);

  const totalRuns = Object.values(pulse.totals.runs).reduce((sum, value) => sum + value, 0);
  const totalCost = Object.values(pulse.totals.cost).reduce((sum, value) => sum + value, 0);
  const usage = el('p', { class: 'home-usage muted small',
    text: `This week · ${totalRuns} runs · ${pulse.totals.filesSaved} files saved · ${formatPlan(totalCost)} estimated plan usage` });

  // ---- feed ----
  const feed = el('section', { id: 'home-activity', class: 'home-card sticker' },
    el('div', { class: 'section-head' }, el('h2', { text: "Recent activity" })),
    pulse.feed.length
      ? el('div', { class: 'feed sticker' }, el('ul', {}, pulse.feed.slice(0, 5).map((item) => el('li', {},
        el('span', { class: `avatar ${userColor(item.who, users)}`, 'aria-hidden': 'true', text: initial(item.who) }),
        el('div', { class: 'feed-text' },
          el('div', {}, el('strong', { text: item.who }), ` ${item.text}`),
          el('a', { class: 'where', href: `#/p/${item.projectId}`, text: `${item.projectName}  ·  ${timeAgo(item.at)}` }))))))
      : el('div', { class: 'empty sticker' }, el('div', { class: 'emoji', text: '◇' }), el('strong', { text: 'Quiet so far' }),
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
        newProject.close();
        window.location.hash = `#/p/${project.id}`;
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
    },
  }, nameInput, repoInput, el('button', { type: 'submit', class: 'btn primary', text: 'Create project' }), errorEl);

  const newProject = el('dialog', { id: 'home-new', class: 'new-project-card' },
    el('h2', { text: 'New project' }),
    el('p', { class: 'muted small', text: 'Add a GitHub address if you both should share the files.' }),
    form,
    el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => newProject.close() }));
  const recent = [...projects].sort((a, b) => (Date.parse(b.lastActivityAt) || 0) - (Date.parse(a.lastActivityAt) || 0));
  const [featured, ...otherProjects] = recent;
  const card = (project) => el('a', {
    class: `home-project-card c-${projectColor(project.id)}`, href: `#/p/${project.id}`,
  }, el('span', { class: 'home-project-mark', 'aria-hidden': 'true' }, icon('files', 22)),
  el('div', {}, el('h3', { text: project.name }),
    el('p', { class: 'muted small', text: project.lastEventText || 'No activity yet' })),
  el('span', { 'aria-hidden': 'true', text: '→' }));

  const preview = el('div', { class: 'home-feature-preview' },
    icon('preview', 36), el('span', { text: 'Project preview' }));
  const feature = featured ? el('div', { class: 'home-feature' },
    el('a', { class: 'home-feature-link', href: `#/p/${featured.id}`, 'aria-label': `Open ${featured.name}` }, preview),
    el('div', { class: 'home-feature-copy' },
      el('p', { class: 'eyebrow', text: 'Most recent project' }),
      el('h3', { text: featured.name }),
      el('p', { class: 'muted', text: featured.lastEventText || 'Ready when you are.' }),
      el('a', { class: 'btn primary', href: `#/p/${featured.id}`, text: 'Open workspace →' })))
    : el('p', { class: 'muted', text: 'Create a project to get started.' });
  const projectsSection = el('section', { class: 'home-continue' },
    el('h2', { text: 'Continue working' }),
    el('div', { class: 'home-card sticker' }, feature,
      otherProjects.length ? el('div', { class: 'home-projects' }, otherProjects.map(card)) : null));

  const chats = createChats();
  const privateChats = el('div', { id: 'home-chats' }, chats.element, usage);
  const dock = el('nav', { class: 'home-dock dock', 'aria-label': 'Home shortcuts' },
    ...[['Home', 'home', '#/'], ['Chats', 'chat', '#/chats'], ['Activity', 'progress', '#/activity'], ['New project', 'plus', '#/new']]
      .map(([label, glyph, href]) => el('a', {
        class: `dock-item${(window.location.hash || '#/') === href ? ' open' : ''}`,
        href, 'aria-label': label, 'data-label': label,
        onclick: href === '#/new' ? (event) => { event.preventDefault(); newProject.showModal(); } : undefined,
      }, el('span', { class: 'dock-icon' }, icon(glyph, 18)))));
  viewEl.replaceChildren(el('div', { class: 'home tideline-home' }, hero,
    el('div', { class: 'home-grid' },
      el('div', { class: 'home-main' }, projectsSection, privateChats),
      el('div', { class: 'home-aside' }, crew, feed)), newProject), dock);

  if (featured) {
    api(`/api/projects/${featured.id}`).then(({ previewUrl, previewVersion }) => {
      if (!(previewVersion > 0) || !previewUrl || !preview.isConnected) return;
      preview.replaceChildren(el('iframe', {
        class: 'home-preview-frame', title: `Preview of ${featured.name}`,
        src: `${previewUrl}?v=${encodeURIComponent(previewVersion)}`, sandbox: 'allow-scripts',
        referrerpolicy: 'no-referrer', tabindex: '-1', loading: 'lazy',
      }));
    }).catch(() => {}); // A project can still be opened without a preview.
  }

  const refresh = setInterval(async () => {
    try {
      setPresence((await api('/api/me')).presence);
    } catch {
      // The next tick tries again.
    }
  }, 12_000);
  return () => {
    clearInterval(refresh);
    chats.stop();
    stopListening();
  };
}
