# Start Glasshouse by itself at login

Normally the hub and your helper stop when the window that started them closes. This sets
Windows to start both, hidden, every time you log in, and to start either one again within
seconds if it stops.

## Turn it on

In PowerShell, in the Glasshouse folder:

```
powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1
```

It asks for your helper token once (it does not show on screen) and starts everything right
away. No window appears, now or at login. Open http://localhost:3000 to check.

If your hub was already running in a terminal, close that first, or the second copy will find
the port taken.

**Max, or anyone whose hub is on another computer**, starts only the helper:

```
powershell -ExecutionPolicy Bypass -File scripts\autostart\install.ps1 -HelperOnly -HubUrl https://the-address-brennan-sent
```

Other options: `-HubOnly` (no helper), `-Port 3001`, and `-HubPublicHost workspace.something.ts.net`
(the Tailscale name from `docs/hosting.md`; if `HUB_PUBLIC_HOST` is set in that window it is used).

## Turn it off

```
powershell -ExecutionPolicy Bypass -File scripts\autostart\uninstall.ps1
```

This stops the hub and helper, stops them starting at login, and deletes the saved settings
and token. Logs are kept.

## Good to know

- **After pulling new code, or moving the Glasshouse folder,** run the install command again.
  It restarts both with the new code. Pressing Enter at the token question keeps the saved token.
- **Logs** are in `%LOCALAPPDATA%\Glasshouse\logs`: `hub.log`, `helper.log`, and
  `autostart.log` (each start and stop, with the reason).
- **Your helper token** is saved in `%LOCALAPPDATA%\Glasshouse\autostart.json`, locked with
  Windows' own encryption so only your Windows account on this computer can read it.
- **If something keeps stopping** (for example a replaced helper token), it is retried less and
  less often, down to once every 5 minutes, and `autostart.log` says why.
- It runs as you, on your own login, so your GitHub and Claude sign-ins work as usual. It
  needs no administrator rights on most PCs. If Windows refuses, the script says to run it
  again from PowerShell opened with "Run as administrator".
- It shows in Task Scheduler as **Glasshouse**.
- The hidden start uses a small VBScript file (`start-hidden.vbs`). Microsoft plans to switch
  VBScript off by default in a future Windows version. If that happens, the task will stop
  starting, and this needs a new launcher.

## How it works

`install.ps1` adds a Task Scheduler task that runs at your login. The task opens
`start-hidden.vbs`, which starts `run-glasshouse.ps1` with its window hidden from the first
moment. That script runs `node hub\index.js` and `node helper\index.js`, checks them every few
seconds, and starts again whichever one stopped. It finds the Glasshouse folder from its own
location, not a fixed path.
