// Pummel Party's Strategic Shockwave ("Bomber"), as pure rules: the wheel-shaped node graph,
// where a blast travels, what a crate hides, the walkable floor, scoring and the bot brain.
// Sources: ~/Projects/rea-work/pummel-party/decompiled/Assembly-CSharp/ BomberController.cs,
// BomberPlayer.cs, Bomb.cs, BombNode.cs, BomberBuff.cs, Node.cs; the node graph, colliders
// and camera come from scenes_scenes_bomber_scene.bundle and the minigames-strategicshockwave
// prefab bundles; FINDINGS.md §16. Only numbers and structure are reused, never the assets.
//
// Frame: the reference camera sits on +z looking toward −z; ours (like the other top-down
// ports) sits on −z looking toward +z, i.e. the arena is turned half a turn. The wheel is
// symmetric, so only the spawn order and the "more players" pockets notice.

import type { MoverTuning } from "./characterMover.js";

export const SHOCKWAVE = {
  rounds: 2, // BomberController.rounds
  roundLength: 60, // BomberController.roundLength
  suddenDeathLength: 20, // the round is cut at `time_test <= -20f`
  suddenDeathText: 4, // `ShowLargeText("Sudden Death", …, 4f)`
  suddenDeathRange: 30, // `bombRange = 30`
  suddenDeathBombs: 10, // `MaxBombs = BombsRemaining = 10`
  endHold: 3, // `EndRound(3f, 3f)`
  fuse: 3, // Bomb.explode_time
  placeRange: 1, // BomberPlayer.maxPlaceRange: nearest free node within 1 unit
  startBombs: 1, // ResetPlayer: MaxBombs = BombsRemaining = 1
  startRange: 1, // ResetPlayer: bombRange = 1
  rangeBuffChance: 0.5, // GetRandomBuff: < 0.5 → range
  countBuffChance: 0.3, // < 0.8 → bomb count, else nothing
  blastHalf: 0.6, // BombNode trigger box 1.2 × 1.2 (rotated with the node)
  crateHalf: 0.625, // Blocker box 1.25 × 1.25
  buffRadius: 0.4, // BomberBuff SphereCollider
  playerRadius: 0.3, // CharacterController radius
  bombRadius: 0.45, // our stand-in for the bomb's collider: with the 0.3 body it seals a corridor
  bodyTurnSpeed: 1500, // `RotateTowards(…, 1500f * dt)`
  waypointReach: 0.35, // the AI drops a waypoint within 0.35
  buffSeekSteps: 5, // the AI goes for a buff fewer than 5 nodes away
  safeSearchDepth: 8, // BomberPlayer.maxSafeDistance
  cameraShake: 0.2, // ours: the reference only plays the explosion effect
} as const;

// extracted/minigames/strategicshockwave.json → CharacterMover on the BomberPlayer prefab:
// maxSpeed 5, acceleration 35, deceleration 35, airAcceleration 17, airDeceleration 0,
// gravity 15, maxJumps 0 (no jumping), jumpLeewayTime 0.3, jumpVelocity 10.
export const SHOCKWAVE_MOVER: MoverTuning = {
  maxSpeed: 5,
  acceleration: 35,
  deceleration: 35,
  airAcceleration: 17,
  airDeceleration: 0,
  gravity: 15,
  maxJumps: 0,
  jumpLeewayTime: 0.3,
  jumpVelocity: 10,
  jumpBufferTime: 0.15,
};

// ── the wheel ────────────────────────────────────────────────────────────────────────────
// NodeCreator on the scene's `Nodes` object holds 97 nodes: the hub, eight spokes of six
// nodes (radii 1.67–1.71, 3.09–3.12, 4.48–4.5, 5.88–6.0, 7.39–7.42, 9.01–9.14) and three
// rings through the 1st, 4th and 6th spoke node — 8, 24 and 40 nodes around (the outer
// ring bulges to 9.36 between spokes; we keep it round). A node belongs to "groups": one
// per spoke pair (a diameter, groups 0–3) and one for every ring (group 4). A blast only
// keeps travelling through links that stay in the group it started along.

export const SPOKES = 8;
export const SPOKE_RADII = [1.7, 3.1, 4.5, 5.9, 7.4, 9.1] as const;
const RING_SPOKE_SLOTS = [0, 3, 5] as const; // which spoke node each ring runs through
const RING_BETWEEN = [0, 2, 4] as const; // extra ring nodes between two neighbouring spokes
export const RING_GROUP = 4;

// The floor (BomberCollider, a wheel-shaped slab scaled 4.3): hub disc out to 2.3, ring
// corridors 5.1–6.65 and 8.3–9.9, spokes 1.44–1.6 wide. Step off it in the reference and
// you drop into the cave and are put back on your spawn; here the edge simply holds you.
export const FLOOR = {
  hubRadius: 2.3,
  rings: [
    [5.1, 6.65],
    [8.3, 9.9],
  ],
  spokeHalfWidth: 0.75,
  spokeLength: 9.9,
} as const;

export interface WheelNode {
  index: number;
  x: number;
  z: number;
  /** the node's yaw (radians): crates and blast boxes are turned to face along the wheel */
  rot: number;
  groups: number[];
  links: number[];
  /** `Node.blocker`: a crate stands here at the start of a round */
  blocker: boolean;
  /** `unblockedPlayerCount`: 0, or the player count from which this node starts clear */
  minPlayers: number;
}

// The four pockets that only open for players 5–8 sit on the diagonals; in our turned frame
// spoke 1 hosts player 5, spoke 5 player 6, spoke 7 player 7 and spoke 3 player 8.
const EXTRA_POCKET: Record<number, number> = { 1: 5, 5: 6, 7: 7, 3: 8 };

const spokeNode = (k: number, j: number): number => 1 + (((k % SPOKES) + SPOKES) % SPOKES) * SPOKE_RADII.length + j;

export function buildWheel(): WheelNode[] {
  const nodes: WheelNode[] = [];
  const add = (x: number, z: number, rot: number, groups: number[]): WheelNode => {
    const n: WheelNode = { index: nodes.length, x, z, rot, groups, links: [], blocker: true, minPlayers: 0 };
    nodes.push(n);
    return n;
  };
  const link = (a: number, b: number): void => {
    nodes[a]!.links.push(b);
    nodes[b]!.links.push(a);
  };
  add(0, 0, 0, [0, 1, 2, 3]);
  for (let k = 0; k < SPOKES; k++) {
    const a = (k * Math.PI * 2) / SPOKES;
    for (let j = 0; j < SPOKE_RADII.length; j++) {
      const r = SPOKE_RADII[j]!;
      const onRing = (RING_SPOKE_SLOTS as readonly number[]).includes(j);
      add(Math.sin(a) * r, Math.cos(a) * r, a, onRing ? [k % 4, RING_GROUP] : [k % 4]);
    }
  }
  for (let k = 0; k < SPOKES; k++) {
    link(0, spokeNode(k, 0));
    for (let j = 0; j + 1 < SPOKE_RADII.length; j++) link(spokeNode(k, j), spokeNode(k, j + 1));
  }
  // rings: junction, the in-between nodes, next junction
  const between: number[][][] = RING_SPOKE_SLOTS.map(() => []);
  RING_SPOKE_SLOTS.forEach((slot, ri) => {
    const r = SPOKE_RADII[slot]!;
    const extra = RING_BETWEEN[ri]!;
    for (let k = 0; k < SPOKES; k++) {
      const a0 = (k * Math.PI * 2) / SPOKES;
      const step = (Math.PI * 2) / SPOKES / (extra + 1);
      let prev = spokeNode(k, slot);
      const made: number[] = [];
      for (let e = 1; e <= extra; e++) {
        const a = a0 + step * e;
        const n = add(Math.sin(a) * r, Math.cos(a) * r, a, [RING_GROUP]);
        link(prev, n.index);
        prev = n.index;
        made.push(n.index);
      }
      link(prev, spokeNode(k + 1, slot));
      between[ri]![k] = made;
    }
  });
  // the four spawn pockets on the straight spokes are never crated: the junction on the
  // middle ring, the spoke node inside it and the ring node on either side
  for (let k = 0; k < SPOKES; k += 2) {
    const open = [spokeNode(k, 3), spokeNode(k, 2), between[1]![k]![0]!, between[1]![(k + SPOKES - 1) % SPOKES]![1]!];
    for (const i of open) nodes[i]!.blocker = false;
  }
  // the diagonal pockets open with enough players: the outer junction, the spoke node
  // inside it and the outer-ring node on either side
  for (const [ks, count] of Object.entries(EXTRA_POCKET)) {
    const k = Number(ks);
    const pocket = [spokeNode(k, 5), spokeNode(k, 4), between[2]![k]![0]!, between[2]![(k + SPOKES - 1) % SPOKES]![3]!];
    for (const i of pocket) nodes[i]!.minPlayers = count;
  }
  return nodes;
}

/** `!blocker || (unblockedPlayerCount != 0 && unblockedPlayerCount <= PlayerCount)` negated */
export function startsBlocked(n: WheelNode, playerCount: number): boolean {
  return n.blocker && !(n.minPlayers !== 0 && n.minPlayers <= playerCount);
}

/** the spawn node of each slot: SpawnPoint1–4 on the middle ring, 5–8 on the outer junctions */
export function spawnNodes(playerCount: number): number[] {
  const order = [spokeNode(6, 3), spokeNode(4, 3), spokeNode(2, 3), spokeNode(0, 3), spokeNode(1, 5), spokeNode(5, 5), spokeNode(7, 5), spokeNode(3, 5)];
  if (playerCount === 2) return [order[0]!, order[2]!]; // ours: a duel starts on opposite sides
  return order.slice(0, Math.max(1, Math.min(order.length, playerCount)));
}

// ── buffs ────────────────────────────────────────────────────────────────────────────────
export type Buff = "range" | "count" | "none";

/** `GetRandomBuff`: half the crates hide +1 range, three in ten +1 bomb, the rest nothing */
export function rollBuff(rand: () => number): Buff {
  const v = rand();
  if (v < SHOCKWAVE.rangeBuffChance) return "range";
  if (v < SHOCKWAVE.rangeBuffChance + SHOCKWAVE.countBuffChance) return "count";
  return "none";
}

// ── the field: crates, bombs and loose buffs ─────────────────────────────────────────────
export interface ShockBomb {
  node: number;
  owner: number;
  range: number;
  fuse: number;
  /** the nodes this bomb will hit, fixed when it is placed (`Bomb.Start` → GetHitNodes) */
  hits: number[];
  /** fighters standing on it when it was placed: they may walk off it */
  pass: number[];
}

export interface LooseBuff {
  node: number;
  x: number;
  z: number;
  kind: Exclude<Buff, "none">;
}

export interface ShockField {
  nodes: WheelNode[];
  blocked: boolean[];
  /** what the crate on each node hides */
  hidden: Buff[];
  /** `Node.occupier`: the slot whose bomb sits on the node, or −1 */
  occupier: number[];
  /** `Node.HittingBombs.Count`: how many live bombs will hit the node */
  hitting: number[];
  bombs: ShockBomb[];
  buffs: LooseBuff[];
}

export function newField(nodes: WheelNode[], playerCount: number, rand: () => number): ShockField {
  const field: ShockField = { nodes, blocked: [], hidden: [], occupier: [], hitting: [], bombs: [], buffs: [] };
  resetField(field, playerCount, rand);
  return field;
}

/** `ResetRound`: fresh crates and buffs, no bombs, nothing threatened */
export function resetField(field: ShockField, playerCount: number, rand: () => number): void {
  field.blocked = field.nodes.map((n) => startsBlocked(n, playerCount));
  field.hidden = field.nodes.map(() => rollBuff(rand));
  field.occupier = field.nodes.map(() => -1);
  field.hitting = field.nodes.map(() => 0);
  field.bombs = [];
  field.buffs = [];
}

const sharedGroup = (a: WheelNode, b: WheelNode): number => {
  for (const g of a.groups) if (b.groups.includes(g)) return g;
  return -1;
};

/**
 * `GetHitNodes`: the bomb's own node, then outward along every link for `range` nodes,
 * staying in the group of the first step (a spoke's diameter or a ring) and stopping on the
 * first crate, which is hit too.
 */
export function blastNodes(nodes: readonly WheelNode[], blocked: readonly boolean[], origin: number, range: number): number[] {
  const exploded = new Set<number>(); // node · 8 + group
  const hit: number[] = [origin];
  const o = nodes[origin]!;
  for (const g of o.groups) exploded.add(origin * 8 + g);
  const spread = (i: number, group: number, left: number): void => {
    hit.push(i);
    exploded.add(i * 8 + group);
    if (blocked[i] || left <= 1) return;
    const n = nodes[i]!;
    for (const l of n.links) {
      const g = sharedGroup(n, nodes[l]!);
      if (g !== -1 && g === group && !exploded.has(l * 8 + g)) spread(l, g, left - 1);
    }
  };
  for (const l of o.links) spread(l, sharedGroup(o, nodes[l]!), range);
  return [...new Set(hit)];
}

/** `GetNearestNodeIndex`: the closest uncrated node within √maxDistSq, optionally bomb-free */
export function nearestNode(field: ShockField, x: number, z: number, maxDistSq: number, checkOccupier: boolean): number {
  let best = -1;
  let bd = Infinity;
  for (const n of field.nodes) {
    if (field.blocked[n.index] || (checkOccupier && field.occupier[n.index] !== -1)) continue;
    const d = (x - n.x) ** 2 + (z - n.z) ** 2;
    if (d < maxDistSq && d < bd) {
      bd = d;
      best = n.index;
    }
  }
  return best;
}

/** `SpawnBomb` + `PlaceBomb2` + `Bomb.Start`: put a bomb on the nearest free node, or null */
export function placeBomb(field: ShockField, x: number, z: number, owner: number, range: number, standing: readonly number[] = []): ShockBomb | null {
  const node = nearestNode(field, x, z, SHOCKWAVE.placeRange ** 2, true);
  if (node === -1) return null;
  const bomb: ShockBomb = { node, owner, range, fuse: SHOCKWAVE.fuse, hits: blastNodes(field.nodes, field.blocked, node, range), pass: [...standing] };
  field.bombs.push(bomb);
  field.occupier[node] = owner;
  for (const h of bomb.hits) field.hitting[h] = (field.hitting[h] ?? 0) + 1;
  return bomb;
}

export interface Detonation {
  bomb: ShockBomb;
  /** crates this blast broke */
  opened: number[];
  /** buffs that dropped out of them */
  dropped: LooseBuff[];
}

/** `Bomb.Update`: burn the fuses; a bomb at zero hits its nodes, breaks crates, frees its node */
export function stepBombs(field: ShockField, dt: number): Detonation[] {
  const out: Detonation[] = [];
  for (const b of field.bombs) b.fuse -= dt;
  const due = field.bombs.filter((b) => b.fuse <= 0);
  if (!due.length) return out;
  field.bombs = field.bombs.filter((b) => b.fuse > 0);
  for (const bomb of due) {
    const opened: number[] = [];
    const dropped: LooseBuff[] = [];
    for (const h of bomb.hits) {
      field.hitting[h] = Math.max(0, (field.hitting[h] ?? 0) - 1);
      if (!field.blocked[h]) continue;
      field.blocked[h] = false;
      opened.push(h);
      const kind = field.hidden[h]!;
      if (kind !== "none") {
        const n = field.nodes[h]!;
        const buff: LooseBuff = { node: h, x: n.x, z: n.z, kind };
        field.buffs.push(buff);
        dropped.push(buff);
      }
    }
    field.occupier[bomb.node] = -1;
    out.push({ bomb, opened, dropped });
  }
  return out;
}

// ── geometry ─────────────────────────────────────────────────────────────────────────────
/** does a circle touch a square of half-size `half`, centred on (bx, bz) and turned by `rot`? */
export function circleTouchesBox(px: number, pz: number, r: number, bx: number, bz: number, half: number, rot: number): boolean {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const dx = px - bx;
  const dz = pz - bz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  const qx = Math.max(-half, Math.min(half, lx));
  const qz = Math.max(-half, Math.min(half, lz));
  return (lx - qx) ** 2 + (lz - qz) ** 2 < r * r;
}

/** is a fighter at (px, pz) inside the blast of node n? (`BombNode.collidingPlayers`) */
export function inBlast(n: WheelNode, px: number, pz: number): boolean {
  return circleTouchesBox(px, pz, SHOCKWAVE.playerRadius, n.x, n.z, SHOCKWAVE.blastHalf, n.rot);
}

/** push a circle out of a turned square; returns the corrected centre */
export function pushOutOfBox(px: number, pz: number, r: number, bx: number, bz: number, half: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const dx = px - bx;
  const dz = pz - bz;
  let lx = dx * c - dz * s;
  let lz = dx * s + dz * c;
  const qx = Math.max(-half, Math.min(half, lx));
  const qz = Math.max(-half, Math.min(half, lz));
  const ex = lx - qx;
  const ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  if (d2 >= r * r) return { x: px, z: pz };
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    lx = qx + (ex / d) * r;
    lz = qz + (ez / d) * r;
  } else if (half - Math.abs(lx) < half - Math.abs(lz)) {
    lx = (lx >= 0 ? 1 : -1) * (half + r); // centre inside: leave through the nearer face
  } else {
    lz = (lz >= 0 ? 1 : -1) * (half + r);
  }
  return { x: bx + lx * c + lz * s, z: bz - lx * s + lz * c };
}

/** push a circle out of another circle */
export function pushOutOfCircle(px: number, pz: number, r: number, cx: number, cz: number, cr: number): { x: number; z: number } {
  const dx = px - cx;
  const dz = pz - cz;
  const d = Math.hypot(dx, dz);
  const min = r + cr;
  if (d >= min) return { x: px, z: pz };
  if (d < 1e-6) return { x: cx + min, z: cz };
  return { x: cx + (dx / d) * min, z: cz + (dz / d) * min };
}

/** keep a body of radius r on the wheel: the nearest point of the hub, a ring or a spoke */
export function constrainToFloor(px: number, pz: number, r: number): { x: number; z: number } {
  const rad = Math.hypot(px, pz);
  let best = { x: px, z: pz };
  let bd = Infinity;
  const take = (x: number, z: number): void => {
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bd) {
      bd = d;
      best = { x, z };
    }
  };
  // hub
  const hub = FLOOR.hubRadius - r;
  if (rad <= hub) return best;
  take((px / rad) * hub, (pz / rad) * hub);
  // rings
  for (const [inner, outer] of FLOOR.rings) {
    const a = inner + r;
    const b = outer - r;
    if (rad >= a && rad <= b) return { x: px, z: pz };
    const k = Math.max(a, Math.min(b, rad)) / rad;
    take(px * k, pz * k);
  }
  // spokes
  const w = FLOOR.spokeHalfWidth - r;
  const len = FLOOR.spokeLength - r;
  for (let k = 0; k < SPOKES; k++) {
    const a = (k * Math.PI * 2) / SPOKES;
    const ux = Math.sin(a);
    const uz = Math.cos(a);
    const along = px * ux + pz * uz;
    const side = px * uz - pz * ux;
    if (along >= 0 && along <= len && Math.abs(side) <= w) return { x: px, z: pz };
    const ca = Math.max(0, Math.min(len, along));
    const cs = Math.max(-w, Math.min(w, side));
    take(ux * ca + uz * cs, uz * ca - ux * cs);
  }
  return best;
}

/**
 * Where a body ends up after a move: crates push it out, so does every bomb that is not its
 * own (`GetPath` walks through `occupier == ownerSlot`) or one it is still standing on, and
 * the wheel's edge holds it in.
 */
export function resolveBody(field: ShockField, slot: number, x: number, z: number): { x: number; z: number } {
  const r = SHOCKWAVE.playerRadius;
  const reach = (SHOCKWAVE.crateHalf * Math.SQRT2 + r) ** 2;
  let p = { x, z };
  for (let pass = 0; pass < 2; pass++) {
    for (const n of field.nodes) {
      if (!field.blocked[n.index] || (n.x - p.x) ** 2 + (n.z - p.z) ** 2 > reach) continue;
      p = pushOutOfBox(p.x, p.z, r, n.x, n.z, SHOCKWAVE.crateHalf, n.rot);
    }
    for (const b of field.bombs) {
      if (b.owner === slot || b.pass.includes(slot)) continue;
      const n = field.nodes[b.node]!;
      p = pushOutOfCircle(p.x, p.z, r, n.x, n.z, SHOCKWAVE.bombRadius);
    }
    p = constrainToFloor(p.x, p.z, r);
  }
  return p;
}

// ── scoring ──────────────────────────────────────────────────────────────────────────────
/**
 * `RoundEnded`: a survivor scores 10 × (players − 1); the dead score 10 × their RoundScore,
 * which `PlayerDied` set to the number of fighters already dead when they went.
 */
export function roundPoints(dead: boolean, diedBefore: number, playerCount: number): number {
  return dead ? 10 * diedBefore : 10 * (playerCount - 1);
}

// ── paths ────────────────────────────────────────────────────────────────────────────────
const walkable = (field: ShockField, i: number, slot: number): boolean => !field.blocked[i] && (field.occupier[i] === -1 || field.occupier[i] === slot);

/**
 * `GetPath`: fewest-nodes route over uncrated nodes that carry no rival's bomb. Returns the
 * nodes from `from` to `to`, both included, or null when there is no way through.
 */
export function findPath(field: ShockField, from: number, to: number, slot: number): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    for (const l of field.nodes[cur]!.links) {
      if (prev.has(l) || !walkable(field, l, slot)) continue;
      prev.set(l, cur);
      if (l === to) {
        const path = [l];
        for (let p = cur; p !== -1; p = prev.get(p)!) path.push(p);
        return path.reverse();
      }
      queue.push(l);
    }
  }
  return null;
}

/** `GetPathClosestSafe`: the nearest reachable node no live bomb will hit, or −1 */
export function closestSafe(field: ShockField, from: number, slot: number): number {
  const seen = new Set<number>([from]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    if (field.hitting[cur] === 0) return cur;
    for (const l of field.nodes[cur]!.links) {
      if (seen.has(l) || !walkable(field, l, slot)) continue;
      seen.add(l);
      queue.push(l);
    }
  }
  return -1;
}

/** `GetSafeNodes`: unthreatened nodes reachable in fewer than `maxDepth` steps (the start counts) */
export function safeNodes(field: ShockField, from: number, slot: number, maxDepth: number = SHOCKWAVE.safeSearchDepth): number[] {
  const out: number[] = [];
  if (!walkable(field, from, slot)) return out;
  const depth = new Map<number, number>([[from, 0]]);
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    if (field.hitting[cur] === 0) out.push(cur);
    const d = depth.get(cur)!;
    if (d + 1 >= maxDepth) continue;
    for (const l of field.nodes[cur]!.links) {
      if (depth.has(l) || !walkable(field, l, slot)) continue;
      depth.set(l, d + 1);
      queue.push(l);
    }
  }
  return out;
}

/** `IsPathSafe`: no live bomb will hit any node on the way */
export function pathSafe(field: ShockField, path: readonly number[] | null): boolean {
  return !!path && path.every((i) => field.hitting[i] === 0);
}

// ── the bot (`BomberPlayer.GetAIInput`) ──────────────────────────────────────────────────
export type BotDifficulty = 0 | 1 | 2; // Easy, Normal, Hard
/** `difficultySafeOverrideChance`: how often a bot bombs without checking it can get away */
export const SAFE_OVERRIDE_CHANCE = [0.2, 0.1, -1] as const;
/** `checkSafetyTimer`: how long a bot may take to notice it is standing in a blast */
export const SAFETY_CHECK = [
  [0, 4],
  [0, 2],
  [0.03, 0.06],
] as const;

/** Pummel Party's `ActionTimer(min, max)`: true once per random interval */
export class ActionTimer {
  private next = -1;
  constructor(
    private readonly min: number,
    private readonly max: number,
  ) {}
  elapsed(now: number, rand: () => number): boolean {
    if (this.next < 0) this.next = now + this.min + rand() * (this.max - this.min);
    if (now < this.next) return false;
    this.next = now + this.min + rand() * (this.max - this.min);
    return true;
  }
  reset(): void {
    this.next = -1;
  }
}

export type BotState = "idle" | "escaping" | "buff" | "toBombable";

export interface BotBrain {
  difficulty: BotDifficulty;
  state: BotState;
  target: number;
  targetBuff: LooseBuff | null;
  /** nodes still to walk to, next first */
  path: number[];
  bombTest: ActionTimer;
  safety: ActionTimer;
  repath: ActionTimer;
}

export function newBotBrain(difficulty: BotDifficulty): BotBrain {
  const [lo, hi] = SAFETY_CHECK[difficulty];
  return {
    difficulty,
    state: "idle",
    target: -1,
    targetBuff: null,
    path: [],
    bombTest: new ActionTimer(0.5, 1), // bombPlaceTestTimer
    safety: new ActionTimer(lo, hi),
    repath: new ActionTimer(0.1, 0.125), // findPathTimer
  };
}

/** `ResetPlayer`: forget the plan between rounds */
export function resetBotBrain(b: BotBrain): void {
  b.state = "idle";
  b.target = -1;
  b.targetBuff = null;
  b.path = [];
  b.bombTest.reset();
  b.safety.reset();
  b.repath.reset();
}

export interface BotSelf {
  slot: number;
  x: number;
  z: number;
  bombsRemaining: number;
  range: number;
}

export interface BotOutput {
  /** world-space direction to walk in (zero = stand) */
  dx: number;
  dz: number;
  placeBomb: boolean;
}

export function botThink(field: ShockField, b: BotBrain, me: BotSelf, now: number, rand: () => number): BotOutput {
  const out: BotOutput = { dx: 0, dz: 0, placeBomb: false };
  const here = nearestNode(field, me.x, me.z, Infinity, false);
  if (here === -1) return out;

  // standing in a blast (or running to a spot that has become one): head for the nearest safe node
  if ((b.state !== "escaping" || (b.target !== -1 && field.hitting[b.target]! > 0)) && field.hitting[here]! > 0 && b.safety.elapsed(now, rand)) {
    b.target = closestSafe(field, here, me.slot);
    b.state = "escaping";
  }

  // ours: the reference bot freezes for good when it finds no safe node; let it think again once the danger has passed
  if (b.state === "escaping" && b.target === -1 && field.hitting[here] === 0) b.state = "idle";

  if (b.state === "idle") {
    if (me.bombsRemaining > 0 && b.bombTest.elapsed(now, rand)) {
      const safe = safeNodes(field, here, me.slot);
      const wouldHit = blastNodes(field.nodes, field.blocked, here, me.range);
      // bomb here if some safe node outside the blast can be reached over untouched ground
      let ok = safe.some((s) => !wouldHit.includes(s) && pathSafe(field, findPath(field, s, here, me.slot)));
      if (rand() < SAFE_OVERRIDE_CHANCE[b.difficulty]) ok = true;
      if (ok) {
        out.placeBomb = true;
      } else if (safe.length > 0) {
        // otherwise walk to a safe node next to a crate, or failing that any safe node
        let pick = -1;
        for (const s of safe) {
          if (s === here) continue;
          if (field.nodes[s]!.links.some((l) => field.blocked[l]) && pathSafe(field, findPath(field, s, here, me.slot))) {
            pick = s;
            break;
          }
        }
        if (pick === -1) {
          const pool = [...safe];
          while (pool.length) {
            const i = Math.floor(rand() * pool.length);
            if (pathSafe(field, findPath(field, here, pool[i]!, me.slot))) {
              pick = pool[i]!;
              break;
            }
            pool.splice(i, 1);
          }
        }
        if (pick !== -1) b.target = pick;
        b.state = "toBombable";
      }
    }
    // a buff fewer than five safe steps away wins over everything else
    let bestCost = Infinity;
    let bestBuff: LooseBuff | null = null;
    for (const buff of field.buffs) {
      const bn = nearestNode(field, buff.x, buff.z, Infinity, false);
      if (bn === -1 || field.hitting[bn]! > 0) continue;
      const p = findPath(field, bn, here, me.slot);
      if (p && p.length - 1 < SHOCKWAVE.buffSeekSteps && p.length - 1 < bestCost && pathSafe(field, p)) {
        bestCost = p.length - 1;
        bestBuff = buff;
      }
    }
    if (bestBuff) {
      b.state = "buff";
      b.targetBuff = bestBuff;
      b.target = nearestNode(field, bestBuff.x, bestBuff.z, Infinity, false);
    }
  } else if (b.state === "buff" && (!b.targetBuff || !field.buffs.includes(b.targetBuff))) {
    b.state = "idle";
    b.targetBuff = null;
    b.target = -1;
  }

  if (b.target !== -1 && b.repath.elapsed(now, rand)) {
    const p = findPath(field, here, b.target, me.slot);
    b.path = p ? (p.length > 1 ? p.slice(1) : p) : [];
  }
  if (b.path.length) {
    const reach2 = SHOCKWAVE.waypointReach ** 2;
    let wp = field.nodes[b.path[0]!]!;
    if ((wp.x - me.x) ** 2 + (wp.z - me.z) ** 2 < reach2) {
      b.path.shift();
      if (!b.path.length) {
        b.state = "idle";
        b.target = -1;
        return out;
      }
      wp = field.nodes[b.path[0]!]!;
    }
    const dx = wp.x - me.x;
    const dz = wp.z - me.z;
    const l = Math.hypot(dx, dz) || 1;
    out.dx = dx / l;
    out.dz = dz / l;
  }
  return out;
}
