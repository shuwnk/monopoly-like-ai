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
2. **`railway.json` pins the build** to the root `Dockerfile`, the start command to the
   server workspace, the health check to `/health`, and the service to 1 replica. Don't
   override those in the dashboard.
   - Without it Railway auto-detects a Node monorepo, runs the root `npm run build` — which
     builds the **web** app — and then finds nothing to start. The symptom is a green build
     and "Application failed to respond" on every request.
   - It injects `PORT` automatically; the server reads `process.env.PORT` and binds `0.0.0.0`
     (loopback-only would be unreachable from outside the container).
3. **1 replica is not optional.** Rooms live in the process's memory (Colyseus runs on its
   default local presence, no Redis), so a second replica gets its own set of rooms and half
   your friends would join a room the other half can't see.
4. When the deploy is green, open the service → **Settings → Networking → Generate Domain**.
   You'll get something like `party-monopoly-production.up.railway.app`.
5. Your server URL for the web app is that domain with **`wss://`**:
   `wss://party-monopoly-production.up.railway.app`

Quick check: `https://<domain>/health` returns `ok`. That's the only plain HTTP path the
server serves — everything else is `/matchmake/*` and the WebSocket upgrade, so the bare
domain answers with nothing at all. Use `/health` for Railway's health check too.

## 2. Web → Vercel

1. Go to <https://vercel.com> → **Add New → Project** → import this repo.
2. Vercel reads **`vercel.json`** (install `npm install`, build `npm run build`,
   output `apps/web/dist`). Leave those as detected.
3. Add an **Environment Variable** (Project → Settings → Environment Variables) **before the
   first build**:
   - Name: `VITE_SERVER_URL`
   - Value: `wss://party-monopoly-production.up.railway.app`  ← your Railway domain
   - Apply to **Production** (and Preview if you want).
4. **Deploy.** You'll get a URL like `party-monopoly.vercel.app`.

> Vite inlines env vars at **build time**, so if you change `VITE_SERVER_URL` later
> you must **redeploy** the web app for it to take effect. Build without it and the
> live site is hard-wired to `ws://localhost:2567` — it will look broken for everyone
> but you, with no error that says why.

## 3. Play

- Open the Vercel URL, put your **name** in, choose **Players** (2–10) + length, **Create room**.
- Hit **Copy invite link** in the lobby and send it round — it opens the site with the room
  code filled in (`?room=CODE`). The room code on its own works too.
- Watch the roster fill, then **Start** (or it auto-starts when the room fills).

## Notes

- CORS is fine out of the box: Colyseus 0.16 serves matchmaking with
  `Access-Control-Allow-Origin: *`, so the Vercel origin can reach the Railway server.
- Free tiers sleep/idle. If the first connection is slow, the server is waking up.
- To move the server later, just update `VITE_SERVER_URL` in Vercel and redeploy the web.
