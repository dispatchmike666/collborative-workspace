# Glow-up results

Date: 2026-10-29
Built by: Claude, in one session, following `docs/superpowers/plans/2026-10-29-workspace-glow-up.md`
Tests: 228 pass, 0 fail (the stand-in Claude, never the real one)

Brennan's ask: make it look nice, make it fun to use, add any workspaces that would help, and
finish it. He also suggested running it "as a project", which I built as per-project standing
instructions that Claude reads on every request.

## What was added

| Area | What it does |
|---|---|
| New look | "Night glass": frosted panels over a dark midnight backdrop with slow drifting light, serif headings, champagne accent. Gold-foil headings with an italic name in the greeting, fine film grain, a slow turning aurora, glass edges that light up under the mouse pointer, a sweep of light on the main buttons, a glint on the gem, ornamental rules under section titles, and staggered entrances. Pale "pearl" light mode, or match the computer. Five accents. Motion switches itself off if the computer asks for less. (The first version was cartoonish, with sticker cards and little creatures; Brennan asked for glass and fancy, so it was redone the same day.) |
| Presence | A glass orb with each person's initial. Dimmed when offline, green dot when online, turning ring while their Claude works, soft glow when a run ends well |
| Pulse (home) | Greeting, who is online, 7-day numbers (requests, rough plan use, files saved), a feed of what just happened, project cards |
| Project brief | Standing instructions (up to 4,000 characters, versioned so two saves at once are caught) plus a list of settled decisions. Sent to Claude at the start of every request, for both people |
| Shared notes to Claude | A switch sends the notes page to Claude too (first 3,000 characters) |
| Board | Ideas / To do / Doing / Done. Drag cards, edit, delete. "Give to my Claude" starts a run from a card and moves it to Done on a clean finish |
| Quick prompts | A shelf of six starter prompts plus your own, shared with your teammate |
| Reactions and typing | Emoji reactions on messages and a "someone is typing" line |
| File viewer | Click a file to read it (text files only, up to 200 KB each) |
| Jump menu | Ctrl+K from anywhere; `/` jumps to the message box |
| Finishing touches | A small gold-dust sparkle when a run ends well, and soft sounds (both optional, in settings) |
| Phone layout | One narrow top bar, a project strip, and a Chat / "Board, files and more" switch |
| Sign-in help | If Claude's sign-in has expired, the helper says so in plain words and how to fix it |

## How it was checked

- **Automated:** 228 tests, covering the new board, brief, decisions, prompts, file bundles,
  activity numbers, shared routes, the dispatcher's card handling, the helper's request text, and
  the page-building code.
- **In a real browser** (a throwaway hub with a pretend project, Chrome and the built-in pane):
  login page, Pulse home, the three-column project page, adding a card, handing it to Claude,
  dragging a card between lanes (done by sending the same drag events a mouse sends), the Brief
  tab, the file viewer, Notes and Preview tabs, emoji reactions, the typing signal, saving a
  quick prompt, the Ctrl+K menu, dark mode, the settings dialog, and a phone-width pass
  (no sideways scrolling at 280 and 375 px wide).

## NOT tested

- **A real Claude run with the new brief.** Brennan's Claude login on this computer had expired
  (the real error was "OAuth session expired"), so the real Claude could not answer. The helper
  now explains this in plain words. The brief reaches the stand-in Claude correctly (tested);
  it has not been seen reaching the real one. To fix: open a terminal, run `claude`, type
  `/login`, sign in, send a request again.
- **The sparkle and sounds** by eye and ear. The code runs and the settings switches save, but I
  have not watched or heard them.
- **Real dragging with a mouse and a real phone.** Dragging was tested with the events a mouse
  produces, and the phone layout in a narrow browser window, not on a phone.
- **Everything still on the earlier "not tested" list** in `stages-2-to-5-results.md`: reaching
  the hub from another computer, Max's real computer, a real GitHub push, two real Claudes at once.

## Things found and fixed on the way

- A team-chat row shared a style name with the whole chat column, so those rows collapsed to
  nothing. Renamed.
- The phone switch ("Chat / Board, files and more") also showed on desktop. Scoped to phones.
- Pressing Stop before a request had started could still let it start. Fixed with a test.
- A test cut off a follow-up by using a 300 ms job time limit. Raised.
- On a phone the top bar wrapped to four rows and left the chat a sliver. Now one row.
- Log out was unreachable on very narrow screens. It now also lives in the settings dialog.

## Known limits

- Brief and decisions are sent with every request, so very long ones use up plan allowance faster.
  The limits (4,000 characters, 100 decisions, the latest 20 sent) keep it modest.
- The board holds up to 200 cards. Quick prompts up to 40 per project.
- The file viewer only shows text files and skips anything bigger than 200 KB.
- Presence follows what the hub knows. How fast an orb dims after a computer
  goes to sleep without closing its helper has not been measured.
