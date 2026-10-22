# Shared workspace

A web page where you type a message and your own Claude does the work in a
project folder, while you watch every step appear live.

## Start it

1. Open a terminal in this folder.
2. Run `npm start`.
3. Open http://localhost:3000 in your browser.
4. Type what you want, for example: Create a file called hello.txt containing the word hi.

Claude works inside `workspace-data/demo`. To use another folder, set
`PROJECT_DIR` before starting. To stop it, press Ctrl+C in the terminal.

## What it will and won't do

- It uses your Claude plan login. It never uses an API key, and it refuses to run if
  Claude says it is set up to bill per use.
- Claude can create and edit files without asking, and can run simple harmless
  commands. Anything riskier, like reaching the internet, is blocked. Claude will
  say so, but there is no approve button yet.
- Only this computer can reach the page.

## Run the tests

`npm test` (they use a fake Claude, so they cost nothing).
