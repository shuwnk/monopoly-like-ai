import { describe, expect, it } from "vitest";
import { asMinigameId, asPlayerId, type MinigameResult, type PlayerId } from "@party-monopoly/types";
import type { GameAction } from "../actions.js";
import { createInitialState } from "../init.js";
import { reduce } from "../reducer.js";
import type { GameState, PlayerState } from "../state.js";

const p0 = asPlayerId("p0");
const p1 = asPlayerId("p1");

// pin the economy so these rule tests don't move when default balance is retuned;
// roundCap 0 keeps the cap out of the way unless a test opts in
const TEST_TUNABLES = { startingMoney: 1500, passGoSalary: 200, taxAmount: 100, roundCap: 0 };

function newGame(seed: number, tunables = {}): GameState {
  return createInitialState({
    seed,
    players: [
      { id: p0, name: "Alice", isAI: false },
      { id: p1, name: "Bob", isAI: false },
    ],
    tunables: { ...TEST_TUNABLES, ...tunables },
  });
}

// craft a state with the active player parked one step before `target` so a
// forced roll of `steps` lands them there. easier than fishing for seeds.
function withPlayer(state: GameState, idx: number, patch: Partial<PlayerState>): GameState {
  return { ...state, players: state.players.map((p, i) => (i === idx ? { ...p, ...patch } : p)) };
}

function run(state: GameState, actions: readonly GameAction[]): GameState {
  let s = state;
  for (const a of actions) s = reduce(s, a).state;
  return s;
}

describe("pass GO", () => {
  it("credits salary when the move wraps past 0", () => {
    // sit at 39 so any roll wraps; salary credited before landing resolves
    let s = newGame(1);
    s = withPlayer(s, 0, { position: 39 });
    const { state, events } = reduce(s, { type: "ROLL_DICE" });
    expect(state.players[0]!.money).toBeGreaterThanOrEqual(1500 + 200);
    expect(events.some((e) => e.type === "PLAYER_MOVED" && e.passedGo)).toBe(true);
  });
});

describe("buying property", () => {
  it("deducts price and assigns ownership", () => {
    let s = newGame(1);
    // park on square 1 (a property) awaiting a buy decision
    s = withPlayer(s, 0, { position: 1 });
    s = { ...s, phase: "AWAITING_BUY_DECISION" };
    const price = s.board[1]!.property!.price;
    const after = reduce(s, { type: "BUY_PROPERTY" }).state;
    expect(after.ownership[1]).toBe(p0);
    expect(after.players[0]!.money).toBe(1500 - price);
  });

  it("decline leaves the square unowned", () => {
    let s = newGame(1);
    s = withPlayer(s, 0, { position: 1 });
    s = { ...s, phase: "AWAITING_BUY_DECISION" };
    const after = reduce(s, { type: "DECLINE_BUY" }).state;
    expect(after.ownership[1]).toBeUndefined();
    expect(after.players[0]!.money).toBe(1500);
  });
});

function rentState(): GameState {
  // p0 (lander) parked on square 3, owned by p1, awaiting the showdown
  let s = newGame(1);
  s = withPlayer(s, 0, { position: 3 });
  s = { ...s, ownership: { 3: p1 }, lastRoll: [2, 1] };
  const request = {
    minigameId: asMinigameId("reflex-tap-duel"),
    participants: [
      { playerId: p0, isAI: false },
      { playerId: p1, isAI: false },
    ],
    context: { reason: "RENT_SHOWDOWN" as const, stakeData: { baseRent: 100, propertyId: 3 } },
    config: {},
  };
  return { ...s, phase: "RENT_SHOWDOWN", pendingMinigame: request };
}

function result(status: MinigameResult["status"], outcome: MinigameResult["outcome"], ranking: PlayerId[]): MinigameResult {
  return { minigameId: asMinigameId("reflex-tap-duel"), status, outcome, ranking };
}

describe("rent settlement", () => {
  it("owner win pays 1.5x", () => {
    const after = reduce(rentState(), {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P1_WIN", [p1, p0]),
    }).state;
    expect(after.players[0]!.money).toBe(1500 - 150);
    expect(after.players[1]!.money).toBe(1500 + 150);
  });

  it("payer win pays 0.5x", () => {
    const after = reduce(rentState(), {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P0_WIN", [p0, p1]),
    }).state;
    expect(after.players[0]!.money).toBe(1500 - 50);
    expect(after.players[1]!.money).toBe(1500 + 50);
  });

  it("draw pays 1.0x", () => {
    const after = reduce(rentState(), {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "DRAW", [p0, p1]),
    }).state;
    expect(after.players[0]!.money).toBe(1500 - 100);
    expect(after.players[1]!.money).toBe(1500 + 100);
  });

  it("aborted pays flat 1.0x", () => {
    const after = reduce(rentState(), {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("ABORTED", "DRAW", [p0, p1]),
    }).state;
    expect(after.players[0]!.money).toBe(1500 - 100);
    expect(after.players[1]!.money).toBe(1500 + 100);
  });

  it("bankrupts the payer when rent exceeds their cash and releases their props", () => {
    let s = rentState();
    s = withPlayer(s, 0, { money: 40 }); // owes 150, only has 40
    s = { ...s, ownership: { 3: p1, 5: p0 } }; // p0 also owns square 5
    const { state, events } = reduce(s, {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P1_WIN", [p1, p0]),
    });
    expect(state.players[0]!.bankrupt).toBe(true);
    expect(state.players[0]!.money).toBe(0);
    expect(state.players[1]!.money).toBe(1540); // got everything the payer had
    expect(state.ownership[5]).toBeUndefined(); // released to unowned
    expect(events.some((e) => e.type === "RENT_PAID" && e.amount === 40)).toBe(true);
  });
});

describe("rent escalation", () => {
  // owner (p1) holds three stalls; with step 0.5 that's a 2.0x escalation
  function escalatedState(tunables: object): GameState {
    let s = newGame(1, tunables);
    s = withPlayer(s, 0, { position: 3 });
    s = { ...s, ownership: { 3: p1, 5: p1, 6: p1 } };
    const request = {
      minigameId: asMinigameId("reflex-tap-duel"),
      participants: [
        { playerId: p0, isAI: false },
        { playerId: p1, isAI: false },
      ],
      context: { reason: "RENT_SHOWDOWN" as const, stakeData: { baseRent: 100, propertyId: 3 } },
      config: {},
    };
    return { ...s, phase: "RENT_SHOWDOWN", pendingMinigame: request };
  }

  it("leaves rent flat when the step is 0 (default)", () => {
    const after = reduce(escalatedState({ rentEscalationStep: 0 }), {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "DRAW", [p0, p1]),
    }).state;
    expect(after.players[0]!.money).toBe(1500 - 100); // 100 * 1.0 * 1.0
  });

  it("scales rent by the owner's holdings", () => {
    // 3 properties -> 1 + 0.5*(3-1) = 2.0x, on top of the 1.5x owner-win
    const after = reduce(escalatedState({ rentEscalationStep: 0.5, rentEscalationCap: 4 }), {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P1_WIN", [p1, p0]),
    }).state;
    expect(after.players[0]!.money).toBe(1500 - 300); // 100 * 1.5 * 2.0
    expect(after.players[1]!.money).toBe(1500 + 300);
  });

  it("never exceeds the escalation cap", () => {
    // 3 properties would be 2.0x, but the cap pins it to 1.5x
    const after = reduce(escalatedState({ rentEscalationStep: 0.5, rentEscalationCap: 1.5 }), {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "DRAW", [p0, p1]),
    }).state;
    expect(after.players[0]!.money).toBe(1500 - 150); // 100 * 1.0 * 1.5 (capped)
  });
});

describe("win condition", () => {
  it("fires GAME_OVER when only one solvent player remains", () => {
    let s = rentState();
    s = withPlayer(s, 0, { money: 10 });
    const { state, events } = reduce(s, {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P1_WIN", [p1, p0]),
    });
    expect(state.phase).toBe("GAME_OVER");
    expect(state.winnerId).toBe(p1);
    expect(events.some((e) => e.type === "GAME_OVER")).toBe(true);
  });
});

describe("round cap", () => {
  it("force-ends on net worth (property value counts) when the cap is hit", () => {
    let s = newGame(1, { roundCap: 2 });
    s = withPlayer(s, 0, { money: 200 }); // less cash, but owns a pricey square
    s = withPlayer(s, 1, { money: 500 });
    s = { ...s, ownership: { 39: p0 }, round: 2, activePlayerIndex: 1, phase: "TURN_END" };
    const { state, events } = reduce(s, { type: "END_TURN" });
    expect(state.phase).toBe("GAME_OVER");
    expect(state.winnerId).toBe(p0); // 200 + price(39) beats 500 cash
    expect(events.some((e) => e.type === "GAME_OVER")).toBe(true);
  });

  it("cash tiebreak ignores property value", () => {
    let s = newGame(1, { roundCap: 2, tiebreakMetric: "CASH" as const });
    s = withPlayer(s, 0, { money: 200 });
    s = withPlayer(s, 1, { money: 500 });
    s = { ...s, ownership: { 39: p0 }, round: 2, activePlayerIndex: 1, phase: "TURN_END" };
    const state = reduce(s, { type: "END_TURN" }).state;
    expect(state.winnerId).toBe(p1);
  });
});

describe("jail", () => {
  it("lands on GO_TO_JAIL and is jailed (no salary, turn ends)", () => {
    // place player at 29 then craft a roll of 1 by seeding-independent path:
    // directly set position so a forced single-die board makes 30 reachable.
    let s = newGame(1, { diceCount: 1 });
    // sit at 29 and roll one die until a seed produces a 1, landing on GO_TO_JAIL
    // (which immediately relocates the pawn to jail, so we match on the event).
    let landed = false;
    for (let seed = 1; seed < 200 && !landed; seed++) {
      let g = newGame(seed, { diceCount: 1 });
      g = withPlayer(g, 0, { position: 29 });
      const out = reduce(g, { type: "ROLL_DICE" });
      if (out.events.some((e) => e.type === "SENT_TO_JAIL")) {
        s = out.state;
        landed = true;
      }
    }
    expect(landed).toBe(true);
    expect(s.players[0]!.inJail).toBe(true);
    expect(s.players[0]!.position).toBe(s.tunables.jail.jailSquareId);
    expect(s.phase).toBe("AWAITING_ROLL"); // turn passed to the other player
    expect(s.activePlayerIndex).toBe(1);
  });

  it("three doubles in a row sends to jail", () => {
    // find a seed whose first three rolls are all doubles. between rolls the
    // pawn may park on a buy decision; decline to get back to AWAITING_ROLL.
    let jailed: GameState | null = null;
    for (let seed = 1; seed < 20000 && !jailed; seed++) {
      let g = newGame(seed);
      let ok = true;
      for (let t = 0; t < 3 && ok; t++) {
        if (g.phase !== "AWAITING_ROLL") g = reduce(g, { type: "DECLINE_BUY" }).state;
        if (g.phase !== "AWAITING_ROLL") {
          ok = false;
          break;
        }
        const out = reduce(g, { type: "ROLL_DICE" });
        const roll = out.state.lastRoll!;
        if (roll[0] !== roll[1]) ok = false;
        // a non-doubles outcome that still ended the turn (e.g. GO_TO_JAIL) isn't
        // what we're after; require the turn to stay with player 0 until the 3rd
        if (ok && t < 2 && out.state.activePlayerIndex !== 0) ok = false;
        g = out.state;
      }
      // must be player 0, jailed by the third doubles (turn handed to player 1)
      if (ok && g.players[0]!.inJail && g.activePlayerIndex === 1) jailed = g;
    }
    expect(jailed).not.toBeNull();
    expect(jailed!.players[0]!.inJail).toBe(true);
    expect(jailed!.activePlayerIndex).toBe(1); // turn ended on the jailing
  });

  it("pay fine leaves jail", () => {
    let s = newGame(1);
    s = withPlayer(s, 0, { inJail: true, position: 10 });
    const after = reduce(s, { type: "PAY_JAIL_FINE" }).state;
    expect(after.players[0]!.inJail).toBe(false);
    expect(after.players[0]!.money).toBe(1500 - s.tunables.jail.fine);
    expect(after.phase).toBe("AWAITING_ROLL");
  });

  it("jail roll doubles escapes and moves", () => {
    // find a seed whose first roll is doubles, applied to a jailed player
    let escaped: GameState | null = null;
    for (let seed = 1; seed < 2000 && !escaped; seed++) {
      let g = newGame(seed);
      g = withPlayer(g, 0, { inJail: true, position: 10 });
      const out = reduce(g, { type: "ROLL_DICE" });
      const roll = out.state.lastRoll!;
      if (roll[0] === roll[1]) escaped = out.state;
    }
    expect(escaped).not.toBeNull();
    expect(escaped!.players[0]!.inJail).toBe(false);
    expect(escaped!.players[0]!.position).not.toBe(10);
    // no bonus re-roll: turn handed off (unless parked on a property decision)
    expect(["AWAITING_ROLL", "AWAITING_BUY_DECISION", "RENT_SHOWDOWN"]).toContain(escaped!.phase);
  });
});

describe("tax", () => {
  it("charges taxAmount to the bank", () => {
    // land on square 4 (TAX) by scanning seeds from position 2 with one die
    let charged: GameState | null = null;
    for (let seed = 1; seed < 200 && !charged; seed++) {
      let g = newGame(seed, { diceCount: 1, taxAmount: 100 });
      g = withPlayer(g, 0, { position: 3 });
      const out = reduce(g, { type: "ROLL_DICE" });
      if (out.state.players[0]!.position === 4) charged = out.state;
    }
    expect(charged).not.toBeNull();
    expect(charged!.players[0]!.money).toBe(1500 - 100);
  });
});

describe("determinism", () => {
  it("same seed + same action sequence yields identical state", () => {
    const actions: readonly GameAction[] = [
      { type: "ROLL_DICE" },
      { type: "DECLINE_BUY" },
      { type: "ROLL_DICE" },
      { type: "DECLINE_BUY" },
      { type: "ROLL_DICE" },
      { type: "DECLINE_BUY" },
    ];
    const a = run(newGame(0xabc), actions);
    const b = run(newGame(0xabc), actions);
    expect(a).toStrictEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
  });
});
