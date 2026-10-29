# Shared workspace

## What this is

A website where Brennan and Max work on software projects together in one
shared window: both talk to the AI, talk to each other, and watch the AI build
the project live. Spec: docs/superpowers/specs/2026-10-14-shared-workspace-design.md

## How it is built

- `hub/` is the website (login, projects, live streams, queue and turn-taking, approvals,
  notes, preview, board, project brief and decisions, quick prompts, home numbers). No AI runs
  there. `hub/public/` is the page code: no inline scripts or styles (strict content policy),
  plain modules, one stylesheet. The design is "night glass" (Brennan asked for glass and fancy,
  not cartoonish): frosted panels over a dark midnight backdrop, one champagne accent, serif
  headings, glass-orb presence markers (`crew.js`), a pale "pearl" light mode. No emoji in the
  interface chrome; use plain symbols. Dark is the default look.
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
- Design rounds are over once Brennan picks a look (Night, Gold, Liquid or Paper). Then delete the other looks and the "Look" button, and do not redesign again unless he asks. He refuses endless design rounds; never ask him to describe taste in design words, show him options instead.
- Never add --bare or --dangerously-skip-permissions to the Claude flags.
- Test with the stand-in Claude (test/fake-claude.js), never the real one, except in
  deliberate acceptance runs.

## Decisions

Settled decisions live in ../DECISIONS.md (the "random projects" folder). Read
it before changing behavior a past session already ruled on.
