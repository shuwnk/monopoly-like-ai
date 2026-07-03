# Deploying Party Monopoly online

Two pieces go live: the **Colyseus server** (Railway) and the **web app** (Vercel).
The web app talks to the server over `wss://`, so deploy the server first and give
its URL to the web build.

Everything needed is already committed:
- `Dockerfile` + `.dockerignore` — build the server for Railway.
- `vercel.json` — build the web app for Vercel.
- The client reads `VITE_SERVER_URL` (`apps/web/src/net/onlineClient.ts`); no code edits needed.

## 0. Push the repo to GitHub

Both hosts deploy from a GitHub repo:

```bash
git add -A && git commit -m "Add deploy config"
gh repo create party-monopoly --private --source=. --push   # or push to an existing remote
```

## 1. Server → Railway

1. Go to <https://railway.app> → **New Project → Deploy from GitHub repo** → pick this repo.
2. Railway detects the root **`Dockerfile`** and builds it. No build settings to change.
   - It injects `PORT` automatically; the server already reads `process.env.PORT`.
3. When the deploy is green, open the service → **Settings → Networking → Generate Domain**.
   You'll get something like `party-monopoly-production.up.railway.app`.
4. Your server URL for the web app is that domain with **`wss://`**:
   `wss://party-monopoly-production.up.railway.app`

Quick check: opening `https://<domain>` in a browser should return a small Colyseus
response (not an error) — that means the server is up.

## 2. Web → Vercel

1. Go to <https://vercel.com> → **Add New → Project** → import this repo.
2. Vercel reads **`vercel.json`** (install `npm install`, build `npm run build`,
   output `apps/web/dist`). Leave those as detected.
3. Add an **Environment Variable** (Project → Settings → Environment Variables):
   - Name: `VITE_SERVER_URL`
   - Value: `wss://party-monopoly-production.up.railway.app`  ← your Railway domain
   - Apply to **Production** (and Preview if you want).
4. **Deploy.** You'll get a URL like `party-monopoly.vercel.app`.

> Vite inlines env vars at **build time**, so if you change `VITE_SERVER_URL` later
> you must **redeploy** the web app for it to take effect.

## 3. Play

- Open the Vercel URL, choose **Players** (2–10) + length, **Create room**.
- Share the **room code** shown in the lobby with your friends (also on the Vercel URL).
- Start when everyone's in (or it auto-starts when the room fills).

## Notes

- CORS is fine out of the box: Colyseus 0.16 serves matchmaking with
  `Access-Control-Allow-Origin: *`, so the Vercel origin can reach the Railway server.
- Free tiers sleep/idle. If the first connection is slow, the server is waking up.
- To move the server later, just update `VITE_SERVER_URL` in Vercel and redeploy the web.
