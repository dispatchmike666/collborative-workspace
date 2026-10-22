# Stage 1 results

Date: 2026-10-22
Claude Code version: 2.1.235 (Windows 11, Node.js 24.18.0)

| Check (from spec section 9, Stage 1) | Result |
|---|---|
| Message in window -> Claude does it -> steps appear within a few seconds | PASS. The whole hello.txt run finished in 6.4s, and the "Write hello.txt" step showed up during the run. I did not time the first step on its own. |
| The file exists on this computer afterward | PASS. `workspace-data/demo/hello.txt` contains `hi`. |
| No API key appears anywhere in the code or settings | PASS. `npm test` (50 tests) includes the key scan, and every real run reported no API key. |

## Also measured

- Claude remembers the previous message (real `--resume`): yes. Asked "What file did you just create, and what is in it?", it answered that it created `hello.txt` containing `hi`.
- A message sent while busy waits in line and then runs by itself: yes. The page said "Brennan sent a message. It's waiting in line and will start by itself.", the first finished, the second started with no action, and both `one.txt` and `two.txt` exist.
- Time per message, start to finish: hello.txt 6.4s, the follow-up question 3.9s, one.txt 6.3s, two.txt 5.0s, a simple command 10.3s, a blocked command 16.9s.
- Plan usage shown per message (list-price estimate, not billed): the first two messages about $0.40 each, then about $0.04 to $0.09 each. Six messages in total came to about $1.03 at list price. The drop after the second message is probably Claude's start-up text being reused.
- What happened when Claude wanted to run a command: `echo hello` ran and printed `hello` without any approval. A command that reaches the internet (curl to example.com) was stopped with "This command requires approval". Claude then explained in plain words that it could not run it and asked for permission. The window has no way to approve yet.
- Anything surprising:
  - The status badge stayed on "Connecting…" until the first event arrived. Fixed during this stage (the server now sends its headers at once) and covered by a test.
  - Claude has a PowerShell tool as well as Bash. The window shows it as just "PowerShell" with no detail, unlike Bash steps.
  - One short PowerShell command failed with "The command line is too long". I did not find out why.
  - Stopping the server through the task list left its Node process running and holding port 3000. Stop it by process, not just the wrapper.

## What this means for Stage 2

The helper idea holds up. On this Windows PC, the program runs your own Claude on your plan with no API key, streams every step live, remembers the conversation, and queues extra messages quietly. Plan usage per message is small once Claude's start-up text is reused, so cost on the plan looks acceptable. The next plan should add approval buttons in the window for blocked commands, show PowerShell steps with detail, and then move the same pieces onto a hosted website with logins so Max can join.
