import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { avatarRoster, avatarById, type Avatar } from "../game/avatars.js";
import { useProfile } from "../store/profile.js";
import { createStage } from "../three/stage.js";
import { frameArena } from "../three/cameraRig.js";
import { createPuppet, type Puppet } from "../three/character.js";

// "Brawl — Showdown" — a 3D top-down twin-stick battle royale (Brawl Stars style).
// Each of the 8 mascots is a distinct BRAWLER: its own main attack AND a signature
// Super. The sim lives on the top-down (x,y) plane; Three.js renders it in 3D.
// WASD move · mouse aim · hold click fire · Space = Super when charged. Grab power
// cubes, survive the closing zone, last brawler standing wins.

const HX = 24; // arena half-width (x)
const HZ = 15; // arena half-depth (y)
const R = 0.7; // brawler radius
const TOTAL = 8; // you + 7 bots

interface Wall {
  x: number;
  y: number;
  hw: number;
  hd: number;
}
const WALLS: Wall[] = [
  // central cross of crates (open middle for the cube fights)
  { x: -4.5, y: 0, hw: 0.9, hd: 0.9 },
  { x: 4.5, y: 0, hw: 0.9, hd: 0.9 },
  { x: 0, y: -4.5, hw: 0.9, hd: 0.9 },
  { x: 0, y: 4.5, hw: 0.9, hd: 0.9 },
  // side-lane pillars
  { x: -11, y: 0, hw: 0.8, hd: 2.4 },
  { x: 11, y: 0, hw: 0.8, hd: 2.4 },
  // corner cover
  { x: -17, y: -8.5, hw: 1.8, hd: 0.9 },
  { x: 17, y: -8.5, hw: 1.8, hd: 0.9 },
  { x: -17, y: 8.5, hw: 1.8, hd: 0.9 },
  { x: 17, y: 8.5, hw: 1.8, hd: 0.9 },
  // top/bottom mid cover
  { x: 0, y: -11.5, hw: 2.4, hd: 0.9 },
  { x: 0, y: 11.5, hw: 2.4, hd: 0.9 },
];
// bushes conceal you: bots can't target a brawler hiding in one unless they're close
const BUSHES: Wall[] = [
  { x: -8, y: -5, hw: 2.6, hd: 1.7 },
  { x: 8, y: -5, hw: 2.6, hd: 1.7 },
  { x: -8, y: 5, hw: 2.6, hd: 1.7 },
  { x: 8, y: 5, hw: 2.6, hd: 1.7 },
  { x: -18.5, y: 0, hw: 1.6, hd: 2.6 },
  { x: 18.5, y: 0, hw: 1.6, hd: 2.6 },
];
const inBush = (x: number, y: number): boolean => BUSHES.some((b) => Math.abs(x - b.x) < b.hw && Math.abs(y - b.y) < b.hd);
const SPAWN_PTS: Array<[number, number]> = [
  [-20, -11],
  [20, -11],
  [-20, 11],
  [20, 11],
  [0, -13.5],
  [0, 13.5],
  [-9, 0],
  [9, 0],
];
const CUBE_SPOTS: Array<[number, number]> = [
  [0, -6.5],
  [0, 6.5],
  [-7, 0],
  [7, 0],
  [-9, -8],
  [9, 8],
  [9, -8],
  [-9, 8],
];

type Super = "blast" | "charge" | "blink" | "heal" | "freeze" | "wall" | "stomp" | "turret";
interface Kit {
  hp: number;
  move: number; // units/s
  dmg: number;
  bspeed: number; // bullet units/s
  range: number;
  cool: number;
  reload: number;
  pellets: number;
  spread: number; // total arc (rad)
  pierce: boolean;
  slow: boolean;
  prefer: number; // bot preferred range
  sup: Super;
  atk: string; // main-attack blurb
  supName: string;
  supDesc: string;
}
// one kit per mascot id — distinct feel + a signature Super
const KITS: Record<string, Kit> = {
  blaze: { hp: 100, move: 6.0, dmg: 19, bspeed: 20, range: 11, cool: 0.28, reload: 0.9, pellets: 3, spread: 0.28, pierce: false, slow: false, prefer: 8, sup: "blast", atk: "triple flame burst", supName: "Inferno", supDesc: "lob a fireball that erupts in an AoE blast" },
  tusk: { hp: 142, move: 5.4, dmg: 12, bspeed: 18, range: 7, cool: 0.5, reload: 1.2, pellets: 6, spread: 0.7, pierce: false, slow: false, prefer: 5, sup: "charge", atk: "point-blank shotgun", supName: "Rampage", supDesc: "charge forward, smashing everyone aside" },
  bolt: { hp: 78, move: 7.3, dmg: 26, bspeed: 27, range: 15, cool: 0.34, reload: 1.0, pellets: 1, spread: 0, pierce: false, slow: false, prefer: 11, sup: "blink", atk: "fast long-range zap", supName: "Blink", supDesc: "teleport and unleash a ring of bolts" },
  coco: { hp: 106, move: 6.0, dmg: 22, bspeed: 19, range: 12, cool: 0.4, reload: 1.0, pellets: 1, spread: 0, pierce: true, slow: false, prefer: 9, sup: "heal", atk: "piercing shot", supName: "Second Wind", supDesc: "heal up and gain a shield" },
  frost: { hp: 96, move: 6.0, dmg: 18, bspeed: 17, range: 12, cool: 0.36, reload: 1.0, pellets: 1, spread: 0, pierce: false, slow: true, prefer: 10, sup: "freeze", atk: "chilling shot (slows)", supName: "Blizzard", supDesc: "freeze burst that slows nearby foes" },
  sprout: { hp: 100, move: 5.8, dmg: 20, bspeed: 16, range: 11, cool: 0.42, reload: 1.0, pellets: 2, spread: 0.16, pierce: false, slow: false, prefer: 9, sup: "wall", atk: "twin seed shot", supName: "Hedge", supDesc: "grow a wall of cover where you aim" },
  rex: { hp: 122, move: 5.6, dmg: 46, bspeed: 16, range: 12, cool: 0.66, reload: 1.5, pellets: 1, spread: 0, pierce: false, slow: false, prefer: 9, sup: "stomp", atk: "heavy slug", supName: "Stomp", supDesc: "leap to your aim and slam the ground" },
  pixel: { hp: 92, move: 6.2, dmg: 15, bspeed: 19, range: 12, cool: 0.34, reload: 1.0, pellets: 3, spread: 0.3, pierce: false, slow: false, prefer: 9, sup: "turret", atk: "scatter bits", supName: "Turret", supDesc: "deploy an auto-firing turret" },
};
const kitOf = (av: Avatar): Kit => KITS[av.id] ?? KITS.blaze!;

interface Brawler {
  id: number;
  av: Avatar;
  x: number;
  y: number;
  aim: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  isBot: boolean;
  name: string;
  color: string;
  kit: Kit;
  ammo: number;
  reloadT: number;
  cool: number;
  sup: number; // super charge 0..100
  cubes: number;
  hurt: number;
  place: number;
  wanderT: number;
  strafe: number;
  // status
  shield: number;
  slowT: number;
  healT: number;
  dashT: number;
  dashA: number;
  kbx: number;
  kby: number;
}
interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  owner: number;
  life: number;
  color: string;
  big: boolean;
  pierce: boolean;
  slow: boolean;
  explode: boolean;
  hitIds: Set<number>;
}
interface Cube {
  x: number;
  y: number;
  active: boolean;
  respawn: number;
}
interface TempWall {
  x: number;
  y: number;
  hw: number;
  hd: number;
  life: number;
}
interface Turret {
  x: number;
  y: number;
  owner: number;
  color: string;
  life: number;
  cool: number;
  aim: number;
}
interface Fx {
  x: number;
  y: number;
  t: number;
  max: number;
  r: number;
  color: string;
}
interface World {
  bs: Brawler[];
  bullets: Bullet[];
  cubes: Cube[];
  walls: TempWall[];
  turrets: Turret[];
  fx: Fx[];
  time: number;
  shake: number;
  over: boolean;
  nextPlace: number;
}
interface ResultRow {
  name: string;
  color: string;
  place: number;
  isYou: boolean;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
// shrinking safe half-extents
function safeHalf(time: number): { hw: number; hh: number } {
  const frac = clamp(1 - Math.max(0, time - 8) / 46, 0.16, 1);
  return { hw: HX * frac, hh: HZ * frac };
}

export function BrawlPractice({ onLeave }: { onLeave: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const myAvatar = useProfile((s) => s.avatar);
  const [phase, setPhase] = useState<"pick" | "playing" | "over">("pick");
  const [result, setResult] = useState<{ won: boolean; place: number; coins: number; board: ResultRow[] } | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef<HTMLDivElement | null>(null);
  const superRef = useRef<HTMLDivElement | null>(null);
  const hpTextRef = useRef<HTMLDivElement | null>(null);

  const me = avatarById(myAvatar);
  const myKit = kitOf(me);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = createStage(canvas, {
      width: canvas.width,
      height: canvas.height,
      background: "#0e1a12",
      fog: null, // top-down — keep the whole arena crisp
      sun: { color: "#ffe9c4", intensity: 1.15, pos: [-14, 30, 12], extent: 34 },
      hemi: { sky: "#a8d8ff", ground: "#3d6b35", intensity: 0.5 },
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.18,
    });
    const { scene, camera, renderer } = stage;
    // real shadows from 8 rigged avatars are the main cost — use cheap blob shadows instead
    renderer.shadowMap.enabled = false;
    stage.sun.castShadow = false;
    // cool back-rim so toon-lit mascots separate crisply from the grass
    const rim = new THREE.DirectionalLight("#8fb8ff", 0.5);
    rim.position.set(10, 18, -16);
    scene.add(rim);
    // lower 3/4 "diorama" angle + zoom-in, so it reads like Brawl Stars rather than overhead
    frameArena(camera, { center: new THREE.Vector3(0, 0, 0), radius: 24, tiltDeg: 54, yawDeg: 0, margin: 1.04 });

    // cel-ramp shared by all arena props (matches the avatars)
    const toonRamp = new THREE.DataTexture(new Uint8Array([88, 168, 255]), 3, 1, THREE.RedFormat);
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;
    const toonMat = (color: string): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ color, gradientMap: toonRamp });
    const baseCam = camera.position.clone();

    // soft blob-shadow texture shared by every brawler
    const blobTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d")!;
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(0,0,0,0.5)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();

    // soft radial glow texture (cube auras, etc.)
    const glowTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d")!;
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();

    // ── mowed-grass arena floor ──
    const grassTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      const g = cv.getContext("2d")!;
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? "#43974d" : "#54ab5e";
        g.fillRect(i * 32, 0, 32, 256);
      }
      for (let i = 0; i < 1600; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace; // correct grading under ACES
      return t;
    })();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), new THREE.MeshToonMaterial({ map: grassTex, gradientMap: toonRamp }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // danger overlay: 4 red planes that creep inward as the safe rect shrinks
    const dangerMat = new THREE.MeshBasicMaterial({ color: "#7a1020", transparent: true, opacity: 0.44, depthWrite: false });
    const danger = [0, 1, 2, 3].map(() => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dangerMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.05;
      scene.add(m);
      return m;
    });
    // bright pulsing safe-zone boundary
    const borderMat = new THREE.MeshBasicMaterial({ color: "#ffe14d" });
    const borders = [0, 1, 2, 3].map(() => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 0.18), borderMat);
      b.position.y = 0.14;
      scene.add(b);
      return b;
    });

    // ── enclosed stadium: surrounding ground, perimeter wall, a ring of trees ──
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(HX * 5, HZ * 5), toonMat("#20482a"));
    skirt.rotation.x = -Math.PI / 2;
    skirt.position.y = -0.35;
    scene.add(skirt);
    const rimMat = toonMat("#5b4632");
    for (const [w, d, x, z] of [[HX * 2 + 1.6, 1, 0, -HZ - 0.6], [HX * 2 + 1.6, 1, 0, HZ + 0.6], [1, HZ * 2 + 1.6, -HX - 0.6, 0], [1, HZ * 2 + 1.6, HX + 0.6, 0]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), rimMat);
      m.position.set(x, 0.6, z);
      scene.add(m);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.42, 1.4, 6);
    const trunkMat = toonMat("#5b4632");
    const foliMat = toonMat("#2f8a44");
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const tx = Math.cos(a) * (HX + 3 + Math.random() * 5);
      const tz = Math.sin(a) * (HZ + 3 + Math.random() * 5);
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.7;
      const f1 = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.2, 7), foliMat);
      f1.position.y = 2.1;
      const f2 = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 7), foliMat);
      f2.position.y = 3.1;
      g.add(trunk, f1, f2);
      g.position.set(tx, -0.2, tz);
      g.scale.setScalar(0.9 + Math.random() * 0.7);
      scene.add(g);
    }

    const wallMat = toonMat("#8a6a44");
    const wallTopMat = toonMat("#a5814f");
    for (const w of WALLS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2, 1.4, w.hd * 2), wallMat);
      m.position.set(w.x, 0.7, w.y);
      scene.add(m);
      const top = new THREE.Mesh(new THREE.BoxGeometry(w.hw * 2 + 0.12, 0.18, w.hd * 2 + 0.12), wallTopMat);
      top.position.set(w.x, 1.45, w.y);
      scene.add(top);
    }

    // ── bushes: flat patch + clustered shrubs (concealment zones) ──
    const bushMat = toonMat("#2f8a42");
    const bushMatLite = toonMat("#45a552");
    for (const bu of BUSHES) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(bu.hw * 2, bu.hd * 2), bushMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(bu.x, 0.03, bu.y);
      scene.add(patch);
      const n = Math.round(bu.hw * bu.hd * 1.4);
      for (let i = 0; i < n; i++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 + Math.random() * 0.32, 0), Math.random() < 0.5 ? bushMat : bushMatLite);
        s.position.set(bu.x + (Math.random() - 0.5) * bu.hw * 1.8, 0.4, bu.y + (Math.random() - 0.5) * bu.hd * 1.8);
        s.scale.y = 0.7;
        scene.add(s);
      }
    }

    // ── pools ──
    const bulletGeo = new THREE.SphereGeometry(0.24, 8, 8);
    const bulletPool = Array.from({ length: 110 }, () => {
      const m = new THREE.Mesh(bulletGeo, new THREE.MeshBasicMaterial({ color: "#fff", blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      return m;
    });
    const cubeGeo = new THREE.IcosahedronGeometry(0.42, 0);
    const cubeMat = new THREE.MeshStandardMaterial({ color: "#a06bff", emissive: "#5a2bff", emissiveIntensity: 0.5, flatShading: true });
    const cubePool = Array.from({ length: 20 }, () => {
      const m = new THREE.Mesh(cubeGeo, cubeMat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: "#b98cff", transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(1.9);
      m.add(glow);
      m.visible = false;
      scene.add(m);
      return m;
    });
    const tWallMat = toonMat("#3faa58");
    const tWallPool = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1.3, 1), tWallMat);
      m.visible = false;
      scene.add(m);
      return m;
    });
    const turretPool = Array.from({ length: 8 }, () => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 8), new THREE.MeshStandardMaterial({ color: "#2b2f3a", flatShading: true }));
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: "#c9d2e0", flatShading: true }));
      gun.position.y = 0.55;
      g.add(base, gun);
      g.visible = false;
      scene.add(g);
      return { g, gun };
    });
    // ring FX (super blasts / freezes)
    const ringGeo = new THREE.RingGeometry(0.7, 1, 20);
    const fxPool = Array.from({ length: 18 }, () => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      return m;
    });
    // spark pool — impacts, muzzle flashes, death confetti, pickups
    interface Spark {
      sp: THREE.Sprite;
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      life: number;
      max: number;
      size: number;
    }
    const sparks: Spark[] = Array.from({ length: 72 }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.visible = false;
      scene.add(sp);
      return { sp, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.4 };
    });
    function spawnPuff(x: number, y: number, n: number, color: THREE.ColorRepresentation, speed: number, life: number, up = 0): void {
      let made = 0;
      for (const s of sparks) {
        if (s.life > 0) continue;
        (s.sp.material as THREE.SpriteMaterial).color.set(color);
        s.x = x;
        s.z = y;
        s.y = 0.7;
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.4 + Math.random() * 0.8);
        s.vx = Math.cos(a) * sp;
        s.vz = Math.sin(a) * sp;
        s.vy = up * (0.5 + Math.random());
        s.life = s.max = life * (0.7 + Math.random() * 0.5);
        s.size = 0.5 + Math.random() * 0.4;
        s.sp.visible = true;
        if (++made >= n) break;
      }
    }

    // black segment ticks overlaid on the health bar (Brawl-Stars segmented look)
    const ticksTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = 64;
      cv.height = 8;
      const g = cv.getContext("2d")!;
      g.fillStyle = "rgba(0,0,0,0.65)";
      for (let i = 1; i < 5; i++) g.fillRect(Math.round((i * 64) / 5) - 1, 0, 2, 8);
      g.fillRect(0, 0, 64, 1);
      g.fillRect(0, 7, 64, 1);
      return new THREE.CanvasTexture(cv);
    })();

    // ── puppets, built once (roster is deterministic), reused each match ──
    const roster = avatarRoster(useProfile.getState().avatar, TOTAL);
    interface Pup {
      puppet: Puppet;
      fill: THREE.Sprite;
      ring: THREE.Mesh;
      blob: THREE.Mesh;
      pips: THREE.Sprite[];
    }
    const pups: Pup[] = roster.map((av) => {
      const puppet = createPuppet(scene, av, { outline: "#12141a", toon: true }); // cel-shaded + dark outline (Brawl Stars look)
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.04;
      scene.add(blob);
      const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x0a0a0a }));
      bg.position.set(0, 2.55, 0);
      bg.scale.set(1.3, 0.2, 1);
      const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4ade80 }));
      fill.center.set(0, 0.5);
      fill.position.set(-0.62, 2.55, 0.01);
      fill.scale.set(1.16, 0.13, 1);
      const ticks = new THREE.Sprite(new THREE.SpriteMaterial({ map: ticksTex, transparent: true, depthWrite: false }));
      ticks.position.set(0, 2.55, 0.02);
      ticks.scale.set(1.3, 0.2, 1);
      puppet.group.add(bg, fill, ticks);
      // ammo pips under the bar
      const pips = [0, 1, 2].map((k) => {
        const p = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffcf5a, transparent: true, depthWrite: false }));
        p.position.set(-0.28 + k * 0.28, 2.32, 0.02);
        p.scale.set(0.18, 0.18, 1);
        puppet.group.add(p);
        return p;
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 20), new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      ring.visible = false;
      puppet.group.add(ring);
      return { puppet, fill, ring, blob, pips };
    });

    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
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

    let world: World | null = null;

    const hitsWall = (x: number, y: number, pad: number): boolean => {
      for (const w of WALLS) if (x > w.x - w.hw - pad && x < w.x + w.hw + pad && y > w.y - w.hd - pad && y < w.y + w.hd + pad) return true;
      if (world) for (const w of world.walls) if (x > w.x - w.hw - pad && x < w.x + w.hw + pad && y > w.y - w.hd - pad && y < w.y + w.hd + pad) return true;
      return false;
    };
    const losClear = (ax: number, ay: number, bx: number, by: number): boolean => {
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.8);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (hitsWall(ax + (bx - ax) * t, ay + (by - ay) * t, 0)) return false;
      }
      return true;
    };

    function spawnFx(x: number, y: number, r: number, color: string): void {
      world!.fx.push({ x, y, t: 0.3, max: 0.3, r, color });
    }

    function fire(b: Brawler): void {
      const k = b.kit;
      const dmg = k.dmg * (1 + b.cubes * 0.12);
      for (let p = 0; p < k.pellets; p++) {
        const off = k.pellets > 1 ? (p / (k.pellets - 1) - 0.5) * k.spread : 0;
        const ang = b.aim + off + (b.isBot ? (Math.random() - 0.5) * 0.06 : 0);
        world!.bullets.push({ x: b.x + Math.cos(ang) * (R + 0.3), y: b.y + Math.sin(ang) * (R + 0.3), vx: Math.cos(ang) * k.bspeed, vy: Math.sin(ang) * k.bspeed, dmg, owner: b.id, life: k.range / k.bspeed, color: b.color, big: false, pierce: k.pierce, slow: k.slow, explode: false, hitIds: new Set() });
      }
      spawnPuff(b.x + Math.cos(b.aim) * (R + 0.3), b.y + Math.sin(b.aim) * (R + 0.3), 2, "#fff5cc", 3, 0.08); // muzzle flash
      tone(k.pellets > 3 ? 240 : 320, 0.06, k.pellets > 3 ? "sawtooth" : "square", 0.14, 130);
    }
    function tryShoot(b: Brawler): void {
      if (b.ammo <= 0 || b.cool > 0 || b.dashT > 0) return;
      b.ammo--;
      b.cool = b.kit.cool;
      fire(b);
    }
    function trySuper(b: Brawler): void {
      if (b.sup < 100 || b.dashT > 0) return;
      b.sup = 0;
      world!.shake = 0.16;
      const k = b.kit;
      const cos = Math.cos(b.aim);
      const sin = Math.sin(b.aim);
      switch (k.sup) {
        case "blast":
          world!.bullets.push({ x: b.x + cos, y: b.y + sin, vx: cos * 14, vy: sin * 14, dmg: k.dmg * 1.4, owner: b.id, life: 0.75, color: "#ff7a2a", big: true, pierce: false, slow: false, explode: true, hitIds: new Set() });
          break;
        case "charge":
          b.dashT = 0.34;
          b.dashA = b.aim;
          break;
        case "blink": {
          const nx = clamp(b.x + cos * 9, -HX + R, HX - R);
          const ny = clamp(b.y + sin * 9, -HZ + R, HZ - R);
          if (!hitsWall(nx, ny, R)) {
            b.x = nx;
            b.y = ny;
          }
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            world!.bullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * 22, vy: Math.sin(a) * 22, dmg: k.dmg * 0.7, owner: b.id, life: 0.45, color: "#8ad0ff", big: false, pierce: false, slow: false, explode: false, hitIds: new Set() });
          }
          spawnFx(b.x, b.y, 3, "#8ad0ff");
          break;
        }
        case "heal":
          b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.4);
          b.shield = 45;
          b.healT = 3;
          spawnFx(b.x, b.y, 2.2, "#4ade80");
          break;
        case "freeze":
          for (const o of world!.bs) if (o.alive && o.id !== b.id && Math.hypot(o.x - b.x, o.y - b.y) < 6.5) {
            o.slowT = 2.6;
            damage(o, 16, b);
          }
          spawnFx(b.x, b.y, 6.5, "#bdefff");
          break;
        case "wall": {
          const wx = clamp(b.x + cos * 4, -HX + 2, HX - 2);
          const wy = clamp(b.y + sin * 4, -HZ + 2, HZ - 2);
          const along = Math.abs(cos) > Math.abs(sin);
          world!.walls.push({ x: wx, y: wy, hw: along ? 0.7 : 3, hd: along ? 3 : 0.7, life: 7 });
          break;
        }
        case "stomp": {
          const sx = clamp(b.x + cos * 8, -HX + R, HX - R);
          const sy = clamp(b.y + sin * 8, -HZ + R, HZ - R);
          if (!hitsWall(sx, sy, R)) {
            b.x = sx;
            b.y = sy;
          }
          for (const o of world!.bs) if (o.alive && o.id !== b.id && Math.hypot(o.x - b.x, o.y - b.y) < 5) {
            damage(o, 52, b);
            const a = Math.atan2(o.y - b.y, o.x - b.x);
            o.kbx += Math.cos(a) * 12;
            o.kby += Math.sin(a) * 12;
          }
          spawnFx(b.x, b.y, 5, "#ffcf6b");
          break;
        }
        case "turret":
          world!.turrets.push({ x: b.x + cos * 1.4, y: b.y + sin * 1.4, owner: b.id, color: b.color, life: 9, cool: 0, aim: b.aim });
          break;
      }
      tone(240, 0.28, "sawtooth", 0.26, 520);
    }

    function damage(b: Brawler, dmg: number, by: Brawler | null): void {
      if (!b.alive) return;
      if (b.shield > 0) {
        const a = Math.min(b.shield, dmg);
        b.shield -= a;
        dmg -= a;
      }
      b.hp -= dmg;
      b.hurt = 0.12;
      if (by) by.sup = Math.min(100, by.sup + dmg * 0.5);
      tone(900, 0.04, "square", 0.1, 700);
      if (b.hp <= 0) kill(b, by);
    }
    function kill(b: Brawler, by: Brawler | null): void {
      if (!b.alive) return;
      b.alive = false;
      b.place = world!.nextPlace--;
      world!.shake = 0.12;
      if (by && by !== b) by.sup = Math.min(100, by.sup + 25);
      world!.cubes.push({ x: clamp(b.x, -HX + 1, HX - 1), y: clamp(b.y, -HZ + 1, HZ - 1), active: true, respawn: 0 });
      spawnFx(b.x, b.y, 2.4, b.color);
      spawnPuff(b.x, b.y, 10, b.color, 6, 0.5, 4); // confetti pop
      tone(140, 0.28, "sawtooth", 0.3, 55);
    }

    function moveBrawler(b: Brawler, dx: number, dy: number, dt: number, speed: number): void {
      const len = Math.hypot(dx, dy) || 1;
      const sp = speed * dt;
      const nx = b.x + (dx / len) * sp;
      const ny = b.y + (dy / len) * sp;
      if (nx > -HX + R && nx < HX - R && !hitsWall(nx, b.y, R)) b.x = nx;
      if (ny > -HZ + R && ny < HZ - R && !hitsWall(b.x, ny, R)) b.y = ny;
    }

    const mouse = { x: 0, y: 0, down: false };
    const keys = new Set<string>();
    const aliveCount = (): number => (world ? world.bs.filter((b) => b.alive).length : 0);

    function botThink(b: Brawler, w: World, dt: number, hw: number, hh: number): void {
      const k = b.kit;
      let tgt: Brawler | null = null;
      let bd = Infinity;
      for (const o of w.bs) {
        if (o === b || !o.alive) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (inBush(o.x, o.y) && d > 3.6) continue; // can't see a brawler hiding in a bush
        if (d < bd) {
          bd = d;
          tgt = o;
        }
      }
      let dx = 0;
      let dy = 0;
      if (Math.abs(b.x) > hw * 0.92 || Math.abs(b.y) > hh * 0.92) {
        dx = -b.x;
        dy = -b.y;
      } else if (tgt) {
        b.aim = Math.atan2(tgt.y - b.y, tgt.x - b.x) + (Math.random() - 0.5) * 0.12;
        if (bd > k.prefer * 1.15) {
          dx = tgt.x - b.x;
          dy = tgt.y - b.y;
        } else if (bd < k.prefer * 0.7) {
          dx = b.x - tgt.x;
          dy = b.y - tgt.y;
        } else {
          if (Math.random() < 0.02) b.strafe *= -1;
          dx = -(tgt.y - b.y) * b.strafe;
          dy = (tgt.x - b.x) * b.strafe;
        }
        for (const c of w.cubes) if (c.active && Math.hypot(c.x - b.x, c.y - b.y) < 6) {
          dx += (c.x - b.x) * 0.5;
          dy += (c.y - b.y) * 0.5;
          break;
        }
        if (bd < k.range && losClear(b.x, b.y, tgt.x, tgt.y)) {
          tryShoot(b);
          if (b.sup >= 100) trySuper(b);
        }
      } else {
        b.wanderT -= dt;
        if (b.wanderT <= 0) {
          b.aim = Math.random() * Math.PI * 2;
          b.wanderT = 1 + Math.random();
        }
        dx = Math.cos(b.aim);
        dy = Math.sin(b.aim);
      }
      if (dx || dy) moveBrawler(b, dx, dy, dt, k.move * (b.slowT > 0 ? 0.5 : 1));
    }

    function update(dt: number): void {
      const w = world;
      if (!w || w.over) return;
      w.time += dt;
      w.shake = Math.max(0, w.shake - dt);
      const { hw, hh } = safeHalf(w.time);
      const dangerDps = (10 + w.time * 0.35) / 100;

      for (const c of w.cubes) if (!c.active) {
        c.respawn -= dt;
        if (c.respawn <= 0) c.active = true;
      }
      w.walls = w.walls.filter((wl) => (wl.life -= dt) > 0);
      w.fx = w.fx.filter((f) => (f.t -= dt) > 0);

      // turrets
      for (const t of w.turrets) {
        t.life -= dt;
        t.cool = Math.max(0, t.cool - dt);
        let tg: Brawler | null = null;
        let td = Infinity;
        for (const o of w.bs) if (o.alive && o.id !== t.owner) {
          const d = Math.hypot(o.x - t.x, o.y - t.y);
          if (d < td && d < 13 && losClear(t.x, t.y, o.x, o.y)) {
            td = d;
            tg = o;
          }
        }
        if (tg) {
          t.aim = Math.atan2(tg.y - t.y, tg.x - t.x);
          if (t.cool <= 0) {
            t.cool = 0.3;
            const owner = w.bs[t.owner];
            world!.bullets.push({ x: t.x + Math.cos(t.aim), y: t.y + Math.sin(t.aim), vx: Math.cos(t.aim) * 20, vy: Math.sin(t.aim) * 20, dmg: 12, owner: t.owner, life: 0.65, color: owner?.color ?? "#fff", big: false, pierce: false, slow: false, explode: false, hitIds: new Set() });
          }
        }
      }
      w.turrets = w.turrets.filter((t) => t.life > 0);

      for (const b of w.bs) {
        if (!b.alive) continue;
        b.cool = Math.max(0, b.cool - dt);
        b.hurt = Math.max(0, b.hurt - dt);
        b.slowT = Math.max(0, b.slowT - dt);
        if (b.healT > 0) {
          b.healT -= dt;
          b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.12 * dt);
        }
        // knockback impulse
        if (Math.abs(b.kbx) > 0.05 || Math.abs(b.kby) > 0.05) {
          moveBrawler(b, b.kbx, b.kby, dt, Math.hypot(b.kbx, b.kby));
          b.kbx *= 0.86;
          b.kby *= 0.86;
        }
        if (b.ammo < 3) {
          b.reloadT += dt;
          if (b.reloadT >= b.kit.reload) {
            b.ammo++;
            b.reloadT = 0;
          }
        }
        if (Math.abs(b.x) > hw || Math.abs(b.y) > hh) {
          b.hp -= b.maxHp * dangerDps * dt;
          if (b.hp <= 0) {
            kill(b, null);
            continue;
          }
        }
        for (const c of w.cubes) if (c.active && Math.hypot(c.x - b.x, c.y - b.y) < R + 0.6) {
          c.active = false;
          c.respawn = 12;
          b.cubes++;
          b.maxHp += 24;
          b.hp = Math.min(b.maxHp, b.hp + 24);
          spawnFx(c.x, c.y, 1.4, "#a06bff");
          spawnPuff(c.x, c.y, 5, "#c39bff", 5, 0.3, 3);
        }

        // dash (charge super)
        if (b.dashT > 0) {
          b.dashT -= dt;
          moveBrawler(b, Math.cos(b.dashA), Math.sin(b.dashA), dt, 22);
          for (const o of w.bs) if (o.alive && o.id !== b.id && Math.hypot(o.x - b.x, o.y - b.y) < R * 2 + 0.4) {
            damage(o, 26, b);
            o.kbx += Math.cos(b.dashA) * 14;
            o.kby += Math.sin(b.dashA) * 14;
          }
          continue;
        }

        if (!b.isBot) {
          let dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
          let dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
          if (Math.abs(b.x) > hw) dx += b.x > 0 ? -1 : 1;
          if (Math.abs(b.y) > hh) dy += b.y > 0 ? -1 : 1;
          if (dx || dy) moveBrawler(b, dx, dy, dt, b.kit.move * (b.slowT > 0 ? 0.5 : 1));
          b.aim = Math.atan2(mouse.y - b.y, mouse.x - b.x);
          if (mouse.down) tryShoot(b);
          if (keys.has(" ")) trySuper(b);
        } else {
          botThink(b, w, dt, hw, hh);
        }
      }

      // bullets
      for (const p of w.bullets) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const wall = Math.abs(p.x) > HX || Math.abs(p.y) > HZ || hitsWall(p.x, p.y, 0);
        if (p.life <= 0 || wall) {
          if (p.explode) {
            for (const b of w.bs) if (b.alive && b.id !== p.owner && Math.hypot(b.x - p.x, b.y - p.y) < 3.4) damage(b, p.dmg, w.bs[p.owner] ?? null);
            spawnFx(p.x, p.y, 3.4, "#ff7a2a");
            spawnPuff(p.x, p.y, 8, "#ffb347", 6, 0.4, 3);
          } else if (wall) spawnPuff(p.x, p.y, 3, "#e8e0cf", 3, 0.14); // wall chip
          p.life = 0;
          continue;
        }
        for (const b of w.bs) {
          if (!b.alive || b.id === p.owner || p.hitIds.has(b.id)) continue;
          if (Math.hypot(b.x - p.x, b.y - p.y) < R + (p.big ? 0.4 : 0.24)) {
            damage(b, p.dmg, w.bs[p.owner] ?? null);
            spawnPuff(p.x, p.y, 4, p.color, 4, 0.18); // hit spark in the shooter's colour
            if (p.slow) b.slowT = Math.max(b.slowT, 1.6);
            p.hitIds.add(b.id);
            if (p.explode) {
              for (const o of w.bs) if (o.alive && o.id !== p.owner && Math.hypot(o.x - p.x, o.y - p.y) < 3.4) if (o.id !== b.id) damage(o, p.dmg, w.bs[p.owner] ?? null);
              spawnFx(p.x, p.y, 3.4, "#ff7a2a");
              p.life = 0;
              break;
            }
            if (!p.pierce) {
              p.life = 0;
              break;
            }
          }
        }
      }
      w.bullets = w.bullets.filter((p) => p.life > 0);

      if (aliveCount() <= 1) finish();
    }

    function finish(): void {
      const w = world!;
      if (w.over) return;
      w.over = true;
      const surv = w.bs.find((b) => b.alive);
      if (surv) surv.place = 1;
      const board: ResultRow[] = w.bs.map((b) => ({ name: b.name, color: b.color, place: b.place || 1, isYou: b.id === 0 })).sort((a, z) => a.place - z.place);
      const place = (w.bs[0]!.place || 1);
      const coins = Math.round(15 + (85 * (TOTAL - place)) / (TOTAL - 1));
      useProfile.getState().award(coins);
      setResult({ won: place === 1, place, coins, board });
      setPhase("over");
      tone(place === 1 ? 560 : 300, 0.3, "square", 0.26, place === 1 ? 900 : 90);
    }

    function beginMatch(): void {
      const bs: Brawler[] = roster.map((av, i) => {
        const kit = kitOf(av);
        const [sx, sy] = SPAWN_PTS[i]!;
        return { id: i, av, x: sx, y: sy, aim: Math.atan2(-sy, -sx), hp: kit.hp, maxHp: kit.hp, alive: true, isBot: i > 0, name: i === 0 ? "You" : av.name, color: av.body, kit, ammo: 3, reloadT: 0, cool: 0, sup: 0, cubes: 0, hurt: 0, place: 0, wanderT: 0, strafe: Math.random() < 0.5 ? 1 : -1, shield: 0, slowT: 0, healT: 0, dashT: 0, dashA: 0, kbx: 0, kby: 0 };
      });
      world = { bs, bullets: [], cubes: CUBE_SPOTS.map(([x, y]) => ({ x, y, active: true, respawn: 0 })), walls: [], turrets: [], fx: [], time: 0, shake: 0, over: false, nextPlace: TOTAL };
      setResult(null);
      setPhase("playing");
      void ac.resume();
    }
    beginRef.current = beginMatch;

    // ── input ──
    const down = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
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
        mouse.x = hitPt.x;
        mouse.y = hitPt.z;
      }
    };
    const mdn = (): void => void (mouse.down = true);
    const mup = (): void => void (mouse.down = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    canvas.addEventListener("mousemove", mm);
    canvas.addEventListener("mousedown", mdn);
    window.addEventListener("mouseup", mup);

    function sync(dt: number): void {
      const w = world;
      // creeping danger overlay + pulsing safe-zone border
      const sh = w ? safeHalf(w.time) : { hw: HX, hh: HZ };
      const topH = HZ - sh.hh;
      const sideW = HX - sh.hw;
      dangerMat.opacity = 0.4 + Math.sin((w?.time ?? 0) * 4) * 0.08;
      danger[0]!.visible = topH > 0.02;
      danger[0]!.position.set(0, 0.05, -(sh.hh + topH / 2));
      danger[0]!.scale.set(HX * 2, Math.max(0.001, topH), 1);
      danger[1]!.visible = topH > 0.02;
      danger[1]!.position.set(0, 0.05, sh.hh + topH / 2);
      danger[1]!.scale.set(HX * 2, Math.max(0.001, topH), 1);
      danger[2]!.visible = sideW > 0.02;
      danger[2]!.position.set(-(sh.hw + sideW / 2), 0.05, 0);
      danger[2]!.scale.set(Math.max(0.001, sideW), sh.hh * 2, 1);
      danger[3]!.visible = sideW > 0.02;
      danger[3]!.position.set(sh.hw + sideW / 2, 0.05, 0);
      danger[3]!.scale.set(Math.max(0.001, sideW), sh.hh * 2, 1);
      borders[0]!.position.set(0, 0.14, -sh.hh);
      borders[0]!.scale.set(sh.hw * 2, 1, 1);
      borders[1]!.position.set(0, 0.14, sh.hh);
      borders[1]!.scale.set(sh.hw * 2, 1, 1);
      borders[2]!.position.set(-sh.hw, 0.14, 0);
      borders[2]!.scale.set(0.18, 1, (sh.hh * 2) / 0.18);
      borders[3]!.position.set(sh.hw, 0.14, 0);
      borders[3]!.scale.set(0.18, 1, (sh.hh * 2) / 0.18);

      // camera shake
      if (w && w.shake > 0) camera.position.set(baseCam.x + (Math.random() - 0.5) * 0.5, baseCam.y, baseCam.z + (Math.random() - 0.5) * 0.5);
      else camera.position.copy(baseCam);

      // brawlers
      for (let i = 0; i < pups.length; i++) {
        const pu = pups[i]!;
        const b = w?.bs[i];
        if (!b || !b.alive) {
          pu.puppet.group.visible = false;
          pu.blob.visible = false;
          continue;
        }
        pu.puppet.group.visible = true;
        pu.blob.visible = true;
        pu.blob.position.set(b.x, 0.04, b.y);
        const g = pu.puppet.group;
        g.position.set(b.x, 0, b.y);
        pu.puppet.faceYaw(Math.PI / 2 - b.aim); // snap to aim (twin-stick)
        pu.puppet.animate(b.slowT > 0 ? 2.4 : 4.8, dt);
        // white-hot hit flash (ramped), else green heal / blue slow tint
        if (b.hurt > 0) pu.puppet.rig.tint.emissive.setScalar(b.hurt / 0.12);
        else if (b.healT > 0) pu.puppet.rig.tint.emissive.setRGB(0.1, 0.5, 0.2);
        else if (b.slowT > 0) pu.puppet.rig.tint.emissive.setRGB(0.06, 0.16, 0.32);
        else pu.puppet.rig.tint.emissive.setScalar(0);
        g.scale.setScalar(1.35 + b.hurt * 0.5); // chunky brawler + impact pop
        const frac = Math.max(0, b.hp / b.maxHp);
        pu.fill.scale.x = frac;
        (pu.fill.material as THREE.SpriteMaterial).color.setRGB(b.id === 0 ? 0.3 : 1 - frac, b.id === 0 ? 0.85 : frac, 0.25);
        pu.ring.visible = b.sup >= 100;
        if (pu.ring.visible) pu.ring.scale.setScalar(1 + Math.sin((w?.time ?? 0) * 5) * 0.09);
        for (let k = 0; k < 3; k++) {
          const pm = pu.pips[k]!.material as THREE.SpriteMaterial;
          if (k < b.ammo) {
            pm.color.setHex(0xffcf5a);
            pm.opacity = 1;
          } else if (k === b.ammo && b.ammo < 3) {
            pm.color.setHex(0xffcf5a);
            pm.opacity = 0.3 + (b.reloadT / b.kit.reload) * 0.55; // reloading pip fills
          } else {
            pm.color.setHex(0x2a2a2a);
            pm.opacity = 0.6;
          }
        }
      }

      // bullets
      let bi = 0;
      if (w) for (const p of w.bullets) {
        const m = bulletPool[bi++];
        if (!m) break;
        m.visible = true;
        m.position.set(p.x, 0.7, p.y);
        m.rotation.y = Math.atan2(p.vx, p.vy); // orient along travel
        const s = p.big ? 2 : 1;
        m.scale.set(s, s, s * 2.6); // stretch into a glowing bolt
        (m.material as THREE.MeshBasicMaterial).color.set(p.color);
      }
      for (let j = bi; j < bulletPool.length; j++) bulletPool[j]!.visible = false;

      // cubes
      let ci = 0;
      if (w) for (const c of w.cubes) {
        if (!c.active) continue;
        const m = cubePool[ci++];
        if (!m) break;
        m.visible = true;
        m.position.set(c.x, 0.6 + Math.sin((w.time + c.x) * 3) * 0.12, c.y);
        m.rotation.y += 0.05;
      }
      for (let j = ci; j < cubePool.length; j++) cubePool[j]!.visible = false;

      // temp walls
      let wi = 0;
      if (w) for (const tw of w.walls) {
        const m = tWallPool[wi++];
        if (!m) break;
        m.visible = true;
        m.position.set(tw.x, 0.65, tw.y);
        m.scale.set(tw.hw * 2, 1, tw.hd * 2);
      }
      for (let j = wi; j < tWallPool.length; j++) tWallPool[j]!.visible = false;

      // turrets
      let ti = 0;
      if (w) for (const t of w.turrets) {
        const m = turretPool[ti++];
        if (!m) break;
        m.g.visible = true;
        m.g.position.set(t.x, 0.25, t.y);
        m.g.rotation.y = Math.PI / 2 - t.aim;
      }
      for (let j = ti; j < turretPool.length; j++) turretPool[j]!.g.visible = false;

      // sparks (impacts, muzzle, confetti)
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.vy -= 9 * dt;
        s.x += s.vx * dt;
        s.y = Math.max(0.1, s.y + s.vy * dt);
        s.z += s.vz * dt;
        const sk = Math.max(0, s.life / s.max);
        s.sp.position.set(s.x, s.y, s.z);
        s.sp.scale.setScalar(s.size * (0.35 + sk * 0.9));
        (s.sp.material as THREE.SpriteMaterial).opacity = sk;
        if (s.life <= 0) s.sp.visible = false;
      }

      // ring fx
      let fi = 0;
      if (w) for (const f of w.fx) {
        const m = fxPool[fi++];
        if (!m) break;
        m.visible = true;
        const k = 1 - f.t / f.max;
        m.position.set(f.x, 0.1, f.y);
        m.scale.setScalar(f.r * (0.4 + k * 0.9));
        (m.material as THREE.MeshBasicMaterial).color.set(f.color);
        (m.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      }
      for (let j = fi; j < fxPool.length; j++) fxPool[j]!.visible = false;

      // HUD
      if (aliveRef.current) aliveRef.current.textContent = `Alive: ${aliveCount()}`;
      const meB = w?.bs[0];
      if (meB) {
        if (superRef.current) {
          superRef.current.textContent = meB.sup >= 100 ? `SUPER READY — ${meB.kit.supName} (Space)` : `Super ${Math.floor(meB.sup)}%`;
          superRef.current.style.color = meB.sup >= 100 ? "#ffd23f" : "rgba(255,255,255,0.7)";
        }
        if (hpTextRef.current) hpTextRef.current.textContent = meB.alive ? `❤ ${Math.ceil(meB.hp)} · ${meB.ammo}/3 · ${meB.cubes}◆` : "down";
      }
    }

    let raf = 0;
    let last = performance.now();
    function loop(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (phaseRef.current === "playing") update(dt);
      sync(dt);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      canvas.removeEventListener("mousemove", mm);
      canvas.removeEventListener("mousedown", mdn);
      window.removeEventListener("mouseup", mup);
      void ac.close();
      for (const p of pups) p.puppet.dispose();
      blobTex.dispose();
      glowTex.dispose();
      grassTex.dispose();
      toonRamp.dispose();
      ticksTex.dispose();
      stage.dispose();
    };
  }, []);

  return (
    <main style={{ minHeight: "100vh", padding: 16, maxWidth: 1040, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Brawl: Showdown</h1>
        <button onClick={onLeave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 960, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={960} height={600} style={{ width: "100%", aspectRatio: "960 / 600", background: "#0e1a12", borderRadius: 8, display: "block", cursor: phase === "playing" ? "crosshair" : "default" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 8, boxShadow: "inset 0 0 110px rgba(0,0,0,0.5)" }} />

        {phase === "playing" && (
          <>
            <div ref={aliveRef} style={{ position: "absolute", top: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Alive: 8</div>
            <div ref={hpTextRef} style={{ position: "absolute", bottom: 14, left: 16, color: "#fff", fontWeight: 800, fontSize: 17, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>❤ 100</div>
            <div ref={superRef} style={{ position: "absolute", bottom: 14, right: 16, fontWeight: 800, fontSize: 15, textShadow: "0 1px 3px #000", pointerEvents: "none", color: "rgba(255,255,255,0.7)" }}>Super 0%</div>
          </>
        )}

        {phase !== "playing" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "rgba(8,14,10,0.82)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            {phase === "over" && result && (
              <>
                <div style={{ fontSize: 28, fontWeight: 900, color: result.won ? "#4ade80" : "#ff6a6a" }}>
                  {result.won ? "🏆 You win!" : `Knocked out — #${result.place} of ${TOTAL}`}
                  <div style={{ fontSize: 16, color: "#ffd23f", marginTop: 2 }}>🪙 +{result.coins} coins</div>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", maxWidth: 460 }}>
                  {result.board.slice(0, 4).map((r) => (
                    <span key={r.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: r.isYou ? 800 : 600 }}>
                      <span style={{ color: "var(--muted)" }}>#{r.place}</span>
                      <span style={{ width: 12, height: 12, borderRadius: "50%", background: r.color }} />
                      {r.name}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", background: me.body, border: `2px solid ${me.accent}` }} />
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {me.name} · <span style={{ color: "#ffd23f" }}>{myKit.supName}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{myKit.atk} · Super: {myKit.supDesc}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, opacity: 0.8, maxWidth: 480, lineHeight: 1.5 }}>
              <strong>WASD</strong> move · <strong>mouse</strong> aim · <strong>hold click</strong> fire · <strong>Space</strong> Super. Grab purple cubes to grow. The zone closes in — last brawler standing wins. (Your brawler is your equipped avatar — change it in the Shop.)
            </div>
            <button className="primary" style={{ fontSize: 18, padding: "10px 26px" }} onClick={() => beginRef.current?.()}>
              {phase === "over" ? "Play again" : "Enter Showdown"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
