# Open chats - results

Date: 2026-10-30
Branch: `open-chats` (not merged, not pushed)
Where the idea came from: Reason Network's engine (https://github.com/reason-machines/reason-network,
MIT or Apache-2.0). We read its design notes and two source files (`claude.rs`, `doing.rs`) and wrote our own
Node version from what they document. No code was copied.

## What it does

1. **Lists your real open Claude chats.** Claude Code keeps one small file per open chat in
   `~/.claude/sessions`: name, folder, busy or idle, and the address of a private mailbox. The helper reads
   them every 5 seconds and tells the hub only when something changed (or every 30 seconds as a sign of life).
2. **Shows what each chat is working on.** Read from the chat's own record of what happened
   (`~/.claude/projects/*/<chat id>.jsonl`): the item marked "in progress" on its latest to-do list. Only the
   end of a long record is read, then only what was added since.
3. **Drops a message into one of your own chats.** The helper writes one line to the chat's mailbox
   (with the mailbox password line first on Windows, from `~/.claude/sessions/<pid>.<hash>.key`). Claude Code
   puts it in the chat between steps, or starts a turn if the chat is idle. The message begins with
   "Message from <name> in the shared workspace:" so the chat knows where it came from.

Where it shows: a new "Your open Claude chats" section on the home page, using the existing styles.

## Privacy rules (kept on purpose)

- Each person's list is private. The page only ever asks for the logged-in person's own list, and the hub
  refuses to send a message to anyone's chats but the sender's own.
- The hub keeps the list in memory only. It is forgotten when the helper disconnects. Nothing about
  someone's other chats is written to disk.
- The hub never receives a chat's private mailbox address or password. It gets the chat id, name, last part
  of the folder name, busy or idle, the current task and whether the chat takes messages.
- Set `SHOW_OPEN_CHATS=off` when starting the helper to keep the chats out of the workspace entirely.
- This follows the standing rule that a person's message goes only to their own helper.

## Checked

- 256 tests pass (240 before, 16 new in `test/live-chats.test.js` and `test/hub-chats.test.js`), including a
  real helper talking to a real hub and a pretend chat mailbox.
- Run for real against this PC's 9 open chats: all were listed with the right names, folders and status, and
  tasks showed for the ones with a to-do list. The home page section looked right in the browser pane, with
  no errors.
- A real message sent through the page arrived in a real open chat on Windows (a deliberate self-test into the
  chat that built this).

## Not checked, and limits

- The mailbox and the session files are not a documented public feature of Claude Code. A Claude Code
  update could change them. If it does, listing and messaging stop working; nothing else is affected.
- A chat that skips permission prompts may hold the message until its person approves it in that chat.
- Messaging was tried on Windows against the desktop app only, not against a chat in a terminal window.
- Only the home page shows the list. Nothing appears inside a project yet.
- Not done: letting a person choose to share a chat with their teammate, and a "doing" line for chats that
  use only the older task folder (`~/.claude/tasks`).

## Message progress (added 2026-10-30, branch `message-status`)

After you send a message to one of your own chats, the row shows three steps: Sent, Chat picked it up,
Chat finished. If nothing picks it up for two minutes it says it is still waiting and reminds you to approve
any permission prompt in that chat.

How it works: when the helper sends a message it starts watching that chat's own record (the same file
used for the "doing" line). Claude Code writes a "queued" line when the chat receives the message and a normal
turn when it reads it. Picked up means either line appeared. Finished means the chat read the message, then
answered, and its status went back to idle. The helper reports only the state, an id and the time to the hub,
never the words, and the hub keeps it in memory with the rest of the list.

Checked: 15 new tests (271 pass in all), including a real helper and hub with a pretend chat; and the real
page, with a pretend chat, showed all three steps in order with no errors in the browser console. The line
formats come from a real chat's record on this PC (a message sent to it by this feature).

Not checked: a full run against a real chat from start to finish; the "still waiting" note on screen (only in
tests); a chat in a terminal window. Sending the same words twice in quick succession can mix up which
message a line belongs to. Progress is forgotten ten minutes after finishing, half an hour after a message
nobody picked up, and when the chat closes. Like the rest of this feature, it depends on Claude Code's own
files, which are not a documented public feature and could change.

Fixed the same day: the box for typing a message lost its cursor every few seconds, because the list put
every row back on each 5-second refresh and that drops focus from a box inside it. Rows now stay put
(`placeInOrder` in `hub/public/render.js`), and the order is left alone while you are typing in one. Found
and checked in Brennan's real Chrome: typed across three refreshes and nothing was lost.

Decided against: letting a person share a chat with their teammate (Brennan, 2026-10-30). Not built.

## A test helper change

`test/helpers.js`: a temp folder that Windows would not let go of no longer fails a test that already passed.
It was turning one old test red when the whole suite ran together (it passed alone, and on the old code).
