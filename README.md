# Shared workspace

A website where two people work on software projects together. Each person talks to their
own Claude, runs on their own computer and their own Claude plan, and both watch every step
live. The two Claudes share project files through GitHub and take turns quietly.

## How it fits together

- **The hub** is the website. People log in to it. It shows projects, chat, files, notes and a
  preview, and it decides whose Claude runs next. It does not run any AI itself.
- **A helper** runs on each person's own computer. It connects out to the hub, runs that
  person's own Claude when the hub asks, and sends back every step. A person's message only
  ever goes to their own helper.
- **GitHub** holds each project's files, so both computers work on the same code.

## Start it

1. Add the people who can log in (once). Passwords go into private files, not onto the screen:

   ```
   npm run hub:add-user -- Brennan
   npm run hub:add-user -- Max
   ```

2. Start the hub, then open http://localhost:3000 and log in: `npm run hub`
3. Start your own helper in a second terminal. In PowerShell, using your helper token from your
   private credentials file:

   ```
   $env:HUB_URL = "http://localhost:3000"
   $env:HELPER_TOKEN = "your-helper-token"
   npm run helper
   ```

4. For Max to join from his own computer, see `docs/hosting.md` (making the hub reachable) and
   `docs/max-setup.md` (his steps).

## Using it

- **Home (Pulse).** The first page shows who is online, how much your team's Claudes did this
  week (requests, rough plan use, files saved), a feed of what just happened, and your projects.
- **Presence.** Each person has a glass orb with their initial in the top bar. It is dimmed when
  their helper is off, has a green dot when they are online, a turning ring while their Claude is
  working, and a soft glow when a job ends well.
- **Projects.** Create one with a name and, if the project's files should be shared, its GitHub
  address (`https://github.com/owner/repo`). Everyone who works on it needs access to that
  repository.
- **Project brief and decisions.** The Brief tab holds standing instructions ("always use plain
  words", "never touch the login page") and a list of settled decisions. Claude is given both at
  the start of every request, for both people. Notes can be shared with Claude too, by a switch.
- **The tile wall.** A project is one screen of tiles: Chat on the left, then Board, Preview, Files and
  Brief. Drag a tile by its title bar to pull it out into a floating window, or press the pop-out
  button. Drag the bottom-right corner to resize. Double-click a title bar to dock it back. The dock at
  the bottom opens and hides tiles (Notes starts hidden), and "Tiles" or "Windows" turns the whole
  screen into the wall or into floating windows. Your arrangement is remembered per project. On a
  phone the dock becomes a tab bar and shows one tile at a time.
- **Board.** Four lanes: Ideas, To do, Doing, Done. Drag cards between lanes. "Give to my
  Claude" turns a card into a request, and the card moves to Done by itself when the run ends well.
- **Quick prompts.** A shelf above the message box with one-click requests ("Find bugs", "Make
  it prettier"). You can save your own, and they are shared with your teammate.
- **Reactions and typing.** Hover a message to react with an emoji. You see when the other
  person is typing.
- **Files.** The Files tab lists the project's files and shows any text file when you click it.
- **Look and feel.** Dark frosted glass with a blue accent by default, or a light mode, or match your
  computer. Five accent colours (Azure, Rose, Teal, Amber, Violet) and soft sounds in the settings
  (the half-moon icon). An optional celebration when a run finishes is off by default.
- **Jump menu.** Press Ctrl+K anywhere to jump to a project, a tab, the settings or a new project.
  Press `/` to jump to the message box.
- **Chat.** Under the timeline, "My Claude" sends your message to your own Claude. "Just Max"
  sends a normal message to the other person that no AI ever sees.
- **Taking turns.** One Claude works on a project at a time. A second request waits in line
  and starts by itself. If someone's computer is off, their request waits without holding up
  anyone else.
- **Recap.** Each Claude is told what the other person asked and what their Claude did, so it
  can answer "what did Max change?".
- **Approve button.** When Claude is blocked from running a command, the window shows the
  command with "Allow once". Only the person whose Claude it is can press it, and it allows
  that one command only.
- **Notes.** A shared page for each project. If two people save at the same moment, the second
  is warned and nothing is overwritten.
- **Preview.** If the project has an `index.html`, the window shows the page.
- **Plan usage.** Every finished request says roughly how much of your Claude plan it used.

## What it will and won't do

- Each Claude runs on its own person's Claude plan login. It never uses an API key and refuses
  to run if Claude says it is set up to bill per use.
- Claude can create and edit files in the project folder and run simple harmless commands.
  Anything riskier needs the approve button.
- The hub only answers on the computer it runs on. To let someone else in, put a tunnel or a
  web host in front of it (`docs/hosting.md`).
- Whoever runs the hub decides what is sent to each helper, so Max is trusting Brennan with that.

## Solo mode

`npm start` runs the original single-person page at http://localhost:3000 (no logins, no
helper). It was Stage 1 and is kept for quick tests.

## Run the tests

`npm test`. They use a stand-in for Claude, so they cost nothing and use no plan allowance.

## More

- `docs/superpowers/specs/2026-10-14-shared-workspace-design.md` is the design.
- `docs/superpowers/stage-1-results.md`, `docs/superpowers/stages-2-to-5-results.md` and
  `docs/superpowers/glow-up-results.md` say what was measured and what is still untested.
- If Claude says its sign-in expired, open a terminal, run `claude`, type `/login`, and sign in
  again. The helper shows this in plain words.
