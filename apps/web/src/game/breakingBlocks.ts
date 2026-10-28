// Pummel Party's "Breaking Blocks" (the game Floor Drop is modelled on) as pure helpers:
// the crate grid, the 18 drop patterns, the wave schedule, each crate's shake → fall →
// return timeline, the spread spawn line, the scoring and the bots' crate targeting.
// Sources: ~/Projects/rea-work/pummel-party/decompiled/Assembly-CSharp/BoxController.cs,
// BoxDropBox.cs, BoxDropController.cs, BoxDropPlayer.cs, MinigameController.cs
// (SpawnPlayers → Spread), extracted/minigames/breakingblocks.json and a dump of
// scenes_scenes_boxdrop_scene.bundle (BoxController dimensions 10, scale 2, offset y −0.66;
// SpawnPoints; the CameraParent rig). Numbers and structure only, never the game's assets.

import type { MoverTuning } from "./characterMover.js";

export const BREAKING_BLOCKS = {
  dimensions: 10, // `m_dimensions`
  scale: 2, // `m_scale`: each crate is a 2-unit cube, the arena is 20 × 20
  offsetY: -0.66, // `m_offset.y`: crate centres sit at y −0.66, so their tops are at 0.34
  dropDistance: 3, // `m_dropDistance`: patterns 6 and 7 split the board at a radius of 3 crates
  roundLength: 70, // BoxDropController.roundLength
  waveInterval: 2.5, // a wave queues once `m_dropTimeElapsed` (ticking only while nothing is queued) reaches 2.5 s
  waveLead: 1, // `DropBoxes(…, GameTime + 1f)`: a queued wave runs 1 s later
  firstWaveElapsed: 5, // `m_dropTimeElapsed = 5f` at start, so the first wave queues on the first frame of play
  delayMin: 0.3, // `Mathf.Clamp(1f - progress * 0.9f, 0.3f, 1f)` …
  delayMax: 1,
  delayShrink: 0.9,
  delaySpan: 0.8, // … with progress = elapsed / (roundLength · 0.8): the shortest warning from 56 s on
  deathY: -6, // BoxDropPlayer.Update: below y −6 the player is killed (the lava)
  cameraShake: 0.25, // `m_shake.AddShake(0.25f)` as each wave starts shaking
  endHold: 3, // `EndRound(3f)` once the timer runs out or one player is left
  // BoxDropBox.DropRoutine
  shakeLead: 0.1, // the shake lasts `delay − 0.1 + Random.value · 0.5` …
  shakeRandom: 0.5,
  riseMin: 0.045, // … while the crate rises 0.045–0.195 over the first quarter of the delay …
  riseRandom: 0.15,
  shakeRadius: 0.15, // … jittering toward points 0.15 out, at up to 1 unit/s
  shakeSpeed: 1,
  shakeRetarget: 0.05, // after 0.05 s the jitter target is re-rolled every frame (the timer is never reset)
  fallTime: 1.35, // the crate is a loose rigidbody for 1.35 s …
  fallGravity: 9.81, // … under Unity's default gravity …
  fallKick: 2, // … launched along a random unit vector with 2 taken off its y …
  spinSpeed: 360, // … spinning 360°/s about a random axis
  returnMin: 0.3, // then it eases back into place over 0.3–0.6 s
  returnRandom: 0.3,
  // the `SpawnPoints` line in world units (MinigameRoot scale 0.8 × SpawnPoints scale 1.7
  // applied): Spawn1 at x −3.06 … Spawn4 at x 3.06, y 1.096, z 0, facing the camera (−z)
  spawnX0: -3.06,
  spawnX1: 3.06,
  spawnY: 1.096,
  spawnZ: 0,
  bodyTurnSpeed: 1500, // the model turns to the movement axis at 1500°/s
} as const;

/** the crates' top surface: centre y plus half a crate */
export const CRATE_TOP_Y = BREAKING_BLOCKS.offsetY + BREAKING_BLOCKS.scale / 2;

/** half the arena width: the grid spans −10 … 10 on both axes */
export const ARENA_HALF = (BREAKING_BLOCKS.dimensions * BREAKING_BLOCKS.scale) / 2;

// BoxDropPlayer's CharacterMover, from extracted/minigames/breakingblocks.json: maxSpeed 8,
// acceleration 70, deceleration 70, airAcceleration 70, airDeceleration 70, gravity 25,
// maxJumps 1, jumpLeewayTime 0.2, jumpVelocity 7.
export const BREAKING_BLOCKS_MOVER: MoverTuning = {
  maxSpeed: 8,
  acceleration: 70,
  deceleration: 70,
  airAcceleration: 70,
  airDeceleration: 70,
  gravity: 25,
  maxJumps: 1,
  jumpLeewayTime: 0.2,
  jumpVelocity: 7,
  jumpBufferTime: 0.15,
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** `GetBoxPosition(x, y)`: the centre of crate (x, y), x along world x and y along world z */
export function crateCenter(x: number, y: number): Vec3 {
  const { dimensions, scale, offsetY } = BREAKING_BLOCKS;
  const start = -(dimensions * scale) / 2; // `GetStartPos`
  return { x: start + x * scale + scale / 2, y: offsetY, z: start + y * scale + scale / 2 };
}

/** the crate under a world point, or null off the grid */
export function crateAt(wx: number, wz: number): { x: number; y: number } | null {
  const { dimensions, scale } = BREAKING_BLOCKS;
  const x = Math.floor((wx + ARENA_HALF) / scale);
  const y = Math.floor((wz + ARENA_HALF) / scale);
  if (x < 0 || y < 0 || x >= dimensions || y >= dimensions) return null;
  return { x, y };
}

/** `GetBoxDropPermuationCount` */
export const PERMUTATION_COUNT = 18;

/** `BoxController.ShouldBoxDrop`: does crate (x, y) drop in wave pattern `permutation`? */
export function shouldCrateDrop(x: number, y: number, permutation: number): boolean {
  const n = BREAKING_BLOCKS.dimensions;
  const p = ((permutation % PERMUTATION_COUNT) + PERMUTATION_COUNT) % PERMUTATION_COUNT;
  const num = x * n + y;
  const c = crateCenter(x, y);
  // `b = boxPosition / m_scale` — keeps the y offset, which matters for the disc patterns
  const bx = c.x / BREAKING_BLOCKS.scale;
  const bz = c.z / BREAKING_BLOCKS.scale;
  const dist = Math.hypot(c.x, c.y, c.z); // Vector3.Distance(zero, boxPosition), y included
  const cheb = Math.trunc(Math.max(Math.abs(bx), Math.abs(bz)));
  switch (p) {
    case 0:
      return num < (n * n) / 2; // the low-x half
    case 1:
      return num >= (n * n) / 2;
    case 2:
      return x % 2 === y % 2; // checkerboard
    case 3:
      return x % 2 !== y % 2;
    case 4:
      return x % 2 === 0; // every other column
    case 5:
      return y % 2 === 0; // every other row
    case 6:
      return dist < BREAKING_BLOCKS.dropDistance * BREAKING_BLOCKS.scale; // the inner disc
    case 7:
      return dist > BREAKING_BLOCKS.dropDistance * BREAKING_BLOCKS.scale; // the outer ring
    case 8:
      return cheb % 2 === 0; // concentric square rings
    case 9:
      return cheb % 2 !== 0;
    case 10:
      return bx < 0 && bz < 0; // one quadrant each
    case 11:
      return bx > 0 && bz < 0;
    case 12:
      return bx > 0 && bz > 0;
    case 13:
      return bx < 0 && bz > 0;
    case 14:
      return x % 3 !== 0 && y % 3 !== 0; // everything but a lattice of every third row/column
    case 15:
      return x % 3 === 0 || y % 3 === 0; // the lattice itself
    case 16:
      return isDiagonalBand(x, y, n); // an X of 3-wide diagonals
    case 17:
      return !isDiagonalBand(x, y, n);
    default:
      return false;
  }
}

// `x == y || x == y ± 1 || x + y == n || x + 1 + y == n || x + 2 + y == n`
function isDiagonalBand(x: number, y: number, n: number): boolean {
  return x === y || x === y + 1 || x === y - 1 || x + y === n || x + 1 + y === n || x + 2 + y === n;
}

/** the per-crate warning time (the shake) `roundElapsed` seconds into the round */
export function waveDelay(roundElapsed: number, roundLength: number = BREAKING_BLOCKS.roundLength): number {
  const progress = roundElapsed / (roundLength * BREAKING_BLOCKS.delaySpan);
  return Math.min(BREAKING_BLOCKS.delayMax, Math.max(BREAKING_BLOCKS.delayMin, 1 - progress * BREAKING_BLOCKS.delayShrink));
}

export interface Wave {
  permutation: number;
  delay: number;
}

/** BoxDropController.Update's wave timing: queue every 2.5 s of unqueued time, run 1 s later */
export class WaveScheduler {
  private elapsed: number = BREAKING_BLOCKS.firstWaveElapsed;
  private time = 0;
  private queued: (Wave & { at: number }) | null = null;

  /** the wave queued but not yet running, if any (the HUD can hint at it) */
  get pending(): Wave | null {
    return this.queued;
  }

  /** advance by dt; returns the wave that starts this step, if any */
  update(dt: number, roundElapsed: number, rand: () => number): Wave | null {
    this.time += dt;
    if (!this.queued) {
      this.elapsed += dt;
      if (this.elapsed >= BREAKING_BLOCKS.waveInterval) {
        this.queued = { permutation: Math.floor(rand() * PERMUTATION_COUNT), delay: waveDelay(roundElapsed), at: this.time + BREAKING_BLOCKS.waveLead };
        this.elapsed = 0;
      }
    }
    if (this.queued && this.time >= this.queued.at) {
      const w = this.queued;
      this.queued = null;
      return { permutation: w.permutation, delay: w.delay };
    }
    return null;
  }
}

export type CratePhase = "idle" | "shake" | "fall" | "return";

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** one crate's `DropRoutine` state: an offset and rotation from its resting place */
export interface CrateDrop {
  phase: CratePhase;
  t: number; // seconds into the phase
  off: Vec3; // local offset from the rest position
  rot: Quat; // local rotation
  shakeTime: number;
  riseTime: number;
  riseHeight: number;
  shakeTarget: { x: number; z: number };
  vel: Vec3; // fall velocity
  spin: Vec3; // fall angular velocity, rad/s
  returnTime: number;
  returnFrom: { off: Vec3; rot: Quat };
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function idleCrate(): CrateDrop {
  return {
    phase: "idle",
    t: 0,
    off: { x: 0, y: 0, z: 0 },
    rot: { ...IDENTITY },
    shakeTime: 0,
    riseTime: 0,
    riseHeight: 0,
    shakeTarget: { x: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
    returnTime: 0,
    returnFrom: { off: { x: 0, y: 0, z: 0 }, rot: { ...IDENTITY } },
  };
}

/** `Random.onUnitSphere` */
export function randomUnit(rand: () => number): Vec3 {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: Math.cos(a) * r, y: z, z: Math.sin(a) * r };
}

/** `Drop(delay)`: start the routine on a resting crate (a dropping crate ignores it) */
export function startCrateDrop(c: CrateDrop, delay: number, rand: () => number): boolean {
  if (c.phase !== "idle") return false;
  const B = BREAKING_BLOCKS;
  c.phase = "shake";
  c.t = 0;
  c.shakeTime = delay - B.shakeLead + rand() * B.shakeRandom;
  c.riseTime = delay / 4;
  c.riseHeight = B.riseMin + rand() * B.riseRandom;
  c.shakeTarget = shakeTarget(rand);
  c.returnTime = B.returnMin + rand() * B.returnRandom;
  return true;
}

function shakeTarget(rand: () => number): { x: number; z: number } {
  const u = randomUnit(rand); // `Random.onUnitSphere * 0.15f` with y zeroed
  return { x: u.x * BREAKING_BLOCKS.shakeRadius, z: u.z * BREAKING_BLOCKS.shakeRadius };
}

/** advance a crate's routine by dt */
export function stepCrate(c: CrateDrop, dt: number, rand: () => number): void {
  const B = BREAKING_BLOCKS;
  if (c.phase === "idle") return;
  c.t += dt;
  if (c.phase === "shake") {
    if (c.t >= c.shakeTime) {
      // the rigidbody is let go: a random kick, mostly downward, and a tumble
      const u = randomUnit(rand);
      c.vel = { x: u.x, y: u.y - B.fallKick, z: u.z };
      const s = randomUnit(rand);
      const w = (B.spinSpeed * Math.PI) / 180;
      c.spin = { x: s.x * w, y: s.y * w, z: s.z * w };
      c.phase = "fall";
      c.t = 0;
      return;
    }
    const k = Math.min(1, c.t / c.riseTime); // `num2`
    if (c.t > B.shakeRetarget) c.shakeTarget = shakeTarget(rand);
    // `Vector3.MoveTowards(localPosition, shakeTarget, 1 · dt · num2)`, y overridden by the rise
    const dx = c.shakeTarget.x - c.off.x;
    const dz = c.shakeTarget.z - c.off.z;
    const d = Math.hypot(dx, dz);
    const step = B.shakeSpeed * dt * k;
    if (d <= step || d < 1e-6) {
      c.off.x = c.shakeTarget.x;
      c.off.z = c.shakeTarget.z;
    } else {
      c.off.x += (dx / d) * step;
      c.off.z += (dz / d) * step;
    }
    c.off.y = k * c.riseHeight;
  } else if (c.phase === "fall") {
    c.vel.y -= B.fallGravity * dt;
    c.off.x += c.vel.x * dt;
    c.off.y += c.vel.y * dt;
    c.off.z += c.vel.z * dt;
    c.rot = integrateSpin(c.rot, c.spin, dt);
    if (c.t >= B.fallTime) {
      c.phase = "return";
      c.t = 0;
      c.returnFrom = { off: { ...c.off }, rot: { ...c.rot } };
    }
  } else {
    // `Vector3.LerpUnclamped(lerpPos, startPos, curve(t))` + `Quaternion.Lerp` back to rest
    const u = Math.min(1, c.t / c.returnTime);
    const e = returnCurve(u);
    const f = c.returnFrom;
    c.off = { x: f.off.x * (1 - e), y: f.off.y * (1 - e), z: f.off.z * (1 - e) };
    c.rot = nlerp(f.rot, IDENTITY, e);
    if (u >= 1) {
      c.phase = "idle";
      c.t = 0;
      c.off = { x: 0, y: 0, z: 0 };
      c.rot = { ...IDENTITY };
    }
  }
}

// `m_returnCurve` is an editor curve we can't read; an ease-out matches the settle it produces
function returnCurve(u: number): number {
  return 1 - (1 - u) * (1 - u);
}

/** the crate's collider is only enabled while resting or shaking (`m_boxCollider.enabled`) */
export function crateSolid(c: CrateDrop): boolean {
  return c.phase === "idle" || c.phase === "shake";
}

/** the crate counts for the bots' navigation only while resting (`m_sourceTag.enabled`) */
export function crateWalkable(c: CrateDrop): boolean {
  return c.phase === "idle";
}

/** `IsDropping`: the routine is running */
export function crateDropping(c: CrateDrop): boolean {
  return c.phase !== "idle";
}

function integrateSpin(q: Quat, w: Vec3, dt: number): Quat {
  // q' = q + ½·(ω ⊗ q)·dt, renormalised
  const hx = w.x * dt * 0.5;
  const hy = w.y * dt * 0.5;
  const hz = w.z * dt * 0.5;
  const n: Quat = {
    w: q.w - hx * q.x - hy * q.y - hz * q.z,
    x: q.x + hx * q.w + hy * q.z - hz * q.y,
    y: q.y - hx * q.z + hy * q.w + hz * q.x,
    z: q.z + hx * q.y - hy * q.x + hz * q.w,
  };
  const len = Math.hypot(n.x, n.y, n.z, n.w) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len, w: n.w / len };
}

function nlerp(a: Quat, b: Quat, t: number): Quat {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const n: Quat = { x: a.x + (b.x * sign - a.x) * t, y: a.y + (b.y * sign - a.y) * t, z: a.z + (b.z * sign - a.z) * t, w: a.w + (b.w * sign - a.w) * t };
  const len = Math.hypot(n.x, n.y, n.z, n.w) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len, w: n.w / len };
}

/** `MinigameSpawnPositionType.Spread`: n spots evenly along Spawn1 → Spawn4 */
export function spreadSpawns(n: number): Vec3[] {
  const B = BREAKING_BLOCKS;
  const out: Vec3[] = [];
  const step = n >= 3 ? 1 / (n - 1) : n === 2 ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const u = Math.min(1, i * step);
    out.push({ x: B.spawnX0 + (B.spawnX1 - B.spawnX0) * u, y: B.spawnY, z: B.spawnZ });
  }
  return out;
}

/** `BuildResults`: the dead score by death order (first out = 10), survivors 10 × players */
export function scoreFor(dead: boolean, deathOrder: number, playerCount: number): number {
  return dead ? 10 * (deathOrder + 1) : 10 * playerCount;
}

export interface CrateRef {
  x: number;
  y: number;
  dropping: boolean;
}

/** `GetClosestBox`: the nearest crate in the wanted state within [min, max] of a point, or null */
export function closestCrate(crates: readonly CrateRef[], from: Vec3, dropping: boolean, minDistance: number, maxDistance = 1000): CrateRef | null {
  let best: CrateRef | null = null;
  let bestD = Infinity;
  for (const c of crates) {
    if (c.dropping !== dropping) continue;
    const p = crateCenter(c.x, c.y);
    const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
    if (d < bestD && d >= minDistance && d <= maxDistance) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/** `OnDropBoxes`: four bots in five head for a safe crate at least 6 away, the fifth for a dropping one */
export function waveTargetsDropping(rand: () => number): boolean {
  return rand() >= 0.8;
}

export interface Cell {
  x: number;
  y: number;
}

/**
 * A stand-in for the NavMeshAgent: a shortest path over the crates from `from` toward `to`,
 * where `cost(x, y)` is the price of stepping onto a crate (1 for a resting crate, more for
 * one that is shaking, Infinity for a gap). It ends on the reachable crate nearest the goal
 * when the goal itself is gone (the agent's `pathEndPosition` then differs from the target
 * and the bot waits at the edge). Returns the cells after `from`, or [] when there is
 * nowhere better to go.
 */
export function cratePath(from: Cell, to: Cell, cost: (x: number, y: number) => number): Cell[] {
  const n = BREAKING_BLOCKS.dimensions;
  const key = (c: Cell): number => c.y * n + c.x;
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const open: Array<{ c: Cell; d: number }> = [{ c: from, d: 0 }];
  dist.set(key(from), 0);
  prev.set(key(from), -1);
  let best = from;
  let bestGoal = Math.hypot(from.x - to.x, from.y - to.y);
  while (open.length) {
    // Dijkstra on a 10 × 10 grid: a linear scan for the cheapest open cell is plenty
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.d < open[bi]!.d) bi = i;
    const { c, d } = open.splice(bi, 1)[0]!;
    if (d > (dist.get(key(c)) ?? Infinity)) continue;
    const g = Math.hypot(c.x - to.x, c.y - to.y);
    if (g < bestGoal - 1e-9) {
      bestGoal = g;
      best = c;
    }
    if (g === 0) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const w = cost(nx, ny);
      if (!Number.isFinite(w)) continue;
      const k = ny * n + nx;
      const nd = d + w;
      if (nd < (dist.get(k) ?? Infinity)) {
        dist.set(k, nd);
        prev.set(k, key(c));
        open.push({ c: { x: nx, y: ny }, d: nd });
      }
    }
  }
  const path: Cell[] = [];
  let k = key(best);
  while (k !== key(from)) {
    path.push({ x: k % n, y: Math.floor(k / n) });
    k = prev.get(k)!;
  }
  return path.reverse();
}

/** the bots' price of stepping onto a crate: resting 1, shaking 3 (still solid, but a gamble), gone impassable */
export function crateCost(c: CrateDrop): number {
  if (c.phase === "idle") return 1;
  if (c.phase === "shake") return 3;
  return Infinity;
}
