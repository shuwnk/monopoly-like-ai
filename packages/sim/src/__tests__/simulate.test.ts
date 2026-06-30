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

  it("escalation pushes more games to end by elimination", () => {
    const flat = runBatch({ games: 60, players: 4, tunables: { rentEscalationStep: 0 } });
    const escalated = runBatch({
      games: 60,
      players: 4,
      tunables: { rentEscalationStep: 0.5, rentEscalationCap: 4 },
    });
    expect(escalated.eliminationRate).toBeGreaterThan(flat.eliminationRate);
  });
});
