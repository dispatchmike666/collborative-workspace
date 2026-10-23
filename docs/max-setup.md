# Max: setting up your helper

**What you are setting up.** The helper is a small program that runs on your own computer.
When you ask your Claude to do something in the shared workspace, the website passes the
request to your helper, and your helper runs your own Claude on your own computer. You and
Brennan each have your own helper and your own Claude plan. Nobody uses anyone else's Claude.

You do this once. After that, you only start the helper when you want to work.

## What you need first

1. **Node.js** (version 22 or newer): the engine the helper runs on. Download the installer
   from nodejs.org. To check, open a terminal and run `node --version`.
2. **Git**: the tool that keeps project files in step with GitHub. Download it from git-scm.com
   if `git --version` does not work.
3. **Claude Code**, signed in with your own Claude plan. Open a terminal, run `claude`, and
   sign in if it asks. Close it again once it works.
4. **Access to the project's GitHub page.** Brennan has to add you to each project's GitHub
   repository. The first time your computer fetches a project, Windows may ask you to sign in
   to GitHub. Do that once and it remembers.
5. **Your helper token and the workspace address**, sent to you privately by Brennan.

## Get the helper

1. Open a terminal where you keep your projects.
2. Fetch the code (Brennan will tell you the exact address if it is different):

   ```
   git clone https://github.com/dispatchmike666/collborative-workspace
   cd collborative-workspace
   ```

   There is nothing else to install.

## Start it

In PowerShell, in that folder. Replace the two values with the ones Brennan sent you:

```
$env:HUB_URL = "https://the-address-brennan-sent"
$env:HELPER_TOKEN = "your-helper-token"
npm run helper
```

You should see "Connected to the hub. Waiting for work." In the workspace website, a green dot
appears next to your name. Leave this window open while you work. Press Ctrl+C to stop.

**To avoid typing it every time:** make a text file called `start-helper.cmd` somewhere private
(not inside the project folder) containing these lines, with your real values:

```
@echo off
cd /d C:\path\to\collborative-workspace
set HUB_URL=https://the-address-brennan-sent
set HELPER_TOKEN=your-helper-token
npm run helper
```

Your helper token is like a password for your helper, so do not share that file.

## What the helper does on your computer

- It keeps a copy of each project in a folder called `shared-workspace-projects` inside your
  user folder. It only ever works inside that folder.
- When you ask your Claude for something, your Claude can create and edit files there. It can
  run simple harmless commands. For anything riskier, such as reaching the internet, the
  workspace shows an "Allow once" button that only you can press.
- When your Claude finishes, the helper saves the changes to GitHub, so Brennan's computer gets
  them before his next request.
- It uses your Claude plan's allowance. Building uses more than chatting. The workspace shows
  roughly how much each request used.
- It never uses an API key and refuses to run if your Claude is set up to bill per use.
- Git records the changes under the name set on your computer (`git config user.name`).

**Trust:** Brennan runs the website, so Brennan's website decides what is sent to your helper.
You are trusting Brennan with that, the same way you would trust him in a shared document.

## If something goes wrong

| What you see | What to do |
|---|---|
| "The hub did not accept this helper token" | The token is wrong or was replaced. Ask Brennan for a new one. |
| "Couldn't start Claude" in the workspace | Claude Code is not installed or not on this computer's path. Run `claude --version` in a terminal. |
| "Couldn't get the project files from ..." | Your GitHub login cannot open that project. Ask Brennan to add you, then try again. |
| "Both computers changed the same part of a file" | You and Brennan's Claude edited the same lines. Nothing is lost. Ask for help sorting it out. |
| Your name shows a grey dot | The helper is not running or cannot reach the address. Check the helper window. |
