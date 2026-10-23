import assert from 'node:assert/strict';
import test from 'node:test';
import { Dispatcher } from '../hub/dispatcher.js';
import { Store } from '../hub/store.js';
import { tempDir, waitFor } from './helpers.js';

function setup(t, options = {}) {
  const store = new Store(tempDir(t));
  const project = store.createProject({ name: 'Map', repoUrl: 'https://github.com/acme/map', createdBy: 'Brennan' });
  const dispatcher = new Dispatcher({ store, users: () => ['Brennan', 'Max'], ...options });
  const helpers = {};
  const connect = (name) => {
    const helper = { name, jobs: [], other: [] };
    helper.disconnect = dispatcher.registerHelper(name, (message) => {
      if (message.type === 'job') helper.jobs.push(message.job);
      else helper.other.push(message);
    });
    helpers[name] = helper;
    return helper;
  };
  const kinds = () => store.events(project.id).map((e) => `${e.kind}${e.state ? `:${e.state}` : ''}`);
  return { store, project, dispatcher, helpers, connect, kinds };
}

test('a message goes only to the sender\'s own helper', (t) => {
  const { project, dispatcher, connect } = setup(t);
  const brennan = connect('Brennan');
  const max = connect('Max');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'make it blue' });
  assert.equal(brennan.jobs.length, 0);
  assert.equal(max.jobs.length, 1);
  const job = max.jobs[0];
  assert.equal(job.who, 'Max');
  assert.equal(job.text, 'make it blue');
  assert.equal(job.projectId, project.id);
  assert.equal(job.projectName, 'Map');
  assert.equal(job.repoUrl, 'https://github.com/acme/map');
  assert.equal(job.kind, 'message');
  assert.equal(job.recap, '');
  assert.deepEqual(job.allowedTools, []);
  assert.ok(job.jobId);
});

test('helper events land on the timeline stamped with the owner, and hub-only kinds are ignored', (t) => {
  const { project, store, dispatcher, connect, kinds } = setup(t);
  const max = connect('Max');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'hi' });
  const { jobId } = max.jobs[0];
  dispatcher.helperEvents('Max', jobId, [
    { kind: 'status', state: 'working' },
    { kind: 'run-start', sessionId: 's', apiKeySource: 'none' },
    { kind: 'claude-step', tool: 'Write', summary: 'Write a.txt' },
    { kind: 'claude-text', text: 'done', owner: 'Brennan' },
    { kind: 'mystery', text: 'nope' },
  ]);
  assert.deepEqual(kinds(), ['user', 'status:working', 'claude-step', 'claude-text']);
  const stored = store.events(project.id);
  assert.equal(stored.find((e) => e.kind === 'claude-step').owner, 'Max');
  assert.equal(stored.find((e) => e.kind === 'claude-text').owner, 'Max');
});

test('finishing a run frees the project and says it is idle', (t) => {
  const { project, dispatcher, connect, kinds } = setup(t);
  const max = connect('Max');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'hi' });
  dispatcher.helperDone('Max', max.jobs[0].jobId, true);
  assert.deepEqual(kinds(), ['user', 'status:working', 'status:idle']);
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'again' });
  assert.equal(max.jobs.length, 2);
});

test('a second request waits in line quietly and starts by itself', (t) => {
  const { project, dispatcher, connect, store } = setup(t);
  const brennan = connect('Brennan');
  const max = connect('Max');
  dispatcher.submit({ projectId: project.id, user: 'Brennan', text: 'first' });
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'second' });
  assert.equal(max.jobs.length, 0);
  const queued = store.events(project.id).find((e) => e.state === 'queued');
  assert.equal(queued.who, 'Max');
  assert.equal(queued.reason, 'busy');
  assert.equal(queued.position, 1);

  dispatcher.helperDone('Brennan', brennan.jobs[0].jobId, true);
  assert.equal(max.jobs.length, 1);
  assert.equal(max.jobs[0].text, 'second');
});

test('a person whose computer is off waits, without blocking the other person', (t) => {
  const { project, dispatcher, connect, store } = setup(t);
  const brennan = connect('Brennan');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'for max while offline' });
  dispatcher.submit({ projectId: project.id, user: 'Brennan', text: 'for brennan' });
  assert.equal(brennan.jobs.length, 1);
  assert.equal(brennan.jobs[0].text, 'for brennan');
  const waiting = store.events(project.id).find((e) => e.state === 'waiting');
  assert.equal(waiting.who, 'Max');
  assert.equal(waiting.reason, 'offline');

  dispatcher.helperDone('Brennan', brennan.jobs[0].jobId, true);
  const max = connect('Max');
  assert.equal(max.jobs.length, 1);
  assert.equal(max.jobs[0].text, 'for max while offline');
});

test('if a computer drops off during a run, the run is marked failed and the next one starts', (t) => {
  const { project, dispatcher, connect, store } = setup(t);
  const max = connect('Max');
  const brennan = connect('Brennan');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'long job' });
  dispatcher.submit({ projectId: project.id, user: 'Brennan', text: 'next' });
  max.disconnect();
  const error = store.events(project.id).find((e) => e.kind === 'error');
  assert.match(error.text, /Max's computer went offline/);
  assert.equal(brennan.jobs.length, 1);
  assert.equal(brennan.jobs[0].text, 'next');
  assert.deepEqual(dispatcher.presence(), { Brennan: true, Max: false });
});

test('a reconnect does not get cut off by the old connection closing late', (t) => {
  const { dispatcher, connect } = setup(t);
  const first = connect('Max');
  connect('Max');
  first.disconnect();
  assert.equal(dispatcher.isOnline('Max'), true);
});

test('the next job carries a recap of what the other person did', (t) => {
  const { project, dispatcher, connect } = setup(t);
  const brennan = connect('Brennan');
  const max = connect('Max');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'Make the pins color-coded' });
  dispatcher.helperEvents('Max', max.jobs[0].jobId, [
    { kind: 'claude-step', tool: 'Edit', summary: 'Edit map.js' },
    { kind: 'claude-text', text: 'Pins are colored now.' },
  ]);
  dispatcher.helperDone('Max', max.jobs[0].jobId, true);
  dispatcher.submit({ projectId: project.id, user: 'Brennan', text: 'what did Max change?' });
  assert.equal(
    brennan.jobs[0].recap,
    ['Max asked: Make the pins color-coded', "Max's Claude did: Edit map.js", "Max's Claude said: Pins are colored now."].join('\n'),
  );

  dispatcher.helperDone('Brennan', brennan.jobs[0].jobId, true);
  dispatcher.submit({ projectId: project.id, user: 'Brennan', text: 'thanks' });
  assert.equal(brennan.jobs[1].recap, '', 'nothing new happened since the last recap');
});

test('only the owner of a run can report on it, and unknown runs are refused', (t) => {
  const { project, dispatcher, connect } = setup(t);
  const max = connect('Max');
  connect('Brennan');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'hi' });
  const { jobId } = max.jobs[0];
  assert.throws(() => dispatcher.helperEvents('Brennan', jobId, [{ kind: 'claude-text', text: 'x' }]), /not your/i);
  assert.throws(() => dispatcher.helperDone('Brennan', jobId, true), /not your/i);
  assert.throws(() => dispatcher.helperEvents('Max', 'nope', []), /not your|unknown/i);
});

test('blocked commands become approvals that only their owner can use, once', (t) => {
  const { project, store, dispatcher, connect } = setup(t);
  const max = connect('Max');
  connect('Brennan');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'fetch a page' });
  dispatcher.helperEvents('Max', max.jobs[0].jobId, [
    {
      kind: 'run-done',
      ok: true,
      text: 'blocked',
      denials: [
        { tool: 'Bash', id: 'a', command: 'curl -s https://example.com', description: 'Check the site' },
        { tool: 'Bash', id: 'b', command: 'rm -rf *', description: 'Clean up' },
        { tool: 'PowerShell', id: 'c', command: 'Get-Date', description: null },
        { tool: 'Write', id: 'd', command: null, description: null },
      ],
    },
  ]);
  dispatcher.helperDone('Max', max.jobs[0].jobId, true);

  const approvals = store.events(project.id).filter((e) => e.kind === 'approval-needed');
  assert.equal(approvals.length, 3);
  const [curl, star, shell] = approvals;
  assert.equal(curl.owner, 'Max');
  assert.equal(curl.approvable, true);
  assert.equal(star.approvable, false);
  assert.equal(shell.tool, 'PowerShell');
  assert.ok(!store.events(project.id).find((e) => e.kind === 'run-done').denials, 'denials are not stored on the run itself');

  assert.throws(() => dispatcher.approve({ projectId: project.id, user: 'Brennan', approvalId: curl.approvalId }), /Only Max/);
  assert.throws(() => dispatcher.approve({ projectId: project.id, user: 'Max', approvalId: star.approvalId }), /cannot be approved/);
  assert.throws(() => dispatcher.approve({ projectId: project.id, user: 'Max', approvalId: 'unknown' }), /no longer available/);

  dispatcher.approve({ projectId: project.id, user: 'Max', approvalId: curl.approvalId });
  const job = max.jobs.at(-1);
  assert.equal(job.kind, 'approval');
  assert.deepEqual(job.allowedTools, ['Bash(curl -s https://example.com)']);
  assert.match(job.text, /Approved by Max/);
  assert.ok(store.events(project.id).some((e) => e.kind === 'approval-used' && e.approvalId === curl.approvalId));
  assert.throws(() => dispatcher.approve({ projectId: project.id, user: 'Max', approvalId: curl.approvalId }), /already/i);
});

test('a run that never reports back is failed after the time limit', async (t) => {
  const { project, dispatcher, connect, store } = setup(t, { jobTimeoutMs: 100 });
  const max = connect('Max');
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'stuck' });
  await waitFor(() => store.events(project.id).some((e) => e.kind === 'error'), { label: 'the timeout' });
  assert.match(store.events(project.id).find((e) => e.kind === 'error').text, /took too long/);
  assert.deepEqual(max.other, [{ type: 'cancel', jobId: max.jobs[0].jobId }]);
  dispatcher.submit({ projectId: project.id, user: 'Max', text: 'after' });
  assert.equal(max.jobs.length, 2);
});

test('people watching a project hear when someone comes online or goes offline', (t) => {
  const { project, store, connect } = setup(t);
  const heard = [];
  store.subscribe(project.id, (event) => heard.push(event));
  const max = connect('Max');
  max.disconnect();
  const presence = heard.filter((e) => e.kind === 'presence').map((e) => e.online);
  assert.deepEqual(presence, [{ Brennan: false, Max: true }, { Brennan: false, Max: false }]);
});

test('unknown projects and users are refused', (t) => {
  const { project, dispatcher } = setup(t);
  assert.throws(() => dispatcher.submit({ projectId: 'nope', user: 'Max', text: 'x' }), /No such project/);
  assert.throws(() => dispatcher.submit({ projectId: project.id, user: 'Stranger', text: 'x' }), /Unknown user/);
});
