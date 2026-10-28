import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { MinigameResult } from "@party-monopoly/types";
import { avatarRoster, type Avatar, resolveLook } from "../game/avatars.js";
import { animateChar, buildAvatar3D, type Char3D } from "../game/avatar3d.js";
import { bound, isGameKey, moveVector } from "../game/keybinds.js";
import { createAnnouncer } from "../game/announcer.js";
import { myLook, useProfile } from "../store/profile.js";
import { partyResult, type PartyProps } from "../game/partyRound.js";
import { BARN_BRAWL_MOVER, CharacterMover } from "../game/characterMover.js";
import { BARN_BRAWL_CAMERA, PUMMEL_FOV, ThirdPersonCamera, type RaycastFn } from "../game/thirdPersonCamera.js";

// "Barn Brawl" — a port of Pummel Party's Barn Brawl: a one-shot shotgun scramble in a
// two-level barn. Everyone spawns unarmed; shotguns appear around the barn; picking one
// up gives you exactly one shot; the shot sprays 3–5 pellets and any pellet kills; the gun
// flies out of your hands when you fire. 50 points a kill, most points after 75 s wins.
// Movement and camera are the ported CharacterMover / ThirdPersonCamera.
//
// Sources: ~/Projects/rea-work/pummel-party/decompiled/Assembly-CSharp/BarnBrawlPlayer.cs,
// BarnBrawlController.cs and extracted/minigames/barnbrawl.json. Numbers are cited inline;
// only tuning and structure are reused, never the game's assets.
// WASD move · mouse look · click fire · Space jump · click the view to capture the mouse.

const STEP_UP = 0.55; // stair rise climbed without a jump (the CharacterController's stepOffset)
const COUNTDOWN = 3;
const ROUND_LENGTH = 75; // BarnBrawlController.roundLength 75
const KILL_SCORE = 50; // ApplyDamage: `player.Score += 50`
const DEATH_TIME = 4; // `deathTimer = new ActionTimer(4f)`
// the shotgun (BarnBrawlPlayer prefab): minProjectiles 3, maxProjectiles 5, spread ±10° on
// both axes (minSpread/maxSpread), the first pellet dead centre, 30-unit pellet range
// (`num4 = 30f`), 0.1 origin jitter (`num3`); a pellet does 1 damage to 1 health — it kills
const PELLETS_MIN = 3;
const PELLETS_MAX = 5;
const SPREAD_DEG = 10;
const PELLET_RANGE = 30;
const ORIGIN_JITTER = 0.1;
// aim: the screen-centre ray's hit, clamped to 5..20 units past the character (`num2`/`num3`),
// is where the pellets converge; the crosshair grows from ×1 at 20 units to ×2.25 at 5
const AIM_MIN = 5;
const AIM_MAX = 20;
const CROSS_NEAR = 2.25;
// pickups (BarnBrawlController): 4 spawned at the start (`i < 4`); after that every
// `ActionTimer(2f, 4f)` another appears at a random empty point, and the count is topped
// back up to 2 straight away whenever it drops below
const PICKUP_INITIAL = 4;
const PICKUP_MIN = 2;
const PICKUP_TIMER: [number, number] = [2, 4];
const PICKUP_RADIUS = 1.3;
const FIRE_SHAKE = 0.5; // `cameraShake.AddShake(0.5f)`
// bots (BarnBrawlPlayer's AI), indexed by GamePlayer.Difficulty 0 easy / 1 normal / 2 hard:
// the random look-at offset radius that mis-aims them, and the chance to hold fire when
// the shoot-chance timer (0.8–1.2 s) elapses
type Difficulty = 0 | 1 | 2;
const BOT_OFFSET_MIN = [1.5, 0.75, 0] as const;
const BOT_OFFSET_MAX = [2.5, 1.25, 0.75] as const;
const BOT_HOLD_FIRE = [0.8, 0.65, 0.4] as const;
const BOT_SEE_RANGE = 11; // canSee raycast 11f; `num = 121f` (11²) is the engage range
const BOT_TOO_CLOSE2 = 5; // `sqrMagnitude3 <= 5f` → back off
const BOT_TURN = 550; // `RotateTowards(…, 550f * dt)`
const BOT_RETREAT = 9; // `num6 = 9f`, how far the escape probes reach
const PLAYER_ID = -1;
const DEG = Math.PI / 180;

interface ScoreRow {
  name: string;
  color: string;
  score: number;
  kills: number;
  deaths: number;
  isYou: boolean;
}

// ZP.Utility.ActionTimer(min, max): `Elapsed()` fires once per random(min..max) seconds and
// restarts itself. Runs on the sim clock, so a long frame can't double-fire it.
class ActionTimer {
  private next: number;
  constructor(
    private readonly min: number,
    private readonly max: number,
  ) {
    this.next = this.roll();
  }
  private roll(): number {
    return this.min + Math.random() * (this.max - this.min);
  }
  elapsed(now: number): boolean {
    if (now < this.next) return false;
    this.next = now + this.roll();
    return true;
  }
  restart(now: number): void {
    this.next = now + this.roll();
  }
}

export function BarnBrawlPractice({ onLeave, party }: { onLeave: () => void; party?: PartyProps }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const crossRef = useRef<HTMLDivElement | null>(null);
  const killedRef = useRef<HTMLDivElement | null>(null);
  const scoreRef = useRef<HTMLDivElement | null>(null);
  const vignRef = useRef<HTMLDivElement | null>(null);
  const deadRef = useRef<HTMLDivElement | null>(null);
  const deadWhoRef = useRef<HTMLDivElement | null>(null);
  const deadSecRef = useRef<HTMLDivElement | null>(null);
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

    const camera = new THREE.PerspectiveCamera(PUMMEL_FOV, W / H, 0.1, 300); // 70° vertical, every Pummel Party minigame camera

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

    // ── characters: the player's picked mascot + distinct ones for the bots ──
    const roster = avatarRoster(resolveLook(myLook()), N);
    const playerRig = buildAvatar3D(roster[0]!);
    const player = playerRig.group;
    scene.add(player);
    for (const m of playerRig.hit) m.userData.owner = PLAYER_ID; // pellets know whose body they hit

    // open, obstacle-free spawn points (clear of crates, pickups, barrels, pillars)
    const SPAWNS = [
      new THREE.Vector3(0, 0, 7),
      new THREE.Vector3(0, 0, -7),
      new THREE.Vector3(-18, 0, 0),
      new THREE.Vector3(18, 0, 0),
      new THREE.Vector3(-10, 0, -14),
      new THREE.Vector3(10, 0, 14),
    ];
    const pos = SPAWNS[0]!.clone();
    const mover = new CharacterMover(BARN_BRAWL_MOVER); // speed 8 · accel 55 · gravity 30 · jump 10
    const tpCam = new ThirdPersonCamera(BARN_BRAWL_CAMERA); // 2 back · 1 up · 0.5 off the right shoulder
    let jumpQueued = false; // Space edge; the mover decides (ground / coyote / buffer)
    let fireQueued = false; // left-click edge (`GetButtonDown(UseItemShoot)`)
    const keys = new Set<string>();
    const ray = new THREE.Raycaster();
    ray.far = 5;
    const FORWARD = new THREE.Vector3(0, 0, 1);

    // ── the shotgun prop: in the hands while holding, tumbling away once fired ──
    const gunMat = new THREE.MeshStandardMaterial({ color: "#22242c", roughness: 0.5 });
    const stockMat = new THREE.MeshStandardMaterial({ color: "#6b4424", roughness: 0.8, flatShading: true });
    function makeShotgun(): THREE.Group {
      const g = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.9), gunMat);
      barrel.position.z = 0.2;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.42), stockMat);
      stock.position.set(0, -0.04, -0.4);
      barrel.castShadow = stock.castShadow = true;
      g.add(barrel, stock);
      g.position.set(0.3, 1.02, 0.52); // parented to the torso so it rides the body's bob
      g.visible = false; // `shotgunObject.SetActive(holding)`
      return g;
    }
    const gun = makeShotgun();
    playerRig.upper.add(gun);
    // `shotgunRigidbody`: the fired gun is let go and tumbles — a small pool of falling props
    interface DroppedGun {
      mesh: THREE.Group;
      vel: THREE.Vector3;
      spin: THREE.Vector3;
      life: number;
      resting: boolean;
    }
    const dropped: DroppedGun[] = [];
    for (let i = 0; i < 6; i++) {
      const mesh = makeShotgun();
      mesh.position.set(0, 0, 0);
      scene.add(mesh);
      dropped.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, resting: false });
    }
    function dropGun(from: THREE.Object3D, kickX: number, kickZ: number): void {
      const d = dropped.find((g) => g.life <= 0) ?? dropped[0]!;
      from.getWorldPosition(d.mesh.position);
      from.getWorldQuaternion(d.mesh.quaternion);
      d.vel.set(-kickX * 2 + (Math.random() - 0.5), 3.5, -kickZ * 2 + (Math.random() - 0.5)); // kicks back out of the hands
      d.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
      d.life = 1.6;
      d.resting = false;
      d.mesh.visible = true;
      d.mesh.scale.setScalar(1);
    }

    // ── bots ──
    interface Pickup3D {
      grp: THREE.Group;
      active: boolean;
      x: number;
      y: number;
      z: number;
    }
    interface Enemy {
      root: THREE.Group;
      mat: THREE.MeshStandardMaterial;
      rig: Char3D;
      gun: THREE.Group;
      alive: boolean;
      deathT: number; // respawn countdown while dead
      deathPop: number; // >0 while playing the death scale-pop before hiding
      pos: THREE.Vector3;
      home: THREE.Vector3;
      mover: CharacterMover;
      name: string;
      av: Avatar;
      id: number; // index into `enemies`; the player is PLAYER_ID
      difficulty: Difficulty;
      score: number;
      kills: number;
      deaths: number;
      holding: boolean;
      // ── BarnBrawlPlayer.GetAIInput state ──
      targetPickup: Pickup3D | null;
      targetId: number; // fighter being hunted, -2 = none
      lookAt: THREE.Vector3; // random mis-aim offset, re-rolled per target (`lookAtOffset`)
      canSee: boolean;
      moveAway: THREE.Vector3; // escape point when a rival is on top of us (`moveAwayPoint`)
      randomMove: { x: number; z: number }; // strafe vector while a target is in sight
      tPath: ActionTimer; // SetDestination cadence (`pathUpdateTimer` 0.1–0.15)
      tSee: ActionTimer; // line-of-sight check (`checkCanSee` 0.05–0.075)
      tTarget: ActionTimer; // retarget (`targetCheckTimer` 0.75–1)
      tMoveAway: ActionTimer; // re-pick the escape point (`moveAwayGetPointTimer` 0.4–0.6)
      tRandom: ActionTimer; // re-roll the strafe (`randomMovementTimer` 0.25–1)
      tShoot: ActionTimer; // chance to shoot (`shootChanceTimer` 0.8–1.2)
      // ── waypoint navigation (stands in for the NavMeshAgent) ──
      navMode: "direct" | "path";
      path: number[];
      pathI: number;
      repathNow: boolean;
      stuckT: number;
      lastNavX: number;
      lastNavZ: number;
      stuckCount: number;
      sidestepT: number;
      sidestepSign: number;
      directForceT: number;
      edgePen: Map<string, number>;
    }
    const enemies: Enemy[] = [];
    const bodies: THREE.Mesh[] = [];
    function makeEnemy(x: number, y: number, z: number, av: Avatar, name: string, difficulty: Difficulty): void {
      const c = buildAvatar3D(av, { outline: 0xff5566 }); // hot rim so rivals pop
      const root = c.group;
      root.position.set(x, y, z);
      scene.add(root);
      const egun = makeShotgun();
      c.upper.add(egun);
      const e: Enemy = {
        root, mat: c.tint as THREE.MeshStandardMaterial, rig: c, gun: egun, alive: true, deathT: 0, deathPop: 0,
        pos: new THREE.Vector3(x, y, z), home: new THREE.Vector3(x, y, z), mover: new CharacterMover(BARN_BRAWL_MOVER),
        name, av, id: enemies.length, difficulty, score: 0, kills: 0, deaths: 0, holding: false,
        targetPickup: null, targetId: -2, lookAt: new THREE.Vector3(), canSee: false, moveAway: new THREE.Vector3(x, y, z), randomMove: { x: 0, z: 0 },
        tPath: new ActionTimer(0.1, 0.15), tSee: new ActionTimer(0.05, 0.075), tTarget: new ActionTimer(0.75, 1), tMoveAway: new ActionTimer(0.4, 0.6), tRandom: new ActionTimer(0.25, 1), tShoot: new ActionTimer(0.8, 1.2),
        navMode: "direct", path: [], pathI: 0, repathNow: false, stuckT: 0, lastNavX: x, lastNavZ: z, stuckCount: 0, sidestepT: 0, sidestepSign: 1, directForceT: 0, edgePen: new Map<string, number>(),
      };
      for (const m of c.hit) m.userData.owner = e.id;
      bodies.push(...c.hit);
      enemies.push(e);
    }
    // mixed lobby: an easy confidence-kill, a baseline, and a hard one starting up on the
    // loft. In a party round the bots take the other board players' names.
    const ENEMY_SETUP: Array<[number, number, number, string, Difficulty]> = [
      [18, 0, -14, "Rex", 1],
      [-18, 0, 14, "Bruiser", 0],
      [18, MZ, 2, "Ziggy", 2],
    ];
    for (let i = 1; i < N; i++) {
      const [ex, ey, ez, dname, diff] = ENEMY_SETUP[(i - 1) % ENEMY_SETUP.length]!;
      makeEnemy(ex, ey, ez, roster[i]!, party ? party.seats[i]!.name : dname, diff);
    }
    // walls AND floors/lofts/stairs stop pellets and block sight
    const occluders: THREE.Object3D[] = [...blockers, ...walkables];
    const shootTargets: THREE.Object3D[] = [...occluders, ...bodies, ...playerRig.hit];

    // ── shotgun pickups (the scene's ShotgunSpawnPoints: ground lanes + both lofts) ──
    const pickups: Pickup3D[] = [];
    function makePickup(x: number, y: number, z: number): void {
      const grp = new THREE.Group();
      grp.position.set(x, y + 1, z);
      const prop = makeShotgun();
      prop.position.set(0, 0, 0);
      prop.rotation.z = -0.5;
      prop.visible = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 18), new THREE.MeshBasicMaterial({ color: "#ffd98a" }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.35;
      const glow = new THREE.PointLight("#ffcf80", 0.6, 4);
      glow.position.y = 0.2;
      grp.add(prop, ring, glow);
      grp.visible = false;
      scene.add(grp);
      pickups.push({ grp, active: false, x, y, z });
    }
    for (const [x, y, z] of [[-12, 0, 0], [12, 0, 0], [0, 0, -22], [0, 0, 22], [-18, MZ, 4], [18, MZ, -4], [-6, 0, 14], [6, 0, -14]] as const) makePickup(x, y, z);
    const pickupTimer = new ActionTimer(PICKUP_TIMER[0], PICKUP_TIMER[1]);
    function activatePickup(pk: Pickup3D): void {
      pk.active = true;
      pk.grp.visible = true;
    }
    function takePickup(pk: Pickup3D): void {
      pk.active = false;
      pk.grp.visible = false;
    }
    // BarnBrawlController.Update: spawn when the timer elapses, or straight away while fewer
    // than PICKUP_MIN are out; one per frame, at a random empty point
    function pickupTick(): void {
      let out = 0;
      for (const pk of pickups) if (pk.active) out++;
      if (!pickupTimer.elapsed(clock) && out >= PICKUP_MIN) return;
      const empty = pickups.filter((pk) => !pk.active);
      if (empty.length) activatePickup(empty[Math.floor(Math.random() * empty.length)]!);
    }

    // ── audio (synthesised, no assets) ──
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
    // a shotgun boom, quieter with distance from the player (`shotgunFire` at 0.7)
    function boom(at: THREE.Vector3): void {
      const k = Math.max(0.15, 1 - at.distanceTo(pos) / 40);
      blip(95, 0.2, "sawtooth", 0.28 * k, 28);
      blip(1800, 0.05, "square", 0.08 * k, 400);
    }
    const announcer = createAnnouncer();

    // ── particle burst pool (impact puffs on wood, confetti-blood, death pops) ──
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
    // pellet smoke trails (`ShotgunSmokeTrail`): a line that fades over a quarter second
    const tracers: Array<{ line: THREE.Line; t: number }> = [];
    const TRACER_LIFE = 0.25;
    function addTracer(a: THREE.Vector3, b: THREE.Vector3, color: number): void {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, transparent: true }));
      scene.add(line);
      tracers.push({ line, t: TRACER_LIFE });
    }
    const muzzleLight = new THREE.PointLight("#ffe0a0", 0, 10);
    scene.add(muzzleLight);

    // ── player state ──
    let playerDead = 0; // death countdown while dead
    let killerId = PLAYER_ID; // who got us (drives the death text + the killer cam)
    let holding = false; // `HoldingShotgun`
    let score = 0;
    let kills = 0;
    let deaths = 0;
    let hurtT = 0; // red vignette on death
    let killedT = 0; // "Killed X" popup (`killedTextPrefab`)
    let shake = 0; // CameraShake trauma: damping 1/s, max 15° yaw/pitch/roll, max 1 unit offset, noise scale 15
    let recoil = 0; // transient upward pitch kick on the player's own shot
    let satW = 0; // death desaturation weight (`saturationVolume.weight`, ±2/s)
    let lastDeathSec = -1;
    const targetPoint = new THREE.Vector3(); // where the pellets converge (`targetPoint`)
    let aimOnBody = false;
    let aimDist = Infinity;

    function fighterAlive(id: number): boolean {
      return id === PLAYER_ID ? playerDead <= 0 : enemies[id]!.alive;
    }
    function fighterPos(id: number): THREE.Vector3 {
      return id === PLAYER_ID ? pos : enemies[id]!.pos;
    }
    function fighterName(id: number): string {
      return id === PLAYER_ID ? "You" : enemies[id]!.name;
    }
    function randomUnit(): THREE.Vector3 {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      return v.lengthSq() < 1e-6 ? v.set(1, 0, 0) : v.normalize();
    }

    // ── kills: `ApplyDamage` → `KillPlayer`; 1 pellet, 1 health ──
    function creditKill(by: number, victim: string): void {
      if (by === PLAYER_ID) {
        score += KILL_SCORE;
        kills++;
        announcer.onKill(false);
        killedT = 1.3;
        if (killedRef.current) killedRef.current.textContent = `Killed ${victim}`;
      } else {
        const k = enemies[by]!;
        k.score += KILL_SCORE;
        k.kills++;
      }
    }
    function killEnemy(e: Enemy, by: number): void {
      if (!e.alive) return;
      e.alive = false;
      e.deathT = DEATH_TIME;
      e.deathPop = 0.22; // scale-pop, then hide (handled in the frame loop)
      e.deaths++;
      e.holding = false;
      e.gun.visible = false;
      e.mover.reset();
      burst(e.pos.x, e.pos.y + 1.2, e.pos.z, e.mat.color, 16, 3.4, 0.34, 6); // confetti-blood
      blip(180, 0.3, "sawtooth", 0.2, 55);
      creditKill(by, e.name);
    }
    function killPlayer(by: number): void {
      if (playerDead > 0) return;
      playerDead = DEATH_TIME;
      killerId = by;
      deaths++;
      holding = false;
      gun.visible = false;
      hurtT = 0.5;
      mover.reset();
      announcer.onDeath();
      player.visible = false; // the ragdoll stands in for the hidden body
      burst(pos.x, pos.y + 1.2, pos.z, roster[0]!.body, 16, 3.4, 0.34, 6);
      blip(150, 0.4, "sawtooth", 0.22, 48);
      creditKill(by, "You");
    }

    // ── the shot (`DoShotgunShot`): 3–5 pellets in a ±10° cone from a jittered muzzle, each a
    // 30-unit ray; the first pellet is dead centre; the first body a pellet meets dies ──
    const shotRay = new THREE.Raycaster();
    function fireShotgun(shooter: number, origin: THREE.Vector3, aimDir: THREE.Vector3): void {
      const n = PELLETS_MIN + Math.floor(Math.random() * (PELLETS_MAX - PELLETS_MIN + 1));
      const baseQ = new THREE.Quaternion().setFromUnitVectors(FORWARD, aimDir.clone().normalize());
      muzzleLight.position.copy(origin);
      muzzleLight.intensity = 10;
      boom(origin);
      for (let i = 0; i < n; i++) {
        const pitch = i === 0 ? 0 : (Math.random() * 2 - 1) * SPREAD_DEG;
        const yaw = i === 0 ? 0 : (Math.random() * 2 - 1) * SPREAD_DEG;
        const dir = FORWARD.clone()
          .applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * DEG, yaw * DEG, 0, "YXZ"))) // `Quaternion.Euler(x, y, 0)`
          .applyQuaternion(baseQ);
        const o = origin.clone().addScaledVector(randomUnit(), Math.random() * ORIGIN_JITTER);
        shotRay.set(o, dir);
        shotRay.far = PELLET_RANGE;
        let end = o.clone().addScaledVector(dir, PELLET_RANGE);
        for (const h of shotRay.intersectObjects(shootTargets, false)) {
          const owner = h.object.userData.owner as number | undefined;
          if (owner === shooter) continue; // never your own body
          if (owner !== undefined && !fighterAlive(owner)) continue; // corpses don't stop pellets
          end = h.point.clone();
          if (owner === undefined) burst(end.x, end.y, end.z, 0xc9a86a, 4, 2.2, 0.24, 1.6); // `HandleImpact` wood puff
          else if (owner === PLAYER_ID) killPlayer(shooter);
          else killEnemy(enemies[owner]!, shooter);
          break; // the first solid thing stops the pellet
        }
        addTracer(o, end, shooter === PLAYER_ID ? 0xfff0c0 : 0xffb8a0);
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

    const DOWN = new THREE.Vector3(0, -1, 0);
    const losRay = new THREE.Raycaster();
    const camRay = new THREE.Raycaster();
    const camColliders = [...blockers, ...walkables]; // camera doesn't clip through these
    // the ThirdPersonCamera's wall probe: from just above the feet (so the floor the
    // character stands on doesn't count) out toward the wanted camera spot
    const camProbe: RaycastFn = (o, d, max) => {
      camRay.set(new THREE.Vector3(o.x, o.y + 0.1, o.z), new THREE.Vector3(d.x, d.y, d.z));
      camRay.far = max;
      const h = camRay.intersectObjects(camColliders, false)[0];
      return h ? h.distance : null;
    };
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

    // one body step for the player and the bots: horizontal axis by axis against the
    // blockers (a wall stops that axis dead), then gravity onto the highest walkable with
    // a smooth step-up; the mover is told whether it landed
    function stepBody(p: THREE.Vector3, m: CharacterMover, dt: number): void {
      const sxm = m.vx * dt;
      const szm = m.vz * dt;
      if (!blockedMove(p.x, p.y, p.z, sxm, 0)) p.x += sxm;
      else m.vx = 0;
      if (!blockedMove(p.x, p.y, p.z, 0, szm)) p.z += szm;
      else m.vz = 0;
      p.x = Math.max(-HALF + 0.9, Math.min(HALF - 0.9, p.x));
      p.z = Math.max(-HALF + 0.9, Math.min(HALF - 0.9, p.z));
      const ground = groundAt(p.x, p.y, p.z);
      let ny = p.y + m.vy * dt;
      let landed = false;
      if (ny <= ground) {
        ny = ground;
        landed = true;
      } else if (ground > p.y && ground - p.y <= STEP_UP) {
        ny = Math.min(ground, p.y + 9 * dt); // climb steps smoothly instead of snapping
        landed = true;
      }
      p.y = ny;
      m.finishMove(landed, false, dt); // grounded → vy = -g·dt and the jump count resets
    }
    // how far a chest-height planar ray travels before a blocker (the escape probes)
    function freeDistance(px: number, py: number, pz: number, dx: number, dz: number, max: number): number {
      ray.set(new THREE.Vector3(px, py + 0.9, pz), new THREE.Vector3(dx, 0, dz).normalize());
      ray.far = max;
      const h = ray.intersectObjects(blockers, false)[0];
      return h ? h.distance : max;
    }
    // the spawn point farthest from current threats, so no one drops into a crossfire
    // (the original picks at random; this is kinder and changes nothing else)
    function pickSpawn(): THREE.Vector3 {
      const threats: THREE.Vector3[] = [];
      if (playerDead <= 0) threats.push(pos);
      for (const e of enemies) if (e.alive) threats.push(e.pos);
      let best = SPAWNS[0]!;
      let bestScore = -Infinity;
      for (const s of SPAWNS) {
        let near = Infinity;
        for (const t of threats) near = Math.min(near, s.distanceTo(t));
        const sc = (near === Infinity ? 100 : near) + Math.random() * 2;
        if (sc > bestScore) {
          bestScore = sc;
          best = s;
        }
      }
      return best;
    }

    // ── bot AI: BarnBrawlPlayer.GetAIInput, with the waypoint graph standing in for the
    // NavMeshAgent. Unarmed → walk to the nearest shotgun. Armed → hunt the nearest rival
    // with a random mis-aim offset by difficulty; shoot when it's in sight and in front,
    // strafe randomly while it's in sight, back off when it's on top of you. ──
    const _goal = new THREE.Vector3();
    const _v = new THREE.Vector3();
    function randomMovement(e: Enemy): void {
      if (!e.tRandom.elapsed(clock)) return;
      const a = Math.random() * Math.PI * 2;
      e.randomMove.x = Math.sin(a);
      e.randomMove.z = Math.cos(a);
    }
    // a rival is on top of us: probe left, back and right of the body (the original mixes
    // local and world axes here; this reads it as "away") and run for the most open one
    function pickRetreat(e: Enemy): void {
      const ry = e.root.rotation.y;
      const fx = Math.sin(ry);
      const fz = Math.cos(ry);
      const rx = -Math.cos(ry);
      const rz = Math.sin(ry);
      let bestD = -1;
      for (const [dx, dz] of [[-rx, -rz], [-fx, -fz], [rx, rz]] as const) {
        const d = freeDistance(e.pos.x, e.pos.y, e.pos.z, dx, dz, BOT_RETREAT + 1);
        if (d > bestD) {
          bestD = d;
          const reach = Math.max(0, Math.min(BOT_RETREAT, d - 0.6));
          e.moveAway.set(e.pos.x + dx * reach, e.pos.y, e.pos.z + dz * reach);
        }
      }
    }
    // bots shoot along the body's facing (`LookRotation(transform.forward)`), level — the
    // mis-aim offset has already turned the body
    function botFire(e: Enemy): void {
      const ry = e.root.rotation.y;
      const dir = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
      const origin = new THREE.Vector3(e.pos.x + dir.x * 0.5, e.pos.y + 1.2, e.pos.z + dir.z * 0.5);
      fireShotgun(e.id, origin, dir);
      e.holding = false;
      dropGun(e.gun, dir.x, dir.z);
      e.gun.visible = false;
      e.tShoot.restart(clock);
    }
    interface Steer {
      x: number;
      z: number;
      jump: boolean;
      fx: number; // the point the bot steers at (next waypoint while pathing, else the goal)
      fz: number;
    }
    // `agent.SetDestination(goal)` every 0.1–0.15 s + `agent.steeringTarget`: same level and
    // in sight → straight at it; otherwise Dijkstra over the hand-placed nodes to cross levels
    function steer(e: Enemy, goal: THREE.Vector3, dt: number): Steer {
      const p = e.pos;
      if (e.directForceT > 0) e.directForceT -= dt;
      if (e.repathNow || e.tPath.elapsed(clock)) {
        e.repathNow = false;
        const near = Math.hypot(goal.x - p.x, goal.z - p.z) < 6;
        if (e.directForceT > 0 || (navLevel(p.y) === navLevel(goal.y) && (near || losClear(p.x, p.y + 1, p.z, goal.x, goal.y + 1, goal.z)))) {
          e.navMode = "direct";
        } else {
          const path = navPath(snapNode(p.x, p.y, p.z), snapNode(goal.x, goal.y, goal.z), e.edgePen, clock);
          if (path && path.length > 1) {
            e.navMode = "path";
            e.path = path;
            e.pathI = 0;
          } else {
            e.navMode = "direct"; // graph miss → never worse than a direct chase
          }
        }
      }
      let mvx = 0;
      let mvz = 0;
      let fx = goal.x;
      let fz = goal.z;
      let useDirect = e.navMode !== "path";
      if (!useDirect) {
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
          fx = wp.x;
          fz = wp.z;
        }
      }
      if (useDirect) {
        const dx = goal.x - p.x;
        const dz = goal.z - p.z;
        const L = Math.hypot(dx, dz);
        if (L > 0.3) {
          mvx = dx / L;
          mvz = dz / L;
        }
      }
      // sidestep nudge (stuck recovery) rotates the wanted move to slip past a snag
      if (e.sidestepT > 0) {
        e.sidestepT -= dt;
        const c = Math.cos(e.sidestepSign);
        const s = Math.sin(e.sidestepSign);
        const rx = mvx * c - mvz * s;
        const rz = mvx * s + mvz * c;
        mvx = rx;
        mvz = rz;
      }
      // stuck recovery: wants to move but isn't → hop, then sidestep + re-route, then ignore the graph
      let jump = false;
      e.stuckT += dt;
      if (e.stuckT >= 0.5) {
        const moved = Math.hypot(p.x - e.lastNavX, p.z - e.lastNavZ);
        if ((mvx !== 0 || mvz !== 0) && moved < 0.35) {
          e.stuckCount++;
          if (e.stuckCount === 1) {
            jump = true; // hop a hay bale / crate
          } else if (e.stuckCount === 2) {
            e.sidestepT = 0.4;
            e.sidestepSign = Math.random() < 0.5 ? 1 : -1;
            if (e.navMode === "path" && e.pathI > 0) {
              const a2 = e.path[e.pathI - 1]!;
              const b2 = e.path[e.pathI]!;
              e.edgePen.set(a2 < b2 ? `${a2}-${b2}` : `${b2}-${a2}`, clock + 3); // avoid this edge, re-route
            }
            e.repathNow = true;
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
      return { x: mvx, z: mvz, jump, fx, fz };
    }
    function botAI(e: Enemy, dt: number): void {
      const p = e.pos;
      // ── unarmed: the nearest shotgun on the map ──
      if (!e.holding && (e.targetPickup === null || !e.targetPickup.active || e.tTarget.elapsed(clock))) {
        e.targetId = -2;
        e.targetPickup = null;
        let best = Infinity;
        for (const pk of pickups) {
          if (!pk.active) continue;
          const d2 = (pk.x - p.x) ** 2 + (pk.y - p.y) ** 2 + (pk.z - p.z) ** 2;
          if (d2 < best) {
            best = d2;
            e.targetPickup = pk;
          }
        }
      }
      // ── armed: the nearest living rival; a newcomer must be 20 % closer to steal focus ──
      if (e.holding && (e.targetId === -2 || !fighterAlive(e.targetId) || e.tTarget.elapsed(clock))) {
        e.targetPickup = null;
        const prev = e.targetId;
        let best = prev !== -2 && fighterAlive(prev) ? fighterPos(prev).distanceToSquared(p) * 0.8 : Infinity;
        for (let id = PLAYER_ID; id < enemies.length; id++) {
          if (id === e.id || id === prev || !fighterAlive(id)) continue;
          const d2 = fighterPos(id).distanceToSquared(p);
          if (d2 < best) {
            best = d2;
            e.targetId = id;
          }
        }
        if (e.targetId !== prev) {
          // `lookAtOffset`: a random direction scaled by the difficulty's radius — the mis-aim
          const r = BOT_OFFSET_MIN[e.difficulty] + Math.random() * (BOT_OFFSET_MAX[e.difficulty] - BOT_OFFSET_MIN[e.difficulty]);
          e.lookAt.copy(randomUnit()).multiplyScalar(r);
        }
      }
      const tgtId = e.targetId !== -2 && fighterAlive(e.targetId) ? e.targetId : -2;
      let goal = e.targetPickup ? _goal.set(e.targetPickup.x, e.targetPickup.y, e.targetPickup.z) : tgtId !== -2 ? _goal.copy(fighterPos(tgtId)) : _goal.copy(p);
      let facing = false;
      if (tgtId !== -2) {
        _v.copy(fighterPos(tgtId)).add(e.lookAt).sub(p);
        _v.y = 0;
        _v.normalize();
        facing = _v.x * Math.sin(e.root.rotation.y) + _v.z * Math.cos(e.root.rotation.y) > 0.85; // `Dot(…, forward) > 0.85`
      }
      if (tgtId !== -2 && e.holding && e.tSee.elapsed(clock)) {
        const tp = fighterPos(tgtId);
        e.canSee = p.distanceTo(tp) <= BOT_SEE_RANGE && losClear(p.x, p.y + 0.9, p.z, tp.x, tp.y + 0.9, tp.z);
      }
      if (tgtId === -2) e.canSee = false;
      const d2 = goal.distanceToSquared(p);
      let mv: Steer | null = null;
      let rx = 0;
      let rz = 0;
      let jump = false;
      if (!e.canSee || !e.holding || d2 > BOT_SEE_RANGE * BOT_SEE_RANGE || d2 <= BOT_TOO_CLOSE2) {
        if (d2 <= BOT_TOO_CLOSE2 && tgtId !== -2) {
          if (e.tMoveAway.elapsed(clock)) pickRetreat(e);
          goal = _goal.copy(e.moveAway);
        }
        mv = steer(e, goal, dt);
        rx = mv.x;
        rz = mv.z;
        jump = mv.jump;
      } else if (facing) {
        if (e.tShoot.elapsed(clock) && Math.random() > BOT_HOLD_FIRE[e.difficulty]) botFire(e);
        randomMovement(e);
        rx = e.randomMove.x;
        rz = e.randomMove.z;
      } else {
        randomMovement(e);
        rx = e.randomMove.x;
        rz = e.randomMove.z;
      }
      // face the steering point while fetching a gun, the goal otherwise — plus the mis-aim
      let fx = (e.targetPickup && mv ? mv.fx : goal.x) - p.x;
      let fz = (e.targetPickup && mv ? mv.fz : goal.z) - p.z;
      if (tgtId !== -2) {
        fx += e.lookAt.x;
        fz += e.lookAt.z;
      }
      if (fx !== 0 || fz !== 0) {
        let dy = Math.atan2(fx, fz) - e.root.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        const step = BOT_TURN * DEG * dt;
        e.root.rotation.y += Math.abs(dy) <= step ? dy : Math.sign(dy) * step;
      }
      // `CharacterMoverInput(new Vector2(x, z))`: the AI's input is a world direction
      e.mover.calculateVelocity(e.mover.worldInput(rx, rz, jump), dt);
      stepBody(p, e.mover, dt);
      if (p.y < -8) {
        p.copy(e.home);
        e.mover.reset();
        e.navMode = "direct";
      }
      e.root.position.copy(p);
    }
    function respawnEnemy(e: Enemy): void {
      e.alive = true;
      e.root.visible = true;
      e.root.scale.setScalar(1);
      e.pos.copy(pickSpawn());
      e.mover.reset();
      e.root.position.copy(e.pos);
      e.holding = false;
      e.gun.visible = false;
      e.targetId = -2;
      e.targetPickup = null;
      e.canSee = false;
      e.navMode = "direct";
      e.path = [];
      e.pathI = 0;
      e.stuckCount = 0;
      e.stuckT = 0;
      e.lastNavX = e.pos.x;
      e.lastNavZ = e.pos.z;
      e.sidestepT = 0;
      e.directForceT = 0;
    }

    // ── match state machine (ready → countdown → playing → results) ──
    let mode: "ready" | "countdown" | "playing" | "results" = "ready";
    let cdT = 0; // countdown remaining
    let mtime = 0; // round time remaining

    function beginMatch(): void {
      score = 0;
      kills = 0;
      deaths = 0;
      playerDead = 0;
      killerId = PLAYER_ID;
      lastDeathSec = -1;
      holding = false;
      gun.visible = false;
      hurtT = 0;
      killedT = 0;
      shake = 0;
      recoil = 0;
      pos.copy(SPAWNS[0]!);
      mover.reset();
      tpCam.resetTo(tpCam.yaw);
      jumpQueued = false;
      fireQueued = false;
      player.visible = true;
      for (const e of enemies) {
        e.score = 0;
        e.kills = 0;
        e.deaths = 0;
        e.alive = true;
        e.deathPop = 0;
        e.deathT = 0;
        e.holding = false;
        e.gun.visible = false;
        e.root.visible = true;
        e.root.scale.setScalar(1);
        e.pos.copy(e.home);
        e.mover.reset();
        e.root.position.copy(e.pos);
        e.targetId = -2;
        e.targetPickup = null;
        e.canSee = false;
        e.navMode = "direct";
        e.path = [];
        e.pathI = 0;
        e.repathNow = false;
        e.stuckCount = 0;
        e.stuckT = 0;
        e.lastNavX = e.home.x;
        e.lastNavZ = e.home.z;
        e.sidestepT = 0;
        e.directForceT = 0;
        e.edgePen.clear();
      }
      for (const pk of pickups) takePickup(pk);
      // `i < 4`: four shotguns are already out when the round starts
      const shuffled = [...pickups].sort(() => Math.random() - 0.5);
      for (let i = 0; i < PICKUP_INITIAL && i < shuffled.length; i++) activatePickup(shuffled[i]!);
      pickupTimer.restart(clock);
      for (const d of dropped) {
        d.life = 0;
        d.mesh.visible = false;
      }
      canvas.style.filter = "";
      satW = 0;
      announcer.reset();
      cdT = COUNTDOWN;
      mtime = ROUND_LENGTH;
      mode = "countdown";
      setResults(null);
      setPhase("countdown");
      try {
        const r = canvas.requestPointerLock() as unknown;
        if (r instanceof Promise) r.catch(() => undefined);
      } catch {
        // not allowed in this document (automation / iframe) — the click-to-capture hint covers it
      }
    }
    beginRef.current = beginMatch;

    function finishMatch(): void {
      mode = "results";
      const board: ScoreRow[] = [
        { name: "You", color: roster[0]!.body, score, kills, deaths, isYou: true },
        ...enemies.map((e) => ({ name: e.name, color: e.av.body, score: e.score, kills: e.kills, deaths: e.deaths, isYou: false })),
      ];
      board.sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths); // MostPoints
      const place = board.findIndex((r) => r.isYou) + 1;
      if (party) {
        // rank every fighter (You = fighter 0, bots follow) by score → placement payout
        const scored = [{ s: score, k: kills, d: deaths, i: 0 }, ...enemies.map((e, idx) => ({ s: e.score, k: e.kills, d: e.deaths, i: idx + 1 }))];
        scored.sort((a, b) => b.s - a.s || b.k - a.k || a.d - b.d);
        const places: number[] = new Array(N).fill(N);
        scored.forEach((f, rank) => (places[f.i] = rank + 1));
        partyResultRef.current = partyResult(party.minigameId, party.seats, places);
      } else {
        useProfile.getState().award(20 + kills * 4 + Math.max(0, board.length - place) * 6); // everyone earns something
      }
      canvas.style.filter = "";
      satW = 0;
      setResults(board);
      setPhase("results");
      if (document.pointerLockElement) document.exitPointerLock();
    }

    // ── frame ──
    let raf = 0;
    let last = performance.now();
    let clock = 0; // sim clock: every ActionTimer and the pickup spawner run on it
    const aimRay = new THREE.Raycaster();
    const aimDir = new THREE.Vector3();
    const muzzle = new THREE.Vector3();
    const _tmp = new THREE.Vector3();
    const _look = new THREE.Camera(); // scratch for the killer-cam target rotation
    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;

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
      const playing = mode === "playing"; // sim (bots, shots, pickups) only runs in-match

      // ── death / respawn (`deathTimer` 4 s, then `ResetPlayer`) ──
      hurtT = Math.max(0, hurtT - dt);
      killedT = Math.max(0, killedT - dt);
      if (playerDead > 0) {
        playerDead -= dt;
        const sec = Math.ceil(Math.max(0, playerDead));
        if (sec !== lastDeathSec) {
          // `SetText`: "Killer: name / Respawn: n", with a tick each time the second changes
          lastDeathSec = sec;
          if (sec > 0) blip(880, 0.05, "square", 0.08);
          if (deadWhoRef.current) deadWhoRef.current.textContent = `Killed by ${fighterName(killerId)}`;
          if (deadSecRef.current) deadSecRef.current.textContent = `Respawn in ${sec}`;
        }
        if (playerDead <= 0) {
          pos.copy(pickSpawn());
          mover.reset();
          tpCam.resetTo(tpCam.yaw); // `ZRotation = 5f` on respawn, keep the facing
          player.visible = true;
          lastDeathSec = -1;
        }
      }
      const alive = playerDead <= 0;

      // ── movement: CharacterMover, relative to the camera's planar forward ──
      const fwd = tpCam.forward();
      const canMove = alive && playing;
      const mv = moveVector(keys);
      mover.setForward(fwd.x, fwd.z);
      const jumpNow = jumpQueued && canMove;
      jumpQueued = false;
      mover.calculateVelocity({ axisX: canMove ? mv.dx : 0, axisY: canMove ? -mv.dy : 0, jump: jumpNow }, dt);
      stepBody(pos, mover, dt);
      if (pos.y < -10) {
        pos.set(-12, 0, 0);
        mover.reset();
      }
      // the character always faces where you're aiming (camera direction), and
      // strafes/backpedals — it does NOT spin toward its movement direction
      let dRot = tpCam.yawRad - player.rotation.y;
      while (dRot > Math.PI) dRot -= Math.PI * 2;
      while (dRot < -Math.PI) dRot += Math.PI * 2;
      player.rotation.y += dRot * Math.min(1, dt * 18);
      player.position.copy(pos);
      // `ShotgunStrength`: the arms come up onto the gun only while holding one
      animateChar(playerRig, Math.hypot(mover.vx, mover.vz), dt, { vx: mover.vx, vz: mover.vz, grounded: mover.grounded, aim: holding ? 1 : 0 });

      // ── camera ──
      recoil = Math.max(0, recoil - dt * (0.4 + recoil * 5));
      muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 90);
      if (alive) {
        const pose = tpCam.update(pos, camProbe, dt, -recoil * THREE.MathUtils.RAD2DEG);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
      } else {
        // killer cam: the camera stays put and turns toward whoever got us, faster the
        // further off-axis they are (`RotateTowards`, clamp(1 − dot, 0.06, 2) × 250°/s)
        const kp = _tmp.copy(fighterPos(killerId));
        kp.y += 0.875;
        _look.position.copy(camera.position);
        _look.lookAt(kp);
        const toKiller = kp.sub(camera.position).normalize();
        const maxDeg = Math.max(0.06, Math.min(2, -camera.getWorldDirection(aimDir).dot(toKiller) + 1)) * 250 * dt;
        camera.quaternion.rotateTowards(_look.quaternion, maxDeg * DEG);
      }
      // CameraShake: trauma² drives a fast wobble of up to 1 unit / 15°, draining at 1/s
      shake = Math.max(0, shake - dt);
      if (shake > 0) {
        const s = shake * shake;
        const t = clock * 15;
        camera.position.x += Math.sin(t + 1) * s;
        camera.position.y += Math.sin(t * 1.3 + 2) * s;
        camera.rotateZ(Math.sin(t * 1.7 + 3) * s * 15 * DEG);
        camera.rotateX(Math.sin(t * 1.1 + 4) * s * 15 * DEG);
      }

      // ── aiming (`Update` while holding): the screen-centre ray, clamped 5..20 past the
      // character, is where the pellets converge; the crosshair reads distance and target ──
      if (alive && holding) {
        camera.getWorldDirection(aimDir);
        gun.getWorldPosition(muzzle).addScaledVector(_tmp.set(fwd.x, 0, fwd.z), 0.45);
        const tPlane = Math.max(0, _tmp.copy(muzzle).sub(camera.position).dot(aimDir));
        aimRay.set(camera.position, aimDir);
        aimRay.far = tPlane + AIM_MAX + 0.01;
        const hit = aimRay.intersectObjects(shootTargets, false).find((h) => {
          const o = h.object.userData.owner as number | undefined;
          return o === undefined || (o !== PLAYER_ID && fighterAlive(o));
        });
        aimOnBody = hit !== undefined && hit.object.userData.owner !== undefined;
        aimDist = hit ? hit.distance - tPlane : Infinity;
        targetPoint.copy(camera.position).addScaledVector(aimDir, hit ? tPlane + Math.max(AIM_MIN, Math.min(AIM_MAX, aimDist)) : tPlane + AIM_MAX);
      }
      if (fireQueued) {
        fireQueued = false;
        if (playing && alive && holding && document.pointerLockElement === canvas) {
          void ac.resume();
          fireShotgun(PLAYER_ID, muzzle, _tmp.copy(targetPoint).sub(muzzle));
          holding = false; // `HoldingShotgun = false` — one shell, then it's gone
          dropGun(gun, fwd.x, fwd.z);
          gun.visible = false;
          shake = Math.min(1, shake + FIRE_SHAKE);
          recoil += 0.05;
        }
      }

      // ── tracers, particles, dropped guns ──
      for (let i = tracers.length - 1; i >= 0; i--) {
        const tr = tracers[i]!;
        tr.t -= dt;
        (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.t / TRACER_LIFE);
        if (tr.t <= 0) {
          scene.remove(tr.line);
          tr.line.geometry.dispose();
          (tr.line.material as THREE.Material).dispose();
          tracers.splice(i, 1);
        }
      }
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
      for (const d of dropped) {
        if (d.life <= 0) continue;
        d.life -= dt;
        if (d.life <= 0) {
          d.mesh.visible = false;
          continue;
        }
        if (!d.resting) {
          d.vel.y -= BARN_BRAWL_MOVER.gravity * dt;
          d.mesh.position.addScaledVector(d.vel, dt);
          d.mesh.rotation.x += d.spin.x * dt;
          d.mesh.rotation.y += d.spin.y * dt;
          d.mesh.rotation.z += d.spin.z * dt;
          const g = groundAt(d.mesh.position.x, d.mesh.position.y, d.mesh.position.z);
          if (d.mesh.position.y <= g + 0.08) {
            d.mesh.position.y = g + 0.08;
            d.mesh.rotation.set(0, d.mesh.rotation.y, 0.45); // comes to rest on its side
            d.resting = true;
          }
        }
        if (d.life < 0.3) d.mesh.scale.setScalar(Math.max(0.01, d.life / 0.3));
      }

      // ── bots ──
      for (const e of enemies) {
        if (!e.alive) {
          if (e.deathPop > 0) {
            e.deathPop -= dt;
            const tt = 1 - Math.max(0, e.deathPop) / 0.22; // 0→1 over the pop
            e.root.scale.setScalar(tt < 0.4 ? 1 + tt * 0.65 : Math.max(0.02, 1.26 - (tt - 0.4) * 2.1));
            if (e.deathPop <= 0) e.root.visible = false;
          }
          e.deathT -= dt;
          if (e.deathT <= 0) respawnEnemy(e);
          continue;
        }
        if (playing) botAI(e, dt);
        animateChar(e.rig, Math.hypot(e.mover.vx, e.mover.vz), dt, { vx: e.mover.vx, vz: e.mover.vz, grounded: e.mover.grounded, aim: e.holding ? 1 : 0 });
      }

      // ── pickups: float/spin; grabbed by whoever is unarmed and walks over (`OnTrigger`) ──
      for (const pk of pickups) {
        if (!pk.active) continue;
        pk.grp.rotation.y += dt * 1.6;
        pk.grp.position.y = pk.y + 1 + Math.sin(clock * 2 + pk.x) * 0.1;
        if (!playing) continue;
        if (alive && !holding && Math.hypot(pos.x - pk.x, pos.z - pk.z) < PICKUP_RADIUS && Math.abs(pos.y - pk.y) < 1.6) {
          holding = true;
          gun.visible = true;
          takePickup(pk);
          blip(560, 0.14, "square", 0.2, 980); // `shotgunPickup` at 0.25
          continue;
        }
        for (const e of enemies) {
          if (e.alive && !e.holding && Math.hypot(e.pos.x - pk.x, e.pos.z - pk.z) < PICKUP_RADIUS && Math.abs(e.pos.y - pk.y) < 1.6) {
            e.holding = true;
            e.gun.visible = true;
            e.targetPickup = null;
            e.tShoot.restart(clock); // `shootChanceTimer.Start()` whenever HoldingShotgun flips
            takePickup(pk);
            break;
          }
        }
      }
      if (playing) pickupTick();

      // ── HUD ──
      if (crossRef.current) {
        const el = crossRef.current;
        el.style.display = playing && alive && holding ? "block" : "none"; // `crossHair.enabled = holding`
        const k = aimDist <= AIM_MIN ? CROSS_NEAR : aimDist >= AIM_MAX ? 1 : CROSS_NEAR - (CROSS_NEAR - 1) * ((aimDist - AIM_MIN) / (AIM_MAX - AIM_MIN));
        el.style.transform = `scale(${k.toFixed(3)})`;
        el.style.color = aimOnBody ? "rgba(255,40,40,0.75)" : "rgba(255,255,255,0.6)";
      }
      if (killedRef.current) killedRef.current.style.opacity = String(Math.min(1, killedT / 0.3));
      if (weaponRef.current) weaponRef.current.textContent = !alive ? "" : holding ? "Shotgun · one shell" : "Unarmed · find a shotgun";
      if (scoreRef.current) scoreRef.current.textContent = `Score ${score} · Kills ${kills}`;
      if (vignRef.current) vignRef.current.style.opacity = String(Math.min(0.55, hurtT));
      if (deadRef.current) deadRef.current.style.display = playerDead > 0 ? "grid" : "none";
      // `saturationVolume.weight` ramps at ±2/s: the barn greys out while you're dead
      const satNext = Math.max(0, Math.min(1, satW + (alive ? -2 : 2) * dt));
      if (satNext !== satW) {
        satW = satNext;
        canvas.style.filter = satW > 0.005 ? `grayscale(${satW.toFixed(2)})` : "";
      }

      dust.rotation.y += dt * 0.03;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // ── input ──
    const kd = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (isGameKey(k)) e.preventDefault();
      if (bound("action", k) && !e.repeat) jumpQueued = true;
    };
    const ku = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    const mvs = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) return;
      tpCam.rotate(e.movementX, e.movementY); // 0.18°/px, pitch clamped to ±89°
    };
    const mdn = (e: MouseEvent): void => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) fireQueued = true;
    };
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mvs);
    window.addEventListener("mousedown", mdn);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", mvs);
      window.removeEventListener("mousedown", mdn);
      canvas.style.filter = "";
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
              <div style={{ position: "relative", width: 22, height: 60, display: "grid", justifyItems: "center", alignContent: "start" }}>
                {/* the aimer: only while holding a shotgun; grows as the target gets close, red over a body */}
                <div ref={crossRef} style={{ position: "relative", width: 22, height: 22, display: "none", color: "rgba(255,255,255,0.6)", transition: "transform 80ms linear" }}>
                  <div style={{ position: "absolute", left: 10, top: 0, width: 2, height: 22, background: "currentColor" }} />
                  <div style={{ position: "absolute", top: 10, left: 0, width: 22, height: 2, background: "currentColor" }} />
                </div>
                <div ref={killedRef} style={{ marginTop: 10, whiteSpace: "nowrap", opacity: 0, color: "#ffd23f", fontWeight: 900, fontSize: 20, textShadow: "0 1px 4px #000" }} />
              </div>
            </div>
            <div ref={timerRef} style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center", color: "#fff", fontWeight: 900, fontSize: 26, textShadow: "0 1px 4px #000", pointerEvents: "none" }}>1:15</div>
            <div ref={scoreRef} style={{ position: "absolute", top: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 16, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Score 0 · Kills 0</div>
            <div ref={weaponRef} style={{ position: "absolute", right: 16, bottom: 16, color: "#fff", fontWeight: 800, fontSize: 17, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>Unarmed · find a shotgun</div>
            <div ref={deadRef} style={{ position: "absolute", inset: 0, display: "none", placeItems: "center", background: "rgba(40,10,10,0.45)", borderRadius: 8, color: "#fff", pointerEvents: "none", textAlign: "center" }}>
              <div>
                <div ref={deadWhoRef} style={{ fontWeight: 900, fontSize: 30 }} />
                <div ref={deadSecRef} style={{ fontWeight: 700, fontSize: 20, opacity: 0.85, marginTop: 6 }} />
              </div>
            </div>
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
            <div style={{ fontSize: 15, opacity: 0.85, maxWidth: 480, lineHeight: 1.5 }}>
              <strong>WASD</strong> move · <strong>mouse</strong> look · <strong>click</strong> fire · <strong>Space</strong> jump. Grab a shotgun: one shell, any pellet kills, and the gun flies out of your hands when you fire. {KILL_SCORE} points a kill — most points in {ROUND_LENGTH} seconds wins.
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
            <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
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
                  <span style={{ color: "#ffd23f" }}>{r.score} pts</span>
                  <span style={{ color: "#4ade80" }}>{r.kills} K</span>
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
