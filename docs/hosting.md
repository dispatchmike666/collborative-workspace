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

### Option A: a Cloudflare "quick tunnel" (no account needed, one download)

A tunnel is a secure pipe from the internet to a program on your PC. This one gives you a
temporary web address.

1. Download `cloudflared` from Cloudflare's website (it is a single small program) and put it
   somewhere you can run it.
2. With the hub running, open a second terminal and run:

   ```
   cloudflared tunnel --url http://localhost:3000
   ```

3. It prints an address like `https://something-random.trycloudflare.com`. That is the address
   Max will use.
4. Stop the hub (Ctrl+C) and start it again, telling it its public name. In PowerShell:

   ```
   $env:HUB_PUBLIC_HOST = "something-random.trycloudflare.com"
   npm run hub
   ```

5. Send Max the address. Anyone with the address can see the login page, but only a person
   with a password can get past it.

The catch: this address changes every time you restart the tunnel, so you repeat steps 2 to 5
each time. If that gets annoying, use Option B.

### Option B: Tailscale (a private network just for your devices)

Tailscale puts your PC and Max's PC on a private network. The hub is then not on the public
internet at all. It needs a free Tailscale account and an install on both computers, and
gives each computer a steady name.

1. Both of you install Tailscale and sign in to the same Tailscale network.
2. On your PC, with the hub running, run: `tailscale serve --bg 3000`
3. It shows an address like `https://your-pc.something.ts.net`. Tell the hub that name:

   ```
   $env:HUB_PUBLIC_HOST = "your-pc.something.ts.net"
   npm run hub
   ```

4. Max uses that address.

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
