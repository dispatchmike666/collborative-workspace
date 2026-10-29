# Workspace glow-up: look, fun, and more workspaces

**Goal:** Make the shared workspace look good and feel fun, and add the extra spaces that two people building with AI actually use. Run each project like a Claude "project": standing instructions and settled decisions that every Claude run always sees.

**Asked for by Brennan, 2026-10-29:** "finish building this, make it look nice and make it fun to use, add any workspaces that might be helpful, don't stop until it's finished". Design choices were delegated, so this plan is the design.

## Design direction

- **Subject.** A shared workshop for two friends and their two Claudes. The page's job: be a place you want to open, and make it obvious who is doing what.
- **Look: "two-colour print".** Cool paper, deep ink, and spot colours (blue, pink, sun yellow, mint, tangerine) as if printed in two inks. Cards are stickers: 2px ink outline and a hard offset shadow that lifts on hover. Light and dark.
  - Paper `#F6F4FB`, card `#FFFFFF`, ink `#1D1A3A`, soft ink `#5B5877`
  - Blue `#3B5BFF` (first person), pink `#FF4F8B` (second person), yellow `#FFC93C`, mint `#2FD1A0`, tangerine `#FF7A2F`
  - Dark: paper `#15122B`, card `#1F1B3D`, ink `#F1EEFF`
- **Type.** System fonts only (no downloads, strict security rules): headings in Bahnschrift (a condensed Windows font), falling back to Segoe UI Variable and the system font; body in Segoe UI Variable Text; code in Cascadia Mono. Heavy headings, generous body.
- **Signature: the crew.** Each person's Claude is a little helper creature drawn in SVG in that person's colour. Moods: asleep (computer off), awake, working (busy), cheering (just finished). The crew lives in the top bar, in the project header, and as the avatar on Claude's messages.
- **Restraint.** Timeline rows stay light so long conversations read easily. Boldness is spent on the crew, the sticker cards and the confetti.
- **Quality floor.** Works on phones, visible keyboard focus, reduced motion respected, contrast checked in both modes.
- **Words.** Plain verbs, sentence case, empty states that say what to do next.

## Scope

**Home ("Pulse")**: greeting, the crew with live status, this week's numbers (runs, files saved, plan used), a "what's been happening" feed across projects, project stickers, a dashed "new project" sticker.

**Project view**: projects on the left; chat in the middle (always there); a tool panel on the right with tabs:
1. **Board**: Ideas, To do, Doing, Done. Drag cards or use buttons. "Give to my Claude" starts a run for that card, moves it to Doing, and moves it to Done when the run finishes cleanly.
2. **Brief**: the project's standing instructions, a list of settled decisions (with who and when), and a switch for letting Claude read the shared notes. All of it is added to every Claude run.
3. **Files**: the file list with changed dots, and click-to-read file contents.
4. **Notes**: the shared notes as before.
5. **Preview**: a bigger preview with reload and open in new tab.

**Fun**: emoji reactions on messages; "Max is typing…"; confetti when your run finishes; themes (accent colour, light/dark/auto); optional soft sounds (off by default); quick prompts shelf (shared, with starter set); command palette (Ctrl+K, or Cmd+K); `/` jumps to the message box.

## Contracts (new)

Events stored on the timeline: `reaction {target, emoji, who, on}`, `board-card {who, action, title, column}`, `decision-added {who, text}`, `brief-saved {who}`.
Events sent live but not stored: `typing {who}`, `board {cards}`, `knowledge {brief, decisions, shareNotes}`, `sources {paths}` (plus the existing presence, files, preview).

Browser API, all needing a login:
- `GET/POST /api/projects/:id/board/cards`, `PATCH/DELETE .../board/cards/:cardId`, `POST .../board/cards/:cardId/start`
- `GET /api/projects/:id/knowledge`, `PUT .../knowledge/brief {text, baseVersion}`, `PUT .../knowledge/share-notes {value}`, `POST .../knowledge/decisions {text}`, `DELETE .../knowledge/decisions/:id`
- `GET/POST /api/prompts`, `DELETE /api/prompts/:id`
- `POST /api/projects/:id/react {eventId, emoji}`, `POST /api/projects/:id/typing`
- `GET /api/projects/:id/source?path=`, `GET /api/pulse`
Helper: `POST /helper/sources {projectId, files: [{path, text}]}`.
Jobs gain `context {brief, decisions[], notes}`; the helper puts it at the top of what Claude is told.

## Tasks (tests first for everything that is logic; the pages are checked in a real browser)

1. **Data modules:** `hub/paths.js`, `hub/board.js`, `hub/knowledge.js`, `hub/prompts.js`, `hub/sources.js`, `hub/activity.js`, wired into the store.
2. **Dispatcher:** job context, board card runs and auto-move.
3. **Routes:** `hub/routes-workspace.js` for everything above; generalise page-file serving safely; helper sources endpoint.
4. **Helper:** source bundle upload; prompt with context.
5. **Page logic (pure, tested):** reactions, board grouping, pulse formatting, palette search, colours.
6. **Page:** styles, the crew, home, project view, panels, palette, themes, confetti, sounds.
7. **Checks in a real browser**, then docs, results, push.

## Pass/fail checks

- A card handed to Claude starts a run on that person's helper, appears in Doing, and moves to Done after a clean run; a failed run leaves it in Doing.
- The text Claude receives starts with the project instructions and the settled decisions.
- Reactions toggle on and off and survive a reload; typing shows for a few seconds only.
- File contents can be read in the page, only for text files, and never for hidden files.
- Nothing on a page can run inline scripts (the strict security header stays).
- Everything works at phone width and with reduced motion.

## Limits written down now

- Boards are last-write-wins per card, not per keystroke; two people moving the same card at once: the later move wins.
- File contents are limited to small text files; big or binary files show "too big or not text".
- The first run of a card does not wait for a human review.
