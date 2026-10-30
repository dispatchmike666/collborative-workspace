# Putting the hub where Max can reach it

**What this is for.** The hub is the website you and Max both log in to. Right now it only
answers on the computer it runs on. For Max to use it from his own computer, it needs a safe
way in from the internet. That part needs software and accounts that only you can set up,
so I could not test it. Everything else in this project has been tested.

**Good to know first**

- The hub runs on your PC. When your PC is off, or the hub is stopped, nobody can use the workspace.
- Only people you add can log in. Each person gets a long random password. After five wrong
  tries in a row, logging in is blocked for ten minutes.
- The hub never touches your GitHub login or anyone's Claude login. Those stay on each computer.

## Step 1: start the hub on your PC

1. Open a terminal (a window where you type commands) in the `shared-workspace` folder.
2. Add yourself and Max (this only needs doing once). Each command writes a private file
   with that person's password and helper token. Nothing secret is shown on the screen.

   ```
   npm run hub:add-user -- Brennan
   npm run hub:add-user -- Max
   ```

3. Open the files it names, in `hub-data\credentials`. Save your password somewhere safe.
   Send Max his password and his helper token privately (a direct message, not a group chat
   or email to many people). Then delete the files.
4. Start the hub: `npm run hub`. It says it is running at http://localhost:3000.
   Open that address on your PC and log in to check it works.

## Step 2: choose a way for Max to reach it

### Option A: a Cloudflare "quick tunnel" (does NOT work for this app)

Cloudflare's free quick tunnel is a one-download way to get a temporary web address, but their own
documentation says quick tunnels do not support Server-Sent Events. That is the live connection the
workspace page and every helper depend on, so the workspace would load and then not update. Do not use it.

### Option B: Tailscale (a private network just for you and Max) - tested and working

Tailscale puts your PC and Max's PC on a private network. The hub is then not on the public internet at
all. It needs a free Tailscale account and an install on both computers, and gives your PC a steady name.
Tested on 2026-10-30: the live connection works through it.

1. Install Tailscale on your PC and sign in with a **personal** account (not a work email, which joins
   your company's network instead). To give the PC a plain name, run `tailscale up --hostname=workspace`.
2. The first time you publish, Tailscale sends you to a page called "Start using Serve". Tick
   **HTTPS certificates** only. Leave **Funnel** unticked: it is ticked by default, and it opens the
   workspace to the whole public internet. Turning on HTTPS publicly lists your PC's name, so keep it plain.
3. With the hub running, run: `tailscale serve --bg 3000`. It shows an address like
   `https://workspace.something.ts.net` and says "tailnet only".
4. Tell the hub that name, then restart it:

   ```
   $env:HUB_PUBLIC_HOST = "workspace.something.ts.net"
   npm run hub
   ```

5. Invite Max in Tailscale's admin page (Users, then Invite users), and add him as a collaborator on the
   GitHub repository so he can download the code.
6. Max installs Tailscale, accepts the invite, and uses that address.

Your PC has to be on, with the hub and your helper running, whenever Max is using the workspace.
### Option C: a web host (later, if you want it always on)

Any service that runs Node programs and puts HTTPS in front of them will work, so the hub is
on even when your PC is off. Set `HUB_PUBLIC_HOST` to the address it gives you. Its data lives
in the `hub-data` folder, so that folder must be kept between restarts. This is the biggest
step up in setup, so I would only do it once you two use the workspace daily.

## Step 3: Max starts his helper

Follow `docs/max-setup.md`. He needs the address from Step 2.

## If something goes wrong

| What you see | What it means |
|---|---|
| The page says "Unknown host" | The hub was not told its public name. Set `HUB_PUBLIC_HOST` to exactly the name in the address bar, without `https://`, then restart the hub. |
| Login works but you get logged out at once | The address must be `https://` when using a tunnel. Use the tunnel's `https://` address. |
| Someone is locked out | Wait ten minutes, or give them a new password with `npm run hub:new-password -- Max`. |
| You want to remove someone's access | Run `npm run hub:new-token -- Max` and `npm run hub:new-password -- Max`, and do not send them the new files. |
