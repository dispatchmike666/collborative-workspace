# Shared workspace

## What this is

A website where Brennan and Max work on software projects together in one
shared window: both talk to the AI, talk to each other, and watch the AI build
the project live. Spec: docs/superpowers/specs/2026-10-14-shared-workspace-design.md

## How it is built

- `hub/` is the website (login, projects, live streams, queue and turn-taking, approvals,
  notes, preview). No AI runs there.
- `helper/` runs on each person's own computer and runs that person's own Claude.
- `server/` is the Stage 1 single-person page. Its parser, runner and settings are reused by
  the helper.
- Plans: docs/superpowers/plans/. Results: docs/superpowers/stage-1-results.md and
  stages-2-to-5-results.md.

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
- Never add --bare or --dangerously-skip-permissions to the Claude flags.
- Test with the stand-in Claude (test/fake-claude.js), never the real one, except in
  deliberate acceptance runs.

## Decisions

Settled decisions live in ../DECISIONS.md (the "random projects" folder). Read
it before changing behavior a past session already ruled on.
