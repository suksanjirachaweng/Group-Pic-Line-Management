# Group Pic Photo Server (self-hosted, runs on your own PC)

Replaces Vercel Blob for group-photo storage. The main app uploads/serves photos through this
server instead, once configured. Everything here runs on your Windows PC — nothing to deploy to
Vercel for this part.

Reachability is handled by **Cloudflare Tunnel** (`cloudflared`), not port-forwarding — there's no
router configuration and no certificate to manage. The tunnel makes an outbound-only connection
from this PC to Cloudflare, which then proxies `https://grouppic.newsalon1999.com` straight to
this server's `127.0.0.1:8793`. If `cloudflared` isn't already installed and connected (check the
Cloudflare Zero Trust dashboard → Networks → Tunnels → your tunnel → Connectors, should show
"Connected"), get the tunnel token from whoever manages the `newsalon1999.com` Cloudflare account
and run `cloudflared service install --token <token>` — that's a one-time setup done outside this
folder.

## What you need before starting

- The Cloudflare Tunnel above already installed and showing "Connected", with a published
  application route for `grouppic.newsalon1999.com` → `https://localhost:8793` (Published
  application routes tab on the tunnel's page).
- This PC on and connected 24/7 — if it's off, every photo in the app (admin tagging pages, and
  any public "view my photo" links sent to students) fails to load.

## 1. Install Node.js

Download the LTS installer from https://nodejs.org and run it (default options are fine).
Confirm it worked by opening Command Prompt and running:

```
node --version
```

## 2. Install this server's dependencies

Open Command Prompt in this folder (`pc-photo-server`) and run:

```
npm install
```

## 3. Configure

Copy `.env.example` to `.env` in this same folder, then edit it:

- `UPLOAD_SECRET` — generate a random value (e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the output). **This exact same value must also be set as `PC_PHOTO_STORAGE_SECRET` in the main app's environment (Vercel project settings) — they have to match exactly.**
- `PUBLIC_BASE_URL` — the full HTTPS URL for the subdomain, e.g. `https://grouppic.newsalon1999.com`

## 4. Try it manually first

Open Command Prompt in this folder and run:

```
node server.js
```

You should see `Photo storage server listening on 127.0.0.1:8793, ...`. Leave this window open
and, from another device (even your phone, off your home WiFi, to prove the tunnel really works),
visit `https://grouppic.newsalon1999.com/health` — it should return `{"ok":true}`. Close this
window (Ctrl+C) once confirmed; step 5 turns it into a proper background service.

## 5. Run it as a background Windows service (so it survives reboots)

Download **NSSM** (Non-Sucking Service Manager) from https://nssm.cc/download, extract it, and
use the 64-bit `nssm.exe`. Open Command Prompt **as Administrator** in that folder and run:

```
nssm install GroupPicPhotoServer "C:\Program Files\nodejs\node.exe" "server.js"
```

When the GUI popup appears, set **Startup directory** to this `pc-photo-server` folder, then
click Install service.

Start it:

```
nssm start GroupPicPhotoServer
```

Now starts automatically on every boot, even if you're not logged in — same as `cloudflared`
does once it's installed as a service (`cloudflared service install` already handles that).

## 6. Test it

From any browser (even on your phone, off your home WiFi, to prove it's really public):

```
https://grouppic.newsalon1999.com/health
```

Should return `{"ok":true}`.

## 7. Point the main app at it

In the main app's environment (Vercel project → Settings → Environment Variables, and your local
`.env` if you want to test locally too), add:

```
NEXT_PUBLIC_PC_PHOTO_STORAGE_URL="https://grouppic.newsalon1999.com"
PC_PHOTO_STORAGE_SECRET="<the exact same value as UPLOAD_SECRET above>"
```

That's it — no code changes needed on the app side. As soon as those two variables are set, every
new group-photo upload goes through your PC instead of Vercel Blob. Existing photos already
stored in Vercel Blob keep working exactly as before (their URLs don't change) — this only
affects new uploads going forward.
