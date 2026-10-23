# Shared workspace - design

Date: 2026-10-14
Status: Built. Stages 1 to 5 are done and tested (see docs/superpowers/stage-1-results.md and
stages-2-to-5-results.md). Hosting for Max and his helper setup still need a person.
Working name: "Shared workspace" (rename any time)

## 1. What this is

A website where Brennan and Max work on software projects together.
Each project has one shared window. In it, both people talk to the AI,
talk to each other, and watch the AI build the project live.

Think "Claude Projects, but with two people in the room, and the AI
actually builds things."

## 2. Who it's for

- **Version 1:** Brennan and Max only. Nobody else can log in.
- **Later (not in version 1):** more people, and other AIs besides Claude.
  We build version 1 so those can be added without starting over.

## 3. The shape

Four pieces:

1. **The workspace website.** The shared window. It shows the project
   list, the timeline of messages and AI activity, and the files. It does
   not run any AI itself.
2. **Brennan's computer.** Runs Brennan's own Claude, signed in to
   Brennan's own Claude plan.
3. **Max's computer.** Runs Max's own Claude, signed in to Max's own
   Claude plan.
4. **A shared GitHub folder per project.** GitHub is a website that
   stores code and tracks every change. It holds the project's files so
   both Claudes work on the same code.

On each computer runs a **helper**: a small program that links that
computer's Claude to the website. It takes a message from the window,
hands it to Claude, and sends Claude's steps back so everyone can watch.

## 4. What you see

- **Login.** Only Brennan's and Max's accounts get in.
- **Home.** One card per project.
- **Inside a project, three areas:**
  - Left: the project list.
  - Middle: one timeline with every message and everything each Claude
    does. Under it, a box to type in, with a "Send to" choice:
    "My Claude" (the AI) or "Just [other person]" (a normal chat message,
    no AI).
  - Right: the project's files, with a dot on files that just changed.
- **Shared notes** for each project (a page both people can edit) come
  after the core above works. See stage 4.

## 5. Rules of behavior

1. **Your message goes only to your own Claude.** Max's messages never
   reach Brennan's computer, and Brennan's never reach Max's. This is a
   safety rule: nobody can make someone else's computer run anything.
2. **Everyone sees everything.** The timeline shows both people's
   messages and both Claudes' activity, live.
3. **Each Claude gets a recap.** With every message, the helper adds a
   short summary of what happened since that Claude last worked, for
   example: "Max asked for color-coded pins. His Claude changed map.js."
   The two Claudes never talk to each other. They only share files.
4. **One Claude edits at a time.** If a second request comes in while a
   Claude is working, it is marked "queued" and starts by itself when the
   first one finishes. Nobody is blocked: people can keep typing and
   chatting with each other the whole time.
5. **Files stay in sync.** Before a Claude starts, it pulls the latest
   files from GitHub. When it finishes, it saves its changes back.
6. **If a computer is off,** the window says so ("Max's computer is
   offline") and that person's AI messages wait until it is back.
7. **The helper only calls out.** The website never reaches into anyone's
   computer. The helper connects to the website, not the other way around.

## 6. Money and rules

- **No pay-per-use AI spending.** No API key (a secret password that
  bills per use) is used anywhere. Each person's Claude runs on their own
  Claude plan.
- **Plan limits.** Building uses a lot of AI. It will use up each
  person's plan allowance faster than chatting does.
- **No shared logins.** Max never uses Brennan's Claude login, and the
  reverse. Anthropic's rules point this way, and the design follows it.
- **Hosting should be free** at this size (two users). Confirmed in
  stage 1, not assumed.

## 7. What's not in version 1

- Other AIs besides Claude
- More than two people
- Two Claudes editing at the same time on separate copies (branches)
- Two people typing in the same note at the exact same second without one
  overwriting the other
- A live preview of the running website (a stretch goal, stage 5)

## 8. Riskiest assumptions, and how we test them

| Risk | How we test it |
|---|---|
| A helper can run Claude Code on each computer and stream its steps back live | Stage 1 is built only to prove this |
| Using each person's own Claude plan this way is within Anthropic's rules | Re-read Anthropic's current wording before stage 2. If it's unclear, stop and ask |
| Free hosting is enough for two users | Check the free limits in stage 1 |
| Heavy building drains a plan too fast | Watch real usage during stages 1 to 3 |
| A live preview is possible | Try in stage 5. If not, link to the files instead |

## 9. Build stages and pass/fail checks

Each stage ends with checks that either pass or fail.

**Stage 1 - the risky test.** One person, one computer.
- Pass: Brennan types "create a file called hello.txt" in the window, his
  Claude does it, and the steps appear in the window within a few seconds.
- Pass: the file exists on Brennan's computer afterward.
- Pass: no API key appears anywhere in the code or settings.

**Stage 2 - Max joins.**
- Pass: Max logs in from his own computer and does the same with his own
  Claude.
- Pass: each person sees both timelines live.
- Pass: Brennan's message never triggers anything on Max's computer, and
  the reverse. Tested on purpose.
- Pass: a person who is not Brennan or Max cannot log in.

**Stage 3 - shared files and turns.**
- Pass: a change by one Claude is visible to the other Claude on its next
  turn.
- Pass: a second request sent while the first Claude works shows "queued,"
  starts alone when the first finishes, and the sender can keep chatting
  while waiting.
- Pass: the recap is included, so the second Claude can answer "what did
  Max just change?"

**Stage 4 - dashboard and team talk.**
- Pass: create and open projects from the home page.
- Pass: "Just Max" messages go to the person, not the AI.
- Pass: shared notes per project, both people can edit.

**Stage 5 - live preview (stretch).**
- Pass: after a Claude changes the site, a preview of the result shows in
  the window. If not possible, a link to the files replaces it.

## 10. Proposed tools

- Website: a Next.js site (a popular tool for building websites) on
  Vercel (a service that puts a site online at a link).
- Logins, saved messages, and live updates: Supabase (a service that
  stores your app's data online and handles who can log in).
- Helper: a small Node.js program (runs on Windows and Mac) that drives
  Claude Code's non-interactive mode, which prints each step as it goes.
  Confirmed in stage 1.
- Project files: one private GitHub repository per project.

## 11. To settle before the stage that needs it

- Settled 2026-10-15: Max is on Windows, same as Brennan, so version 1
  needs a Windows helper only.
- Stage 2: How will Max install the helper? Proposed: one command, with
  steps written for him.
- Stage 4: How should the project list be created? Proposed: a "New
  project" button that makes the GitHub folder for you.
