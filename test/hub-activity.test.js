import assert from 'node:assert/strict';
import test from 'node:test';
import { computeActivity } from '../hub/activity.js';

const NOW = Date.parse('2026-10-29T15:00:00Z');
const projects = [{ id: 'map-1', name: 'Map' }, { id: 'site-2', name: 'Site' }];
let id = 1;
const ev = (at, event) => ({ id: id++, at, ...event });

const timelines = {
  'map-1': [
    ev('2026-10-29T10:00:00Z', { kind: 'user', who: 'Max', text: 'Make the pins blue' }),
    ev('2026-10-29T10:01:00Z', { kind: 'run-done', owner: 'Max', ok: true, costUsd: 0.2 }),
    ev('2026-10-29T10:01:30Z', { kind: 'sync', owner: 'Max', text: 'Saved 3 changed files to GitHub.' }),
    ev('2026-10-28T09:00:00Z', { kind: 'run-done', owner: 'Brennan', ok: true, costUsd: 0.1 }),
    ev('2026-10-20T09:00:00Z', { kind: 'run-done', owner: 'Brennan', ok: true, costUsd: 5 }),
  ],
  'site-2': [
    ev('2026-10-29T12:00:00Z', { kind: 'run-done', owner: 'Brennan', ok: false, costUsd: 0.05 }),
    ev('2026-10-29T12:05:00Z', { kind: 'notes-saved', who: 'Brennan', version: 2 }),
    ev('2026-10-29T12:06:00Z', { kind: 'decision-added', who: 'Brennan', text: 'Blue buttons' }),
    ev('2026-10-29T12:07:00Z', { kind: 'board-card', who: 'Max', action: 'added', title: 'Footer', column: 'todo' }),
    ev('2026-10-29T12:08:00Z', { kind: 'brief-saved', who: 'Max' }),
    ev('2026-10-29T12:09:00Z', { kind: 'claude-step', owner: 'Max', summary: 'Write a.txt' }),
  ],
};
const eventsFor = (projectId) => timelines[projectId];

test('the week is seven days ending today, oldest first', () => {
  const { week } = computeActivity({ projects, eventsFor, now: NOW });
  assert.equal(week.length, 7);
  assert.equal(week[0].day, '2026-10-23');
  assert.equal(week[6].day, '2026-10-29');
});

test('runs and plan usage are counted per person per day', () => {
  const { week, totals } = computeActivity({ projects, eventsFor, now: NOW });
  const today = week[6];
  assert.deepEqual(today.runs, { Max: 1, Brennan: 1 });
  assert.equal(today.cost.Max, 0.2);
  assert.equal(today.cost.Brennan, 0.05);
  assert.deepEqual(week[5].runs, { Brennan: 1 });
  assert.deepEqual(totals.runs, { Max: 1, Brennan: 2 });
  assert.equal(Math.round(totals.cost.Brennan * 100) / 100, 0.15);
});

test('runs older than the week are not counted, and files saved are added up', () => {
  const { totals } = computeActivity({ projects, eventsFor, now: NOW });
  assert.equal(totals.cost.Brennan < 1, true);
  assert.equal(totals.filesSaved, 3);
});

test('the feed lists the interesting things, newest first, with the project name', () => {
  const { feed } = computeActivity({ projects, eventsFor, now: NOW });
  assert.deepEqual(feed.slice(0, 5).map((item) => [item.who, item.text, item.projectName]), [
    ['Max', 'updated the project brief', 'Site'],
    ['Max', 'added a card: Footer', 'Site'],
    ['Brennan', 'added a decision: Blue buttons', 'Site'],
    ['Brennan', 'updated the notes', 'Site'],
    ['Brennan', 'had a run stop with a problem', 'Site'],
  ]);
  assert.ok(!feed.some((item) => /Write a\.txt/.test(item.text)), 'single steps are too noisy for the feed');
});

test('the feed is limited and each item says when it happened', () => {
  const { feed } = computeActivity({ projects, eventsFor, now: NOW, feedLimit: 3 });
  assert.equal(feed.length, 3);
  assert.equal(feed[0].at, '2026-10-29T12:08:00Z');
  assert.equal(feed[0].projectId, 'site-2');
});

test('long messages are clipped in the feed', () => {
  const long = { 'map-1': [ev('2026-10-29T10:00:00Z', { kind: 'user', who: 'Max', text: 'y'.repeat(300) })], 'site-2': [] };
  const { feed } = computeActivity({ projects, eventsFor: (p) => long[p], now: NOW });
  assert.ok(feed[0].text.length < 120);
});

test('no projects means an empty but well-formed result', () => {
  const result = computeActivity({ projects: [], eventsFor, now: NOW });
  assert.equal(result.week.length, 7);
  assert.deepEqual(result.feed, []);
  assert.deepEqual(result.totals, { runs: {}, cost: {}, filesSaved: 0 });
});
