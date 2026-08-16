import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { MinigameResult } from "@party-monopoly/types";
import { avatarRoster, type Avatar, resolveLook } from "../game/avatars.js";
import { myLook, useProfile } from "../store/profile.js";
import { isGameKey, moveVector } from "../game/keybinds.js";
import { createStage } from "../three/stage.js";
import { frameArena } from "../three/cameraRig.js";
import { createPuppet, type Puppet } from "../three/character.js";
import { partyResult, type PartyProps } from "../game/partyRound.js";

// "Bomber" — a Bomberman-style maze battle, now rendered in 3D (top-down toon).
// The whole simulation stays on the grid; only the rendering is Three.js.
// WASD / arrows move · Space drop a bomb. Blow up crates for power-ups, catch
// rivals in the cross of flame, last one standing wins.

const GW = 15;
const GH = 13;
const HALFW = GW / 2;
const HALFH = GH / 2;
const FUSE = 2.4;
const FLAME = 0.5;
const DIE_TIME = 0.7;
const BASE_SPEED = 3.5; // cells / sec
const CRATE_PROB = 0.72;
const POWER_DROP = 0.38;

type Cell = 0 | 1 | 2; // 0 empty · 1 wall (indestructible) · 2 crate
type Power = "bomb" | "fire" | "speed";

interface Player {
  x: number; // continuous cell coords (centre = cell + 0.5)
  y: number;
  alive: boolean;
  dying: number;
  place: number;
  isBot: boolean;
  name: string;
  color: string;
  bombMax: number;
  range: number;
  speed: number;
  active: number;
  face: number;
  av: Avatar;
  retarget: number;
  target: Player | null;
}
interface Bomb {
  cx: number;
  cy: number;
  fuse: number;
  range: number;
  owner: Player;
  pass: Player[];
}
interface Flame {
  cx: number;
  cy: number;
  t: number;
}
interface Pickup {
  cx: number;
  cy: number;
  kind: Power;
}
interface World {
  cells: Cell[];
  players: Player[];
  bombs: Bomb[];
  flames: Flame[];
  pickups: Pickup[];
  shake: number;
  over: boolean;
  nextPlace: number;
}

const NAMES = ["You", "Rex", "Bruiser", "Ziggy"];
const CORNERS: Array<[number, number]> = [
  [1, 1],
  [GW - 2, 1],
  [1, GH - 2],
  [GW - 2, GH - 2],
];
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const POWERS: Power[] = ["bomb", "fire", "speed"];

const inGrid = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < GW && r < GH;
const ci = (c: number, r: number): number => r * GW + c;
const isWall = (c: number, r: number): boolean => c === 0 || r === 0 || c === GW - 1 || r === GH - 1 || (c % 2 === 0 && r % 2 === 0);

// ── audio ────────────────────────────────────────────────────────────────────
interface Sfx {
  resume(): void;
  place(): void;
  boom(): void;
  power(): void;
  die(): void;
  win(): void;
  lose(): void;
}
function makeSfx(): Sfx {
  const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctor();
  const master = ac.createGain();
  master.gain.value = 0.3;
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
    place: () => tone(280, 0.08, "sine", 0.14, 180),
    boom: () => {
      noise(0.35, 0.55, 900);
      tone(80, 0.32, "sawtooth", 0.3, 38);
    },
    power: () => tone(560, 0.14, "square", 0.2, 980),
    die: () => tone(300, 0.4, "sawtooth", 0.28, 70),
    win: () => {
      tone(520, 0.15, "square", 0.25, 780);
      tone(780, 0.2, "square", 0.2, 1040);
    },
    lose: () => tone(300, 0.4, "sawtooth", 0.25, 90),
  };
}

export function BombermanPractice({ onLeave, party }: { onLeave: () => void; party?: PartyProps }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // party rounds auto-start and skip coins/replay — see the party branches below
  const [phase, setPhase] = useState<"ready" | "playing" | "over">(party ? "playing" : "ready");
  const [result, setResult] = useState<{ won: boolean; place: number; coins: number } | null>(null);
  const partyResultRef = useRef<MinigameResult | null>(null);
  const N = party ? party.seats.length : NAMES.length; // fighters this match (== seated board players)
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const world = useRef<World | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const aliveRef = useRef<HTMLDivElement | null>(null);
  const powerRef = useRef<HTMLDivElement | null>(null);

  function newWorld(): void {
    const cells: Cell[] = new Array<Cell>(GW * GH).fill(0);
    const clear = new Set<number>();
    for (const [cx, cy] of CORNERS) for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (inGrid(cx + dc, cy + dr)) clear.add(ci(cx + dc, cy + dr));
    for (let r = 0; r < GH; r++)
      for (let c = 0; c < GW; c++) {
        if (isWall(c, r)) cells[ci(c, r)] = 1;
        else if (!clear.has(ci(c, r)) && Math.random() < CRATE_PROB) cells[ci(c, r)] = 2;
      }
    const roster = avatarRoster(resolveLook(myLook()), N);
    const names = party ? party.seats.map((s) => s.name) : NAMES;
    world.current = {
      cells,
      players: Array.from({ length: N }, (_, i) => ({
        av: roster[i]!,
        x: CORNERS[i]![0] + 0.5,
        y: CORNERS[i]![1] + 0.5,
        alive: true,
        dying: 0,
        place: 0,
        isBot: i > 0, // fighter 0 is the human; the rest are bots
        name: names[i] ?? `Bot ${i}`,
        color: roster[i]!.body,
        bombMax: 1,
        range: 2,
        speed: BASE_SPEED,
        active: 0,
        face: Math.PI / 2,
        retarget: 0,
        target: null,
      })),
      bombs: [],
      flames: [],
      pickups: [],
      shake: 0,
      over: false,
      nextPlace: N,
    };
  }

  useEffect(() => {
    newWorld();
    if (party) {
      if (!sfxRef.current) sfxRef.current = makeSfx();
      sfxRef.current.resume();
    }
    const canvas = canvasRef.current!;
    const wx = (cx: number): number => cx - HALFW;
    const wz = (cy: number): number => cy - HALFH;

    // ── 3D scene ──
    const stage = createStage(canvas, {
      width: canvas.width,
      height: canvas.height,
      background: "#0c1119",
      fov: 46,
      fog: null,
      sun: { color: "#fff0d4", intensity: 1.35, pos: [-6, 20, 8], extent: 16 },
      hemi: { sky: "#bcd4ff", ground: "#2a3550", intensity: 0.75 },
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.12,
    });
    const { scene, camera, renderer } = stage;
    renderer.shadowMap.enabled = false;
    stage.sun.castShadow = false;
    frameArena(camera, { center: new THREE.Vector3(0, 0, 0), radius: Math.max(GW, GH) * 0.62, tiltDeg: 58, yawDeg: 8, margin: 1.04 });
    const baseCam = camera.position.clone();

    const toonRamp = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
    const toonMat = (color: string): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp });

    // checker floor: one texel per cell
    const floorTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = GW;
      cv.height = GH;
      const g = cv.getContext("2d")!;
      for (let r = 0; r < GH; r++)
        for (let c = 0; c < GW; c++) {
          g.fillStyle = (c + r) % 2 === 0 ? "#2b3a52" : "#243146";
          g.fillRect(c, r, 1, 1);
        }
      const t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), new THREE.MeshToonMaterial({ map: floorTex, gradientMap: toonRamp }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // static indestructible walls (deterministic pattern — same every match)
    const wallMat = toonMat("#5a6474");
    const wallTop = toonMat("#6f7a8c");
    const boxGeo = new THREE.BoxGeometry(0.94, 1.05, 0.94);
    for (let r = 0; r < GH; r++)
      for (let c = 0; c < GW; c++)
        if (isWall(c, r)) {
          const m = new THREE.Mesh(boxGeo, wallMat);
          m.position.set(wx(c + 0.5), 0.52, wz(r + 0.5));
          scene.add(m);
          const top = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.12, 0.98), wallTop);
          top.position.set(wx(c + 0.5), 1.06, wz(r + 0.5));
          scene.add(top);
        }

    // pools
    const crateMat = toonMat("#b07a42");
    const crateGeo = new THREE.BoxGeometry(0.86, 0.86, 0.86);
    const cratePool = Array.from({ length: 130 }, () => {
      const m = new THREE.Mesh(crateGeo, crateMat);
      m.position.y = 0.43;
      m.visible = false;
      scene.add(m);
      return m;
    });
    const bombGeo = new THREE.SphereGeometry(0.34, 12, 10);
    const bombPool = Array.from({ length: 16 }, () => {
      const m = new THREE.Mesh(bombGeo, toonMat("#15181f"));
      m.visible = false;
      scene.add(m);
      return m;
    });
    const flameGeo = new THREE.BoxGeometry(0.9, 0.7, 0.9);
    const flamePool = Array.from({ length: 90 }, () => {
      const m = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      return m;
    });
    const powerColor: Record<Power, string> = { bomb: "#2b3550", fire: "#ff7a3c", speed: "#5cc8ff" };
    const pickupGeo = new THREE.OctahedronGeometry(0.32, 0);
    const pickupPool = Array.from({ length: 24 }, () => {
      const m = new THREE.Mesh(pickupGeo, new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#000", emissiveIntensity: 0.4, flatShading: true }));
      m.visible = false;
      scene.add(m);
      return m;
    });

    // puppets (toon + outline; deterministic roster, one per fighter)
    const roster = avatarRoster(resolveLook(myLook()), N);
    interface Pup { puppet: Puppet; lx: number; lz: number; }
    const pups: Pup[] = roster.map((av, i) => {
      const puppet = createPuppet(scene, av, { toon: true, outline: i === 0 ? "#ffd23f" : "#141428" });
      puppet.group.scale.setScalar(0.8);
      return { puppet, lx: 0, lz: 0 };
    });

    const keys = new Set<string>();
    let raf = 0;
    let last = performance.now();
    const aliveCount = (): number => world.current!.players.filter((p) => p.alive).length;
    const bombAt = (c: number, r: number): Bomb | undefined => world.current!.bombs.find((b) => b.cx === c && b.cy === r);

    function solidFor(p: Player, c: number, r: number): boolean {
      if (!inGrid(c, r)) return true;
      const cell = world.current!.cells[ci(c, r)] ?? 1;
      if (cell !== 0) return true;
      const b = bombAt(c, r);
      return !!b && !b.pass.includes(p);
    }
    function canBe(p: Player, x: number, y: number): boolean {
      const rr = 0.34;
      for (const [dx, dy] of [[-rr, -rr], [rr, -rr], [-rr, rr], [rr, rr]] as const) if (solidFor(p, Math.floor(x + dx), Math.floor(y + dy))) return false;
      return true;
    }
    function movePlayer(p: Player, dx: number, dy: number, dt: number): void {
      const sp = p.speed * dt;
      if (dx !== 0 && dy === 0) p.y += (Math.floor(p.y) + 0.5 - p.y) * Math.min(1, dt * 12);
      if (dy !== 0 && dx === 0) p.x += (Math.floor(p.x) + 0.5 - p.x) * Math.min(1, dt * 12);
      const nx = p.x + dx * sp;
      if (canBe(p, nx, p.y)) p.x = nx;
      const ny = p.y + dy * sp;
      if (canBe(p, p.x, ny)) p.y = ny;
    }
    function placeBomb(p: Player): void {
      if (p.active >= p.bombMax) return;
      const c = Math.floor(p.x);
      const r = Math.floor(p.y);
      if (bombAt(c, r)) return;
      p.active++;
      world.current!.bombs.push({ cx: c, cy: r, fuse: FUSE, range: p.range, owner: p, pass: world.current!.players.filter((q) => Math.floor(q.x) === c && Math.floor(q.y) === r) });
      if (!p.isBot) sfxRef.current?.place();
    }
    function detonate(start: Bomb): void {
      const w = world.current!;
      const queue: Bomb[] = [start];
      const done = new Set<Bomb>();
      while (queue.length) {
        const b = queue.shift()!;
        if (done.has(b)) continue;
        done.add(b);
        b.owner.active = Math.max(0, b.owner.active - 1);
        w.bombs = w.bombs.filter((x) => x !== b);
        w.flames.push({ cx: b.cx, cy: b.cy, t: FLAME });
        for (const [dc, dr] of DIRS) {
          for (let s = 1; s <= b.range; s++) {
            const c = b.cx + dc * s;
            const r = b.cy + dr * s;
            if (!inGrid(c, r)) break;
            const cell = w.cells[ci(c, r)] ?? 1;
            if (cell === 1) break;
            const chain = bombAt(c, r);
            if (chain && !done.has(chain)) queue.push(chain);
            w.flames.push({ cx: c, cy: r, t: FLAME });
            if (cell === 2) {
              w.cells[ci(c, r)] = 0;
              if (Math.random() < POWER_DROP) w.pickups.push({ cx: c, cy: r, kind: POWERS[Math.floor(Math.random() * POWERS.length)]! });
              break;
            }
          }
        }
      }
      w.shake = 0.18;
      sfxRef.current?.boom();
    }
    function kill(p: Player): void {
      if (!p.alive) return;
      p.alive = false;
      p.dying = DIE_TIME;
      p.place = world.current!.nextPlace--;
      sfxRef.current?.die();
    }

    function dangerTime(extra?: { cx: number; cy: number; range: number }): Float32Array {
      const w = world.current!;
      const d = new Float32Array(GW * GH).fill(Infinity);
      const mark = (cx: number, cy: number, range: number, time: number): void => {
        d[ci(cx, cy)] = Math.min(d[ci(cx, cy)]!, time);
        for (const [dc, dr] of DIRS)
          for (let s = 1; s <= range; s++) {
            const c = cx + dc * s;
            const r = cy + dr * s;
            if (!inGrid(c, r)) break;
            const cell = w.cells[ci(c, r)] ?? 1;
            if (cell === 1) break;
            d[ci(c, r)] = Math.min(d[ci(c, r)]!, time);
            if (cell === 2) break;
          }
      };
      for (const b of w.bombs) mark(b.cx, b.cy, b.range, b.fuse);
      for (const f of w.flames) d[ci(f.cx, f.cy)] = 0;
      if (extra) mark(extra.cx, extra.cy, extra.range, FUSE);
      return d;
    }
    function lineClear(c0: number, r0: number, c1: number, r1: number): boolean {
      const w = world.current!;
      if (c0 === c1) {
        for (let r = Math.min(r0, r1) + 1; r < Math.max(r0, r1); r++) if ((w.cells[ci(c0, r)] ?? 1) !== 0) return false;
        return true;
      }
      if (r0 === r1) {
        for (let c = Math.min(c0, c1) + 1; c < Math.max(c0, c1); c++) if ((w.cells[ci(c, r0)] ?? 1) !== 0) return false;
        return true;
      }
      return false;
    }
    function bfsStep(sc: number, sr: number, goal: (c: number, r: number) => boolean, blocked: (c: number, r: number) => boolean): [number, number] | null {
      if (goal(sc, sr)) return [0, 0];
      const prev = new Map<number, number>();
      const q: number[] = [ci(sc, sr)];
      const seen = new Set<number>([ci(sc, sr)]);
      while (q.length) {
        const cur = q.shift()!;
        const cc = cur % GW;
        const cr = Math.floor(cur / GW);
        for (const [dc, dr] of DIRS) {
          const c = cc + dc;
          const r = cr + dr;
          if (!inGrid(c, r) || seen.has(ci(c, r)) || blocked(c, r)) continue;
          seen.add(ci(c, r));
          prev.set(ci(c, r), cur);
          if (goal(c, r)) {
            let node = ci(c, r);
            let p = prev.get(node)!;
            while (p !== ci(sc, sr)) {
              node = p;
              p = prev.get(node)!;
            }
            return [(node % GW) - sc, Math.floor(node / GW) - sr];
          }
          q.push(ci(c, r));
        }
      }
      return null;
    }

    const IMMINENT = 0.4;
    function botThink(b: Player, dt: number): [number, number] {
      const w = world.current!;
      const mc = Math.floor(b.x);
      const mr = Math.floor(b.y);
      const passableFor = (c: number, r: number): boolean => (w.cells[ci(c, r)] ?? 1) === 0 && !bombAt(c, r);
      const dg = dangerTime();
      const dgAt = (c: number, r: number): number => dg[ci(c, r)]!;
      if (dgAt(mc, mr) < 1.6) {
        const blocked = (c: number, r: number): boolean => !passableFor(c, r) || dgAt(c, r) < IMMINENT;
        const step = bfsStep(mc, mr, (c, r) => dgAt(c, r) === Infinity, blocked) ?? bfsStep(mc, mr, (c, r) => dgAt(c, r) > dgAt(mc, mr) + 0.4, blocked);
        return step ?? [0, 0];
      }
      b.retarget -= dt;
      let t = b.target;
      if (t && !t.alive) t = null;
      if (!t || b.retarget <= 0) {
        let best: Player | null = null;
        let bd = Infinity;
        for (const o of w.players) {
          if (o === b || !o.alive) continue;
          const d = Math.abs(o.x - b.x) + Math.abs(o.y - b.y);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        t = best;
        b.target = best;
        b.retarget = 1.4 + Math.random() * 1.4;
      }
      if (b.active < b.bombMax && !bombAt(mc, mr) && dgAt(mc, mr) === Infinity) {
        const crateAdj = DIRS.some(([dc, dr]) => (w.cells[ci(mc + dc, mr + dr)] ?? 0) === 2);
        const rivalHit = !!t && (Math.floor(t.x) === mc || Math.floor(t.y) === mr) && Math.abs(t.x - b.x) + Math.abs(t.y - b.y) <= b.range + 0.5 && lineClear(mc, mr, Math.floor(t.x), Math.floor(t.y));
        if (crateAdj || rivalHit) {
          const d2 = dangerTime({ cx: mc, cy: mr, range: b.range });
          const escBlocked = (c: number, r: number): boolean => !passableFor(c, r) || d2[ci(c, r)]! < IMMINENT;
          if (bfsStep(mc, mr, (c, r) => d2[ci(c, r)] === Infinity, escBlocked)) {
            placeBomb(b);
            return [0, 0];
          }
        }
      }
      const roamBlocked = (c: number, r: number): boolean => !passableFor(c, r) || dgAt(c, r) < IMMINENT;
      const pickupGoal = (c: number, r: number): boolean => w.pickups.some((pk) => pk.cx === c && pk.cy === r);
      const rivalGoal = (c: number, r: number): boolean => !!t && Math.abs(c - Math.floor(t.x)) + Math.abs(r - Math.floor(t.y)) <= 1;
      const crateGoal = (c: number, r: number): boolean => DIRS.some(([dc, dr]) => (w.cells[ci(c + dc, r + dr)] ?? 0) === 2);
      const step = (w.pickups.length ? bfsStep(mc, mr, pickupGoal, roamBlocked) : null) ?? bfsStep(mc, mr, rivalGoal, roamBlocked) ?? bfsStep(mc, mr, crateGoal, roamBlocked);
      return step ?? [0, 0];
    }

    function update(dt: number): void {
      const w = world.current!;
      if (w.over || phaseRef.current !== "playing") return;
      w.shake = Math.max(0, w.shake - dt);
      for (const b of w.bombs) b.fuse -= dt;
      for (const b of w.bombs.filter((b) => b.fuse <= 0)) detonate(b);
      for (const f of w.flames) f.t -= dt;
      w.flames = w.flames.filter((f) => f.t > 0);
      for (const p of w.players) {
        if (p.dying > 0) {
          p.dying -= dt;
          continue;
        }
        if (!p.alive) continue;
        let dx = 0;
        let dy = 0;
        if (!p.isBot) {
          ({ dx, dy } = moveVector(keys));
          if (dx !== 0 && dy !== 0) dy = 0;
        } else {
          [dx, dy] = botThink(p, dt);
        }
        if (dx || dy) {
          p.face = Math.atan2(dy, dx);
          movePlayer(p, dx, dy, dt);
        }
        for (const bmb of w.bombs) if (bmb.pass.includes(p) && !(Math.floor(p.x) === bmb.cx && Math.floor(p.y) === bmb.cy)) bmb.pass = bmb.pass.filter((q) => q !== p);
        for (const pk of w.pickups) {
          if (Math.floor(p.x) === pk.cx && Math.floor(p.y) === pk.cy) {
            if (pk.kind === "bomb") p.bombMax = Math.min(6, p.bombMax + 1);
            else if (pk.kind === "fire") p.range = Math.min(7, p.range + 1);
            else p.speed = Math.min(6, p.speed + 0.55);
            w.pickups = w.pickups.filter((x) => x !== pk);
            if (!p.isBot) sfxRef.current?.power();
          }
        }
        if (w.flames.some((f) => f.cx === Math.floor(p.x) && f.cy === Math.floor(p.y))) kill(p);
      }
      if (aliveCount() <= 1) endMatch();
    }

    function endMatch(): void {
      const w = world.current!;
      if (w.over) return;
      w.over = true;
      const survivor = w.players.find((p) => p.alive);
      if (survivor) survivor.place = 1;
      const me = w.players[0]!;
      const place = me.place || 1;
      const won = place === 1;
      if (party) {
        partyResultRef.current = partyResult(party.minigameId, party.seats, w.players.map((p) => p.place || 1));
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
      if (isGameKey(k)) e.preventDefault();
      if (phaseRef.current === "playing" && k === " ") {
        const me = world.current!.players[0]!;
        if (me.alive) placeBomb(me);
      }
    };
    const up = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    function sync(dt: number): void {
      const w = world.current!;
      // camera shake
      if (w.shake > 0) {
        const a = (w.shake / 0.18) * 0.35;
        camera.position.set(baseCam.x + (Math.random() - 0.5) * a, baseCam.y, baseCam.z + (Math.random() - 0.5) * a);
      } else camera.position.copy(baseCam);

      // crates
      let cn = 0;
      for (let i = 0; i < w.cells.length && cn < cratePool.length; i++) {
        if (w.cells[i] !== 2) continue;
        const m = cratePool[cn++]!;
        m.visible = true;
        m.position.set(wx((i % GW) + 0.5), 0.43, wz(Math.floor(i / GW) + 0.5));
      }
      for (let j = cn; j < cratePool.length; j++) cratePool[j]!.visible = false;

      // bombs
      let bn = 0;
      for (const b of w.bombs) {
        const m = bombPool[bn++];
        if (!m) break;
        m.visible = true;
        const pulse = 1 + Math.sin(b.fuse * 12) * 0.1 * (b.fuse < 1 ? 2 : 1);
        m.position.set(wx(b.cx + 0.5), 0.36, wz(b.cy + 0.5));
        m.scale.setScalar(pulse);
      }
      for (let j = bn; j < bombPool.length; j++) bombPool[j]!.visible = false;

      // flames
      let fn = 0;
      for (const f of w.flames) {
        const m = flamePool[fn++];
        if (!m) break;
        m.visible = true;
        const a = f.t / FLAME;
        m.position.set(wx(f.cx + 0.5), 0.4, wz(f.cy + 0.5));
        m.scale.setScalar(0.7 + a * 0.4);
        (m.material as THREE.MeshBasicMaterial).opacity = 0.4 + a * 0.5;
      }
      for (let j = fn; j < flamePool.length; j++) flamePool[j]!.visible = false;

      // pickups
      let pn = 0;
      for (const pk of w.pickups) {
        const m = pickupPool[pn++];
        if (!m) break;
        m.visible = true;
        m.position.set(wx(pk.cx + 0.5), 0.5 + Math.sin(performance.now() * 0.004 + pk.cx) * 0.08, wz(pk.cy + 0.5));
        m.rotation.y += dt * 2;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.color.set(powerColor[pk.kind]);
        mat.emissive.set(powerColor[pk.kind]);
      }
      for (let j = pn; j < pickupPool.length; j++) pickupPool[j]!.visible = false;

      // players
      for (let i = 0; i < pups.length; i++) {
        const pu = pups[i]!;
        const p = w.players[i];
        if (!p || (!p.alive && p.dying <= 0)) {
          pu.puppet.group.visible = false;
          continue;
        }
        pu.puppet.group.visible = true;
        const g = pu.puppet.group;
        const px = wx(p.x);
        const pz = wz(p.y);
        const moved = Math.hypot(px - pu.lx, pz - pu.lz) / Math.max(dt, 1e-4);
        pu.lx = px;
        pu.lz = pz;
        if (p.dying > 0) {
          const k = Math.max(0.02, p.dying / DIE_TIME);
          g.position.set(px, 0, pz);
          g.scale.setScalar(0.8 * k);
          g.rotation.y += dt * 14;
        } else {
          g.position.set(px, 0, pz);
          g.scale.setScalar(0.8);
          g.rotation.y = 0;
          pu.puppet.faceYaw(Math.PI / 2 - p.face);
          pu.puppet.animate(moved > 0.3 ? 4.6 : 2, dt);
        }
      }

      if (aliveRef.current) aliveRef.current.textContent = `Alive: ${aliveCount()}`;
      const me = w.players[0]!;
      if (powerRef.current) powerRef.current.textContent = `💣 ${me.bombMax}   🔥 ${me.range}   » ${Math.round((me.speed - BASE_SPEED) / 0.55)}`;

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
      for (const p of pups) p.puppet.dispose();
      toonRamp.dispose();
      floorTex.dispose();
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
        <h1 style={{ margin: 0, fontSize: 22 }}>Bomber</h1>
        <button onClick={onLeave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 820, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={820} height={620} style={{ width: "100%", aspectRatio: "820 / 620", background: "#0c1119", borderRadius: 8, display: "block" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 8, boxShadow: "inset 0 0 110px rgba(0,0,0,0.5)" }} />

        {phase === "playing" && (
          <>
            <div ref={aliveRef} style={{ position: "absolute", top: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Alive: 4</div>
            <div ref={powerRef} style={{ position: "absolute", top: 14, right: 16, color: "rgba(255,255,255,0.8)", fontWeight: 700, fontSize: 14, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>💣 1 🔥 2 » 0</div>
          </>
        )}

        {phase !== "playing" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(8,10,14,0.82)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            {phase === "over" && result && (
              <div style={{ fontSize: 28, fontWeight: 900, color: result.won ? "#4ac36b" : "#d64545" }}>
                {result.won ? "💥 Last bomber standing — you win!" : `You were blown up — #${result.place} of ${N}`}
                {party ? (
                  <div style={{ fontSize: 15, color: "#ffd23f", marginTop: 2 }}>Placement decides your R$ payout</div>
                ) : (
                  <div style={{ fontSize: 16, color: "#ffd23f", marginTop: 2 }}>🪙 +{result.coins} coins</div>
                )}
              </div>
            )}
            <div style={{ fontSize: 14, opacity: 0.85, maxWidth: 480, lineHeight: 1.5 }}>
              <strong>WASD / arrows</strong> move · <strong>Space</strong> drop a bomb. Bombs blast a cross of flame — blow up crates for power-ups (<span style={{ color: "#ff7a3c" }}>🔥 range</span>, <span style={{ color: "#5cc8ff" }}>» speed</span>, ＋ bombs) and catch rivals in the fire. Don't stand in your own blast! Last one standing wins.
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
