# Helper hardening - results

Date: 2026-10-30
Branch: `helper-hardening` (not merged, not pushed)
Why: the research report (docs/superpowers/multiplayer-ai-coding-workspaces-report.md) said the design stays
allowed only while the helper is a thin launcher that never touches the login, and listed what to tighten.

## What was found, with the real Claude

A deliberate check (a few tiny requests on Brennan's plan, run on 2026-10-30) built a "hostile" project: a settings
file with hooks and an environment setting, plus a CLAUDE.md with a secret word.

| Start-up flags | Project's hook ran | Project's environment setting applied | CLAUDE.md loaded | Login source reported |
|---|---|---|---|---|
| **Before** (`--setting-sources project`) | **Yes** | **Yes** | Yes | none |
| `--setting-sources ""` (now used) | No | not applied | Yes | none |
| `project` plus `disableAllHooks` | No | not checked | Yes | none |

So before this change, whatever a shared project's settings file said ran on the other person's computer with no
question asked: commands before every message, changes to Claude's environment (for example where it sends its
requests), and permission allowances that could defeat the approval buttons (documented, not tried). An empty list of setting sources
switches all of that off and the project's CLAUDE.md instructions still load.

Also learned: under a plain Claude plan login, Claude's start-up report says `apiKeySource: "none"`. The existing
check (stop unless it says none or oauth) is right and fails closed.

## What changed

1. **No settings files at all** (`server/config.js`): `--setting-sources ""`.
2. **More environment cleaning** (`server/child-env.js`): every `CLAUDE_CODE_USE_*` switch, the Bedrock, Vertex and
   Foundry families, `ANTHROPIC_PROFILE` and `AWS_BEARER_TOKEN_BEDROCK` are removed, on top of the API key, auth
   token and base address already removed. Ordinary settings (model, config folder, plan token) are kept.
3. **Forbidden flags** (`server/claude-runner.js`): `--bare` and both skip-permissions flags can never be used. A
   single message may add only an approval of one exact command; any other extra flag is refused and Claude is not
   started.
4. **Stop really stops** (`server/kill-tree.js`): Stop, the time limit and the "bills per use" refusal now stop
   everything Claude started, not only Claude. Windows uses `taskkill /T /F`; Mac and Linux start Claude as the
   leader of its own group and signal the group. Before, a stopped run could leave commands or dev servers running.
5. **Quiet-run watchdog**: a run that has printed nothing for 8 minutes while no command is running is stopped,
   with a plain message. A command that is still running (a long test run) may be quiet; the 15-minute overall
   limit still applies to it.
6. **Unknown login sources are refused** (already true, now tested): `apiKeyHelper`, a managed key, or a missing
   value all stop the run before anything is billed.

## Tests

- 286 tests pass (12 more than before: `test/claude-runner-hardening.test.js` and additions to `child-env.test.js`),
  including tests with real programs that start a second program, stop the first, and check the second is gone.
- `test/acceptance/hostile-project.manual.mjs` repeats the real-Claude check with the helper's actual flags. It is
  not part of `npm test` because it uses the plan. Run it after a Claude update.

## What this changes for you

- A project's own settings (its hooks, environment settings and permission allow-lists) are no longer read. If a
  project relied on its own allow-list, Claude will now ask through the approval buttons instead.
- Nothing about logins moved: the hub still never sees anyone's Claude login.

## Not done (still on the list from the report)

- Prefer documented routes over private files: `claude agents --json` is the documented way to list sessions. The
  open-chats feature still reads `~/.claude/sessions`, which Anthropic does not document. A fallback chain is a
  good next step.
- An optional, off-by-default API-key mode as insurance against a rule change. It conflicts with the never-an-API-key
  rule, so it is Brennan's decision.
- A message dropped into a chat that skips permission prompts can be held for approval; the message status feature
  (sent, picked up, finished, waiting) already shows when that happens.
- Single-use run tokens and redaction of secrets in what the other person sees.
