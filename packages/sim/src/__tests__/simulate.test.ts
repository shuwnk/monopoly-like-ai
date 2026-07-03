import { describe, expect, it } from "vitest";
import { runBatch, simulateGame } from "../simulate.js";

describe("simulateGame", () => {
  it("is deterministic for a given seed", () => {
    const a = simulateGame({ seed: 42 });
    const b = simulateGame({ seed: 42 });
    expect(a).toEqual(b);
  });

  it("different seeds can diverge", () => {
    // not guaranteed for every pair, but across a spread the runs must vary
    const results = Array.from({ length: 10 }, (_, i) => simulateGame({ seed: i }));
    const distinct = new Set(results.map((r) => `${r.turns}:${r.endReason}:${r.winnerId}`));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("always terminates within the step guard under default tunables", () => {
    const stats = runBatch({ games: 30, players: 4 });
    expect(stats.byReason.TIMEOUT).toBe(0);
    expect(stats.finished).toBe(30);
  });

  it("reports a winner whenever a game finishes", () => {
    const { results } = runBatch({ games: 20 });
    for (const r of results) {
      if (r.finished) expect(r.winnerId).not.toBeNull();
    }
  });

  it("houses are built under default tunables and games still converge", () => {
    // 2 players is the online product's shape and where bots actually complete
    // districts. batch elimination-rate is too sample-sensitive to assert on;
    // the deterministic rent-scaling is covered by the engine tests. here we
    // just pin the sim-level facts: houses fire, and the economy still finishes.
    const houses = runBatch({ games: 60, players: 2 });
    expect(houses.avgBuilds).toBeGreaterThan(0);
    expect(houses.finished).toBe(60);
    expect(houses.timeoutRate).toBe(0);
  });
});
