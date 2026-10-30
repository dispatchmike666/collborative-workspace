# Glasshouse

## What this is

A website where Brennan and Max work on software projects together in one
shared window: both talk to the AI, talk to each other, and watch the AI build
the project live. Spec: docs/superpowers/specs/2026-10-14-shared-workspace-design.md

## How it is built

- `hub/` is the website (login, projects, live streams, queue and turn-taking, approvals,
  notes, preview, board, project brief and decisions, quick prompts, home numbers). No AI runs
  there. `hub/public/` is the page code: no inline scripts or styles (strict content policy),
  plain modules, one stylesheet. The design is "stage glass": a near-black stage, a few sharp diagonal bands of light in the accent colour far
  behind (`body::before` in the stylesheet), and glossy glass windows in front. Brennan picked Raycast and
  Apple's glass pages as the feel (dark, bold, glossy, light behind glass); a flat grey or pastel backdrop
  shows nothing through the glass and he disliked it, as he did fuzzy coloured blobs. Slim menu bar with real
  menus and a clock, windows with red / yellow / green dots that go quiet when not active, solid system-style
  controls at 13px, a plain still dock (no bounce, no magnifying), and a glow that only lights the part of a window's edge nearest the mouse, never a full outline
  (`enableProximityGlow` in `ui.js`). Snap layouts (`SNAP_LAYOUTS` in `logic.js`) open from each window's green dot and
  from Window > Arrange everything. Backgrounds are chosen in the Background menu (`data-bg` on the page); the Mac-style and space wallpapers are finished
  pictures made by the scripts that produced `hub/public/bg-*.svg|jpg` (numpy and PIL, noise, glows, grain), and each decides light or dark
  mode itself (`WALLPAPER_MODE` in `ui.js`); silk and contours are shape files in `hub/public/bg-*.svg`
  coloured by the accent, and a person's own picture is stored in their browser (`chooseWallpaper` in `ui.js`). Dark by default, light mode available, coral accent by
  default, sans-serif only. The project screen (`tiles.js`) opens as free windows: chat in the middle as the
  focus, board and preview beside it, others from the dock. Windows move anywhere and resize from every
  edge. On phones the dock becomes a tab bar. No emoji in the interface chrome; use plain symbols (`icons.js`).
- `helper/` runs on each person's own computer and runs that person's own Claude. It puts the
  project's brief, last decisions and (if shared) notes at the top of every request to Claude.
- Open chats (branch `open-chats`): the helper reads Claude Code's own per-chat files in `~/.claude/sessions`
  (`helper/live-chats.js`) and tells the hub which chats are open, busy or idle, and what each is working on
  (from the chat's own to-do list). The hub keeps that list in memory only, per person (`hub/chats.js`); a
  person's page never shows anyone else's chats. A person can drop a message into one of their own open chats
  through its private mailbox. Idea and mailbox format come from Reason Network (MIT or Apache): see
  docs/superpowers/open-chats-results.md. The home page section is `hub/public/chats.js`. After a message
  is sent the row steps through Sent, Chat picked it up, Chat finished (`messageProgress` in
  `hub/public/render.js`). The helper follows the message in the chat's own record and reports only the
  state, never the words. Chats stay private: Brennan decided against sharing them with Max.
- `server/` is the Stage 1 single-person page. Its parser, runner and settings are reused by
  the helper.
- Plans: docs/superpowers/plans/. Results: docs/superpowers/stage-1-results.md,
  stages-2-to-5-results.md and glow-up-results.md.
- New modules under `hub/` each have their own test file in `test/`. Keep screens plain English.

## Standing constraints

- Never use an API key (a secret password that bills per use). Claude runs on
  each person's own Claude plan login only. The runner removes API-key settings
  from Claude's environment and refuses to run if Claude reports an API key.
- No npm packages unless there is no other way. Brennan does not want more installs.
- Windows is the target. Spawn the real claude.exe, not claude.cmd.
- A person's message goes to Claude through stdin, never the command line.
- A person's message for the AI goes only to their own helper, never anyone else's.
- The hub never handles git logins or Claude logins. Those stay on each computer.
- The hub and the solo page listen on 127.0.0.1 only.
- Approvals allow one exact command. Commands with * ( ) or line breaks cannot be approved.
- Anything a person reads is plain English.
- The look is settled (stage glass: dark, bands of light behind glossy windows, menu bar, free windows, plain dock, chat in the middle). To change it, ask Brennan for a reference screenshot first; never guess from adjectives. Do not redesign it again unless Brennan asks. He refuses endless design rounds; never ask him to describe taste in design words, show him pictures or finished options instead.
- Never add --bare or --dangerously-skip-permissions to the Claude flags. The runner refuses them, and refuses
  any per-message flag except an approval of one exact command (`--allowedTools`).
- Claude is started with `--setting-sources ""` (no settings files at all, not even the project's own). A shared
  project's settings file can run commands before each message, change Claude's environment and widen what it may
  do without asking, on the OTHER person's computer. Do not put `project` back. Verified with the real Claude:
  `node test/acceptance/hostile-project.manual.mjs` (run it after a Claude update or any change to the flags).
- Stop kills the whole family of programs Claude started (`server/kill-tree.js`), and a run that prints nothing
  for 8 minutes with no command running is stopped. Details: docs/superpowers/helper-hardening-results.md.
- Test with the stand-in Claude (test/fake-claude.js), never the real one, except in
  deliberate acceptance runs.

## Decisions

Settled decisions live in ../DECISIONS.md (the "random projects" folder). Read
it before changing behavior a past session already ruled on.
