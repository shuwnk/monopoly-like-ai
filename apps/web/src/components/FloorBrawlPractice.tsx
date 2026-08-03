import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { avatarRoster, type Avatar } from "../game/avatars.js";
import { useProfile } from "../store/profile.js";
import { createStage } from "../three/stage.js";
import { frameArena } from "../three/cameraRig.js";
import { createPuppet, type Puppet } from "../three/character.js";

// "Floor Brawl" — a chaotic break-the-floor party brawler, now in 3D (top-down toon).
// The whole simulation stays on the grid; only rendering is Three.js.
// WASD move · mouse aim · left-click break a tile · Space dash · Shift shove · Q bomb.

const GRID = 13;
const HALF = GRID / 2;
const MOVE_SPEED = 4.6;
const DASH_SPEED = 12;
const DASH_TIME = 0.16;
const DASH_CD = 1.1;
const SHOVE_CD = 0.9;
const SHOVE_RANGE = 1.7;
const SHOVE_IMPULSE = 11;
const BREAK_CD = 0.22;
const BREAK_RANGE = 2.7;
const BOMB_FUSE = 1.3;
const BOMB_CD = 0.6;
const FALL_TIME = 0.55;
const GRACE = 7;
const WARN_LEAD = 1.2;
const COLLAPSE_INTERVAL = 3.4;
const POWER_INTERVAL = 5;

type Tile = 0 | 1;
type Power = "speed" | "shield" | "bomb" | "ghost";

interface Fighter {
  av: Avatar;
  x: number;
  y: number;
  aim: number;
  vx: number;
  vy: number;
  state: "alive" | "falling" | "gone";
  fallT: number;
  place: number;
  isBot: boolean;
  name: string;
  color: string;
  breakCD: number;
  dashCD: number;
  dashT: number;
  dashX: number;
  dashY: number;
  shoveCD: number;
  bombCD: number;
  bombs: number;
  speedT: number;
  ghostT: number;
  shield: boolean;
  shovePulse: number;
  target: Fighter | null;
  retarget: number;
}
interface Bomb {
  x: number;
  y: number;
  fuse: number;
}
interface Pickup {
  x: number;
  y: number;
  kind: Power;
}
interface Fx {
  x: number;
  y: number;
  t: number;
  max: number;
  kind: "boom" | "break";
}
interface World {
  grid: Tile[];
  fighters: Fighter[];
  bombs: Bomb[];
  pickups: Pickup[];
  fx: Fx[];
  time: number;
  ringMargin: number;
  ringWarn: number;
  ringTimer: number;
  powerTimer: number;
  shake: number;
  over: boolean;
  nextPlace: number;
}

const NAMES = ["You", "Rex", "Bruiser", "Ziggy"];
const SPAWNS: Array<[number, number]> = [
  [1.5, 1.5],
  [GRID - 1.5, 1.5],
  [1.5, GRID - 1.5],
  [GRID - 1.5, GRID - 1.5],
];
const POWERS: Power[] = ["speed", "shield", "bomb", "ghost"];
const POWER_COLOR: Record<Power, string> = { speed: "#ffd23f", shield: "#5cc8ff", bomb: "#ff8a5c", ghost: "#e6e6e6" };

const idx = (c: number, r: number): number => r * GRID + c;
const inGrid = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < GRID && r < GRID;
const ringOf = (c: number, r: number): number => Math.min(c, r, GRID - 1 - c, GRID - 1 - r);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

interface Sfx {
  resume(): void;
  brk(): void;
  shove(): void;
  dash(): void;
  bomb(): void;
  power(): void;
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
    brk: () => noise(0.06, 0.35, 2600),
    shove: () => tone(360, 0.12, "sine", 0.22, 120),
    dash: () => tone(620, 0.1, "sine", 0.18, 1100),
    bomb: () => {
      noise(0.3, 0.6, 800);
      tone(90, 0.3, "sawtooth", 0.3, 40);
    },
    power: () => tone(560, 0.14, "square", 0.2, 980),
    fall: () => tone(500, 0.5, "sawtooth", 0.3, 90),
    win: () => {
      tone(520, 0.15, "square", 0.25, 780);
      tone(780, 0.2, "square", 0.2, 1040);
    },
    lose: () => tone(300, 0.4, "sawtooth", 0.25, 90),
  };
}

export function FloorBrawlPractice({ onLeave }: { onLeave: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"ready" | "playing" | "over">("ready");
  const [result, setResult] = useState<{ won: boolean; place: number; coins: number } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const world = useRef<World | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const aliveRef = useRef<HTMLDivElement | null>(null);
  const warnRef = useRef<HTMLDivElement | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);

  function newWorld(): void {
    const roster = avatarRoster(useProfile.getState().avatar, NAMES.length);
    world.current = {
      grid: new Array<Tile>(GRID * GRID).fill(1),
      fighters: NAMES.map((name, i) => ({
        av: roster[i]!,
        x: SPAWNS[i]![0],
        y: SPAWNS[i]![1],
        aim: 0,
        vx: 0,
        vy: 0,
        state: "alive",
        fallT: 0,
        place: 0,
        isBot: i > 0,
        name,
        color: roster[i]!.body,
        breakCD: 0,
        dashCD: 0,
        dashT: 0,
        dashX: 0,
        dashY: 0,
        shoveCD: 0,
        bombCD: 0,
        bombs: 1,
        speedT: 0,
        ghostT: 0,
        shield: false,
        shovePulse: 0,
        target: null,
        retarget: 0,
      })),
      bombs: [],
      pickups: [],
      fx: [],
      time: 0,
      ringMargin: 0,
      ringWarn: -1,
      ringTimer: GRACE,
      powerTimer: 2,
      shake: 0,
      over: false,
      nextPlace: NAMES.length,
    };
  }

  useEffect(() => {
    newWorld();
    const canvas = canvasRef.current!;
    const wpos = (coord: number): number => coord - HALF;
    const mouse = { x: GRID / 2, y: GRID / 2 };

    // ── 3D scene ──
    const stage = createStage(canvas, {
      width: canvas.width,
      height: canvas.height,
      background: "#0a0e15",
      fov: 46,
      fog: null,
      sun: { color: "#fff0d4", intensity: 1.35, pos: [-6, 20, 8], extent: 15 },
      hemi: { sky: "#bcd4ff", ground: "#2a3550", intensity: 0.78 },
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.12,
    });
    const { scene, camera, renderer } = stage;
    renderer.shadowMap.enabled = false;
    stage.sun.castShadow = false;
    frameArena(camera, { center: new THREE.Vector3(0, 0, 0), radius: GRID * 0.6, tiltDeg: 56, yawDeg: 8, margin: 1.04 });
    const baseCam = camera.position.clone();

    const toonRamp = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;

    // abyss below the floor so holes read as a drop
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(GRID * 3, GRID * 3), new THREE.MeshBasicMaterial({ color: "#05070c" }));
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.y = -4;
    scene.add(abyss);

    const TOP_A = new THREE.Color("#4a86df");
    const TOP_B = new THREE.Color("#3f74c8");
    const WARN = new THREE.Color("#e0524a");
    const cBlack = new THREE.Color("#000000");
    // one mesh per tile, individual material so ring-warn tiles can flash
    const tileGeo = new THREE.BoxGeometry(0.94, 0.5, 0.94);
    interface T { mesh: THREE.Mesh; mat: THREE.MeshToonMaterial; checker: boolean; }
    const tiles: T[] = [];
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++) {
        const checker = (c + r) % 2 === 0;
        const mat = new THREE.MeshToonMaterial({ color: checker ? TOP_A : TOP_B, gradientMap: toonRamp });
        const mesh = new THREE.Mesh(tileGeo, mat);
        mesh.position.set(wpos(c + 0.5), -0.25, wpos(r + 0.5));
        scene.add(mesh);
        tiles.push({ mesh, mat, checker });
      }

    // cursor highlight (the tile you'd break)
    const cursor = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 0.98), new THREE.MeshBasicMaterial({ color: "#ff5050", transparent: true, opacity: 0.55, depthWrite: false }));
    cursor.position.y = 0.06;
    scene.add(cursor);

    const bombPool = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshToonMaterial({ color: "#15181f", gradientMap: toonRamp }));
      m.visible = false;
      scene.add(m);
      return m;
    });
    const pickupPool = Array.from({ length: 8 }, () => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#000", emissiveIntensity: 0.5, flatShading: true }));
      m.visible = false;
      scene.add(m);
      return m;
    });
    const ringGeo = new THREE.RingGeometry(0.55, 0.8, 20);
    const fxPool = Array.from({ length: 16 }, () => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      return m;
    });

    // puppets + per-fighter shield ring & shove ring
    const roster = avatarRoster(useProfile.getState().avatar, NAMES.length);
    interface Pup { puppet: Puppet; lx: number; lz: number; shield: THREE.Mesh; shove: THREE.Mesh; }
    const pups: Pup[] = roster.map((av, i) => {
      const puppet = createPuppet(scene, av, { toon: true, outline: i === 0 ? "#ffd23f" : "#141428" });
      puppet.group.scale.setScalar(0.85);
      const shield = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 20), new THREE.MeshBasicMaterial({ color: "#5cc8ff" }));
      shield.rotation.x = -Math.PI / 2;
      shield.position.y = 0.1;
      shield.visible = false;
      puppet.group.add(shield);
      const shove = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 20), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      shove.rotation.x = -Math.PI / 2;
      shove.position.y = 0.08;
      shove.visible = false;
      scene.add(shove);
      return { puppet, lx: 0, lz: 0, shield, shove };
    });

    const keys = new Set<string>();
    let raf = 0;
    let last = performance.now();
    const aliveCount = (): number => world.current!.fighters.filter((f) => f.state === "alive").length;
    const solidAt = (x: number, y: number): boolean => {
      const c = Math.floor(x);
      const r = Math.floor(y);
      return inGrid(c, r) && (world.current!.grid[idx(c, r)] ?? 0) === 1;
    };
    function nearestSolid(x: number, y: number): [number, number] {
      const c0 = Math.floor(x);
      const r0 = Math.floor(y);
      for (let rad = 0; rad < GRID; rad++)
        for (let dr = -rad; dr <= rad; dr++)
          for (let dc = -rad; dc <= rad; dc++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
            const c = c0 + dc;
            const r = r0 + dr;
            if (inGrid(c, r) && (world.current!.grid[idx(c, r)] ?? 0) === 1) return [c + 0.5, r + 0.5];
          }
      return [GRID / 2, GRID / 2];
    }
    function drop(f: Fighter): void {
      if (f.state !== "alive") return;
      f.state = "falling";
      f.fallT = 0;
      f.place = world.current!.nextPlace--;
      if (!f.isBot) sfxRef.current?.fall();
    }
    function fallOrShield(f: Fighter): void {
      if (f.shield) {
        f.shield = false;
        const [sx, sy] = nearestSolid(f.x, f.y);
        f.x = sx;
        f.y = sy;
        f.vx = 0;
        f.vy = 0;
        sfxRef.current?.power();
        return;
      }
      drop(f);
    }
    function playerBreakAt(f: Fighter, c: number, r: number): void {
      if (f.breakCD > 0 || !inGrid(c, r)) return;
      if (Math.hypot(c + 0.5 - f.x, r + 0.5 - f.y) > BREAK_RANGE) return;
      f.breakCD = BREAK_CD;
      breakTile(c, r);
    }
    function breakTile(c: number, r: number): void {
      const w = world.current!;
      if (!inGrid(c, r) || (w.grid[idx(c, r)] ?? 0) === 0) return;
      w.grid[idx(c, r)] = 0;
      w.fx.push({ x: c + 0.5, y: r + 0.5, t: 0.3, max: 0.3, kind: "break" });
      sfxRef.current?.brk();
      for (const o of w.fighters) if (o.state === "alive" && o.ghostT <= 0 && Math.floor(o.x) === c && Math.floor(o.y) === r) fallOrShield(o);
    }
    function doShove(f: Fighter): void {
      if (f.shoveCD > 0) return;
      f.shoveCD = SHOVE_CD;
      f.shovePulse = 0.25;
      sfxRef.current?.shove();
      const w = world.current!;
      for (const o of w.fighters) {
        if (o === f || o.state !== "alive") continue;
        const dx = o.x - f.x;
        const dy = o.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d < SHOVE_RANGE && d > 0.001) {
          o.vx += (dx / d) * SHOVE_IMPULSE;
          o.vy += (dy / d) * SHOVE_IMPULSE;
        }
      }
    }
    function doDash(f: Fighter): void {
      if (f.dashCD > 0 || f.dashT > 0) return;
      f.dashCD = DASH_CD;
      f.dashT = DASH_TIME;
      f.dashX = Math.cos(f.aim);
      f.dashY = Math.sin(f.aim);
      if (!f.isBot) sfxRef.current?.dash();
    }
    function doBomb(f: Fighter): void {
      if (f.bombCD > 0 || f.bombs <= 0) return;
      f.bombCD = BOMB_CD;
      f.bombs--;
      world.current!.bombs.push({ x: Math.floor(f.x) + 0.5, y: Math.floor(f.y) + 0.5, fuse: BOMB_FUSE });
    }
    function detonate(b: Bomb): void {
      const w = world.current!;
      const bc = Math.floor(b.x);
      const br = Math.floor(b.y);
      for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) breakTile(bc + dc, br + dr);
      w.fx.push({ x: b.x, y: b.y, t: 0.4, max: 0.4, kind: "boom" });
      w.shake = 0.22;
      sfxRef.current?.bomb();
    }
    function integrate(f: Fighter, dt: number, mvx: number, mvy: number): void {
      const speed = MOVE_SPEED * (f.speedT > 0 ? 1.5 : 1);
      if (f.dashT > 0) {
        f.dashT -= dt;
        f.x += f.dashX * DASH_SPEED * dt;
        f.y += f.dashY * DASH_SPEED * dt;
      } else {
        const len = Math.hypot(mvx, mvy) || 1;
        f.x += (mvx / len) * speed * dt * (Math.abs(mvx) + Math.abs(mvy) > 0.01 ? 1 : 0);
        f.y += (mvy / len) * speed * dt * (Math.abs(mvx) + Math.abs(mvy) > 0.01 ? 1 : 0);
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      const fr = Math.exp(-7 * dt);
      f.vx *= fr;
      f.vy *= fr;
      f.x = clamp(f.x, 0.35, GRID - 0.35);
      f.y = clamp(f.y, 0.35, GRID - 0.35);
    }

    function botThink(b: Fighter, w: World, dt: number): [number, number] {
      b.retarget -= dt;
      let t = b.target;
      if (t && t.state !== "alive") t = null;
      if (!t || b.retarget <= 0) {
        let best: Fighter | null = null;
        let bd = Infinity;
        for (const o of w.fighters) {
          if (o === b || o.state !== "alive") continue;
          const d = Math.hypot(o.x - b.x, o.y - b.y);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        t = best;
        b.target = best;
        b.retarget = 1 + Math.random() * 1.5;
      }
      const myRing = ringOf(Math.floor(b.x), Math.floor(b.y));
      let tx = t ? t.x : GRID / 2;
      let ty = t ? t.y : GRID / 2;
      if (myRing <= w.ringMargin + (w.ringWarn >= 0 ? 1 : 0)) {
        tx = GRID / 2;
        ty = GRID / 2;
      }
      b.aim = Math.atan2(ty - b.y, tx - b.x);
      for (const pk of w.pickups) if (Math.hypot(pk.x - b.x, pk.y - b.y) < 3.5) {
        tx = pk.x;
        ty = pk.y;
        break;
      }
      let mvx = Math.sign(tx - b.x);
      let mvy = Math.sign(ty - b.y);
      const probe = (dx: number, dy: number): boolean => solidAt(b.x + dx * 0.6, b.y + dy * 0.6);
      if (!(mvx === 0 && mvy === 0) && !probe(mvx, mvy)) {
        const opts: Array<[number, number]> = [[mvx, 0], [0, mvy], [mvy, mvx], [-mvy, -mvx], [-mvx, 0], [0, -mvy]];
        const ok = opts.find(([dx, dy]) => (dx || dy) && probe(dx, dy));
        if (ok) [mvx, mvy] = ok;
        else {
          mvx = 0;
          mvy = 0;
        }
      }
      if (t) {
        const d = Math.hypot(t.x - b.x, t.y - b.y);
        b.aim = Math.atan2(t.y - b.y, t.x - b.x);
        if (d < 1.5 && b.shoveCD <= 0 && Math.random() < 0.5) doShove(b);
        if (d < 1.4 && b.breakCD <= 0) {
          const oc = Math.floor(t.x);
          const or = Math.floor(t.y);
          if (Math.abs(oc - Math.floor(b.x)) + Math.abs(or - Math.floor(b.y)) <= 1) breakTile(oc, or);
        }
        if (d < 3.5 && b.bombs > 0 && b.bombCD <= 0 && Math.random() < 0.4 * dt * 60) doBomb(b);
        if (d < 3 && d > 1.6 && b.dashCD <= 0 && Math.random() < 0.02) doDash(b);
      }
      return [mvx, mvy];
    }

    function applyPower(f: Fighter, kind: Power): void {
      if (kind === "speed") f.speedT = 6;
      else if (kind === "shield") f.shield = true;
      else if (kind === "bomb") f.bombs += 2;
      else f.ghostT = 4;
    }

    function update(dt: number): void {
      const w = world.current!;
      if (w.over || phaseRef.current !== "playing") return;
      w.time += dt;
      w.shake = Math.max(0, w.shake - dt);
      w.ringTimer -= dt;
      if (w.ringWarn < 0) {
        if (w.ringTimer <= 0 && w.ringMargin < Math.floor(GRID / 2)) {
          w.ringWarn = w.ringMargin;
          w.ringTimer = WARN_LEAD;
        }
      } else if (w.ringTimer <= 0) {
        for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (ringOf(c, r) === w.ringWarn) breakTile(c, r);
        w.shake = 0.18;
        w.ringMargin = w.ringWarn + 1;
        w.ringWarn = -1;
        w.ringTimer = COLLAPSE_INTERVAL;
      }
      for (const b of w.bombs) b.fuse -= dt;
      for (const b of w.bombs.filter((b) => b.fuse <= 0)) detonate(b);
      w.bombs = w.bombs.filter((b) => b.fuse > 0);
      w.powerTimer -= dt;
      if (w.powerTimer <= 0 && w.pickups.length < 4) {
        w.powerTimer = POWER_INTERVAL;
        for (let tries = 0; tries < 20; tries++) {
          const c = 1 + Math.floor(Math.random() * (GRID - 2));
          const r = 1 + Math.floor(Math.random() * (GRID - 2));
          if ((w.grid[idx(c, r)] ?? 0) === 1) {
            w.pickups.push({ x: c + 0.5, y: r + 0.5, kind: POWERS[Math.floor(Math.random() * POWERS.length)]! });
            break;
          }
        }
      }
      for (const f of w.fx) f.t -= dt;
      w.fx = w.fx.filter((f) => f.t > 0);
      for (const f of w.fighters) {
        f.breakCD = Math.max(0, f.breakCD - dt);
        f.dashCD = Math.max(0, f.dashCD - dt);
        f.shoveCD = Math.max(0, f.shoveCD - dt);
        f.bombCD = Math.max(0, f.bombCD - dt);
        f.speedT = Math.max(0, f.speedT - dt);
        f.ghostT = Math.max(0, f.ghostT - dt);
        f.shovePulse = Math.max(0, f.shovePulse - dt);
        if (f.state === "falling") {
          f.fallT += dt;
          if (f.fallT >= FALL_TIME) f.state = "gone";
          continue;
        }
        if (f.state === "gone") continue;
        let mvx = 0;
        let mvy = 0;
        if (!f.isBot) {
          f.aim = Math.atan2(mouse.y - f.y, mouse.x - f.x);
          mvx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
          mvy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
        } else {
          [mvx, mvy] = botThink(f, w, dt);
        }
        integrate(f, dt, mvx, mvy);
        for (const pk of w.pickups) {
          if (Math.hypot(pk.x - f.x, pk.y - f.y) < 0.5) {
            applyPower(f, pk.kind);
            w.pickups = w.pickups.filter((p) => p !== pk);
            if (!f.isBot) sfxRef.current?.power();
            break;
          }
        }
        if (f.dashT <= 0 && f.ghostT <= 0 && !solidAt(f.x, f.y)) fallOrShield(f);
      }
      if (aliveCount() <= 1) endMatch();
    }

    function endMatch(): void {
      const w = world.current!;
      if (w.over) return;
      w.over = true;
      const survivor = w.fighters.find((f) => f.state === "alive");
      if (survivor) survivor.place = 1;
      const me = w.fighters[0]!;
      const place = me.place || 1;
      const won = place === 1;
      const coins = Math.round(15 + (85 * (NAMES.length - place)) / (NAMES.length - 1));
      useProfile.getState().award(coins);
      setResult({ won, place, coins });
      setPhase("over");
      if (won) sfxRef.current?.win();
      else sfxRef.current?.lose();
    }

    // input
    const down = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (["w", "a", "s", "d", " ", "shift", "q", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
      if (phaseRef.current !== "playing") return;
      const me = world.current!.fighters[0]!;
      if (me.state !== "alive") return;
      if (k === " ") doDash(me);
      else if (k === "shift") doShove(me);
      else if (k === "q") doBomb(me);
    };
    const up = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    const groundRay = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();
    const mm = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      groundRay.setFromCamera(ndc, camera);
      if (groundRay.ray.intersectPlane(groundPlane, hitPt)) {
        mouse.x = hitPt.x + HALF;
        mouse.y = hitPt.z + HALF;
      }
    };
    const md = (e: MouseEvent): void => {
      if (phaseRef.current !== "playing") return;
      e.preventDefault();
      const me = world.current!.fighters[0]!;
      if (me.state === "alive") playerBreakAt(me, Math.floor(mouse.x), Math.floor(mouse.y));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    canvas.addEventListener("mousemove", mm);
    canvas.addEventListener("mousedown", md);
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

    function sync(dt: number): void {
      const w = world.current!;
      if (w.shake > 0) {
        const a = (w.shake / 0.22) * 0.4;
        camera.position.set(baseCam.x + (Math.random() - 0.5) * a, baseCam.y, baseCam.z + (Math.random() - 0.5) * a);
      } else camera.position.copy(baseCam);

      // tiles: hide holes, flash the warning ring
      const flash = Math.floor(w.time * 9) % 2 === 0;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i]!;
        if ((w.grid[i] ?? 0) === 0) {
          t.mesh.visible = false;
          continue;
        }
        t.mesh.visible = true;
        const c = i % GRID;
        const r = (i / GRID) | 0;
        if (w.ringWarn >= 0 && ringOf(c, r) === w.ringWarn && flash) {
          t.mat.color.copy(WARN);
          t.mat.emissive.copy(WARN).multiplyScalar(0.4);
        } else {
          t.mat.color.copy(t.checker ? TOP_A : TOP_B);
          t.mat.emissive.copy(cBlack);
        }
      }

      // cursor highlight
      const me0 = w.fighters[0]!;
      const mc = Math.floor(mouse.x);
      const mr = Math.floor(mouse.y);
      if (me0.state === "alive" && inGrid(mc, mr) && (w.grid[idx(mc, mr)] ?? 0) === 1) {
        cursor.visible = true;
        cursor.position.set(wpos(mc + 0.5), 0.06, wpos(mr + 0.5));
        const reach = Math.hypot(mc + 0.5 - me0.x, mr + 0.5 - me0.y) <= BREAK_RANGE;
        (cursor.material as THREE.MeshBasicMaterial).color.set(reach ? "#ff5050" : "#8a97b0");
        (cursor.material as THREE.MeshBasicMaterial).opacity = reach ? 0.6 : 0.25;
      } else cursor.visible = false;

      // bombs
      let bn = 0;
      for (const b of w.bombs) {
        const m = bombPool[bn++];
        if (!m) break;
        m.visible = true;
        m.position.set(wpos(b.x), 0.32, wpos(b.y));
        const fast = b.fuse < 0.5;
        m.scale.setScalar(1 + (Math.floor(w.time * (fast ? 16 : 6)) % 2 === 0 ? 0.15 : 0));
      }
      for (let j = bn; j < bombPool.length; j++) bombPool[j]!.visible = false;

      // pickups
      let pn = 0;
      for (const pk of w.pickups) {
        const m = pickupPool[pn++];
        if (!m) break;
        m.visible = true;
        m.position.set(wpos(pk.x), 0.5 + Math.sin(w.time * 3 + pk.x) * 0.08, wpos(pk.y));
        m.rotation.y += dt * 2.4;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.color.set(POWER_COLOR[pk.kind]);
        mat.emissive.set(POWER_COLOR[pk.kind]);
      }
      for (let j = pn; j < pickupPool.length; j++) pickupPool[j]!.visible = false;

      // fx rings (break / boom)
      let fn = 0;
      for (const f of w.fx) {
        const m = fxPool[fn++];
        if (!m) break;
        m.visible = true;
        const a = f.t / f.max;
        m.position.set(wpos(f.x), 0.12, wpos(f.y));
        if (f.kind === "boom") {
          m.scale.setScalar((1 - a) * 3 + 0.5);
          (m.material as THREE.MeshBasicMaterial).color.set("#ff9a3c");
        } else {
          m.scale.setScalar(1.2 - a * 0.6);
          (m.material as THREE.MeshBasicMaterial).color.set("#dce6ff");
        }
        (m.material as THREE.MeshBasicMaterial).opacity = a;
      }
      for (let j = fn; j < fxPool.length; j++) fxPool[j]!.visible = false;

      // fighters
      for (let i = 0; i < pups.length; i++) {
        const pu = pups[i]!;
        const f = w.fighters[i];
        if (!f || f.state === "gone") {
          pu.puppet.group.visible = false;
          pu.shove.visible = false;
          continue;
        }
        pu.puppet.group.visible = true;
        const g = pu.puppet.group;
        const px = wpos(f.x);
        const pz = wpos(f.y);
        const moved = Math.hypot(px - pu.lx, pz - pu.lz) / Math.max(dt, 1e-4);
        pu.lx = px;
        pu.lz = pz;
        if (f.state === "falling") {
          const k = Math.max(0.02, 1 - f.fallT / FALL_TIME);
          g.position.set(px, -f.fallT * 6, pz);
          g.scale.setScalar(0.85 * k);
          g.rotation.x = f.fallT * 10;
          pu.shield.visible = false;
          pu.shove.visible = false;
        } else {
          g.position.set(px, 0, pz);
          g.rotation.x = 0;
          g.scale.setScalar(f.ghostT > 0 ? 0.7 : 0.85); // ghost reads as smaller/faded
          pu.puppet.faceYaw(Math.PI / 2 - f.aim);
          pu.puppet.animate(f.dashT > 0 ? 9 : moved > 0.3 ? 4.6 : 2, dt);
          pu.shield.visible = f.shield;
          if (f.shovePulse > 0) {
            pu.shove.visible = true;
            pu.shove.position.set(px, 0.08, pz);
            const kk = 1 - f.shovePulse / 0.25;
            pu.shove.scale.setScalar(SHOVE_RANGE * (0.4 + kk * 1.1));
            (pu.shove.material as THREE.MeshBasicMaterial).opacity = 1 - kk;
          } else pu.shove.visible = false;
        }
      }

      if (aliveRef.current) aliveRef.current.textContent = `Alive: ${aliveCount()}`;
      if (warnRef.current) warnRef.current.style.opacity = w.ringWarn >= 0 && flash ? "1" : w.ringWarn >= 0 ? "0.5" : "0";
      const me = w.fighters[0]!;
      if (infoRef.current) infoRef.current.textContent = `💣 ${me.bombs}   ${me.dashCD > 0 ? "dash…" : "dash ✓"}`;

      renderer.render(scene, camera);
    }

    function loop(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      sync(dt);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      canvas.removeEventListener("mousemove", mm);
      canvas.removeEventListener("mousedown", md);
      for (const p of pups) p.puppet.dispose();
      toonRamp.dispose();
      tileGeo.dispose();
      stage.dispose();
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
        <h1 style={{ margin: 0, fontSize: 22 }}>Floor Brawl</h1>
        <button onClick={onLeave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 780, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={780} height={620} style={{ width: "100%", aspectRatio: "780 / 620", background: "#0a0e15", borderRadius: 8, display: "block", cursor: phase === "playing" ? "crosshair" : "default" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 8, boxShadow: "inset 0 0 110px rgba(0,0,0,0.5)" }} />

        {phase === "playing" && (
          <>
            <div ref={aliveRef} style={{ position: "absolute", top: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Alive: 4</div>
            <div ref={warnRef} style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", color: "#ff6a5c", fontWeight: 900, fontSize: 16, textShadow: "0 1px 3px #000", pointerEvents: "none", opacity: 0 }}>⚠ FLOOR COLLAPSING</div>
            <div ref={infoRef} style={{ position: "absolute", top: 14, right: 16, color: "rgba(255,255,255,0.8)", fontWeight: 700, fontSize: 14, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>💣 1 dash ✓</div>
          </>
        )}

        {phase !== "playing" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(8,10,14,0.82)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            {phase === "over" && result && (
              <div style={{ fontSize: 28, fontWeight: 900, color: result.won ? "#4ac36b" : "#d64545" }}>
                {result.won ? "Last one standing — you win!" : `You fell — placed #${result.place} of 4`}
                <div style={{ fontSize: 16, color: "#ffd23f", marginTop: 2 }}>🪙 +{result.coins} coins</div>
              </div>
            )}
            <div style={{ fontSize: 14, opacity: 0.85, maxWidth: 500, lineHeight: 1.5 }}>
              <strong>WASD</strong> move · <strong>mouse</strong> aim · <strong>left-click a tile</strong> to break it (in reach) · <strong>Space</strong> dash · <strong>Shift</strong> shove · <strong>Q</strong> bomb. Holes are <span style={{ color: "#ff6a6a" }}>deadly</span> — shove/bomb rivals into the gaps! Grab power-ups. The ring closes in. Last one standing wins.
            </div>
            <button className="primary" style={{ fontSize: 18, padding: "10px 26px" }} onClick={start}>
              {phase === "over" ? "Play again" : "Start"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
