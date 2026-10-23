# Stages 2 to 5 results

Date: 2026-10-23
Built by: Claude, in one session, following `docs/superpowers/plans/2026-10-23-stages-2-to-5-hub-and-helpers.md`
Tests: 159 pass, 0 fail (about 3,100 lines of program code, about 2,500 lines of tests)

## What the spec's pass/fail checks look like now

| Check (spec section 9) | Result | How it was checked |
|---|---|---|
| **Stage 2** A second person logs in and their own helper runs their own Claude | PASS | Tests with a stand-in Claude on this PC, and a real run: real hub, real browser, Brennan's real helper and Claude |
| Each person sees both timelines live | PASS | Test with two live screens; real run: messages from "Max" (sent by script) appeared live in Brennan's browser |
| A message from one person never reaches the other's helper | PASS | Tested on purpose at the website level and in the whole-system test |
| An unknown name or wrong password cannot log in | PASS | Tests, including the "too many tries" block and identical answers for wrong name vs wrong password |
| **Stage 3** A change one Claude saves is present for the other's next run | PASS | Two helpers sharing a Git repository on this PC; the second Claude's computer received the first one's file before it started |
| A second request waits in line, starts alone, and the sender can keep chatting | PASS | Whole-system test with a slow job; real run showed the waiting note |
| The recap lets a Claude answer "what did the other person just change?" | PASS (with the stand-in) | The second Claude received "Max asked: ... Max's Claude did: Write index.html". Not tested with two real Claudes |
| **Stage 4** Create and open projects from the home page | PASS | Real browser |
| "Just <name>" messages never reach any AI | PASS | Tested; the recap also leaves private chat out |
| Shared notes edit with a conflict warning | PASS | Real browser plus a second user by script: the stale save was refused, the good save appeared live |
| **Stage 5** After a run that makes an index.html, the preview shows | PASS | Real browser: the page Claude wrote was uploaded and served in a sandboxed frame |
| No index.html means the preview area says why | PASS | Wording is in the page; covered by the page code and file helper tests |

Also from Stage 1's leftovers: the **approve button** works with the real Claude. A blocked command
showed up with "Allow once", and after the click Claude ran exactly that command and reported
"200".

## The real run on this PC (a throwaway hub, real Claude, real browser)

- Logged in through the login page. Dashboard showed Brennan online and Max offline.
- "Create index.html ..." took 20.2s, and showed a step, the reply, the usage line, "Saved 1 changed
  file", the file in the Files panel, and the preview.
- A blocked `curl` appeared as an approval row. One click, then Claude printed 200 (12.0s).
- Max (by script) sent a team chat message and a message to his own Claude while offline. Brennan's
  window showed the chat message and "Max's computer is offline. This will run as soon as it is back."
- Notes: Max's out-of-date save was refused (HTTP 409); his correct save appeared in Brennan's box.
- A project with a GitHub address, using a pretend GitHub on this PC: Claude created a file and the
  window said "Saved 1 changed file to GitHub."; the repository held the commit.
- Plan usage per message ran from about $0.05 to $0.16 at list price (not billed).

## NOT tested, because it needs things only a person can do

- **Reaching the hub from another computer** (a tunnel or web host). `docs/hosting.md` explains
  the options, but none of them has been run.
- **Max's real computer.** His helper has never run. `docs/max-setup.md` has the steps.
- **A real GitHub repository.** The sharing path is tested with real Git against a repository on
  this PC, and the real run used the same code. Pushing to github.com needs a saved GitHub login
  on each computer and access to the repository.
- **Two real Claudes at once on two plans**, and long-running stability.
- **The browser pane could not draw screenshots** during the run, because its window was hidden.
  The pages were checked by reading their content and by clicking their controls, not by eye.
  Please look at the pages once and tell me if anything looks wrong.

## Things found and fixed on the way

- The status badge stayed on "Connecting…" until the first event (fixed in Stage 1).
- A stop message from the hub that arrived while a helper was still copying files was lost, and a
  stuck Claude could be left running. Fixed, with a test.
- Test setup on Windows needed patience when deleting folders a program was still using.

## Known limits

- If the hub restarts during a run, that run is marked failed and the next one starts. A person's
  recap forgets what happened before the restart.
- If both computers change the same lines of the same file, the second save stops with a plain
  message and nothing is lost, but it needs a person to sort out. After that, that computer's copy
  stays "ahead" until someone fixes it.
- Claude has to be installed and signed in on each person's computer, and each helper needs access
  to the project's GitHub repository.
- Commits show the name set on each computer's Git, not "Max" or "Brennan".
- Whoever runs the hub decides what is sent to each helper.
- Anthropic's rules: running Claude on your own plan for your own work is the intended use. The
  design keeps each person's requests on their own computer and plan. I could only read summaries
  of the official wording, so please check it yourself before relying on it.
