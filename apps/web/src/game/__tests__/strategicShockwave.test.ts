import { describe, expect, it } from "vitest";
import {
  ActionTimer,
  blastNodes,
  botThink,
  buildWheel,
  circleTouchesBox,
  closestSafe,
  constrainToFloor,
  findPath,
  FLOOR,
  inBlast,
  nearestNode,
  newBotBrain,
  newField,
  pathSafe,
  placeBomb,
  pushOutOfBox,
  resolveBody,
  resetBotBrain,
  rollBuff,
  roundPoints,
  safeNodes,
  SHOCKWAVE,
  spawnNodes,
  startsBlocked,
  stepBombs,
  RING_GROUP,
  type ShockField,
} from "../strategicShockwave.js";

const seq = (...v: number[]): (() => number) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};
const openField = (players = 4): ShockField => {
  const f = newField(buildWheel(), players, () => 0.9); // 0.9 → every crate hides nothing
  f.blocked = f.blocked.map(() => false);
  return f;
};
const radius = (f: ShockField, i: number): number => Math.hypot(f.nodes[i]!.x, f.nodes[i]!.z);

describe("the wheel", () => {
  const nodes = buildWheel();

  it("has the reference's 97 nodes: hub, 8 spokes of 6, rings of 8 / 24 / 40", () => {
    expect(nodes).toHaveLength(97);
    const linkCounts = new Map<number, number>();
    for (const n of nodes) linkCounts.set(n.links.length, (linkCounts.get(n.links.length) ?? 0) + 1);
    // NodeCreator dump: 72 nodes with 2 links, 16 with 4, 8 with 3, the hub with 8
    expect(Object.fromEntries(linkCounts)).toEqual({ 2: 72, 3: 8, 4: 16, 8: 1 });
    expect(nodes.filter((n) => n.groups.length === 2)).toHaveLength(24);
    expect(nodes.filter((n) => n.groups.includes(RING_GROUP))).toHaveLength(72);
  });

  it("links are symmetric and between neighbours 1.2–1.8 apart", () => {
    for (const n of nodes)
      for (const l of n.links) {
        expect(nodes[l]!.links).toContain(n.index);
        const d = Math.hypot(n.x - nodes[l]!.x, n.z - nodes[l]!.z);
        expect(d).toBeGreaterThan(1.2);
        expect(d).toBeLessThan(1.8);
      }
  });

  it("leaves four 4-node spawn pockets clear and opens a diagonal pocket per extra player", () => {
    expect(nodes.filter((n) => !startsBlocked(n, 4))).toHaveLength(16);
    expect(nodes.filter((n) => !startsBlocked(n, 5))).toHaveLength(20);
    expect(nodes.filter((n) => !startsBlocked(n, 8))).toHaveLength(32);
    for (const pc of [2, 4, 8]) for (const s of spawnNodes(pc)) expect(startsBlocked(nodes[s]!, pc)).toBe(false);
  });

  it("every node sits on the floor", () => {
    for (const n of nodes) {
      const p = constrainToFloor(n.x, n.z, SHOCKWAVE.playerRadius);
      expect(Math.hypot(p.x - n.x, p.z - n.z)).toBeLessThan(1e-9);
    }
  });
});

describe("blasts", () => {
  it("range 1 from the hub hits the hub and the 8 inner nodes", () => {
    const f = openField();
    expect(blastNodes(f.nodes, f.blocked, 0, 1)).toHaveLength(9);
  });

  it("a long blast from the hub runs down every spoke but never around a ring", () => {
    const f = openField();
    const hit = blastNodes(f.nodes, f.blocked, 0, SHOCKWAVE.suddenDeathRange);
    expect(hit).toHaveLength(49);
    expect(hit.every((i) => f.nodes[i]!.groups.some((g) => g !== RING_GROUP))).toBe(true);
  });

  it("a bomb on a ring-only node travels around its ring and nowhere else", () => {
    const f = openField();
    const ringOnly = f.nodes.find((n) => n.groups.length === 1 && n.groups[0] === RING_GROUP && Math.hypot(n.x, n.z) < 7)!;
    const hit = blastNodes(f.nodes, f.blocked, ringOnly.index, SHOCKWAVE.suddenDeathRange);
    expect(hit).toHaveLength(24); // the whole middle ring
    for (const i of hit) expect(radius(f, i)).toBeCloseTo(5.9);
  });

  it("a junction blasts along its spoke and around its ring", () => {
    const f = openField();
    const junction = spawnNodes(4)[0]!;
    const hit = blastNodes(f.nodes, f.blocked, junction, 2);
    // itself, 2 each way round the ring, 2 inward and 2 outward along the spoke
    expect(hit).toHaveLength(9);
  });

  it("stops on the first crate, which is hit too", () => {
    const f = newField(buildWheel(), 4, () => 0.9);
    const junction = spawnNodes(4)[0]!;
    const hit = blastNodes(f.nodes, f.blocked, junction, 5);
    // open pocket: junction, inner spoke node, two ring neighbours; then one crate in each of the 4 directions
    expect(hit.filter((i) => !f.blocked[i])).toHaveLength(4);
    expect(hit.filter((i) => f.blocked[i])).toHaveLength(4);
  });
});

describe("bombs", () => {
  it("snap to the nearest free node within 1 unit, and only one per node", () => {
    const f = openField();
    const n = f.nodes[spawnNodes(4)[0]!]!;
    expect(placeBomb(f, n.x + 0.4, n.z, 0, 1)?.node).toBe(n.index);
    expect(f.occupier[n.index]).toBe(0);
    expect(placeBomb(f, n.x, n.z, 1, 1)?.node).not.toBe(n.index); // taken: the next nearest, if within reach
    expect(placeBomb(f, 1.416, 3.418, 0, 1)).toBeNull(); // between two spokes: no node within 1
  });

  it("go off after 3 s, break crates, drop what they hid and clear the threat", () => {
    const f = newField(buildWheel(), 4, seq(0.1, 0.6, 0.9)); // range, count, none, …
    const junction = spawnNodes(4)[0]!;
    const n = f.nodes[junction]!;
    const bomb = placeBomb(f, n.x, n.z, 0, 1)!;
    expect(bomb.hits.every((h) => f.hitting[h] === 1)).toBe(true);
    expect(stepBombs(f, 2.9)).toHaveLength(0);
    const [boom] = stepBombs(f, 0.2);
    expect(boom!.opened).toHaveLength(1); // the outer spoke node is the only crate in range 1
    expect(f.blocked[boom!.opened[0]!]).toBe(false);
    expect(boom!.dropped.length).toBe(f.hidden[boom!.opened[0]!] === "none" ? 0 : 1);
    expect(f.hitting.every((h) => h === 0)).toBe(true);
    expect(f.occupier[junction]).toBe(-1);
    expect(f.bombs).toHaveLength(0);
  });

  it("roll buffs 50 / 30 / 20", () => {
    expect(rollBuff(() => 0.49)).toBe("range");
    expect(rollBuff(() => 0.5)).toBe("count");
    expect(rollBuff(() => 0.79)).toBe("count");
    expect(rollBuff(() => 0.8)).toBe("none");
  });
});

describe("geometry", () => {
  it("a body is in a blast when its 0.3 circle touches the node's 1.2 box", () => {
    const n = buildWheel()[0]!;
    expect(inBlast(n, 0.85, 0)).toBe(true);
    expect(inBlast(n, 0.95, 0)).toBe(false);
    expect(circleTouchesBox(0.8, 0.8, 0.3, 0, 0, 0.6, 0)).toBe(true); // corner: 0.283 away
    expect(circleTouchesBox(0.85, 0.85, 0.3, 0, 0, 0.6, 0)).toBe(false);
    expect(circleTouchesBox(0, 0.95, 0.3, 0, 0, 0.6, Math.PI / 4)).toBe(true); // turned 45°: the corner points along z
  });

  it("crates push a body out along the nearest face", () => {
    const p = pushOutOfBox(0.8, 0.1, 0.3, 0, 0, 0.625, 0);
    expect(p.x).toBeCloseTo(0.925);
    expect(p.z).toBeCloseTo(0.1);
    const inside = pushOutOfBox(0.1, -0.3, 0.3, 0, 0, 0.625, 0);
    expect(inside.z).toBeCloseTo(-0.925);
  });

  it("the floor holds a body on the hub, the rings and the spokes", () => {
    const r = SHOCKWAVE.playerRadius;
    // between two spokes, between the hub and the middle ring: no floor there
    const a = Math.PI / 8;
    const off = constrainToFloor(Math.sin(a) * 3.7, Math.cos(a) * 3.7, r);
    expect(Math.hypot(off.x - Math.sin(a) * 3.7, off.z - Math.cos(a) * 3.7)).toBeGreaterThan(0.3);
    // on a ring corridor, anywhere around
    const on = constrainToFloor(Math.sin(a) * 5.9, Math.cos(a) * 5.9, r);
    expect(on).toEqual({ x: Math.sin(a) * 5.9, z: Math.cos(a) * 5.9 });
    // past the rim: pulled back inside
    const rim = constrainToFloor(0, 12, r);
    expect(rim.z).toBeCloseTo(FLOOR.rings[1][1] - r);
  });
});

describe("scoring", () => {
  it("survivors take 10 × (players − 1); the dead 10 per fighter who died before them", () => {
    expect(roundPoints(false, 0, 4)).toBe(30);
    expect(roundPoints(true, 0, 4)).toBe(0);
    expect(roundPoints(true, 2, 4)).toBe(20);
  });
});

describe("paths", () => {
  it("routes around crates and rivals' bombs but through its own", () => {
    const f = newField(buildWheel(), 4, () => 0.9);
    const [a, b] = spawnNodes(4) as [number, number];
    expect(findPath(f, a, b, 0)).toBeNull(); // crated in at the start
    f.blocked = f.blocked.map(() => false);
    const path = findPath(f, a, b, 0)!;
    expect(path[0]).toBe(a);
    expect(path[path.length - 1]).toBe(b);
    expect(path).toHaveLength(7); // a quarter of the 24-node ring
    placeBomb(f, f.nodes[path[1]!]!.x, f.nodes[path[1]!]!.z, 1, 1);
    expect(findPath(f, a, b, 0)!.includes(path[1]!)).toBe(false);
    expect(findPath(f, a, b, 1)).toEqual(path);
  });

  it("finds the nearest node no bomb will hit", () => {
    const f = openField();
    const n = f.nodes[spawnNodes(4)[0]!]!;
    const bomb = placeBomb(f, n.x, n.z, 0, 1)!;
    const safe = closestSafe(f, n.index, 0);
    expect(bomb.hits).not.toContain(safe);
    expect(findPath(f, n.index, safe, 0)).toHaveLength(3);
    expect(pathSafe(f, [safe])).toBe(true);
    expect(pathSafe(f, [n.index, safe])).toBe(false);
    expect(safeNodes(f, n.index, 0).every((i) => f.hitting[i] === 0)).toBe(true);
  });
});

describe("the bot", () => {
  it("ActionTimer fires once per random interval", () => {
    const t = new ActionTimer(0.5, 1);
    const half = (): number => 0.5;
    expect(t.elapsed(0, half)).toBe(false); // armed for 0.75
    expect(t.elapsed(0.7, half)).toBe(false);
    expect(t.elapsed(0.76, half)).toBe(true);
    expect(t.elapsed(0.8, half)).toBe(false);
  });

  it("walks off its pocket's junction first: a bomb there would cover the whole pocket", () => {
    const f = newField(buildWheel(), 4, () => 0.9);
    const n = f.nodes[spawnNodes(4)[1]!]!;
    const bot = newBotBrain(2);
    const me = { slot: 1, x: n.x, z: n.z, bombsRemaining: 1, range: 1 };
    let out = botThink(f, bot, me, 0, () => 0.5);
    for (let t = 0.05; t < 1.2 && !out.dx && !out.dz; t += 0.05) out = botThink(f, bot, me, t, () => 0.5);
    expect(out.placeBomb).toBe(false);
    expect(bot.state).toBe("toBombable");
    expect(Math.hypot(out.dx, out.dz)).toBeCloseTo(1);
  });

  it("bombs when it has a way out, then runs for the nearest safe node", () => {
    const f = openField();
    const n = f.nodes[spawnNodes(4)[1]!]!;
    const bot = newBotBrain(2);
    const me = { slot: 1, x: n.x, z: n.z, bombsRemaining: 1, range: 1 };
    let out = botThink(f, bot, me, 0, () => 0.5);
    let t = 0;
    while (!out.placeBomb && t < 2) out = botThink(f, bot, me, (t += 0.05), () => 0.5);
    expect(out.placeBomb).toBe(true);
    placeBomb(f, me.x, me.z, me.slot, me.range);
    me.bombsRemaining = 0;
    while (bot.state !== "escaping" && t < 4) out = botThink(f, bot, me, (t += 0.05), () => 0.5);
    expect(bot.state).toBe("escaping");
    expect(f.hitting[bot.target]).toBe(0);
    out = botThink(f, bot, me, (t += 0.2), () => 0.5);
    expect(Math.hypot(out.dx, out.dz)).toBeCloseTo(1);
  });

  it("goes for a buff fewer than five nodes away", () => {
    const f = openField();
    const [a] = spawnNodes(4) as [number];
    const n = f.nodes[a]!;
    const far = findPath(f, a, spawnNodes(4)[1]!, 0)!;
    const near = f.nodes[far[3]!]!;
    f.buffs.push({ node: near.index, x: near.x, z: near.z, kind: "range" });
    const bot = newBotBrain(2);
    botThink(f, bot, { slot: 0, x: n.x, z: n.z, bombsRemaining: 0, range: 1 }, 0, () => 0.5);
    expect(bot.state).toBe("buff");
    expect(bot.target).toBe(near.index);
    expect(nearestNode(f, near.x, near.z, 1, false)).toBe(near.index);
  });
});

// a whole round with nobody at the keyboard: four bots, the real rules, a seeded dice
describe("a bots-only round", () => {
  const lcg = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  };

  function play(seed: number, seconds: number): { crates: number; picked: number; deaths: number; maxIdle: number; offFloor: number } {
    const rand = lcg(seed);
    const f = newField(buildWheel(), 4, rand);
    const bots = spawnNodes(4).map((s, slot) => ({ slot, x: f.nodes[s]!.x, z: f.nodes[s]!.z, dead: false, max: 1, bombsRemaining: 1, range: 1, brain: newBotBrain(2), still: 0 }));
    for (const b of bots) resetBotBrain(b.brain);
    const start = f.blocked.filter(Boolean).length;
    let picked = 0;
    let maxIdle = 0;
    let offFloor = 0;
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      for (const boom of stepBombs(f, dt)) {
        bots[boom.bomb.owner]!.bombsRemaining++;
        for (const h of boom.bomb.hits) for (const b of bots) if (!b.dead && inBlast(f.nodes[h]!, b.x, b.z)) b.dead = true;
      }
      for (const b of bots) {
        if (b.dead) continue;
        const out = botThink(f, b.brain, b, t, rand);
        if (out.placeBomb && b.bombsRemaining > 0 && placeBomb(f, b.x, b.z, b.slot, b.range)) b.bombsRemaining--;
        const p = resolveBody(f, b.slot, b.x + out.dx * 5 * dt, b.z + out.dz * 5 * dt);
        b.still = Math.hypot(p.x - b.x, p.z - b.z) < 1e-4 ? b.still + dt : 0;
        maxIdle = Math.max(maxIdle, b.still);
        b.x = p.x;
        b.z = p.z;
        const held = constrainToFloor(b.x, b.z, SHOCKWAVE.playerRadius);
        if (Math.hypot(held.x - b.x, held.z - b.z) > 1e-6) offFloor++;
        for (let i = f.buffs.length - 1; i >= 0; i--) {
          const u = f.buffs[i]!;
          if (Math.hypot(u.x - b.x, u.z - b.z) >= SHOCKWAVE.buffRadius + SHOCKWAVE.playerRadius) continue;
          if (u.kind === "range") b.range++;
          else {
            b.max++;
            b.bombsRemaining++;
          }
          f.buffs.splice(i, 1);
          picked++;
        }
      }
    }
    return { crates: start - f.blocked.filter(Boolean).length, picked, deaths: bots.filter((b) => b.dead).length, maxIdle, offFloor };
  }

  it("Hard bots break crates, pick up buffs and never leave the floor", () => {
    let crates = 0;
    let picked = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = play(seed, 30);
      crates += r.crates;
      picked += r.picked;
      expect(r.offFloor).toBe(0);
      expect(r.maxIdle).toBeLessThan(6); // nobody wedged against a crate for the fuse of two bombs
    }
    expect(crates).toBeGreaterThan(40); // 5 rounds × 4 bots × 30 s
    expect(picked).toBeGreaterThan(10);
  });
});
