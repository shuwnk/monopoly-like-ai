import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { matchMaker } from "colyseus";

// Colyseus types its transport server as net|http|https; all we need is the
// ability to hook request events, so ask for exactly that and nothing more.
interface RequestHookable {
  prependListener(event: "request", listener: (req: IncomingMessage, res: ServerResponse) => void): unknown;
}

// Token-guarded admin API, mounted on the same HTTP server Colyseus already runs
// (it only answers /matchmake/*, so prepending a listener leaves it untouched).
//
// Disabled unless ADMIN_TOKEN is set: with no token every /admin route 404s, so
// a deployment can never accidentally ship an open admin panel. The routes list
// player names and can reset live games, which is not something to leave open.
//
//   GET  /admin/rooms            → every live room, summarised
//   GET  /admin/rooms/:id        → one room's full state (watch a game)
//   POST /admin/rooms/:id/action → { type, arg } — nudge / reset / kick / close
const TOKEN = process.env.ADMIN_TOKEN ?? "";

export function mountAdmin(http: RequestHookable | undefined): boolean {
  if (!http || !TOKEN) return false;
  http.prependListener("request", (req, res) => {
    const url = req.url ?? "";
    if (!url.startsWith("/admin/")) return;
    cors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (!authorized(req, url)) {
      // 404 rather than 401: an unauthenticated caller learns nothing about
      // whether an admin API exists here at all
      json(res, 404, { error: "not found" });
      return;
    }
    void route(req, res, url.split("?")[0]!).catch((e: unknown) => {
      json(res, 500, { error: e instanceof Error ? e.message : "admin error" });
    });
  });
  return true;
}

async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (path === "/admin/rooms" && req.method === "GET") {
    const rooms = await matchMaker.query({});
    json(res, 200, {
      rooms: rooms.map((r) => ({
        roomId: r.roomId,
        name: r.name,
        clients: r.clients,
        maxClients: r.maxClients,
        locked: r.locked,
        createdAt: r.createdAt,
      })),
    });
    return;
  }

  const detail = /^\/admin\/rooms\/([A-Za-z0-9_-]+)$/.exec(path);
  if (detail && req.method === "GET") {
    json(res, 200, await call(detail[1]!, "adminSnapshot"));
    return;
  }

  const action = /^\/admin\/rooms\/([A-Za-z0-9_-]+)\/action$/.exec(path);
  if (action && req.method === "POST") {
    const body = (await readJson(req)) as { type?: unknown; arg?: unknown };
    if (typeof body.type !== "string") {
      json(res, 400, { error: "missing action type" });
      return;
    }
    const arg = typeof body.arg === "string" ? body.arg : undefined;
    json(res, 200, await call(action[1]!, "adminAction", [body.type, arg]));
    return;
  }

  json(res, 404, { error: "not found" });
}

// Call a method on a specific room. Single process (rooms live in memory and the
// service runs one replica), so this resolves locally.
async function call(roomId: string, method: string, args: unknown[] = []): Promise<unknown> {
  try {
    return await matchMaker.remoteRoomCall(roomId, method, args);
  } catch {
    return { error: "room not found" };
  }
}

function authorized(req: IncomingMessage, url: string): boolean {
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  // a query param is allowed too, so a browser tab can be pointed at a route
  const q = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("token") ?? "";
  return safeEqual(bearer, TOKEN) || safeEqual(q, TOKEN);
}

// constant-time compare so the token can't be recovered a character at a time
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cors(res: ServerResponse): void {
  // the panel is served from another origin (Vercel) than the server (Railway).
  // The token is the gate, not the origin — it's a header, never a cookie.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64_000) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
