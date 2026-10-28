import { describe, expect, it } from "vitest";
import {
  ARENA_HALF,
  BREAKING_BLOCKS,
  CRATE_TOP_Y,
  closestCrate,
  crateAt,
  crateCenter,
  crateDropping,
  cratePath,
  crateSolid,
  crateWalkable,
  idleCrate,
  PERMUTATION_COUNT,
  scoreFor,
  shouldCrateDrop,
  spreadSpawns,
  startCrateDrop,
  stepCrate,
  waveDelay,
  WaveScheduler,
} from "../breakingBlocks.js";

const DT = 1 / 60;
const N = BREAKING_BLOCKS.dimensions;
// a small deterministic generator so the timeline tests are repeatable
const lcg = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const countDrops = (perm: number): number => {
  let c = 0;
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (shouldCrateDrop(x, y, perm)) c++;
  return c;
};

describe("crate grid", () => {
  it("places 10 × 10 two-unit crates from −9 to 9 with tops at 0.34", () => {
    expect(crateCenter(0, 0)).toEqual({ x: -9, y: -0.66, z: -9 });
    expect(crateCenter(9, 9)).toEqual({ x: 9, y: -0.66, z: 9 });
    expect(CRATE_TOP_Y).toBeCloseTo(0.34);
    expect(ARENA_HALF).toBe(10);
  });

  it("maps world points back to crates and nothing off the edge", () => {
    expect(crateAt(-9.9, -9.9)).toEqual({ x: 0, y: 0 });
    expect(crateAt(0.1, -0.1)).toEqual({ x: 5, y: 4 });
    expect(crateAt(10.01, 0)).toBeNull();
    expect(crateAt(0, -10.01)).toBeNull();
  });
});

describe("drop patterns", () => {
  it("has 18 patterns and wraps the permutation", () => {
    expect(PERMUTATION_COUNT).toBe(18);
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) expect(shouldCrateDrop(x, y, 20)).toBe(shouldCrateDrop(x, y, 2));
  });

  it("pairs up as complements: halves, checkerboards, disc/ring, rings, lattice, diagonals", () => {
    for (const [a, b] of [[0, 1], [2, 3], [6, 7], [8, 9], [14, 15], [16, 17]] as const) {
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) expect(shouldCrateDrop(x, y, a)).toBe(!shouldCrateDrop(x, y, b));
    }
  });

  it("the four quadrants cover the board once", () => {
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) expect([10, 11, 12, 13].filter((p) => shouldCrateDrop(x, y, p)).length).toBe(1);
  });

  it("drops the expected counts", () => {
    expect(countDrops(0)).toBe(50);
    expect(countDrops(2)).toBe(50);
    expect(countDrops(4)).toBe(50);
    expect(countDrops(6)).toBe(32); // the disc of radius 6 (y offset included) reaches (3,5) at 5.87: 8 crates a quadrant
    expect(countDrops(10)).toBe(25);
    expect(countDrops(14)).toBe(36); // 6 × 6 crates off the every-third lattice
    expect(countDrops(16)).toBe(52); // two 3-wide diagonals (28 each) sharing the 4 centre crates
  });

  it("pattern 16 is the X of diagonals", () => {
    expect(shouldCrateDrop(4, 4, 16)).toBe(true);
    expect(shouldCrateDrop(0, 1, 16)).toBe(true);
    expect(shouldCrateDrop(0, 9, 16)).toBe(true); // x + 1 + y = 10
    expect(shouldCrateDrop(0, 5, 16)).toBe(false);
  });
});

describe("wave schedule", () => {
  it("shortens the warning from 1 s to 0.3 s over the first 80 % of the round", () => {
    expect(waveDelay(0)).toBe(1);
    expect(waveDelay(28)).toBeCloseTo(0.55);
    expect(waveDelay(56)).toBeCloseTo(0.3, 5);
    expect(waveDelay(70)).toBe(0.3);
  });

  it("queues the first wave at once, runs it 1 s later, then every 3.5 s", () => {
    const s = new WaveScheduler();
    const rand = lcg(7);
    const starts: number[] = [];
    let t = 0;
    while (t < 12) {
      t += DT;
      if (s.update(DT, t, rand)) starts.push(t);
    }
    expect(starts.length).toBe(4);
    expect(starts[0]).toBeGreaterThan(0.99);
    expect(starts[0]).toBeLessThan(1.05);
    expect(starts[1]! - starts[0]!).toBeCloseTo(3.5, 1); // 2.5 s of unqueued time + the 1 s lead
    expect(starts[2]! - starts[1]!).toBeCloseTo(3.5, 1);
  });

  it("hands out a permutation and the delay of the moment it queued", () => {
    const s = new WaveScheduler();
    let w = s.update(DT, 40, () => 0.99);
    expect(w).toBeNull();
    expect(s.pending?.permutation).toBe(17);
    for (let t = DT; t < 1.1 && !w; t += DT) w = s.update(DT, 40, () => 0.99);
    expect(w?.permutation).toBe(17);
    expect(w?.delay).toBeCloseTo(waveDelay(40));
  });
});

describe("crate timeline", () => {
  it("shakes in place and stays solid, then falls through, then returns to rest", () => {
    const c = idleCrate();
    const rand = lcg(3);
    expect(startCrateDrop(c, 1, rand)).toBe(true);
    expect(startCrateDrop(c, 1, rand)).toBe(false); // already dropping
    expect(c.shakeTime).toBeGreaterThanOrEqual(0.9);
    expect(c.shakeTime).toBeLessThanOrEqual(1.4);
    let t = 0;
    let maxRise = 0;
    while (c.phase === "shake") {
      expect(crateSolid(c)).toBe(true);
      expect(crateWalkable(c)).toBe(false);
      stepCrate(c, DT, rand);
      t += DT;
      maxRise = Math.max(maxRise, c.off.y);
      expect(Math.hypot(c.off.x, c.off.z)).toBeLessThanOrEqual(BREAKING_BLOCKS.shakeRadius + 1e-6);
    }
    expect(t).toBeCloseTo(c.shakeTime, 1);
    expect(maxRise).toBeCloseTo(c.riseHeight, 2);
    expect(c.phase).toBe("fall");
    expect(crateSolid(c)).toBe(false);
    const fallStart = t;
    while (c.phase === "fall") {
      stepCrate(c, DT, rand);
      t += DT;
    }
    expect(t - fallStart).toBeCloseTo(BREAKING_BLOCKS.fallTime, 1);
    expect(c.off.y).toBeLessThan(-9); // 1.35 s of free fall with a 2 u/s downward kick: well under the lava
    expect(c.phase).toBe("return");
    const returnStart = t;
    while (crateDropping(c)) {
      stepCrate(c, DT, rand);
      t += DT;
    }
    expect(t - returnStart).toBeCloseTo(c.returnTime, 1);
    expect(c.off).toEqual({ x: 0, y: 0, z: 0 });
    expect(c.rot).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(crateSolid(c)).toBe(true);
  });

  it("a 0.3 s warning gives at most 0.7 s of shake", () => {
    const c = idleCrate();
    startCrateDrop(c, 0.3, () => 0.999);
    expect(c.shakeTime).toBeCloseTo(0.3 - 0.1 + 0.5 * 0.999, 3);
  });
});

describe("spawns and scoring", () => {
  it("spreads the fighters along Spawn1 → Spawn4", () => {
    expect(spreadSpawns(1).map((s) => s.x)).toEqual([-3.06]);
    expect(spreadSpawns(2).map((s) => s.x)).toEqual([-3.06, 3.06]);
    const four = spreadSpawns(4).map((s) => s.x);
    expect(four[0]).toBeCloseTo(-3.06);
    expect(four[1]).toBeCloseTo(-1.02);
    expect(four[3]).toBeCloseTo(3.06);
    expect(spreadSpawns(4).every((s) => s.y === 1.096 && s.z === 0)).toBe(true);
  });

  it("scores by death order, survivors take 10 × players", () => {
    expect(scoreFor(true, 0, 4)).toBe(10);
    expect(scoreFor(true, 2, 4)).toBe(30);
    expect(scoreFor(false, 0, 4)).toBe(40);
  });
});

describe("bot helpers", () => {
  // crate (5,5) is centred at (1, −0.66, 1), (7,5) at (5, −0.66, 1) and (9,5) at (9, −0.66, 1)
  const crates = [
    { x: 5, y: 5, dropping: false },
    { x: 7, y: 5, dropping: false },
    { x: 9, y: 5, dropping: true },
  ];

  it("picks the closest crate of the wanted kind within the distance band", () => {
    const from = { x: 1, y: 0.34, z: 1 }; // standing on crate (5,5)
    expect(closestCrate(crates, from, false, 0)).toEqual(crates[0]);
    expect(closestCrate(crates, from, false, 3)).toEqual(crates[1]); // the crate underfoot is 1 away, too close
    expect(closestCrate(crates, from, false, 6)).toBeNull(); // the next safe one is 4.1 away
    expect(closestCrate(crates, from, true, 0)).toEqual(crates[2]);
    expect(closestCrate(crates, from, true, 0, 5)).toBeNull();
  });

  it("paths around unwalkable crates and stops at the edge when the goal is gone", () => {
    const hole = new Set(["5,5", "5,4", "5,6", "5,3", "5,7", "5,2", "5,8", "5,1", "5,9"]); // a wall with a gap at y 0
    const walkable = (x: number, y: number): boolean => !hole.has(`${x},${y}`);
    const around = cratePath({ x: 4, y: 5 }, { x: 6, y: 5 }, walkable);
    expect(around.at(-1)).toEqual({ x: 6, y: 5 });
    expect(around.every((c) => walkable(c.x, c.y))).toBe(true);
    expect(around.length).toBe(12); // down to y 0, across, back up
    const nearest = cratePath({ x: 0, y: 5 }, { x: 5, y: 5 }, walkable);
    expect(nearest.at(-1)).toEqual({ x: 4, y: 5 });
    expect(cratePath({ x: 4, y: 5 }, { x: 4, y: 5 }, walkable)).toEqual([]);
  });
});
