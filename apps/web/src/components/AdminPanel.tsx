import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { GameState } from "@party-monopoly/engine";
import type { PlayerLook } from "@party-monopoly/types";
import { resolveLook } from "../game/avatars.js";
import { AvatarThumb } from "./AvatarThumb.js";
import { Hud } from "./Hud.js";
import { IsoBoard } from "./IsoBoard.js";

// Operator console: every live room, the real board of any one of them, and the
// buttons to unstick or restart a game. Reached at ?admin=1 — never linked from
// the menu, and useless without the token the server checks.
const SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "ws://localhost:2567";
// the admin API is plain HTTP on the same host the websocket points at
const API = SERVER.replace(/^ws/, "http");
const TOKEN_KEY = "pm-admin-token";
const REFRESH_MS = 3000;

interface RoomRow {
  roomId: string;
  name: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  createdAt: string;
}
interface Snapshot {
  roomId: string;
  started: boolean;
  clients: number;
  maxClients: number;
  endsAt: number | null;
  phase: string;
  seats: { id: string; name: string; look: PlayerLook }[];
  looks: Record<string, PlayerLook>;
  waitingOn: string | null;
  duel: string[] | null;
  partyRound: boolean;
  events: { t: number; msg: string }[];
  state: GameState | null;
  error?: string;
}

export function AdminPanel({ onLeave }: { onLeave: () => void }): JSX.Element {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [entry, setEntry] = useState("");
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const api = useCallback(
    async (path: string, body?: unknown): Promise<unknown> => {
      const res = await fetch(API + path, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (res.status === 404) throw new Error("Rejected — wrong token, or the server has no ADMIN_TOKEN set.");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    [token],
  );

  // poll the room list, and the selected room's board, while the panel is open
  useEffect(() => {
    if (!token) return;
    let live = true;
    const tick = async (): Promise<void> => {
      try {
        const list = (await api("/admin/rooms")) as { rooms: RoomRow[] };
        if (!live) return;
        setRooms(list.rooms);
        setError(null);
        if (selected) {
          const s = (await api(`/admin/rooms/${selected}`)) as Snapshot;
          if (live) setSnap(s.error ? null : s);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "request failed");
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [token, selected, api]);

  async function act(type: string, arg?: string): Promise<void> {
    if (!selected) return;
    setBusy(true);
    try {
      const r = (await api(`/admin/rooms/${selected}/action`, arg ? { type, arg } : { type })) as { ok?: boolean; error?: string };
      if (r.ok === false) setError(r.error ?? "action failed");
      if (type === "close") {
        setSelected(null);
        setSnap(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Frame onLeave={onLeave}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sessionStorage.setItem(TOKEN_KEY, entry.trim());
            setToken(entry.trim());
          }}
          style={{ maxWidth: 400, marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}
        >
          <label style={{ fontSize: 13, color: "var(--muted)" }}>Admin token</label>
          <input type="password" value={entry} onChange={(e) => setEntry(e.target.value)} autoFocus placeholder="ADMIN_TOKEN" />
          <button className="primary" disabled={!entry.trim()}>
            Unlock
          </button>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            This is the value of <code>ADMIN_TOKEN</code> on the server. Held in sessionStorage — it goes away when you close the tab.
          </p>
        </form>
      </Frame>
    );
  }

  return (
    <Frame
      onLeave={onLeave}
      onSignOut={() => {
        sessionStorage.removeItem(TOKEN_KEY);
        setToken("");
        setSelected(null);
      }}
    >
      {error && (
        <div style={{ margin: "12px 0", padding: 10, borderRadius: 8, background: "#3a1d1d", border: "1px solid #a33", fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
        {/* room list */}
        <div style={{ minWidth: 280, flex: "0 0 300px" }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--muted)", margin: "0 0 8px" }}>
            Active rooms {rooms ? `(${rooms.length})` : ""}
          </h2>
          {rooms?.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>No rooms right now.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rooms?.map((r) => (
              <button
                key={r.roomId}
                onClick={() => setSelected(r.roomId)}
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 8,
                  background: "var(--panel-2)",
                  border: `2px solid ${selected === r.roomId ? "var(--accent)" : "transparent"}`,
                  cursor: "pointer",
                }}
              >
                <div style={{ fontFamily: "monospace", fontWeight: 800 }}>{r.roomId}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {r.name} · {r.clients}/{r.maxClients} · {r.locked ? "in progress" : "lobby"}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>started {timeAgo(r.createdAt)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* the selected room */}
        <div style={{ flex: 1, minWidth: 420 }}>
          {!selected && <p style={{ fontSize: 13, color: "var(--muted)" }}>Pick a room to watch it.</p>}
          {selected && !snap && <p style={{ fontSize: 13, color: "var(--muted)" }}>Loading {selected}…</p>}
          {snap && (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ fontFamily: "monospace" }}>{snap.roomId}</strong>
                <Tag>{snap.phase}</Tag>
                {snap.partyRound && <Tag>party round</Tag>}
                {snap.duel && <Tag>duel: {snap.duel.join(" vs ")}</Tag>}
                {snap.waitingOn && <Tag>waiting on {snap.seats.find((s) => s.id === snap.waitingOn)?.name ?? snap.waitingOn}</Tag>}
                {snap.endsAt && <Tag>{Math.max(0, Math.round((snap.endsAt - Date.now()) / 1000))}s left</Tag>}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {snap.seats.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "var(--panel-2)" }}>
                    <AvatarThumb av={resolveLook(s.look)} size={26} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{s.name}</span>
                    <button onClick={() => void act("kick", s.id)} disabled={busy} title={`Remove ${s.name}`} style={{ padding: "0 6px", fontSize: 11 }}>
                      kick
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                <button onClick={() => void act("nudge")} disabled={busy} title="Play the current player's turn for them">
                  ⏭ Nudge stuck turn
                </button>
                <button onClick={() => void act("reset")} disabled={busy} title="Restart the match with the same players">
                  ♻️ Reset match
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Close room ${snap.roomId}? Everyone in it is disconnected.`)) void act("close");
                  }}
                  disabled={busy}
                  style={{ marginLeft: "auto" }}
                >
                  ⛔ Close room
                </button>
              </div>

              {/* the room's own history — what actually happened, newest last */}
              <details open style={{ marginBottom: 16 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
                  Event log ({snap.events?.length ?? 0})
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      const text = (snap.events ?? []).map((v) => `${new Date(v.t).toISOString()}  ${v.msg}`).join("\n");
                      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `room-${snap.roomId}.log`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    style={{ marginLeft: 10, fontSize: 11, padding: "2px 8px" }}
                  >
                    download
                  </button>
                </summary>
                <div
                  ref={(el) => {
                    if (el) el.scrollTop = el.scrollHeight; // keep the newest line in view
                  }}
                  style={{
                    maxHeight: 260,
                    overflowY: "auto",
                    background: "#0d1016",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    fontFamily: "monospace",
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    marginTop: 8,
                  }}
                >
                  {(snap.events ?? []).map((v, i) => (
                    <div key={i} style={{ whiteSpace: "pre-wrap", color: lineColour(v.msg) }}>
                      <span style={{ color: "#5a6472" }}>{new Date(v.t).toLocaleTimeString()} </span>
                      {v.msg}
                    </div>
                  ))}
                  {!snap.events?.length && <span style={{ color: "var(--muted)" }}>Nothing yet.</span>}
                </div>
              </details>

              {snap.state ? (
                <>
                  <Hud state={snap.state} looks={snap.looks} />
                  <div style={{ marginTop: 12 }}>
                    <IsoBoard state={snap.state} />
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--muted)" }}>Still in the lobby — no board yet.</p>
              )}
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}

function Tag({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: "var(--panel-2)", color: "var(--muted)" }}>
      {children}
    </span>
  );
}

function Frame({ children, onLeave, onSignOut }: { children: ReactNode; onLeave: () => void; onSignOut?: () => void }): JSX.Element {
  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Admin — live rooms</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {onSignOut && <button onClick={onSignOut}>Forget token</button>}
          <button onClick={onLeave}>Back</button>
        </div>
      </header>
      {children}
    </main>
  );
}

// make the lines that matter jump out of a wall of monospace
function lineColour(msg: string): string {
  if (msg.includes("REJECTED") || msg.includes("MALFORMED") || msg.includes("BANKRUPT")) return "#ff9a9a";
  if (msg.includes("ADMIN") || msg.includes("timeout") || msg.includes("forfeit") || msg.includes("IGNORED")) return "#ffcf8c";
  if (msg.startsWith("  · ")) return "#9fb3c8";
  if (msg.includes("GAME OVER") || msg.includes("game started")) return "#8ee6a8";
  return "#dfe6f0";
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
