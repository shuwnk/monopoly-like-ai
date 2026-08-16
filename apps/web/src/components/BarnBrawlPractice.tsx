import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { MinigameResult } from "@party-monopoly/types";
import { avatarRoster, type Avatar, resolveLook } from "../game/avatars.js";
import { animateChar, buildAvatar3D, type Char3D } from "../game/avatar3d.js";
import { createAnnouncer } from "../game/announcer.js";
import { myLook, useProfile } from "../store/profile.js";
import { partyResult, type PartyProps } from "../game/partyRound.js";

// "Barn Brawl" — a 3D third-person arena shooter (Pummel-Party style). MILESTONE 1:
// walk/look/jump around a two-level barn with stairs and cover, with proper
// collision. Weapons, bots and scoring come next.
// WASD move · mouse look · Space jump · click to capture the mouse (Esc to release).

const GRAV = 22;
const MOVE_SPEED = 6.4;
const JUMP_V = 8.4;
const STEP_UP = 0.55;
const MATCH_TIME = 90; // seconds per round
const COUNTDOWN = 3; // pre-round countdown

interface ScoreRow {
  name: string;
  color: string;
  kills: number;
  deaths: number;
  isYou: boolean;
}

type Gun = "pistol" | "shotgun" | "smg" | "rifle";
interface GunDef {
  name: string;
  dmg: number;
  cooldown: number;
  pellets: number;
  spread: number;
  ammo: number;
  kick: number;
  range: number;
  color: number;
}
const GUNS: Record<Gun, GunDef> = {
  pistol: { name: "Pistol", dmg: 24, cooldown: 0.26, pellets: 1, spread: 0.006, ammo: Infinity, kick: 0.012, range: 130, color: 0xffe08a },
  shotgun: { name: "Shotgun", dmg: 13, cooldown: 0.72, pellets: 7, spread: 0.08, ammo: 14, kick: 0.05, range: 42, color: 0xff9a5c },
  smg: { name: "SMG", dmg: 12, cooldown: 0.08, pellets: 1, spread: 0.028, ammo: 50, kick: 0.02, range: 100, color: 0x8ad0ff },
  rifle: { name: "Rifle", dmg: 68, cooldown: 0.9, pellets: 1, spread: 0.001, ammo: 7, kick: 0.06, range: 220, color: 0xa6ff5c },
};
const HEADSHOT_MULT = 2.4; // a clean hit to the head hurts a lot more

// ── bot combat model (real hitscan, replaces the old Math.random() damage roll) ──
// difficulty tiers: aim error, tracking lag, reaction time, fire cadence, engage range,
// damage. Static-but-mixed across the lobby so there's always a killable bot AND a scary
// one — no rubber-banding (keeps every playtest reproducible).
type Tier = "easy" | "normal" | "hard";
interface TierDef {
  sigmaBase: number; // base aim-error half-angle (radians)
  tau: number; // aim-tracking lag (s) — a strafing target outruns the crosshair
  reactionMs: number; // delay before firing on a freshly acquired target
  reactJit: number; // ± jitter on the reaction time
  cdMult: number; // fire-cooldown multiplier (bots fire slower than a human)
  engageMax: number; // max distance a bot will open fire from
  dmgMult: number; // damage scaling vs the flat gun damage
  kMove: number; // how much target lateral speed inflates aim error
}
const BOT_TIERS: Record<Tier, TierDef> = {
  easy: { sigmaBase: 0.055, tau: 0.45, reactionMs: 650, reactJit: 150, cdMult: 2.2, engageMax: 26, dmgMult: 0.45, kMove: 0.18 },
  normal: { sigmaBase: 0.032, tau: 0.3, reactionMs: 400, reactJit: 100, cdMult: 1.8, engageMax: 32, dmgMult: 0.55, kMove: 0.14 },
  hard: { sigmaBase: 0.018, tau: 0.18, reactionMs: 260, reactJit: 80, cdMult: 1.4, engageMax: 40, dmgMult: 0.65, kMove: 0.1 },
};
// per-weapon bot behaviour: respect each gun's effective range + an aim penalty
interface GunAI {
  engageMin: number;
  engageMax: number;
  aimMult: number;
  windupMs: number; // extra reaction on acquire (the rifle "shoulders" before firing)
}
const BOT_GUN: Record<Gun, GunAI> = {
  pistol: { engageMin: 0, engageMax: 34, aimMult: 1.0, windupMs: 0 },
  shotgun: { engageMin: 0, engageMax: 14, aimMult: 0.8, windupMs: 0 }, // holds fire until close
  smg: { engageMin: 0, engageMax: 24, aimMult: 1.25, windupMs: 0 },
  rifle: { engageMin: 12, engageMax: 60, aimMult: 1.3, windupMs: 500 }, // long reach, telegraphed
};
const PLAYER_ID = -1;
const BOT_DPS_CAP = 55; // ceiling on bot damage/sec to the PLAYER (token bucket) — anti-melt
const PLAYER_MERCY = 1.2; // bots can't acquire the player for this long after (re)spawn

export function BarnBrawlPractice({ onLeave, party }: { onLeave: () => void; party?: PartyProps }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitRef = useRef<HTMLDivElement | null>(null);
  const hpRef = useRef<HTMLDivElement | null>(null);
  const scoreRef = useRef<HTMLDivElement | null>(null);
  const vignRef = useRef<HTMLDivElement | null>(null);
  const deadRef = useRef<HTMLDivElement | null>(null);
  const weaponRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const cdRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<"ready" | "countdown" | "playing" | "results">("ready");
  const [results, setResults] = useState<ScoreRow[] | null>(null);
  const beginRef = useRef<(() => void) | null>(null); // lets the button start/restart the match inside the effect
  const partyResultRef = useRef<MinigameResult | null>(null); // ranking handed back when the board round ends
  const N = party ? party.seats.length : 4; // fighters: You + (N-1) bots (== seated board players)

  useEffect(() => {
    const canvas = canvasRef.current!;
    const W = 960;
    const H = 540;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#140e07");
    scene.fog = new THREE.Fog("#1b1208", 14, 52);

    const camera = new THREE.PerspectiveCamera(72, W / H, 0.1, 300);

    // ── lights (dim, moody barn + one warm low sun through the boards) ──
    scene.add(new THREE.HemisphereLight("#ffe6bf", "#221810", 0.34));
    const sun = new THREE.DirectionalLight("#ffcf8c", 1.15);
    sun.position.set(-16, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    (sun.shadow.camera as THREE.OrthographicCamera).left = -28;
    (sun.shadow.camera as THREE.OrthographicCamera).right = 28;
    (sun.shadow.camera as THREE.OrthographicCamera).top = 28;
    (sun.shadow.camera as THREE.OrthographicCamera).bottom = -28;
    scene.add(sun);
    const glow = new THREE.PointLight("#ffb060", 0.35, 34);
    glow.position.set(0, 7, 0);
    scene.add(glow);
    // cool, shadowless fill from opposite the sun so characters never crush to black
    // against the dark wood — warm key / cool fill split keeps the mood but adds a lit edge
    const fill = new THREE.DirectionalLight("#8fb4ff", 0.3);
    fill.position.set(15, 9, -13);
    scene.add(fill);

    // dust motes drifting in the light
    const dustGeo = new THREE.BufferGeometry();
    const dustN = 300;
    const dp = new Float32Array(dustN * 3);
    for (let i = 0; i < dustN; i++) {
      dp[i * 3] = (Math.random() - 0.5) * 54;
      dp[i * 3 + 1] = Math.random() * 9 + 0.4;
      dp[i * 3 + 2] = (Math.random() - 0.5) * 54;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dp, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: "#ffe6b0", size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }));
    scene.add(dust);

    // faked god-ray light shafts
    const shaftMat = new THREE.MeshBasicMaterial({ color: "#ffdca0", transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const [sx, sz, ry] of [[-13, -7, 0.5], [-6, 8, 2.1], [5, -12, 1.2], [12, 3, 0.3], [-2, 15, 2.7]] as const) {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 12), shaftMat);
      shaft.position.set(sx, 4.5, sz);
      shaft.rotation.set(0.22, ry, 0.22);
      scene.add(shaft);
    }

    // ── materials ──
    const floorMat = new THREE.MeshStandardMaterial({ color: "#4e3620", roughness: 1, flatShading: true });
    const wood = new THREE.MeshStandardMaterial({ color: "#6e5334", roughness: 0.9, flatShading: true });
    const darkWood = new THREE.MeshStandardMaterial({ color: "#402c18", roughness: 0.95, flatShading: true });
    const hay = new THREE.MeshStandardMaterial({ color: "#b89438", roughness: 1, flatShading: true });
    const wallMat = new THREE.MeshStandardMaterial({ color: "#5c4527", roughness: 0.95, flatShading: true });

    const walkables: THREE.Mesh[] = []; // surfaces you can stand on (ground raycast)
    const blockers: THREE.Mesh[] = []; // things that stop horizontal movement
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, kind: "walk" | "block" | "both" | "deco"): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y + h / 2, z);
      m.castShadow = kind !== "walk" && kind !== "deco";
      m.receiveShadow = true;
      scene.add(m);
      if (kind === "walk" || kind === "both") walkables.push(m);
      if (kind === "block" || kind === "both") blockers.push(m);
      return m;
    };

    const HALF = 28; // arena half-size (56 × 56)
    const ARENA = HALF * 2;
    const MZ = 4.8; // loft top height

    // floor
    box(ARENA, 0.5, ARENA, floorMat, 0, -0.5, 0, "walk");
    // outer walls (roof open so the sun spills in)
    box(ARENA, 11, 0.6, wallMat, 0, 0, -HALF, "block");
    box(ARENA, 11, 0.6, wallMat, 0, 0, HALF, "block");
    box(0.6, 11, ARENA, wallMat, -HALF, 0, 0, "block");
    box(0.6, 11, ARENA, wallMat, HALF, 0, 0, "block");
    // roof beams
    for (let x = -24; x <= 24; x += 6) box(1, 0.8, ARENA, darkWood, x, 10, 0, "deco").castShadow = true;
    for (let z = -24; z <= 24; z += 8) box(ARENA, 0.6, 0.8, darkWood, 0, 10.4, z, "deco");
    // ground pillars (clear of the open centre)
    for (const px of [-20, -13, 13, 20]) for (const pz of [-18, -6, 6, 18]) box(0.7, 10, 0.7, wood, px, 0, pz, "block");

    // ── barn-plank styling: wall battens, floor seams, glowing windows ──
    for (let i = -HALF + 3; i < HALF; i += 3.4) {
      box(0.24, 11, 0.14, darkWood, i, 0, -HALF + 0.4, "deco");
      box(0.24, 11, 0.14, darkWood, i, 0, HALF - 0.4, "deco");
      box(0.14, 11, 0.24, darkWood, -HALF + 0.4, 0, i, "deco");
      box(0.14, 11, 0.24, darkWood, HALF - 0.4, 0, i, "deco");
    }
    for (let z = -HALF + 2; z < HALF; z += 2.4) box(ARENA, 0.02, 0.1, darkWood, 0, 0.02, z, "deco");
    const winMat = new THREE.MeshBasicMaterial({ color: "#ffe6ac" });
    for (const [wx, wz, ry] of [[-HALF + 0.35, -14, Math.PI / 2], [-HALF + 0.35, 9, Math.PI / 2], [HALF - 0.35, 13, Math.PI / 2], [HALF - 0.35, -7, Math.PI / 2], [-16, HALF - 0.35, 0], [10, HALF - 0.35, 0], [-8, -HALF + 0.35, 0], [15, -HALF + 0.35, 0]] as const) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), winMat);
      win.position.set(wx, 6.8, wz);
      win.rotation.y = ry;
      scene.add(win);
    }

    // ── two side lofts (left x[-28,-8], right x[8,28]) over an open central pit ──
    box(20, 0.5, ARENA, wood, -18, MZ - 0.5, 0, "walk");
    box(20, 0.5, ARENA, wood, 18, MZ - 0.5, 0, "walk");
    for (const pz of [-20, -10, 0, 10, 20]) {
      box(0.5, MZ, 0.5, wood, -9.5, 0, pz, "block");
      box(0.5, MZ, 0.5, wood, 9.5, 0, pz, "block");
    }
    // decorative railings along the open inner edges (you can still drop off)
    box(0.35, 0.75, ARENA, darkWood, -8.2, MZ, 0, "deco");
    box(0.35, 0.75, ARENA, darkWood, 8.2, MZ, 0, "deco");

    // ── two staircases at opposite ends, up to each loft ──
    // Each step is a SOLID block (kind "both") from the ground up to its tread height:
    // walkable on top, but a real wall on the sides so you can't clip through or slip off.
    // Steps overlap slightly along the climb so there are no gaps, and rise 0.4 < STEP_UP.
    function stairs(x0: number, z: number, dir: number): void {
      const n = 12;
      const run = 0.66; // tread depth (along the climb, X)
      const W = 4.8; // width across the climb (Z) — wide enough not to fall off
      for (let i = 0; i < n; i++) box(run + 0.5, ((i + 1) * MZ) / n, W, wood, x0 + dir * (i * run + 0.33), 0, z, "both");
      const slope = -dir * Math.atan2(MZ, run * n);
      const midX = x0 + dir * (run * n * 0.5);
      const topX = x0 + dir * (run * n + 0.2);
      for (const s of [-1, 1]) {
        const rz = z + s * (W / 2 + 0.11);
        // angled stringer + a handrail above it + newel posts at the ends (visual only, thin
        // so they never block the camera)
        box(run * n + 1.2, 0.5, 0.22, darkWood, midX, MZ * 0.5 - 0.25, rz, "deco").rotation.z = slope;
        box(run * n + 1.2, 0.14, 0.14, wood, midX, MZ * 0.5 + 0.6, rz, "deco").rotation.z = slope;
        box(0.18, 1.2, 0.18, darkWood, x0 + dir * 0.2, 0, rz, "deco");
        box(0.18, MZ + 0.9, 0.18, darkWood, topX, 0, rz, "deco");
      }
    }
    stairs(1, -18, 1); // to the right loft (back)
    stairs(-1, 18, -1); // to the left loft (front)

    // ── X-braced crate helper ──
    function crate(x: number, y: number, z: number): void {
      const s = 1.5;
      const h = 1.4;
      box(s, h, s, wood, x, y, z, "both");
      const diag = Math.hypot(s, h) * 0.9;
      const faceX = (dx: number, dz: number, rotY: number): void => {
        const grp = new THREE.Group();
        grp.position.set(x + dx * (s / 2 + 0.02), y + h / 2, z + dz * (s / 2 + 0.02));
        grp.rotation.y = rotY;
        for (const a of [0.72, -0.72]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(diag, 0.13, 0.05), darkWood);
          b.rotation.z = a;
          b.castShadow = true;
          grp.add(b);
        }
        scene.add(grp);
      };
      faceX(0, 1, 0);
      faceX(0, -1, 0);
      faceX(1, 0, Math.PI / 2);
      faceX(-1, 0, Math.PI / 2);
    }

    // ── two catwalk bridges across the centre, linking the lofts into one high level ──
    // deck connects x[-9..9] at loft height; a centre post doubles as ground cover; deco
    // side rails; a crate mid-span makes each bridge a contested high-ground duel spot.
    for (const bz of [-9, 9]) {
      box(18, 0.5, 3.6, wood, 0, MZ - 0.5, bz, "both");
      box(0.6, MZ, 0.6, wood, 0, 0, bz, "block");
      for (const s of [-1, 1]) box(18, 0.7, 0.18, darkWood, 0, MZ, bz + s * 1.85, "deco");
    }

    // ── cover: hay bales, crates, stacks, low walls — a lot more, so the middle isn't a kill field ──
    for (const [x, z] of [[-16, -2], [-21, 9], [-14, 17], [16, -14], [21, -3], [14, 15], [-3, 5], [3, -5], [-6, 6], [6, -6], [7, 9], [-7, -9], [0, -13], [0, 13]] as const)
      box(1.6, 1.4, 1.6, hay, x, 0, z, "both");
    for (const [x, z] of [[-18, -12], [18, 11], [-4, 21], [4, -21], [-24, -22], [23, 22], [6, 6], [-6, -6], [12, 6], [-12, -6]] as const) crate(x, 0, z);
    // low half-walls to peek over and shape lanes (long axis varies)
    for (const [w, d, x, z] of [[5, 1.2, -4, -16], [5, 1.2, 4, 16], [1.2, 5, -14, 3], [1.2, 5, 14, -3]] as const) box(w, 1.05, d, wood, x, 0, z, "both");
    // a couple of taller crate stacks for vertical cover / peeking
    crate(-6, 0, -8);
    box(1.2, 1.2, 1.2, wood, -6, 1.4, -8, "both");
    crate(16, 0, -20);
    box(1.2, 1.2, 1.2, wood, 16, 1.4, -20, "both");
    crate(-16, 0, 20);
    box(1.2, 1.2, 1.2, wood, -16, 1.4, 20, "both");
    // loft + bridge cover (both sides)
    crate(-18, MZ, 8);
    box(1.6, 1.4, 1.6, hay, -21, MZ, -10, "both");
    crate(18, MZ, -8);
    box(1.6, 1.4, 1.6, hay, 21, MZ, 12, "both");
    crate(-14, MZ, -16);
    crate(14, MZ, 16);
    // cover on each bridge — nudged to the inner deck edge so bots have a clear lane past it
    // (the brN/brS nav nodes at z=∓9.8 route through the ~1.95u gap this opens)
    crate(0, MZ, -8.1);
    crate(0, MZ, 8.1);

    // central barrel cluster (like the reference)
    for (const [bx, bz] of [[0, 0], [1.7, 0.6], [-1.6, 1.2]] as const) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.78, 1.5, 12), darkWood);
      barrel.position.set(bx, 0.75, bz);
      barrel.castShadow = true;
      barrel.receiveShadow = true;
      scene.add(barrel);
      blockers.push(barrel);
      walkables.push(barrel); // also stand-on-able, so you can't sink inside it (QA M5)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.06, 6, 14), wood);
      rim.rotation.set(Math.PI / 2, 0, 0);
      rim.position.set(bx, 1.4, bz);
      scene.add(rim);
    }

    // ── characters: the player's picked mascot + distinct ones for the enemies ──
    const roster = avatarRoster(resolveLook(myLook()), N);
    const playerRig = buildAvatar3D(roster[0]!);
    const player = playerRig.group;
    scene.add(player);

    // ── state ──
    // open, obstacle-free spawn points (verified clear of crates, pickups, barrels, pillars)
    const SPAWNS = [
      new THREE.Vector3(0, 0, 7),
      new THREE.Vector3(0, 0, -7),
      new THREE.Vector3(-18, 0, 0),
      new THREE.Vector3(18, 0, 0),
      new THREE.Vector3(-10, 0, -14),
      new THREE.Vector3(10, 0, 14),
    ];
    const pos = SPAWNS[0]!.clone();
    const vel = new THREE.Vector3();
    const hvel = new THREE.Vector3(); // smoothed horizontal velocity
    let yaw = 0;
    let pitch = -0.15;
    let grounded = false;
    let ads = false; // right-click aim-down
    let aimT = 0; // 0 = hip, 1 = aiming (smoothed)
    const keys = new Set<string>();
    const ray = new THREE.Raycaster();
    ray.far = 5;

    // gun in the character's hands — parented to the TORSO, not the root, so it rides
    // the body's bob and twist with the hand that holds it instead of hanging in space
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.66), new THREE.MeshStandardMaterial({ color: "#22242c", roughness: 0.5 }));
    gun.position.set(0.3, 1.02, 0.52);
    gun.castShadow = true;
    playerRig.upper.add(gun);
    const gunBaseZ = gun.position.z; // recoil kicks the held gun back toward this rest pose

    // ── target dummies (Milestone 2) ──
    interface Enemy {
      root: THREE.Group;
      mat: THREE.MeshStandardMaterial;
      fill: THREE.Sprite;
      hp: number;
      alive: boolean;
      respawn: number;
      flash: number;
      pos: THREE.Vector3;
      vel: THREE.Vector3;
      home: THREE.Vector3;
      fireCool: number;
      strafe: number;
      rig: Char3D;
      speed: number;
      grounded: boolean;
      aiming: boolean; // has a target in sight → weapon up
      mdx: number; // eased move direction, so course changes arc instead of snapping
      mdz: number;
      gun: Gun;
      deathPop: number; // >0 while playing the death scale-pop before hiding
      name: string;
      av: Avatar;
      kills: number;
      deaths: number;
      // ── combat model ──
      id: number; // stable target id (0,1,2…); the player is PLAYER_ID
      tier: Tier;
      aimPos: THREE.Vector3; // smoothed virtual crosshair (lags a moving target)
      acqId: number; // id of the target currently being tracked (-2 = none)
      acqTime: number; // sim-time the current target was acquired (drives reaction/warmup)
      lastLosT: number; // last sim-time LOS to the target was clear
      reactDelay: number; // this-acquire's reaction time (s), rolled once per acquire
      shotIndex: number; // shots fired at the current target since acquire (first-shot penalty)
      pvel: THREE.Vector3; // this bot's own planar velocity (for others' lead calc)
      beam: THREE.Line; // rifle telegraph — a laser sight that paints the target during windup
      // ── waypoint navigation ──
      navMode: "direct" | "path";
      path: number[]; // node indices to follow
      pathI: number;
      repathT: number; // countdown to next path recompute
      jitter: number; // per-bot repath phase offset (desyncs the fleet)
      stuckT: number; // stuck-sample timer
      lastNavX: number;
      lastNavZ: number;
      stuckCount: number; // consecutive stuck samples (escalates recovery)
      sidestepT: number;
      sidestepSign: number;
      directForceT: number; // >0 forces direct mode (last-ditch stuck recovery)
      edgePen: Map<string, number>; // edge-key → sim-time the penalty expires
    }
    const ENEMY_HP = 100;
    const enemies: Enemy[] = [];
    const bodies: THREE.Object3D[] = [];
    function makeEnemy(x: number, y: number, z: number, av: Avatar, name: string, tier: Tier): void {
      const c = buildAvatar3D(av, { outline: 0xff5566 }); // hot rim so enemies pop
      const root = c.group;
      root.position.set(x, y, z);
      const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x101010 }));
      bg.position.set(0, 2.5, 0);
      bg.scale.set(1.06, 0.17, 1);
      const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x4ade80 }));
      fill.center.set(0, 0.5);
      fill.position.set(-0.5, 2.5, 0.01);
      fill.scale.set(1, 0.12, 1);
      root.add(bg, fill);
      scene.add(root);
      // rifle telegraph beam (hidden until a rifle bot is winding up a shot)
      const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.visible = false;
      scene.add(beam);
      const e: Enemy = {
        root, mat: c.tint as THREE.MeshStandardMaterial, fill, hp: ENEMY_HP, alive: true, respawn: 0, flash: 0, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), home: new THREE.Vector3(x, y, z), fireCool: 1, strafe: Math.random() < 0.5 ? 1 : -1, rig: c, speed: 0, grounded: true, aiming: false, mdx: 0, mdz: 0, gun: "pistol", deathPop: 0, name, av, kills: 0, deaths: 0,
        id: enemies.length, tier, aimPos: new THREE.Vector3(x, 1.4, z), acqId: -2, acqTime: 0, lastLosT: 0, reactDelay: 0, shotIndex: 0, pvel: new THREE.Vector3(), beam,
        navMode: "direct", path: [], pathI: 0, repathT: 0, jitter: Math.random() * 0.2, stuckT: 0, lastNavX: x, lastNavZ: z, stuckCount: 0, sidestepT: 0, sidestepSign: 1, directForceT: 0, edgePen: new Map<string, number>(),
      };
      for (const m of c.hit) m.userData.enemy = e;
      bodies.push(...c.hit);
      enemies.push(e);
    }
    // mixed lobby: an easy confidence-kill, a baseline, and a scary loft sniper
    // mixed lobby: an easy confidence-kill, a baseline, and a scary loft sniper. In a party
    // round the bots take the other board players' names; standalone keeps Rex/Bruiser/Ziggy.
    const ENEMY_SETUP: Array<[number, number, number, string, Tier]> = [
      [18, 0, -14, "Rex", "normal"],
      [-18, 0, 14, "Bruiser", "easy"],
      [18, 4.8, 2, "Ziggy", "hard"], // starts up on the right loft
    ];
    for (let i = 1; i < N; i++) {
      const [ex, ey, ez, dname, tier] = ENEMY_SETUP[(i - 1) % ENEMY_SETUP.length]!;
      makeEnemy(ex, ey, ez, roster[i]!, party ? party.seats[i]!.name : dname, tier);
    }
    // walls AND floors/lofts/stairs stop bullets and block sight — otherwise you can
    // shoot (and bots can see) straight through the loft planks (QA M2)
    const occluders: THREE.Object3D[] = [...blockers, ...walkables];
    const shootTargets: THREE.Object3D[] = [...occluders, ...bodies]; // the player shoots these
    // bots cast a REAL ray too — so their shots can hit the player, be blocked by cover/floors,
    // or clip a rival bot (friendly fire). The player's own body is tagged so a bot ray registers.
    for (const m of playerRig.hit) m.userData.player = true;
    const botTargets: THREE.Object3D[] = [...occluders, ...bodies, ...playerRig.hit];
    const botRay = new THREE.Raycaster();

    // ── weapon pickups scattered around the barn (ground + lofts) ──
    interface Pickup3D {
      grp: THREE.Group;
      gun: Gun;
      active: boolean;
      respawn: number;
      x: number;
      y: number;
      z: number;
    }
    const pickups: Pickup3D[] = [];
    function makePickup(x: number, y: number, z: number, g: Gun): void {
      const grp = new THREE.Group();
      grp.position.set(x, y + 1, z);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.18), new THREE.MeshStandardMaterial({ color: GUNS[g].color, emissive: GUNS[g].color, emissiveIntensity: 0.5, roughness: 0.4 }));
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.28, 0.16), new THREE.MeshStandardMaterial({ color: "#20242c" }));
      grip.position.set(-0.24, -0.2, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 18), new THREE.MeshBasicMaterial({ color: GUNS[g].color }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.35;
      grp.add(body, grip, ring);
      scene.add(grp);
      pickups.push({ grp, gun: g, active: true, respawn: 0, x, y, z });
    }
    makePickup(-12, 0, 0, "shotgun");
    makePickup(12, 0, 0, "smg");
    makePickup(0, 0, -22, "rifle");
    makePickup(-18, MZ, 4, "smg");
    makePickup(18, MZ, -4, "shotgun");
    makePickup(0, 0, 22, "rifle");

    // ── shooting (hitscan + tracers) ──
    const shootRay = new THREE.Raycaster();
    let fireCool = 0;
    let firing = false;
    let hitmarkT = 0;
    let markKind: "hit" | "head" | "kill" = "hit";
    let curGun: Gun = "pistol";
    let ammo: number = Infinity;
    let recoil = 0;
    const muzzleLight = new THREE.PointLight("#ffe0a0", 0, 10);
    scene.add(muzzleLight);
    const announcer = createAnnouncer();
    // player combat
    let playerHp = 100;
    let playerDead = 0; // respawn timer while dead
    let hurtT = 0;
    let kills = 0;
    let deaths = 0;
    let botBudget = BOT_DPS_CAP; // token bucket capping total bot DPS on the player
    let playerMercyT = 0; // >0 = the player just (re)spawned; bots can't shoot them yet
    const tracers: Array<{ line: THREE.Line; t: number }> = [];
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const blip = (f: number, dur: number, type: OscillatorType, gain: number, sweep?: number): void => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, ac.currentTime);
      if (sweep !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), ac.currentTime + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur);
    };
    // ── particle burst pool (impact puffs on walls, confetti-blood + death pops) ──
    const softTex = (() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 32;
      const g2 = cv.getContext("2d")!;
      const grd = g2.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g2.fillStyle = grd;
      g2.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(cv);
    })();
    interface Particle {
      sprite: THREE.Sprite;
      vel: THREE.Vector3;
      life: number;
      max: number;
      size: number;
      grav: number;
    }
    const particles: Particle[] = [];
    for (let i = 0; i < 90; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.visible = false;
      scene.add(sp);
      particles.push({ sprite: sp, vel: new THREE.Vector3(), life: 0, max: 1, size: 0.2, grav: 0 });
    }
    function burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, n: number, spd: number, size: number, grav: number): void {
      let made = 0;
      for (const p of particles) {
        if (p.life > 0) continue;
        (p.sprite.material as THREE.SpriteMaterial).color.set(color);
        p.sprite.position.set(x, y, z);
        p.vel.set((Math.random() - 0.5) * 2, Math.random() * 1.2 + 0.2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(spd * (0.5 + Math.random()));
        p.life = p.max = 0.22 + Math.random() * 0.18;
        p.size = size * (0.7 + Math.random() * 0.6);
        p.grav = grav;
        p.sprite.visible = true;
        if (++made >= n) break;
      }
    }

    // returns true when the human landed the killing blow (drives the announcer)
    function damageEnemy(e: Enemy, dmg: number, attacker: Enemy | "player" | null = null): boolean {
      if (!e.alive) return false;
      e.hp -= dmg;
      e.flash = 0.12;
      if (e.hp <= 0) {
        e.alive = false;
        e.respawn = 3;
        e.deathPop = 0.22; // scale-pop, then hide (handled in the frame loop)
        e.deaths++;
        burst(e.pos.x, e.pos.y + 1.2, e.pos.z, e.mat.color, 16, 3.4, 0.34, 6); // confetti-blood
        if (attacker === "player") kills++;
        else if (attacker) attacker.kills++;
        blip(180, 0.3, "sawtooth", 0.2, 55);
        return attacker === "player";
      }
      return false;
    }
    function damagePlayer(dmg: number, attacker: Enemy | null = null): void {
      if (playerDead > 0) return;
      playerHp -= dmg;
      hurtT = 0.4;
      if (playerHp <= 0) {
        playerHp = 0;
        playerDead = 3.2;
        deaths++;
        if (attacker) attacker.kills++; // credit the bot that finished you
        firing = false;
        announcer.onDeath(); // breaks the spree / multi-kill chain
        player.visible = false; // hide the corpse during the respawn timer
        blip(150, 0.4, "sawtooth", 0.22, 48);
      }
    }
    // choose the spawn point farthest from current threats, so no one drops into a crossfire
    function pickSpawn(): THREE.Vector3 {
      const threats: THREE.Vector3[] = [];
      if (playerDead <= 0) threats.push(pos);
      for (const e of enemies) if (e.alive) threats.push(e.pos);
      let best = SPAWNS[0]!;
      let bestScore = -Infinity;
      for (const s of SPAWNS) {
        let near = Infinity;
        for (const t of threats) near = Math.min(near, s.distanceTo(t));
        const score = (near === Infinity ? 100 : near) + Math.random() * 2;
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      return best;
    }
    function shoot(): void {
      const gd = GUNS[curGun];
      if (fireCool > 0 || ammo <= 0) return;
      fireCool = gd.cooldown;
      if (ammo !== Infinity) ammo--;
      void ac.resume();
      recoil += gd.kick;
      const base = new THREE.Vector3();
      camera.getWorldDirection(base);
      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const muzzle = new THREE.Vector3(pos.x + fwd.x * 0.7, pos.y + 1.05, pos.z + fwd.z * 0.7);
      muzzleLight.position.copy(muzzle);
      muzzleLight.color.set(gd.color); // each gun flashes in its own colour
      muzzleLight.intensity = curGun === "shotgun" ? 10 : curGun === "rifle" ? 8 : curGun === "smg" ? 4.5 : 6;
      gun.position.z = gunBaseZ - 0.13; // kick the held gun back
      let hitAny = false;
      let hitHead = false;
      let killedAny = false;
      for (let p = 0; p < gd.pellets; p++) {
        const dir = base.clone();
        dir.x += (Math.random() - 0.5) * gd.spread;
        dir.y += (Math.random() - 0.5) * gd.spread;
        dir.z += (Math.random() - 0.5) * gd.spread;
        dir.normalize();
        shootRay.set(camera.position, dir);
        shootRay.far = gd.range;
        const hit = shootRay.intersectObjects(shootTargets, false).find((h) => {
          const e = h.object.userData.enemy as Enemy | undefined;
          return !e || e.alive;
        });
        const end = hit ? hit.point.clone() : camera.position.clone().addScaledVector(dir, gd.range);
        addTracer(muzzle, end, gd.color);
        const e = hit?.object.userData.enemy as Enemy | undefined;
        if (hit) {
          // confetti-blood on a body hit, dusty tan puff on wood
          if (e) burst(end.x, end.y, end.z, e.mat.color, 5, 3, 0.26, 4);
          else burst(end.x, end.y, end.z, 0xc9a86a, 4, 2.2, 0.24, 1.6);
        }
        if (e && e.alive) {
          const head = hit?.object.userData.isHead === true;
          const killed = damageEnemy(e, gd.dmg * (head ? HEADSHOT_MULT : 1), "player");
          hitAny = true;
          if (head) hitHead = true;
          if (killed) {
            killedAny = true;
            announcer.onKill(head); // headshot / multi-kill / spree callouts
          }
        }
      }
      if (killedAny) {
        hitmarkT = 0.34;
        markKind = "kill";
        blip(1350, 0.05, "square", 0.16, 950);
      } else if (hitAny) {
        hitmarkT = 0.16;
        markKind = hitHead ? "head" : "hit";
        blip(hitHead ? 1350 : 900, hitHead ? 0.05 : 0.04, "square", hitHead ? 0.16 : 0.14, hitHead ? 950 : 700);
      }
      blip(curGun === "shotgun" ? 200 : curGun === "rifle" ? 170 : 300, 0.06, curGun === "shotgun" ? "sawtooth" : "square", 0.13, 130);
      if (ammo <= 0) {
        curGun = "pistol";
        ammo = Infinity;
      }
    }
    // ── waypoint navigation graph (fixes M7: bots couldn't reach the lofts/bridges) ──
    // Hand-authored nodes + edges over the real map: ground ring, a node at each stair
    // bottom/top, loft spines, and bridge nodes linking the two lofts. Bots pathfind
    // node→node only to CROSS levels; on the same level they fall back to direct chase,
    // so ground fights are byte-for-byte the old behaviour.
    interface NavNode {
      x: number;
      z: number;
      y: number;
    }
    const NAV_NODES: NavNode[] = [
      { x: 0, z: -5, y: 0 }, // 0 gN  — centre, north of the barrel cluster
      { x: 0, z: 5, y: 0 }, // 1 gS
      { x: -4.5, z: 0, y: 0 }, // 2 gCW — west of barrels (0-1 is blocked by them)
      { x: 4.5, z: 0, y: 0 }, // 3 gCE — drop-landing hub
      { x: 2, z: -13, y: 0 }, // 4 gMidN
      { x: -2, z: 13, y: 0 }, // 5 gMidS
      { x: -2, z: -19, y: 0 }, // 6 gRB — right-stair base
      { x: 2, z: 19, y: 0 }, // 7 gLB — left-stair base
      { x: -17, z: -4, y: 0 }, // 8 gW  — under the left loft
      { x: 17, z: 4, y: 0 }, // 9 gE  — under the right loft
      { x: -15, z: -19, y: 0 }, // 10 gNW
      { x: 15, z: 19, y: 0 }, // 11 gSE
      { x: 18, z: -18.5, y: 0 }, // 12 gNE
      { x: -18, z: 18.5, y: 0 }, // 13 gSW
      { x: 11, z: -18, y: MZ }, // 14 rTop — right-stair top
      { x: 11, z: 0, y: MZ }, // 15 rMid — right loft spine / drop origin
      { x: 10.5, z: -9, y: MZ }, // 16 rBrN
      { x: 10.5, z: 9, y: MZ }, // 17 rBrS
      { x: 11, z: 16, y: MZ }, // 18 rS
      { x: 24, z: 0, y: MZ }, // 19 rE — right loft outer
      { x: -11, z: 18, y: MZ }, // 20 lTop — left-stair top
      { x: -11, z: 0, y: MZ }, // 21 lMid — left loft spine / drop origin
      { x: -10.5, z: 9, y: MZ }, // 22 lBrS
      { x: -10.5, z: -9, y: MZ }, // 23 lBrN
      { x: -11, z: -16, y: MZ }, // 24 lN
      { x: -24, z: 0, y: MZ }, // 25 lW
      { x: 0, z: -9.8, y: MZ }, // 26 brN — north-bridge mid (skirts the moved crate)
      { x: 0, z: 9.8, y: MZ }, // 27 brS — south-bridge mid
    ];
    // [a, b, flag]: "" plain, "S" stair (auto-climbed by step-up), "D" one-way drop off a loft
    const NAV_EDGES: Array<[number, number, string]> = [
      [0, 2, ""], [0, 3, ""], [1, 2, ""], [1, 3, ""], [0, 4, ""], [1, 5, ""], [4, 6, ""], [5, 7, ""],
      [2, 8, ""], [3, 9, ""], [8, 10, ""], [9, 11, ""], [10, 6, ""], [11, 7, ""], [8, 13, ""], [9, 12, ""],
      [6, 14, "S"], [7, 20, "S"], // staircases
      [14, 15, ""], [14, 16, ""], [15, 16, ""], [15, 17, ""], [15, 18, ""], [15, 19, ""], [17, 18, ""], // right loft
      [20, 21, ""], [20, 22, ""], [21, 22, ""], [21, 23, ""], [21, 25, ""], [21, 24, ""], [23, 24, ""], // left loft
      [16, 26, ""], [26, 23, ""], [22, 27, ""], [27, 17, ""], // bridges
      [15, 3, "D"], [21, 2, "D"], // drop off the loft inner edge into the pit
    ];
    const navAdj: Array<Array<{ to: number; w: number; key: string }>> = NAV_NODES.map(() => []);
    for (const [a, b] of NAV_EDGES) {
      const A = NAV_NODES[a]!;
      const B = NAV_NODES[b]!;
      const w = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      navAdj[a]!.push({ to: b, w, key });
    }
    for (const [a, b, flag] of NAV_EDGES) if (flag !== "D") {
      const A = NAV_NODES[a]!;
      const B = NAV_NODES[b]!;
      const w = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      navAdj[b]!.push({ to: a, w, key });
    }
    const MZ_HALF = MZ * 0.5;
    function navLevel(y: number): 0 | 1 {
      return y > MZ_HALF ? 1 : 0;
    }
    // nearest same-level node, preferring one we have LOS to (so we don't snap through a wall)
    function snapNode(x: number, y: number, z: number): number {
      const lvl = navLevel(y);
      let best = -1;
      let bestD = Infinity;
      let bestLos = -1;
      let bestLosD = Infinity;
      for (let i = 0; i < NAV_NODES.length; i++) {
        const n = NAV_NODES[i]!;
        if (navLevel(n.y) !== lvl) continue;
        const d = Math.hypot(x - n.x, z - n.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
        if (d < bestLosD && losClear(x, y + 1.7, z, n.x, n.y + 1.7, n.z)) {
          bestLosD = d;
          bestLos = i;
        }
      }
      return bestLos >= 0 ? bestLos : best;
    }
    // Dijkstra over ~28 nodes (reused scratch arrays — botAI runs bots sequentially, no reentrancy)
    const navDist = new Float64Array(NAV_NODES.length);
    const navPrev = new Int32Array(NAV_NODES.length);
    const navDone = new Uint8Array(NAV_NODES.length);
    function navPath(start: number, goal: number, pen: Map<string, number>, nowT: number): number[] | null {
      if (start < 0 || goal < 0) return null;
      if (start === goal) return [goal];
      navDist.fill(Infinity);
      navDone.fill(0);
      navPrev.fill(-1);
      navDist[start] = 0;
      for (let iter = 0; iter < NAV_NODES.length; iter++) {
        let u = -1;
        let ud = Infinity;
        for (let i = 0; i < NAV_NODES.length; i++) if (navDone[i] === 0 && navDist[i]! < ud) {
          ud = navDist[i]!;
          u = i;
        }
        if (u < 0 || u === goal) break;
        navDone[u] = 1;
        for (const edge of navAdj[u]!) {
          const mult = (pen.get(edge.key) ?? 0) > nowT ? 10 : 1; // penalised edge → route around
          const nd = navDist[u]! + edge.w * mult;
          if (nd < navDist[edge.to]!) {
            navDist[edge.to] = nd;
            navPrev[edge.to] = u;
          }
        }
      }
      if (!isFinite(navDist[goal]!)) return null;
      const out: number[] = [];
      for (let at = goal; at >= 0; at = navPrev[at]!) {
        out.push(at);
        if (at === start) break;
      }
      out.reverse();
      return out;
    }

    // ── bot AI: gravity, waypoint nav across levels, real-hitscan combat ──
    const BOT_SPEED = 4.4;
    function botAI(e: Enemy, dt: number): void {
      const p = e.pos;
      const g = groundAt(p.x, p.y, p.z);
      e.vel.y -= GRAV * dt;
      let ny = p.y + e.vel.y * dt;
      let botGrounded = false;
      if (ny <= g) {
        ny = g;
        e.vel.y = 0;
        botGrounded = true;
      } else if (g > p.y && g - p.y <= STEP_UP) {
        ny = Math.min(g, p.y + 9 * dt);
        e.vel.y = 0;
        botGrounded = true;
      }
      p.y = ny;
      e.grounded = botGrounded; // the rig tucks its legs in the air and absorbs the landing
      if (p.y < -8) {
        p.copy(e.home);
        e.vel.set(0, 0, 0);
        e.navMode = "direct";
      }

      // ── candidate targets: every living rival (the human OR a rival bot — it's a FFA) ──
      const eyeP = p.y + 1.7;
      interface Cand {
        id: number;
        x: number;
        z: number;
        y: number;
        eye: number;
        dist: number;
        los: boolean;
        vx: number;
        vz: number;
        isPlayer: boolean;
      }
      const cands: Cand[] = [];
      if (playerDead <= 0 && playerMercyT <= 0) {
        const d = Math.hypot(pos.x - p.x, pos.z - p.z);
        if (d <= 60) cands.push({ id: PLAYER_ID, x: pos.x, z: pos.z, y: pos.y, eye: pos.y + 1.35, dist: d, los: losClear(p.x, eyeP, p.z, pos.x, pos.y + 1.35, pos.z), vx: hvel.x, vz: hvel.z, isPlayer: true });
      }
      for (const o of enemies) {
        if (o === e || !o.alive) continue;
        const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
        if (d <= 60) cands.push({ id: o.id, x: o.pos.x, z: o.pos.z, y: o.pos.y, eye: o.pos.y + 1.7, dist: d, los: losClear(p.x, eyeP, p.z, o.pos.x, o.pos.y + 1.7, o.pos.z), vx: o.pvel.x, vz: o.pvel.z, isPlayer: false });
      }
      // focus-fire cap: at most 2 bots gang up on the player while any rival bot is available
      let onPlayer = 0;
      for (const o of enemies) if (o !== e && o.alive && o.acqId === PLAYER_ID) onPlayer++;
      const pool = onPlayer >= 2 && cands.some((c) => !c.isPlayer) ? cands.filter((c) => !c.isPlayer) : cands;
      let tgt: Cand | undefined;
      for (const c of pool) if (!tgt || (c.los && !tgt.los) || (c.los === tgt.los && c.dist < tgt.dist)) tgt = c;

      // ── acquire tracking: reaction delay + aim warmup key off acqTime; aimPos lags a mover ──
      const tier = BOT_TIERS[e.tier];
      if (tgt) {
        if (e.acqId !== tgt.id) {
          e.acqId = tgt.id;
          e.acqTime = clock;
          e.lastLosT = clock;
          e.shotIndex = 0;
          e.aimPos.set(tgt.x, tgt.eye - 0.35, tgt.z);
          e.reactDelay = (tier.reactionMs + Math.random() * tier.reactJit + BOT_GUN[e.gun].windupMs) / 1000;
        }
        if (tgt.los) e.lastLosT = clock;
        else if (clock - e.lastLosT > 0.5) {
          e.acqTime = clock; // lost sight for a beat → must re-react before firing again
          e.shotIndex = 0;
        }
        const a = 1 - Math.exp(-dt / tier.tau);
        e.aimPos.x += (tgt.x - e.aimPos.x) * a;
        e.aimPos.y += (tgt.eye - 0.35 - e.aimPos.y) * a;
        e.aimPos.z += (tgt.z - e.aimPos.z) * a;
      } else {
        e.acqId = -2;
      }

      // ── movement: waypoint path to cross levels, else direct chase/strafe ──
      const myLvl = navLevel(p.y);
      const tgtLvl = tgt ? navLevel(tgt.y) : myLvl;
      if (e.directForceT > 0) e.directForceT -= dt;
      e.repathT -= dt;
      if (tgt && e.repathT <= 0) {
        e.repathT = 0.4 + e.jitter;
        if (e.directForceT > 0 || (myLvl === tgtLvl && (tgt.los || tgt.dist < 6))) {
          e.navMode = "direct";
        } else {
          const path = navPath(snapNode(p.x, p.y, p.z), snapNode(tgt.x, tgt.y, tgt.z), e.edgePen, clock);
          if (path && path.length > 1) {
            e.navMode = "path";
            e.path = path;
            e.pathI = 0;
          } else {
            e.navMode = "direct"; // graph miss → never worse than the old direct chase
          }
        }
      }
      if (!tgt) e.navMode = "direct";

      let mvx = 0;
      let mvz = 0;
      let useDirect = e.navMode !== "path";
      if (e.navMode === "path") {
        if (e.path.length === 0) useDirect = true;
        else {
          while (e.pathI < e.path.length) {
            const n = NAV_NODES[e.path[e.pathI]!]!;
            if (Math.hypot(p.x - n.x, p.z - n.z) < 0.9 && navLevel(p.y) === navLevel(n.y)) e.pathI++;
            else break;
          }
          if (e.pathI >= e.path.length) {
            e.navMode = "direct";
            useDirect = true;
          } else {
            const wp = NAV_NODES[e.path[e.pathI]!]!;
            const dx = wp.x - p.x;
            const dz = wp.z - p.z;
            const L = Math.hypot(dx, dz) || 1;
            mvx = dx / L; // straight at the waypoint — path mode never strafes (stays on stairs/bridges)
            mvz = dz / L;
          }
        }
      }
      if (useDirect && tgt) {
        const dxp = tgt.x - p.x;
        const dzp = tgt.z - p.z;
        const dist = tgt.dist || 1;
        const nx = dxp / dist;
        const nz = dzp / dist;
        const PREF = 9;
        if (dist > PREF * 1.2) {
          mvx = nx;
          mvz = nz;
        } else if (dist < PREF * 0.55) {
          mvx = -nx;
          mvz = -nz;
        } else {
          if (Math.random() < 0.02) e.strafe = -e.strafe;
          mvx = -nz * e.strafe;
          mvz = nx * e.strafe;
        }
      }
      // sidestep nudge (stuck recovery) rotates the desired move to slip past a snag
      if (e.sidestepT > 0) {
        e.sidestepT -= dt;
        const ang = e.sidestepSign;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const rx = mvx * c - mvz * s;
        const rz = mvx * s + mvz * c;
        mvx = rx;
        mvz = rz;
      }

      // ease the desired heading: a bot arcs into a new direction and rolls to a stop
      // instead of changing course on a single frame. Steady running is untouched
      // (the vector is already there), so nav timings and pathing don't shift.
      e.mdx += (mvx - e.mdx) * Math.min(1, dt * 10);
      e.mdz += (mvz - e.mdz) * Math.min(1, dt * 10);
      mvx = e.mdx;
      mvz = e.mdz;

      const sp = BOT_SPEED * dt;
      const ox = p.x;
      const oz = p.z;
      if (!blockedMove(p.x, p.y, p.z, mvx * sp, 0)) p.x += mvx * sp;
      if (!blockedMove(p.x, p.y, p.z, 0, mvz * sp)) p.z += mvz * sp;
      p.x = Math.max(-HALF + 0.9, Math.min(HALF - 0.9, p.x));
      p.z = Math.max(-HALF + 0.9, Math.min(HALF - 0.9, p.z));

      // stuck recovery: wants to move but isn't → jump, then sidestep+repath, then bail to direct
      e.stuckT += dt;
      if (e.stuckT >= 0.5) {
        const moved = Math.hypot(p.x - e.lastNavX, p.z - e.lastNavZ);
        if ((mvx !== 0 || mvz !== 0) && moved < 0.35) {
          e.stuckCount++;
          if (e.stuckCount === 1) {
            if (botGrounded) e.vel.y = JUMP_V; // hop a hay bale / crate
          } else if (e.stuckCount === 2) {
            e.sidestepT = 0.4;
            e.sidestepSign = Math.random() < 0.5 ? 1 : -1;
            if (e.navMode === "path" && e.pathI > 0) {
              const a2 = e.path[e.pathI - 1]!;
              const b2 = e.path[e.pathI]!;
              e.edgePen.set(a2 < b2 ? `${a2}-${b2}` : `${b2}-${a2}`, clock + 3); // avoid this edge, re-route
            }
            e.repathT = 0;
          } else {
            e.navMode = "direct";
            e.directForceT = 2; // last-ditch: ignore the graph for a bit
            e.stuckCount = 0;
          }
        } else e.stuckCount = 0;
        e.lastNavX = p.x;
        e.lastNavZ = p.z;
        e.stuckT = 0;
      }

      e.pvel.set((p.x - ox) / Math.max(dt, 1e-4), 0, (p.z - oz) / Math.max(dt, 1e-4));
      e.speed += (Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-4) - e.speed) * Math.min(1, dt * 10);
      e.root.position.copy(p);
      e.aiming = !!tgt && tgt.los; // weapon up only when it can actually see someone
      // turn toward the target instead of snapping to it — an instant pivot is the
      // single most robotic thing a body can do. Fast enough that aim is unaffected.
      if (tgt) {
        let dy = Math.atan2(tgt.x - p.x, tgt.z - p.z) - e.root.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        e.root.rotation.y += dy * Math.min(1, dt * 14);
      }

      // ── fire: real hitscan through the drifted aim point (dodging/cover/range now matter) ──
      e.fireCool = Math.max(0, e.fireCool - dt);
      let charging = false; // rifle winding up → paint the telegraph beam
      if (tgt && tgt.los && e.fireCool <= 0) {
        const gai = BOT_GUN[e.gun];
        const emax = e.gun === "rifle" ? gai.engageMax : Math.min(tier.engageMax, gai.engageMax);
        if (tgt.dist >= gai.engageMin && tgt.dist <= emax) {
          if (clock - e.acqTime >= e.reactDelay) {
            let cd = GUNS[e.gun].cooldown * tier.cdMult * (0.85 + Math.random() * 0.3);
            if (e.gun === "rifle") cd *= 1.3;
            e.fireCool = cd;
            botFire(e, tgt);
          } else if (e.gun === "rifle") {
            charging = true; // still shouldering the rifle — telegraph the incoming shot
          }
        }
      }
      updateBeam(e, charging);
    }

    // rifle telegraph: a red laser sight from the muzzle to the aim point, brightening as the
    // shot nears — so the one-hit weapon reads as a fair, dodgeable threat, not a random snipe.
    function updateBeam(e: Enemy, charging: boolean): void {
      const mat = e.beam.material as THREE.LineBasicMaterial;
      if (!charging) {
        if (e.beam.visible) {
          e.beam.visible = false;
          mat.opacity = 0;
        }
        return;
      }
      const attr = e.beam.geometry.attributes.position as THREE.BufferAttribute;
      attr.setXYZ(0, e.pos.x, e.pos.y + 1.4, e.pos.z);
      attr.setXYZ(1, e.aimPos.x, e.aimPos.y, e.aimPos.z);
      attr.needsUpdate = true;
      e.beam.visible = true;
      const frac = Math.min(1, (clock - e.acqTime) / Math.max(0.001, e.reactDelay));
      mat.opacity = 0.2 + frac * 0.55 + (frac > 0.7 ? Math.abs(Math.sin(clock * 40)) * 0.2 : 0); // flick just before the shot
    }

    // rotate a direction by `theta` about a random axis perpendicular to it → an aim-error cone
    function perturbDir(dir: THREE.Vector3, theta: number): THREE.Vector3 {
      const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const perp = new THREE.Vector3().crossVectors(dir, up).normalize();
      perp.applyAxisAngle(dir, Math.random() * Math.PI * 2); // random azimuth around the aim axis
      return dir.clone().applyAxisAngle(perp, theta);
    }
    // a bot's shot: cast a real ray per pellet through the smoothed aim point + error, and let
    // it hit whatever it hits — the player, cover, a floor, or a rival bot (friendly fire).
    function botFire(e: Enemy, tgt: { dist: number; x: number; z: number; vx: number; vz: number }): void {
      const gd = GUNS[e.gun];
      const tier = BOT_TIERS[e.tier];
      const gai = BOT_GUN[e.gun];
      const muzzle = new THREE.Vector3(e.pos.x, e.pos.y + 1.4, e.pos.z);
      const dist = tgt.dist || 1;
      // target lateral speed relative to the bot → the crosshair can't keep up = dodging works
      const tox = tgt.x - e.pos.x;
      const toz = tgt.z - e.pos.z;
      const tl = Math.hypot(tox, toz) || 1;
      const nx = tox / tl;
      const nz = toz / tl;
      const along = tgt.vx * nx + tgt.vz * nz;
      const vLat = Math.hypot(tgt.vx - along * nx, tgt.vz - along * nz);
      const trackT = clock - e.acqTime;
      const sigma =
        tier.sigmaBase *
        (1 + dist / 60) * // farther = wider error
        (1 + tier.kMove * vLat) * // moving target = wider error
        (1 + 0.6 * Math.max(0, 1 - trackT / 1.5)) * // aim tightens over ~1.5s of tracking
        (e.shotIndex === 0 ? 1.5 : 1) * // first shot after acquire is a "warning"
        gai.aimMult;
      const baseDir = new THREE.Vector3(e.aimPos.x - muzzle.x, e.aimPos.y - muzzle.y, e.aimPos.z - muzzle.z).normalize();
      for (let pel = 0; pel < gd.pellets; pel++) {
        const gauss = Math.random() + Math.random() + Math.random() - 1.5; // ~N(0, 0.5)
        const theta = Math.abs(gauss) * 1.6 * sigma + (gd.pellets > 1 ? Math.random() * gd.spread : 0);
        const dir = perturbDir(baseDir, theta);
        botRay.set(muzzle, dir);
        botRay.far = gd.range;
        let end = muzzle.clone().addScaledVector(dir, gd.range);
        for (const h of botRay.intersectObjects(botTargets, false)) {
          const en = h.object.userData.enemy as Enemy | undefined;
          const isPl = h.object.userData.player === true;
          if (en === e) continue; // never shoot self
          if (en && !en.alive) continue; // ignore corpses
          if (isPl && playerDead > 0) continue; // ignore the hidden player corpse
          end = h.point.clone();
          if (en) {
            damageEnemy(en, gd.dmg * tier.dmgMult, e); // friendly fire counts toward kills
            burst(end.x, end.y, end.z, en.mat.color, 4, 2.6, 0.24, 4);
          } else if (isPl) {
            const dmg = gd.dmg * tier.dmgMult;
            if (dmg <= botBudget) {
              botBudget -= dmg; // spend from the DPS bucket
              damagePlayer(dmg, e);
              burst(end.x, end.y, end.z, 0xff6b6b, 4, 2.6, 0.24, 4);
            } // else: over the melt cap → this shot whistles past (tracer still shows)
          } else {
            burst(end.x, end.y, end.z, 0xc9a86a, 3, 2, 0.2, 1.6); // cover/wood impact
          }
          break; // first solid thing stops the ray
        }
        addTracer(muzzle, end, 0xff5c5c); // tracer to the ACTUAL hit point — misses whistle past
      }
      e.shotIndex++;
    }

    const DOWN = new THREE.Vector3(0, -1, 0);
    const losRay = new THREE.Raycaster();
    const camRay = new THREE.Raycaster();
    const camColliders = [...blockers, ...walkables]; // camera doesn't clip through these
    // highest walkable surface just below a point (for standing / step-up)
    function groundAt(px: number, py: number, pz: number): number {
      ray.set(new THREE.Vector3(px, py + 2, pz), DOWN);
      ray.far = 6;
      let best = -Infinity;
      for (const h of ray.intersectObjects(walkables, false)) if (h.point.y <= py + STEP_UP && h.point.y > best) best = h.point.y;
      return best;
    }
    // would moving (dx,dz) from a point run into a wall/pillar/crate?
    function blockedMove(px: number, py: number, pz: number, dx: number, dz: number): boolean {
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-4) return false;
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      const rad = 0.38;
      const perpx = -dir.z * rad;
      const perpz = dir.x * rad;
      // cast from the centre AND both side edges so walls can't slip past the radius
      for (const o of [0, 1, -1]) {
        ray.set(new THREE.Vector3(px + perpx * o, py + 0.9, pz + perpz * o), dir);
        ray.far = dist + rad;
        if (ray.intersectObjects(blockers, false).length > 0) return true;
      }
      return false;
    }
    // clear line of sight between two world points (blockers only)?
    function losClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
      const from = new THREE.Vector3(ax, ay, az);
      const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
      const d = dir.length();
      losRay.set(from, dir.normalize());
      losRay.far = d - 0.4;
      return losRay.intersectObjects(occluders, false).length === 0;
    }
    function addTracer(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, transparent: true }));
      scene.add(line);
      tracers.push({ line, t: 0.06 });
    }

    // ── match state machine (ready → countdown → playing → results) ──
    let mode: "ready" | "countdown" | "playing" | "results" = "ready";
    let cdT = 0; // countdown remaining
    let mtime = 0; // match time remaining

    function beginMatch(): void {
      // reset the whole arena for a fresh round
      kills = 0;
      deaths = 0;
      playerHp = 100;
      playerDead = 0;
      hurtT = 0;
      curGun = "pistol";
      ammo = Infinity;
      firing = false;
      botBudget = BOT_DPS_CAP;
      playerMercyT = 0;
      pos.copy(SPAWNS[0]!);
      vel.set(0, 0, 0);
      hvel.set(0, 0, 0);
      player.visible = true;
      for (const e of enemies) {
        e.kills = 0;
        e.deaths = 0;
        e.hp = ENEMY_HP;
        e.alive = true;
        e.deathPop = 0;
        e.gun = "pistol";
        e.root.visible = true;
        e.root.scale.setScalar(1);
        e.pos.copy(e.home);
        e.vel.set(0, 0, 0);
        e.root.position.copy(e.pos);
        // reset combat + nav state so a restart is a clean slate
        e.acqId = -2;
        e.acqTime = 0;
        e.lastLosT = 0;
        e.shotIndex = 0;
        e.reactDelay = 0;
        e.fireCool = 1;
        e.aimPos.set(e.home.x, e.home.y + 1.4, e.home.z);
        e.pvel.set(0, 0, 0);
        e.mdx = 0;
        e.mdz = 0;
        e.navMode = "direct";
        e.path = [];
        e.pathI = 0;
        e.repathT = 0;
        e.stuckCount = 0;
        e.stuckT = 0;
        e.lastNavX = e.home.x;
        e.lastNavZ = e.home.z;
        e.sidestepT = 0;
        e.directForceT = 0;
        e.edgePen.clear();
        updateBeam(e, false);
      }
      for (const pk of pickups) {
        pk.active = true;
        pk.grp.visible = true;
        pk.respawn = 0;
      }
      announcer.reset();
      cdT = COUNTDOWN;
      mtime = MATCH_TIME;
      mode = "countdown";
      setResults(null);
      setPhase("countdown");
      canvas.requestPointerLock();
    }
    beginRef.current = beginMatch;

    function finishMatch(): void {
      mode = "results";
      firing = false;
      for (const e of enemies) updateBeam(e, false); // no lingering telegraph beams on the scoreboard
      const board: ScoreRow[] = [{ name: "You", color: roster[0]!.body, kills, deaths, isYou: true }, ...enemies.map((e) => ({ name: e.name, color: e.av.body, kills: e.kills, deaths: e.deaths, isYou: false }))];
      board.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const place = board.findIndex((r) => r.isYou) + 1;
      if (party) {
        // rank every fighter (You = fighter 0, enemies follow) by kills → placement payout
        const scored = [{ kills, deaths, i: 0 }, ...enemies.map((e, idx) => ({ kills: e.kills, deaths: e.deaths, i: idx + 1 }))];
        scored.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
        const places: number[] = new Array(N).fill(N);
        scored.forEach((f, rank) => (places[f.i] = rank + 1));
        partyResultRef.current = partyResult(party.minigameId, party.seats, places);
      } else {
        useProfile.getState().award(20 + kills * 4 + Math.max(0, board.length - place) * 6); // everyone earns something
      }
      setResults(board);
      setPhase("results");
      if (document.pointerLockElement) document.exitPointerLock();
    }

    let raf = 0;
    let last = performance.now();
    let clock = 0;
    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt; // sim clock (drives bot reaction/aim-warmup timing) — must lead botAI
      botBudget = Math.min(BOT_DPS_CAP, botBudget + BOT_DPS_CAP * dt); // refill the anti-melt bucket
      playerMercyT = Math.max(0, playerMercyT - dt);

      // advance the match clock
      if (mode === "countdown") {
        cdT -= dt;
        if (cdRef.current) cdRef.current.textContent = cdT > 0 ? String(Math.ceil(cdT)) : "BRAWL!";
        if (cdT <= -0.6) {
          mode = "playing";
          setPhase("playing");
        }
      } else if (mode === "playing") {
        mtime -= dt;
        if (mtime <= 0) finishMatch();
        else if (timerRef.current) {
          const s = Math.max(0, Math.ceil(mtime));
          timerRef.current.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
          timerRef.current.style.color = mtime <= 10 ? (Math.floor(mtime * 3) % 2 === 0 ? "#ff4d4d" : "#fff") : "#fff";
        }
      }
      const playing = mode === "playing"; // sim (bots, fire, pickups) only runs in-match

      // death / respawn
      hurtT = Math.max(0, hurtT - dt);
      if (playerDead > 0) {
        playerDead -= dt;
        if (playerDead <= 0) {
          playerHp = 100;
          pos.copy(pickSpawn());
          vel.set(0, 0, 0);
          hvel.set(0, 0, 0);
          firing = false; // require a fresh click, don't auto-fire on respawn
          player.visible = true;
          playerMercyT = PLAYER_MERCY; // brief grace so you don't get shot the instant you respawn
        }
      }
      const alive = playerDead <= 0;

      const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      // screen-right in this right-handed, +z-forward frame is -(up × fwd)
      const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
      const canMove = alive && playing;
      const fi = canMove ? (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0) : 0;
      const si = canMove ? (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0) : 0;
      // target velocity from input, then ease toward it (smooth start/stop)
      let tx = fwd.x * fi + right.x * si;
      let tz = fwd.z * fi + right.z * si;
      const tl = Math.hypot(tx, tz);
      if (tl > 0) {
        tx = (tx / tl) * MOVE_SPEED;
        tz = (tz / tl) * MOVE_SPEED;
      }
      hvel.x += (tx - hvel.x) * Math.min(1, dt * 22);
      hvel.z += (tz - hvel.z) * Math.min(1, dt * 22);
      const sxm = hvel.x * dt;
      const szm = hvel.z * dt;
      if (!blockedMove(pos.x, pos.y, pos.z, sxm, 0)) pos.x += sxm;
      else hvel.x = 0;
      if (!blockedMove(pos.x, pos.y, pos.z, 0, szm)) pos.z += szm;
      else hvel.z = 0;
      pos.x = Math.max(-HALF + 0.9, Math.min(HALF - 0.9, pos.x));
      pos.z = Math.max(-HALF + 0.9, Math.min(HALF - 0.9, pos.z));
      // the character always faces where you're aiming (camera direction), and
      // strafes/backpedals — it does NOT spin toward its movement direction
      let dRot = yaw - player.rotation.y;
      while (dRot > Math.PI) dRot -= Math.PI * 2;
      while (dRot < -Math.PI) dRot += Math.PI * 2;
      player.rotation.y += dRot * Math.min(1, dt * 18);

      // vertical: gravity + smooth step-up + landing
      const ground = groundAt(pos.x, pos.y, pos.z);
      vel.y -= GRAV * dt;
      let ny = pos.y + vel.y * dt;
      if (ny <= ground) {
        ny = ground;
        vel.y = 0;
        grounded = true;
      } else if (ground > pos.y && ground - pos.y <= STEP_UP) {
        ny = Math.min(ground, pos.y + 9 * dt); // climb steps smoothly instead of snapping
        vel.y = 0;
        grounded = true;
      } else {
        grounded = false;
      }
      pos.y = ny;
      if (pos.y < -10) {
        pos.set(-12, 0, 0);
        vel.set(0, 0, 0);
      }

      player.position.copy(pos);
      // hand the rig the actual velocity, not just its length: the body faces where you
      // aim, so strafing and backpedalling have to stride sideways/backwards
      // aim: 1 — you always have a gun in your hands, so the arms hold it rather
      // than swinging past it
      animateChar(playerRig, Math.hypot(hvel.x, hvel.z), dt, { vx: hvel.x, vz: hvel.z, grounded, aim: 1 });

      // third-person over-the-shoulder camera, tightening when aiming (ADS)
      aimT += ((ads && alive ? 1 : 0) - aimT) * Math.min(1, dt * 12);
      const camDist = 5.6 - aimT * 2.3;
      const shoulder = 1.2 - aimT * 0.35;
      const fov = 72 - aimT * 24;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      // recoil kicks the view up briefly; muzzle flash fades
      recoil = Math.max(0, recoil - dt * (0.4 + recoil * 5));
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 90);
      gun.position.z += (gunBaseZ - gun.position.z) * Math.min(1, dt * 14); // settle recoil kick
      const vpitch = pitch + recoil;
      // pull the camera in if a wall/loft is behind the player, so the view is never blocked
      const head = new THREE.Vector3(pos.x + right.x * shoulder, pos.y + 2.2, pos.z + right.z * shoulder);
      const desired = new THREE.Vector3(pos.x - fwd.x * camDist + right.x * shoulder, pos.y + 2.5 - vpitch * 2.5, pos.z - fwd.z * camDist + right.z * shoulder);
      const toCam = desired.clone().sub(head);
      const wantLen = toCam.length();
      toCam.normalize();
      camRay.set(head, toCam);
      camRay.far = wantLen;
      const chit = camRay.intersectObjects(camColliders, false)[0];
      camera.position.copy(head).addScaledVector(toCam, chit ? Math.max(0.9, chit.distance - 0.3) : wantLen);
      camera.lookAt(pos.x + fwd.x * 3 + right.x * shoulder, pos.y + 1.5 + vpitch * 4, pos.z + fwd.z * 3 + right.z * shoulder);

      // shooting
      fireCool = Math.max(0, fireCool - dt);
      if (playing && firing && alive && document.pointerLockElement === canvas && fireCool <= 0) shoot();
      for (let i = tracers.length - 1; i >= 0; i--) {
        const tr = tracers[i]!;
        tr.t -= dt;
        (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.t / 0.06);
        if (tr.t <= 0) {
          scene.remove(tr.line);
          tr.line.geometry.dispose();
          (tr.line.material as THREE.Material).dispose();
          tracers.splice(i, 1);
        }
      }
      // impact/confetti particles: drift, gravity, shrink + fade, then recycle
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.life -= dt;
        p.vel.y -= p.grav * dt;
        p.sprite.position.addScaledVector(p.vel, dt);
        const k = Math.max(0, p.life / p.max);
        (p.sprite.material as THREE.SpriteMaterial).opacity = k;
        p.sprite.scale.setScalar(p.size * (0.4 + k * 0.6));
        if (p.life <= 0) p.sprite.visible = false;
      }
      // enemies: bot AI, flash, hp bars, respawn
      for (const e of enemies) {
        if (!e.alive) {
          if (e.beam.visible) updateBeam(e, false); // kill the telegraph if it died mid-charge
          if (e.deathPop > 0) {
            e.deathPop -= dt;
            const tt = 1 - Math.max(0, e.deathPop) / 0.22; // 0→1 over the pop
            e.root.scale.setScalar(tt < 0.4 ? 1 + tt * 0.65 : Math.max(0.02, 1.26 - (tt - 0.4) * 2.1));
            if (e.deathPop <= 0) e.root.visible = false;
          }
          e.respawn -= dt;
          if (e.respawn <= 0) {
            e.hp = ENEMY_HP;
            e.alive = true;
            e.root.visible = true;
            e.root.scale.setScalar(1);
            e.pos.copy(pickSpawn()); // spread bot respawns so they can't be farmed at a fixed home
            e.vel.set(0, 0, 0);
            e.mdx = 0;
            e.mdz = 0;
            e.root.position.copy(e.pos);
          }
          continue;
        }
        if (playing) botAI(e, dt);
        // a bot brings its weapon up when it has someone to shoot, and lets its arms
        // swing while it's just travelling
        animateChar(e.rig, e.speed, dt, { vx: e.pvel.x, vz: e.pvel.z, grounded: e.grounded, aim: e.aiming ? 1 : 0 });
        e.flash = Math.max(0, e.flash - dt);
        e.mat.emissive.setScalar(Math.min(0.8, e.flash * 5));
        const frac = Math.max(0, e.hp / ENEMY_HP);
        e.fill.scale.x = frac;
        (e.fill.material as THREE.SpriteMaterial).color.setRGB(1 - frac, frac, 0.2);
      }

      // weapon pickups (float/spin, grabbed by whoever walks over)
      for (const pk of pickups) {
        if (!pk.active) {
          pk.respawn -= dt;
          if (pk.respawn <= 0) {
            pk.active = true;
            pk.grp.visible = true;
          }
          continue;
        }
        pk.grp.rotation.y += dt * 1.6;
        pk.grp.position.y = pk.y + 1 + Math.sin(clock * 2 + pk.x) * 0.1;
        if (!playing) continue; // pickups only get grabbed once the match is live
        if (alive && Math.hypot(pos.x - pk.x, pos.z - pk.z) < 1.3 && Math.abs(pos.y - pk.y) < 1.6) {
          curGun = pk.gun;
          ammo = GUNS[pk.gun].ammo;
          pk.active = false;
          pk.grp.visible = false;
          pk.respawn = 10;
          blip(560, 0.14, "square", 0.2, 980);
          continue;
        }
        for (const e of enemies)
          if (e.alive && Math.hypot(e.pos.x - pk.x, e.pos.z - pk.z) < 1.3 && Math.abs(e.pos.y - pk.y) < 1.6) {
            e.gun = pk.gun;
            pk.active = false;
            pk.grp.visible = false;
            pk.respawn = 10;
            break;
          }
      }

      // HUD
      hitmarkT = Math.max(0, hitmarkT - dt);
      if (hitRef.current) {
        const el = hitRef.current;
        el.style.opacity = hitmarkT > 0 ? "1" : "0";
        const k = Math.min(1, hitmarkT / (markKind === "kill" ? 0.34 : 0.16));
        el.style.transform = `scale(${1 + k * 0.7}) rotate(${markKind === "head" ? 45 : 0}deg)`;
        el.style.color = markKind === "kill" ? "#ff3b3b" : markKind === "head" ? "#ffd23f" : "#fff";
      }
      if (weaponRef.current) weaponRef.current.textContent = ammo === Infinity ? GUNS[curGun].name : `${GUNS[curGun].name} · ${ammo}`;
      if (hpRef.current) hpRef.current.style.width = `${Math.max(0, playerHp)}%`;
      if (scoreRef.current) scoreRef.current.textContent = `Kills ${kills}  ·  Deaths ${deaths}`;
      if (vignRef.current) vignRef.current.style.opacity = String(Math.min(0.55, hurtT));
      if (deadRef.current) deadRef.current.style.display = playerDead > 0 ? "grid" : "none";
      if (deadRef.current && playerDead > 0) deadRef.current.textContent = `Respawning in ${Math.ceil(playerDead)}…`;

      dust.rotation.y += dt * 0.03;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // ── input ──
    const kd = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (["w", "a", "s", "d", " "].includes(k)) e.preventDefault();
      if (k === " " && grounded && playerDead <= 0) vel.y = JUMP_V;
    };
    const ku = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    const mv = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) return;
      const sens = 0.0024 * (1 - aimT * 0.5); // slower, steadier aim when zoomed
      yaw -= e.movementX * sens;
      pitch = Math.max(-0.9, Math.min(0.9, pitch - e.movementY * (0.0022 * (1 - aimT * 0.5))));
    };
    const mdn = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0 && playerDead <= 0) firing = true;
      if (e.button === 2) ads = true;
    };
    const mup = (e: MouseEvent): void => {
      if (e.button === 0) firing = false;
      if (e.button === 2) ads = false;
    };
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mv);
    window.addEventListener("mousedown", mdn);
    window.addEventListener("mouseup", mup);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mousedown", mdn);
      window.removeEventListener("mouseup", mup);
      announcer.dispose();
      void ac.close();
      scene.traverse((o) => {
        // dispose whatever carries GPU resources — Meshes, Points, Lines AND Sprites
        const r = o as unknown as { geometry?: { dispose(): void }; material?: THREE.Material | THREE.Material[] };
        if (r.geometry) r.geometry.dispose();
        if (r.material) (Array.isArray(r.material) ? r.material : [r.material]).forEach((m) => m.dispose());
      });
      softTex.dispose();
      renderer.dispose();
      // NOTE: do NOT forceContextLoss() here — StrictMode remounts on the SAME canvas,
      // and a force-lost context is dead permanently for that canvas → blank screen.
    };
  }, []);

  const inMatch = phase === "playing" || phase === "countdown";

  return (
    <main style={{ minHeight: "100vh", padding: 16, maxWidth: 1040, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Barn Brawl</h1>
        <button onClick={onLeave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 960, margin: "0 auto" }}>
        <canvas
          ref={canvasRef}
          width={960}
          height={540}
          onClick={() => phase === "playing" && document.pointerLockElement !== canvasRef.current && canvasRef.current?.requestPointerLock()}
          style={{ width: "100%", aspectRatio: "16 / 9", background: "#1c150d", borderRadius: 8, display: "block", cursor: phase === "playing" ? "none" : "default" }}
        />

        {inMatch && (
          <>
            <div ref={vignRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0, boxShadow: "inset 0 0 120px 40px #b01818", borderRadius: 8 }} />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "grid", placeItems: "center" }}>
              <div style={{ position: "relative", width: 22, height: 22 }}>
                <div style={{ position: "absolute", left: 10, top: 0, width: 2, height: 22, background: "rgba(255,255,255,0.8)" }} />
                <div style={{ position: "absolute", top: 10, left: 0, width: 22, height: 2, background: "rgba(255,255,255,0.8)" }} />
                <div ref={hitRef} style={{ position: "absolute", inset: -6, opacity: 0, color: "#ff5c5c", fontWeight: 900, fontSize: 22, lineHeight: "1", textAlign: "center" }}>✕</div>
              </div>
            </div>
            <div ref={timerRef} style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center", color: "#fff", fontWeight: 900, fontSize: 26, textShadow: "0 1px 4px #000", pointerEvents: "none" }}>1:30</div>
            <div ref={scoreRef} style={{ position: "absolute", top: 12, right: 16, color: "#fff", fontWeight: 800, fontSize: 16, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Kills 0 · Deaths 0</div>
            <div style={{ position: "absolute", left: 16, bottom: 16, width: 200, height: 16, background: "rgba(0,0,0,0.55)", borderRadius: 4, overflow: "hidden", pointerEvents: "none" }}>
              <div ref={hpRef} style={{ width: "100%", height: "100%", background: "linear-gradient(90deg,#ff5c5c,#4ade80)" }} />
            </div>
            <div ref={weaponRef} style={{ position: "absolute", right: 16, bottom: 16, color: "#fff", fontWeight: 800, fontSize: 17, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Pistol</div>
            <div ref={deadRef} style={{ position: "absolute", inset: 0, display: "none", placeItems: "center", background: "rgba(60,10,10,0.5)", borderRadius: 8, color: "#fff", fontWeight: 900, fontSize: 30, pointerEvents: "none" }}>Respawning…</div>
          </>
        )}

        {phase === "countdown" && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div ref={cdRef} style={{ fontSize: 92, fontWeight: 900, color: "#ffe6bf", textShadow: "0 3px 18px #000", letterSpacing: 2 }}>3</div>
          </div>
        )}

        {phase === "ready" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(20,12,6,0.82)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#ffe6bf" }}>Barn Brawl</div>
            <div style={{ fontSize: 15, opacity: 0.85, maxWidth: 460, lineHeight: 1.5 }}>
              <strong>WASD</strong> move · <strong>mouse</strong> look · <strong>left-click</strong> fire · <strong>right-click</strong> aim · <strong>Space</strong> jump. Most kills in {MATCH_TIME} seconds wins. Grab weapons, take the high ground, aim for the head.
            </div>
            <button className="primary" style={{ fontSize: 18, padding: "10px 26px" }} onClick={() => beginRef.current?.()}>
              Start Brawl
            </button>
          </div>
        )}

        {phase === "results" && results && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "rgba(18,11,5,0.9)", borderRadius: 8, textAlign: "center", padding: 20 }}>
            <div style={{ fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "var(--muted)" }}>Round Over</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: results[0]!.isYou ? "#4ade80" : "#ffd23f" }}>
              {results[0]!.isYou ? "You win!" : `${results[0]!.name} wins`}
            </div>
            <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {results.map((r, i) => (
                <div
                  key={r.name}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px 18px 1fr auto auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    background: r.isYou ? "rgba(255,226,140,0.16)" : "rgba(255,255,255,0.05)",
                    border: i === 0 ? "1px solid #ffd23f" : "1px solid transparent",
                    fontWeight: r.isYou ? 800 : 600,
                  }}
                >
                  <span style={{ color: "var(--muted)" }}>#{i + 1}</span>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: r.color, justifySelf: "center" }} />
                  <span style={{ textAlign: "left" }}>{r.name}</span>
                  <span style={{ color: "#4ade80" }}>{r.kills} K</span>
                  <span style={{ color: "#ff8a8a" }}>{r.deaths} D</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              {party ? (
                <button className="primary" style={{ fontSize: 16, padding: "9px 22px" }} onClick={() => party.onResult(partyResultRef.current!)}>
                  Continue →
                </button>
              ) : (
                <>
                  <button className="primary" style={{ fontSize: 16, padding: "9px 22px" }} onClick={() => beginRef.current?.()}>
                    Play Again
                  </button>
                  <button style={{ fontSize: 16, padding: "9px 22px" }} onClick={onLeave}>
                    Leave
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Click the view to capture the mouse · Esc to release</p>
    </main>
  );
}
