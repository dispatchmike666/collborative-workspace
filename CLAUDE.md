# Shared workspace

## What this is

A website where Brennan and Max work on software projects together in one
shared window: both talk to the AI, talk to each other, and watch the AI build
the project live. Spec: docs/superpowers/specs/2026-10-14-shared-workspace-design.md

## How it is built

- `hub/` is the website (login, projects, live streams, queue and turn-taking, approvals,
  notes, preview, board, project brief and decisions, quick prompts, home numbers). No AI runs
  there. `hub/public/` is the page code: no inline scripts or styles (strict content policy),
  plain modules, one stylesheet. The design is "glass", in the spirit of macOS: a soft coloured wallpaper behind frosted panes with a lit
  rim and a little glow, a slim menu bar, windows with red / yellow / green dots, and a dock of coloured
  app icons that magnify on hover. Light by default, graphite dark mode available, one blue accent, sans-serif
  only. The project screen (`tiles.js`) puts Chat in the middle as the focus, other tiles (board, preview,
  files, brief, notes) on either side; any tile can pop out into a draggable window or fill the stage. On
  phones the dock becomes a tab bar. Keep it calm: few things on screen by default. No emoji in the
  interface chrome; use plain symbols (`icons.js`).
- `helper/` runs on each person's own computer and runs that person's own Claude. It puts the
  project's brief, last decisions and (if shared) notes at the top of every request to Claude.
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
- The look is settled (macOS-style glass, chat in the middle, tiles on the sides, windows and a dock). Do not redesign it again unless Brennan asks. He refuses endless design rounds; never ask him to describe taste in design words, show him pictures or finished options instead.
- Never add --bare or --dangerously-skip-permissions to the Claude flags.
- Test with the stand-in Claude (test/fake-claude.js), never the real one, except in
  deliberate acceptance runs.

## Decisions

Settled decisions live in ../DECISIONS.md (the "random projects" folder). Read
it before changing behavior a past session already ruled on.
