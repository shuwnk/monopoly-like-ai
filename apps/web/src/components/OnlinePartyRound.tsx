import { useEffect, useRef } from "react";
import { FD_GRID } from "@party-monopoly/types";
import { AVATARS, resolveLook, type Avatar } from "../game/avatars.js";
import { useOnlineStore } from "../store/onlineStore.js";
import { createFloorDropScene, type FDSceneFighter } from "../three/floorDropScene.js";
import { TouchStick } from "./TouchStick.js";

// The online party round: a dumb renderer of the server's authoritative Floor Drop sim,
// embedded in the board flow (uses the existing room via the store — no own connection).
// Snapshots stream into `partySnap.current` at 20Hz; this reads them each frame and sends
// only the local movement vector. Mirrors OnlineFloorDrop, minus the lobby/connection UI.
const GRID = FD_GRID;
const DROP_ANIM = 0.35;
const FALL_TIME = 0.6;

export function OnlinePartyRound(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const aliveRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);
  const party = useOnlineStore((s) => s.party);
  const partyOver = useOnlineStore((s) => s.partyOver);
  const you = party?.you ?? -1;

  useEffect(() => {
    if (!party) return;
    const canvas = canvasRef.current!;
    const scene3d = createFloorDropScene(canvas, GRID, { fallTime: FALL_TIME });
    const { partySnap, sendPartyInput } = useOnlineStore.getState();

    // Every fighter is drawn from the look the SERVER sent for them, so all
    // clients render the same character for the same player. (This used to be
    // derived from the local profile, which meant two people saw different
    // avatars for each other.) Bots have no look, so they fall back by slot.
    const avatars = new Map<number, Avatar>();
    party.roster.forEach((p, i) => avatars.set(p.id, p.look ? resolveLook(p.look) : AVATARS[i % AVATARS.length]!));

    const keys = new Set<string>();
    const sent = { dx: 0, dy: 0 };
    const fall = new Map<number, number>(); // local fall timer per fighter
    const tileAnim = new Array<number>(GRID * GRID).fill(0);
    const tilesNum = new Array<number>(GRID * GRID).fill(0);
    let prevTiles = "";

    function sendInput(): void {
      const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
      const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
      if (dx !== sent.dx || dy !== sent.dy) {
        sent.dx = dx;
        sent.dy = dy;
        sendPartyInput(dx, dy);
      }
    }
    const down = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      keys.add(key);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) e.preventDefault();
      sendInput();
    };
    const up = (e: KeyboardEvent): void => {
      keys.delete(e.key.toLowerCase());
      sendInput();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    let raf = 0;
    let last = performance.now();
    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const snap = partySnap.current;
      if (!snap) {
        tilesNum.fill(0);
        scene3d.draw({ tiles: tilesNum, drop: tileAnim, time: 0, shake: 0, fighters: [] }, dt);
        raf = requestAnimationFrame(frame);
        return;
      }
      // tile drop anims (kick in when a tile first reads '2'); chars → 0/1/2
      for (let i = 0; i < snap.tiles.length; i++) {
        if (snap.tiles[i] === "2" && prevTiles[i] !== "2") tileAnim[i] = DROP_ANIM;
        if (tileAnim[i]! > 0) tileAnim[i]! -= dt;
        tilesNum[i] = snap.tiles.charCodeAt(i) - 48;
      }
      prevTiles = snap.tiles;

      const seen = new Set<number>();
      const fighters: FDSceneFighter[] = [];
      for (const p of snap.players) {
        seen.add(p.id);
        const falling = p.s === 1;
        const t = falling ? (fall.get(p.id) ?? 0) + dt : 0;
        fall.set(p.id, t);
        if (p.s === 2) continue; // gone — omit so the scene retires the puppet
        fighters.push({ id: p.id, av: avatars.get(p.id) ?? AVATARS[0]!, x: p.x, y: p.y, falling, fallT: t, isYou: p.id === party!.you });
      }
      for (const id of [...fall.keys()]) if (!seen.has(id)) fall.delete(id);

      scene3d.draw({ tiles: tilesNum, drop: tileAnim, time: snap.time, shake: 0, fighters }, dt);
      if (aliveRef.current) aliveRef.current.textContent = `Alive: ${snap.alive}`;
      if (timeRef.current) timeRef.current.textContent = `${Math.floor(snap.time)}s`;
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      scene3d.dispose();
    };
  }, [party]);

  const myPlace = partyOver ? (partyOver.places.find(([id]) => id === you) ?? [0, 0])[1] : 0;
  const won = !!partyOver && partyOver.winner !== "" && myPlace === 1;

  return (
    <main style={{ minHeight: "100vh", padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ textAlign: "center", padding: "6px 0 12px", fontWeight: 800, letterSpacing: 1, color: "var(--accent)" }}>
        🎉 PARTY ROUND — Floor Drop · last one standing takes the biggest R$ cut
      </div>
      <div style={{ position: "relative", width: "100%", maxWidth: 820, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={820} height={560} style={{ width: "100%", aspectRatio: "820 / 560", background: "#0a0e15", borderRadius: 8, display: "block" }} />
        <div ref={aliveRef} style={{ position: "absolute", top: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Alive: —</div>
        <div ref={timeRef} style={{ position: "absolute", top: 14, right: 16, color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: 15, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>0s</div>
        <div style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 12, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>WASD / arrows — or drag anywhere on a phone. Just don&apos;t fall.</div>

        {/* only live while the round is running: the placement overlay sits on top of it */}
        {!partyOver && <TouchStick onChange={(dx, dy) => useOnlineStore.getState().sendPartyInput(dx, dy)} />}

        {partyOver && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "rgba(8,10,14,0.82)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: won ? "#4ac36b" : "#d64545" }}>
              {won ? "You win the party round!" : `You placed #${myPlace}`}
            </div>
            <div style={{ fontSize: 15, opacity: 0.85 }}>Placement decides your R$ payout — back to the board…</div>
          </div>
        )}
      </div>
    </main>
  );
}
