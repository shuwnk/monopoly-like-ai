import { describe, expect, it } from "vitest";
import { asPlayerId } from "@party-monopoly/types";
import type { GameAction } from "../actions.js";
import { createInitialState } from "../init.js";
import { reduce } from "../reducer.js";
import { nextFloat } from "../rng.js";
import type { GameState } from "../state.js";

// same seed + same action log must always produce an identical final state

function newGame(seed: number): GameState {
  return createInitialState({
    seed,
    players: [
      { id: asPlayerId("p0"), name: "Alice", isAI: false },
      { id: asPlayerId("p1"), name: "Bob", isAI: false },
    ],
  });
}

function replay(seed: number, actions: readonly GameAction[]): GameState {
  let state = newGame(seed);
  for (const action of actions) {
    state = reduce(state, action).state;
  }
  return state;
}

describe("seeded RNG", () => {
  it("is pure and reproducible for a given seed", () => {
    const a = nextFloat({ seed: 12345 });
    const b = nextFloat({ seed: 12345 });
    expect(a.value).toBe(b.value);
    expect(a.next.seed).toBe(b.next.seed);
  });

  it("advances state so successive draws differ", () => {
    const first = nextFloat({ seed: 1 });
    const second = nextFloat(first.next);
    expect(first.value).not.toBe(second.value);
  });
});

describe("engine replay determinism", () => {
  const actions: readonly GameAction[] = [
    { type: "ROLL_DICE" },
    { type: "END_TURN" },
    { type: "ROLL_DICE" },
    { type: "END_TURN" },
  ];

  it("produces identical final state for the same seed + action log", () => {
    const left = replay(0xc0ffee, actions);
    const right = replay(0xc0ffee, actions);
    expect(left).toStrictEqual(right);
    // must also survive a JSON round-trip unchanged
    expect(JSON.parse(JSON.stringify(left))).toStrictEqual(left);
  });

  it("diverges for different seeds (dice are seed-driven)", () => {
    const left = replay(1, [{ type: "ROLL_DICE" }]);
    const right = replay(2, [{ type: "ROLL_DICE" }]);
    expect(left.lastRoll).not.toStrictEqual(right.lastRoll);
  });
});
