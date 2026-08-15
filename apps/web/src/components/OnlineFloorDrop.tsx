import { useEffect, useRef, useState } from "react";
import { Client, type Room } from "colyseus.js";
import { FD_GRID, FDClient, FDServer, type FDLobby, type FDOver, type FDRosterEntry, type FDSnapshot, type FDStart } from "@party-monopoly/types";
import { AVATARS, avatarById, avatarRoster, type Avatar } from "../game/avatars.js";
import { useProfile } from "../store/profile.js";
import { createFloorDropScene, type FDSceneFighter } from "../three/floorDropScene.js";
import { TouchStick } from "./TouchStick.js";

// Real-time PvP Floor Drop client. The server owns the sim; this just sends the
// movement vector and renders the snapshots it broadcasts (~20Hz) with smoothing.

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "ws://localhost:2567";
const GRID = FD_GRID;
const DROP_ANIM = 0.35;
const FALL_TIME = 0.6;

type Net = "connect" | "connecting" | "lobby" | "playing" | "over";

export function OnlineFloorDrop({ onLeave }: { onLeave: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [net, setNet] = useState<Net>("connect");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [code, setCode] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<FDLobby | null>(null);
  const [result, setResult] = useState<{ won: boolean; place: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const netRef = useRef<Net>(net);
  netRef.current = net;
  const roomRef = useRef<Room | null>(null);
  const youRef = useRef<number>(-1);
  const rosterRef = useRef<Map<number, FDRosterEntry>>(new Map());
  const snapRef = useRef<FDSnapshot | null>(null);
  const avatarsRef = useRef<Map<number, Avatar>>(new Map());
  const fallRef = useRef<Map<number, number>>(new Map()); // fallT per fighter id (fall anim is local)
  const aliveRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);
  const tileAnimRef = useRef<number[]>(new Array(GRID * GRID).fill(0));
  const prevTilesRef = useRef<string>("");
  const keysRef = useRef<Set<string>>(new Set());
  const sentRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  function wire(room: Room): void {
    roomRef.current = room;
    setRoomId(room.roomId);
    room.onMessage(FDServer.lobby, (m: FDLobby) => {
      setLobby(m);
      setNet("lobby");
    });
    room.onMessage(FDServer.start, (m: FDStart) => {
      youRef.current = m.you;
      rosterRef.current = new Map(m.players.map((p) => [p.id, p]));
      // the netcode roster has no avatars (just colors), so assign distinct ones by slot,
      // giving the local player their own equipped avatar
      const base = useProfile.getState().avatar;
      const avs = avatarRoster(base, m.players.length);
      const map = new Map<number, Avatar>();
      m.players.forEach((p, i) => map.set(p.id, p.id === m.you ? avatarById(base) : avs[i] ?? AVATARS[0]!));
      avatarsRef.current = map;
      fallRef.current.clear();
      tileAnimRef.current.fill(0);
      prevTilesRef.current = "";
      snapRef.current = null;
      setResult(null);
      setNet("playing");
    });
    room.onMessage(FDServer.snap, (m: FDSnapshot) => {
      snapRef.current = m;
    });
    room.onMessage(FDServer.over, (m: FDOver) => {
      const place = (m.places.find(([id]) => id === youRef.current) ?? [0, 4])[1];
      setResult({ won: m.winner !== "" && place === 1, place });
      setNet("over");
    });
    room.onLeave(() => {
      if (netRef.current !== "over") setError("Disconnected.");
    });
  }

  async function create(): Promise<void> {
    setError(null);
    setNet("connecting");
    try {
      wire(await new Client(SERVER_URL).create("floordrop", { maxPlayers }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create room");
      setNet("connect");
    }
  }
  async function join(): Promise<void> {
    setError(null);
    setNet("connecting");
    try {
      wire(await new Client(SERVER_URL).joinById(code.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join room");
      setNet("connect");
    }
  }

  function leave(): void {
    roomRef.current?.leave();
    roomRef.current = null;
    onLeave();
  }

  // input + render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene3d = createFloorDropScene(canvas, GRID, { fallTime: FALL_TIME });
    const tilesNum = new Array<number>(GRID * GRID).fill(0);

    function sendInput(): void {
      const k = keysRef.current;
      const dx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      const dy = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
      if (dx !== sentRef.current.dx || dy !== sentRef.current.dy) {
        sentRef.current = { dx, dy };
        roomRef.current?.send(FDClient.input, { dx, dy });
      }
    }
    const down = (e: KeyboardEvent): void => {
      if (netRef.current !== "playing") return;
      const key = e.key.toLowerCase();
      keysRef.current.add(key);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) e.preventDefault();
      sendInput();
    };
    const up = (e: KeyboardEvent): void => {
      keysRef.current.delete(e.key.toLowerCase());
      sendInput();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    let raf = 0;
    let last = performance.now();
    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(frame);
    }

    function draw(dt: number): void {
      const snap = snapRef.current;
      if (!snap || (netRef.current !== "playing" && netRef.current !== "over")) {
        // no snapshot yet (connecting/lobby) — render a solid platform as a backdrop
        tilesNum.fill(0);
        scene3d.draw({ tiles: tilesNum, drop: tileAnimRef.current, time: 0, shake: 0, fighters: [] }, dt);
        return;
      }

      // tile drop animations (start when a tile first reads '2'); convert chars → 0/1/2
      const anims = tileAnimRef.current;
      const prev = prevTilesRef.current;
      for (let i = 0; i < snap.tiles.length; i++) {
        if (snap.tiles[i] === "2" && prev[i] !== "2") anims[i] = DROP_ANIM;
        if (anims[i]! > 0) anims[i]! -= dt;
        tilesNum[i] = snap.tiles.charCodeAt(i) - 48;
      }
      prevTilesRef.current = snap.tiles;

      // fighters — the scene smooths positions; we only track the local fall timer
      const seen = new Set<number>();
      const fighters: FDSceneFighter[] = [];
      for (const p of snap.players) {
        seen.add(p.id);
        const falling = p.s === 1;
        let fallT = fallRef.current.get(p.id) ?? 0;
        fallT = falling ? fallT + dt : 0;
        fallRef.current.set(p.id, fallT);
        if (p.s === 2) continue; // gone — omit so the scene retires the puppet
        fighters.push({ id: p.id, av: avatarsRef.current.get(p.id) ?? AVATARS[0]!, x: p.x, y: p.y, falling, fallT, isYou: p.id === youRef.current });
      }
      for (const id of [...fallRef.current.keys()]) if (!seen.has(id)) fallRef.current.delete(id);

      scene3d.draw({ tiles: tilesNum, drop: anims, time: snap.time, shake: 0, fighters }, dt);
      if (aliveRef.current) aliveRef.current.textContent = `Alive: ${snap.alive}`;
      if (timeRef.current) timeRef.current.textContent = `${Math.floor(snap.time)}s`;
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      scene3d.dispose();
    };
  }, []);

  useEffect(() => () => void roomRef.current?.leave(), []);

  return (
    <main style={{ minHeight: "100vh", padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Floor Drop — Online PvP (beta)</h1>
        <button onClick={leave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 640, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={820} height={560} style={{ width: "100%", aspectRatio: "820 / 560", background: "#0a0e15", borderRadius: 8, display: "block" }} />

        {(net === "playing" || net === "over") && (
          <>
            <div ref={aliveRef} style={{ position: "absolute", top: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Alive: 0</div>
            <div ref={timeRef} style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: 15, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>0s</div>
            <div style={{ position: "absolute", top: 14, right: 16, color: "rgba(255,255,255,0.6)", fontSize: 12, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>WASD / arrows — or drag on a phone</div>
          </>
        )}

        {net === "playing" && (
          <TouchStick
            onChange={(dx, dy) => {
              sentRef.current = { dx, dy };
              roomRef.current?.send(FDClient.input, { dx, dy });
            }}
          />
        )}

        {net !== "playing" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(8,10,14,0.8)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            {net === "connect" && (
              <>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Real-time floor survival vs friends</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                  Players
                  <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} style={{ padding: 6 }}>
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button className="primary" onClick={create}>
                    Create room
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="room code" style={{ padding: 8, width: 160 }} />
                  <button onClick={join} disabled={!code.trim()}>
                    Join
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", maxWidth: 380 }}>Empty seats are filled with bots, so you can test solo. Server: {SERVER_URL}</div>
                {error && <div style={{ color: "var(--bad, #d64545)" }}>{error}</div>}
              </>
            )}
            {net === "connecting" && <div style={{ fontSize: 18 }}>Connecting…</div>}
            {net === "lobby" && lobby && (
              <>
                <div style={{ fontSize: 22, fontWeight: 800 }}>
                  {lobby.joined} / {lobby.capacity} joined
                </div>
                {roomId && (
                  <div style={{ fontSize: 14 }}>
                    Share code: <strong style={{ fontFamily: "monospace", fontSize: 16 }}>{roomId}</strong>
                  </div>
                )}
                {lobby.host ? (
                  <button className="primary" onClick={() => roomRef.current?.send(FDClient.begin, {})}>
                    Start ({lobby.joined} in · rest are bots)
                  </button>
                ) : (
                  <span style={{ color: "var(--muted)" }}>Waiting for the host…</span>
                )}
              </>
            )}
            {net === "over" && result && (
              <>
                <div style={{ fontSize: 30, fontWeight: 900, color: result.won ? "#4ac36b" : "#d64545" }}>{result.won ? "You survived — you win!" : `You dropped — #${result.place}`}</div>
                <button className="primary" onClick={leave}>
                  Back to menu
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
