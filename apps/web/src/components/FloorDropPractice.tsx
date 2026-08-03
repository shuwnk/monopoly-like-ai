import { useEffect, useRef, useState } from "react";
import type { MinigameResult } from "@party-monopoly/types";
import { avatarRoster, type Avatar } from "../game/avatars.js";
import { useProfile } from "../store/profile.js";
import { createFloorDropScene, type FDSceneFighter } from "../three/floorDropScene.js";
import { partyResult, type PartyProps } from "../game/partyRound.js";

// "Floor Drop" — a dodge-the-collapsing-floor survival minigame (Fall Guys
// hex-a-gone style), pure client / standalone. Random tiles crack, flash, then
// fall away on their own — faster and faster. No breaking: just keep moving to
// safe ground. Last one standing wins. WASD / arrows to move.

const GRID = 15;
const MOVE_SPEED = 4.7; // tiles / second
const SPRINT_MULT = 1.65; // Shift sprint multiplier
const STAMINA_MAX = 2; // seconds of sprint; recovers fully in 3s when not sprinting
const JUMP_TIME = 0.5; // airborne duration
const JUMP_SPEED = 6.2; // tiles/sec while jumping (~3 tiles of leap — reliably clears a 1-tile gap from anywhere)
const JUMP_H = 1.5; // visual hop height (world units)
const WARN_TIME = 1.3; // seconds a tile flashes before it drops
const DROP_ANIM = 0.35; // sink animation length
const FALL_TIME = 0.6;
const HAZ_INTERVAL = 4.5; // seconds between falling-box waves (ramps up)
const HAZ_WARN = 0.95; // telegraph time before it drops
const HAZ_FALL = 0.52; // drop duration (a bit slower)
const HAZ_SIZE = 0.7; // footprint half-extent in tiles (small ~1.5-tile stones)
const HAZ_H = 15; // spawn height (world units)

type St = 0 | 1 | 2; // 0 solid · 1 warning · 2 hole (gone/dropping)

interface Fighter {
  av: Avatar;
  x: number;
  y: number;
  color: string;
  name: string;
  isBot: boolean;
  state: "alive" | "falling" | "gone";
  fallT: number;
  place: number;
  jumpT: number; // >0 while airborne (crosses holes, won't fall)
  jumpDX: number;
  jumpDY: number;
  lastDX: number; // last non-zero move dir (so a standing jump still goes somewhere)
  lastDY: number;
  stamina: number; // sprint reserve
}
interface Hazard {
  cx: number; // grid centre
  cy: number;
  phase: "warn" | "fall";
  warnT: number;
  fallT: number;
}
interface World {
  st: St[];
  wt: number[]; // warning time remaining
  dt: number[]; // drop-animation remaining (>0 while sinking)
  fighters: Fighter[];
  hazards: Hazard[];
  hazTimer: number;
  time: number;
  spawnTimer: number;
  shake: number;
  over: boolean;
  nextPlace: number; // descending finishing place assigned as fighters drop out
}

const COLORS = ["#ffd23f", "#ff5c5c", "#5cc8ff", "#a6ff5c"];
const NAMES = ["You", "Bot α", "Bot β", "Bot γ"];
const SPAWNS: Array<[number, number]> = [
  [2.5, 2.5],
  [GRID - 2.5, 2.5],
  [2.5, GRID - 2.5],
  [GRID - 2.5, GRID - 2.5],
];
const CENTER = GRID / 2;
const idx = (c: number, r: number): number => r * GRID + c;
const inGrid = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < GRID && r < GRID;

// spawn cadence ramps up over time so the match always resolves
const spawnInterval = (elapsed: number): number => Math.max(0.28, 0.85 - elapsed * 0.011);

// ── audio ────────────────────────────────────────────────────────────────────
interface Sfx {
  resume(): void;
  warn(): void;
  collapse(): void;
  fall(): void;
  win(): void;
  lose(): void;
}
function makeSfx(): Sfx {
  const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctor();
  const master = ac.createGain();
  master.gain.value = 0.32;
  master.connect(ac.destination);
  const tone = (f: number, dur: number, type: OscillatorType, gain: number, sweep?: number): void => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, ac.currentTime);
    if (sweep !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), ac.currentTime + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ac.currentTime + dur);
  };
  const noise = (dur: number, gain: number, cut: number): void => {
    const n = ac.createBufferSource();
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cut;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
    n.connect(f);
    f.connect(g);
    g.connect(master);
    n.start();
    n.stop(ac.currentTime + dur);
  };
  return {
    resume: () => void ac.resume(),
    warn: () => tone(880, 0.05, "square", 0.06, 920),
    collapse: () => noise(0.2, 0.4, 1100),
    fall: () => tone(500, 0.5, "sawtooth", 0.3, 90),
    win: () => {
      tone(520, 0.15, "square", 0.25, 780);
      tone(780, 0.2, "square", 0.2, 1040);
    },
    lose: () => tone(300, 0.4, "sawtooth", 0.25, 90),
  };
}

export function FloorDropPractice({ onLeave, party }: { onLeave: () => void; party?: PartyProps }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // party rounds auto-start (no ready screen) and skip coins/replay — see the party branches below
  const [phase, setPhase] = useState<"ready" | "playing" | "over">(party ? "playing" : "ready");
  const [result, setResult] = useState<{ won: boolean; place: number; coins: number } | null>(null);
  const partyResultRef = useRef<MinigameResult | null>(null); // the ranking to hand back when the player continues
  const N = party ? party.seats.length : NAMES.length; // fighters this match (== seated board players)
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const world = useRef<World | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const aliveRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);
  const staminaRef = useRef<HTMLDivElement | null>(null);

  function newWorld(): void {
    const roster = avatarRoster(useProfile.getState().avatar, N);
    // party mode seats the board players (fighter 0 = the keyboard human); otherwise the
    // standalone roster of You + bots
    const names = party ? party.seats.map((s) => s.name) : NAMES;
    world.current = {
      st: new Array<St>(GRID * GRID).fill(0),
      wt: new Array<number>(GRID * GRID).fill(0),
      dt: new Array<number>(GRID * GRID).fill(0),
      fighters: Array.from({ length: N }, (_, i) => ({
        av: roster[i]!,
        x: SPAWNS[i]![0],
        y: SPAWNS[i]![1],
        color: COLORS[i % COLORS.length]!,
        name: names[i] ?? `Bot ${i}`,
        isBot: i > 0, // fighter 0 is the human (their keyboard); the rest are bots
        state: "alive",
        fallT: 0,
        place: 0,
        jumpT: 0,
        jumpDX: 0,
        jumpDY: 0,
        lastDX: 0,
        lastDY: 1,
        stamina: STAMINA_MAX,
      })),
      hazards: [],
      hazTimer: 4,
      time: 0,
      spawnTimer: 1.5,
      shake: 0,
      over: false,
      nextPlace: N,
    };
  }

  useEffect(() => {
    newWorld();
    if (party) {
      // auto-started: bring up sfx now since there's no Start click to do it
      if (!sfxRef.current) sfxRef.current = makeSfx();
      sfxRef.current.resume();
    }
    const canvas = canvasRef.current!;
    const scene3d = createFloorDropScene(canvas, GRID, { fallTime: FALL_TIME });

    const keys = new Set<string>();
    let raf = 0;
    let last = performance.now();
    const aliveCount = (): number => world.current!.fighters.filter((f) => f.state === "alive").length;

    function dropFighter(f: Fighter): void {
      if (f.state !== "alive") return;
      f.state = "falling";
      f.fallT = 0;
      f.place = world.current!.nextPlace--; // Nth out gets the Nth-from-last place
      if (!f.isBot) sfxRef.current?.fall();
    }

    // blockHoles=true keeps bots off collapsed tiles; the player passes false so they
    // CAN walk into a hole (and fall) — jumping is how you cross gaps
    function move(f: Fighter, dx: number, dy: number, dt: number, speed: number, blockHoles: boolean): void {
      const sp = speed * dt;
      const rad = 0.34;
      const okTile = (x: number, y: number): boolean => {
        const c = Math.floor(x);
        const r = Math.floor(y);
        if (!inGrid(c, r)) return false; // never leave the board
        return !blockHoles || (world.current!.st[idx(c, r)] ?? 2) !== 2;
      };
      const nx = f.x + dx * sp;
      if (okTile(nx + Math.sign(dx) * rad, f.y)) f.x = nx;
      const ny = f.y + dy * sp;
      if (okTile(f.x, ny + Math.sign(dy) * rad)) f.y = ny;
    }

    function update(dt: number): void {
      const w = world.current!;
      if (w.over || phaseRef.current !== "playing") return;
      w.time += dt;
      w.shake = Math.max(0, w.shake - dt);

      // spawn a new warning wave — mostly a scatter of 1-3, sometimes a full line
      w.spawnTimer -= dt;
      if (w.spawnTimer <= 0) {
        w.spawnTimer = spawnInterval(w.time);
        let any = false;
        const warnAt = (i: number): void => {
          if (w.st[i] === 0) {
            w.st[i] = 1;
            w.wt[i] = WARN_TIME;
            any = true;
          }
        };
        const rowChance = Math.min(0.34, 0.12 + w.time * 0.004); // lines get likelier as it heats up
        if (Math.random() < rowChance) {
          if (Math.random() < 0.5) {
            const r = Math.floor(Math.random() * GRID);
            for (let c = 0; c < GRID; c++) warnAt(idx(c, r)); // whole row
          } else {
            const c = Math.floor(Math.random() * GRID);
            for (let r = 0; r < GRID; r++) warnAt(idx(c, r)); // whole column
          }
        } else {
          const solid: number[] = [];
          for (let i = 0; i < w.st.length; i++) if (w.st[i] === 0) solid.push(i);
          const n = Math.min(1 + Math.floor(Math.random() * 3) + Math.floor(w.time / 25), solid.length); // 1-3 (+ a touch late)
          for (let k = 0; k < n; k++) warnAt(solid.splice(Math.floor(Math.random() * solid.length), 1)[0]!);
        }
        if (any) sfxRef.current?.warn();
      }

      // advance warnings → collapses
      let collapsedAny = false;
      for (let i = 0; i < w.st.length; i++) {
        if (w.st[i] === 1) {
          w.wt[i]! -= dt;
          if (w.wt[i]! <= 0) {
            w.st[i] = 2;
            w.dt[i] = DROP_ANIM;
            collapsedAny = true;
            const c = i % GRID;
            const r = Math.floor(i / GRID);
            for (const f of w.fighters) if (f.state === "alive" && Math.floor(f.x) === c && Math.floor(f.y) === r) dropFighter(f);
          }
        } else if (w.st[i] === 2 && w.dt[i]! > 0) {
          w.dt[i]! -= dt;
        }
      }
      if (collapsedAny) {
        sfxRef.current?.collapse();
        w.shake = 0.14;
      }

      // falling boxes/stones — telegraphed, then crush anyone in the ~4×4 footprint
      w.hazTimer -= dt;
      if (w.hazTimer <= 0) {
        w.hazTimer = Math.max(2.2, HAZ_INTERVAL - w.time * 0.03);
        const n = 2 + Math.floor(Math.random() * 2); // a couple at a time
        for (let k = 0; k < n; k++) w.hazards.push({ cx: HAZ_SIZE + Math.random() * (GRID - HAZ_SIZE * 2), cy: HAZ_SIZE + Math.random() * (GRID - HAZ_SIZE * 2), phase: "warn", warnT: HAZ_WARN * (0.85 + Math.random() * 0.35), fallT: HAZ_FALL });
        sfxRef.current?.warn();
      }
      for (const h of w.hazards) {
        if (h.phase === "warn") {
          h.warnT -= dt;
          if (h.warnT <= 0) h.phase = "fall";
        } else {
          h.fallT -= dt;
          if (h.fallT <= 0) {
            for (const f of w.fighters) if (f.state === "alive" && Math.abs(f.x - h.cx) <= HAZ_SIZE && Math.abs(f.y - h.cy) <= HAZ_SIZE) dropFighter(f);
            w.shake = 0.24;
            sfxRef.current?.collapse();
          }
        }
      }
      w.hazards = w.hazards.filter((h) => !(h.phase === "fall" && h.fallT <= 0));

      for (const f of w.fighters) {
        if (f.state === "falling") {
          f.fallT += dt;
          if (f.fallT >= FALL_TIME) f.state = "gone";
          continue;
        }
        if (f.state === "gone") continue;
        // fall only when grounded on a hole — airborne (jumping) clears gaps
        if (f.jumpT <= 0 && (w.st[idx(Math.floor(f.x), Math.floor(f.y))] ?? 2) === 2) {
          dropFighter(f);
          continue;
        }
        if (!f.isBot) {
          const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
          const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
          if (dx || dy) {
            f.lastDX = dx;
            f.lastDY = dy;
          }
          if (f.jumpT > 0) {
            f.jumpT -= dt;
            move(f, f.jumpDX, f.jumpDY, dt, JUMP_SPEED, false); // airborne — no hole block
          } else if (keys.has(" ")) {
            f.jumpT = JUMP_TIME; // leap the way you're moving, or the way you last moved
            const jx = dx || f.lastDX;
            const jy = dy || f.lastDY;
            const l = Math.hypot(jx, jy) || 1;
            f.jumpDX = jx / l;
            f.jumpDY = jy / l;
            sfxRef.current?.warn();
          } else {
            const sprint = keys.has("shift") && (dx !== 0 || dy !== 0) && f.stamina > 0;
            f.stamina = sprint ? Math.max(0, f.stamina - dt) : Math.min(STAMINA_MAX, f.stamina + dt * (STAMINA_MAX / 3));
            if (dx || dy) move(f, dx, dy, dt, sprint ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED, false);
          }
        } else {
          botThink(f, w, dt);
        }
      }

      if (aliveCount() <= 1) endMatch();
    }

    // move toward the safest reachable tile (solid, central, open); flee warnings
    function botThink(b: Fighter, w: World, dt: number): void {
      const bc = Math.floor(b.x);
      const br = Math.floor(b.y);
      const openness = (c: number, r: number): number => {
        let n = 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (inGrid(c + dc, r + dr) && (w.st[idx(c + dc, r + dr)] ?? 2) !== 2) n++;
        return n;
      };
      const score = (c: number, r: number, isSelf: boolean): number => {
        if (!inGrid(c, r)) return -Infinity;
        const s = w.st[idx(c, r)] ?? 2;
        if (s === 2) return -Infinity;
        if (s === 1) {
          if (isSelf) return -50 + (w.wt[idx(c, r)] ?? 0) * 10; // sitting on a warning is bad
          if ((w.wt[idx(c, r)] ?? 0) < 0.6) return -Infinity; // don't step onto an imminent drop
        }
        return -Math.hypot(c - CENTER, r - CENTER) + openness(c, r) * 0.8 + (s === 0 ? 3 : 0) + Math.random() * 0.6;
      };
      let best: [number, number] = [bc, br];
      let bestScore = score(bc, br, true);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const sc = score(bc + dc, br + dr, false);
        if (sc > bestScore) {
          bestScore = sc;
          best = [bc + dc, br + dr];
        }
      }
      let mvx = (best[0] === bc && best[1] === br ? CENTER : best[0] + 0.5) - b.x;
      let mvy = (best[0] === bc && best[1] === br ? CENTER : best[1] + 0.5) - b.y;
      // flee any telegraphed falling box whose footprint we're standing in
      for (const h of w.hazards) if (h.phase === "warn" && Math.abs(b.x - h.cx) < HAZ_SIZE + 1 && Math.abs(b.y - h.cy) < HAZ_SIZE + 1) {
        mvx += (b.x - h.cx) * 1.5;
        mvy += (b.y - h.cy) * 1.5;
      }
      move(b, Math.sign(mvx), Math.sign(mvy), dt, MOVE_SPEED, true); // bots avoid holes + boxes
    }

    function endMatch(): void {
      const w = world.current!;
      if (w.over) return;
      w.over = true;
      const survivor = w.fighters.find((f) => f.state === "alive");
      if (survivor) survivor.place = 1; // sole survivor takes 1st (counter is at 1 here)
      const me = w.fighters[0]!;
      const place = me.place || 1;
      const won = place === 1;
      if (party) {
        // board round: report placement to the engine (it pays out), no profile coins
        partyResultRef.current = partyResult(party.minigameId, party.seats, w.fighters.map((f) => f.place || 1));
        setResult({ won, place, coins: 0 });
      } else {
        const coins = Math.round(15 + (85 * (N - place)) / (N - 1));
        useProfile.getState().award(coins);
        setResult({ won, place, coins });
      }
      setPhase("over");
      if (won) sfxRef.current?.win();
      else sfxRef.current?.lose();
    }

    const down = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    };
    const uph = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", uph);

    function loop(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      const w = world.current!;
      const fighters: FDSceneFighter[] = [];
      for (let i = 0; i < w.fighters.length; i++) {
        const f = w.fighters[i]!;
        if (f.state === "gone") continue;
        const air = f.jumpT > 0 ? Math.sin((1 - f.jumpT / JUMP_TIME) * Math.PI) * JUMP_H : 0;
        fighters.push({ id: i, av: f.av, x: f.x, y: f.y, falling: f.state === "falling", fallT: f.fallT, isYou: !f.isBot, air });
      }
      const hazards = w.hazards.map((h) => ({ x: h.cx, y: h.cy, size: HAZ_SIZE, warning: h.phase === "warn", h: h.phase === "fall" ? (h.fallT / HAZ_FALL) * HAZ_H : HAZ_H }));
      scene3d.draw({ tiles: w.st, drop: w.dt, time: w.time, shake: w.shake, fighters, hazards }, dt);
      if (aliveRef.current) aliveRef.current.textContent = `Alive: ${aliveCount()}`;
      if (timeRef.current) timeRef.current.textContent = `${Math.floor(w.time)}s survived`;
      if (staminaRef.current) staminaRef.current.style.width = `${(w.fighters[0]!.stamina / STAMINA_MAX) * 100}%`;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", uph);
      scene3d.dispose();
    };
  }, []);

  function start(): void {
    newWorld();
    setResult(null);
    setPhase("playing");
    if (!sfxRef.current) sfxRef.current = makeSfx();
    sfxRef.current.resume();
  }

  return (
    <main style={{ minHeight: "100vh", padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Party Monopoly — Floor Drop (prototype)</h1>
        <button onClick={onLeave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 820, margin: "0 auto" }}>
        <canvas
          ref={canvasRef}
          width={820}
          height={560}
          style={{ width: "100%", aspectRatio: "820 / 560", background: "#0a0e15", borderRadius: 8, display: "block" }}
        />

        {phase === "playing" && (
          <>
            <div ref={aliveRef} style={{ position: "absolute", top: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Alive: 4</div>
            <div ref={timeRef} style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: 15, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>0s survived</div>
            <div style={{ position: "absolute", top: 14, right: 16, color: "rgba(255,255,255,0.6)", fontSize: 12, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>WASD move · Space jump · Shift sprint</div>
            <div style={{ position: "absolute", bottom: 14, left: 16, width: 160, pointerEvents: "none" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", textShadow: "0 1px 3px #000", marginBottom: 2 }}>Sprint</div>
              <div style={{ width: "100%", height: 8, background: "rgba(0,0,0,0.5)", borderRadius: 4, overflow: "hidden" }}>
                <div ref={staminaRef} style={{ width: "100%", height: "100%", background: "linear-gradient(90deg,#5cc8ff,#8affc0)" }} />
              </div>
            </div>
          </>
        )}

        {phase !== "playing" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              background: "rgba(8,10,14,0.75)",
              borderRadius: 8,
              textAlign: "center",
              padding: 24,
            }}
          >
            {phase === "over" && result && (
              <div style={{ fontSize: 30, fontWeight: 900, color: result.won ? "#4ac36b" : "#d64545" }}>
                {result.won ? "Last one standing — you win!" : `You dropped — placed #${result.place} of ${N}`}
                {party ? (
                  <div style={{ fontSize: 16, color: "#ffd23f", marginTop: 4 }}>Placement decides your R$ payout</div>
                ) : (
                  <div style={{ fontSize: 18, color: "#ffd23f", marginTop: 4 }}>🪙 +{result.coins} coins</div>
                )}
              </div>
            )}
            <div style={{ fontSize: 15, opacity: 0.85, maxWidth: 460, lineHeight: 1.5 }}>
              <strong>WASD</strong> move · <strong>Space</strong> jump across gaps · <strong>Shift</strong> sprint (recovers in 3s). Tiles flash{" "}
              <span style={{ color: "#e0524a" }}>red</span> before they fall away, and <strong style={{ color: "#ff6a6a" }}>boxes crash down</strong> where the red square flashes — dodge them! Don't walk into a hole. Last one standing wins.
            </div>
            {party ? (
              <button className="primary" style={{ fontSize: 18, padding: "10px 26px" }} onClick={() => party.onResult(partyResultRef.current!)} disabled={phase !== "over"}>
                Continue →
              </button>
            ) : (
              <button className="primary" style={{ fontSize: 18, padding: "10px 26px" }} onClick={start}>
                {phase === "over" ? "Play again" : "Start"}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
