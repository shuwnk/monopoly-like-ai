import { describe, expect, it } from "vitest";
import { asMinigameId, asPlayerId, type MinigameResult, type PlayerId } from "@party-monopoly/types";
import type { GameAction } from "../actions.js";
import { ISLAND_IDS } from "../board.js";
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
    // park on square 1 (a property) awaiting a buy decision, with cash to spare
    s = withPlayer(s, 0, { position: 1, money: 200000 });
    s = { ...s, phase: "AWAITING_BUY_DECISION" };
    const price = s.board[1]!.property!.price;
    const after = reduce(s, { type: "BUY_PROPERTY" }).state;
    expect(after.ownership[1]).toBe(p0);
    expect(after.players[0]!.money).toBe(200000 - price);
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

  it("rent you can't cover in cash opens the debt phase; bankrupting releases props", () => {
    let s = rentState();
    s = withPlayer(s, 0, { money: 40 }); // owes 150, only 40 cash — but owns sq 5
    s = { ...s, ownership: { 3: p1, 5: p0 } };
    const owed = reduce(s, {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P1_WIN", [p1, p0]),
    }).state;
    expect(owed.phase).toBe("AWAITING_DEBT_PAYMENT"); // sellable, so not instant bankruptcy
    // give up instead of selling -> bankrupt to the owner, props released
    const after = reduce(owed, { type: "DECLARE_BANKRUPT", playerId: p0 }).state;
    expect(after.players[0]!.bankrupt).toBe(true);
    expect(after.ownership[5]).toBeUndefined();
  });

  it("selling to cover the rent settles the debt and keeps you in the game", () => {
    let s = rentState();
    s = withPlayer(s, 0, { money: 40 });
    s = { ...s, ownership: { 3: p1, 5: p0 } };
    const owed = reduce(s, {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P1_WIN", [p1, p0]),
    }).state;
    expect(owed.phase).toBe("AWAITING_DEBT_PAYMENT");
    const after = reduce(owed, { type: "AUTO_SELL" }).state;
    expect(after.players[0]!.bankrupt).toBe(false); // sold sq 5, paid the 150 rent
    expect(after.pendingDebt).toBeNull();
    expect(after.ownership[5]).toBeUndefined(); // sold to raise the money
  });

  it("instant bankruptcy when there's nothing to sell", () => {
    let s = rentState();
    s = withPlayer(s, 0, { money: 40 }); // owns nothing to sell
    const after = reduce(s, {
      type: "SUBMIT_MINIGAME_RESULT",
      result: result("COMPLETED", "P1_WIN", [p1, p0]),
    }).state;
    expect(after.players[0]!.bankrupt).toBe(true);
  });
});

describe("building houses (build on landing)", () => {
  // p0 stands on `squareId` (a stall they own) with the game paused for a build
  function landedOn(
    squareId: number,
    opts: { ownership: Record<number, PlayerId>; buildings?: Record<number, number>; money?: number; tunables?: object },
  ): GameState {
    let s = newGame(1, opts.tunables ?? {});
    s = withPlayer(s, 0, { position: squareId, money: opts.money ?? 200000 });
    return { ...s, ownership: opts.ownership, buildings: opts.buildings ?? {}, phase: "AWAITING_BUILD_DECISION" };
  }

  it("offers a build only when you land on your own buildable stall", () => {
    // fly onto an owned, buildable stall -> the engine pauses to offer one build
    let s = newGame(1);
    s = withPlayer(s, 0, { money: 200000 });
    s = { ...s, ownership: { 1: p0, 3: p0 }, phase: "AWAITING_AIRPORT" };
    const after = reduce(s, { type: "SELECT_AIRPORT_TILE", squareId: 1 }).state;
    expect(after.phase).toBe("AWAITING_BUILD_DECISION");
    expect(after.players[0]!.position).toBe(1);
  });

  it("improves the landed stall one level and charges the cost", () => {
    const s = landedOn(1, { ownership: { 1: p0, 3: p0 } }); // owns all of Norte
    const cost = Math.round(s.board[1]!.property!.price * s.tunables.buildCostFraction);
    const after = reduce(s, { type: "BUILD_HOUSE", squareId: 1 });
    expect(after.state.buildings[1]).toBe(1);
    expect(after.state.players[0]!.money).toBe(200000 - cost);
    expect(after.events.some((e) => e.type === "HOUSE_BUILT" && e.level === 1)).toBe(true);
    expect(after.state.phase).not.toBe("AWAITING_BUILD_DECISION"); // one build, then the turn moves on
  });

  it("one improvement per landing: a second build the same turn is rejected", () => {
    const once = reduce(landedOn(1, { ownership: { 1: p0, 3: p0 } }), { type: "BUILD_HOUSE", squareId: 1 }).state;
    expect(once.buildings[1]).toBe(1);
    const again = reduce(once, { type: "BUILD_HOUSE", squareId: 1 }).state;
    expect(again.buildings[1]).toBe(1); // no chaining; you must land on it again to go higher
  });

  it("only builds the stall you're standing on", () => {
    const s = landedOn(1, { ownership: { 1: p0, 3: p0 } }); // owns 3 too, but stands on 1
    expect(reduce(s, { type: "BUILD_HOUSE", squareId: 3 }).state.buildings[3]).toBeUndefined();
  });

  it("declining leaves it unbuilt and ends the build choice", () => {
    const after = reduce(landedOn(1, { ownership: { 1: p0, 3: p0 } }), { type: "DECLINE_BUILD" }).state;
    expect(after.buildings[1]).toBeUndefined();
    expect(after.phase).not.toBe("AWAITING_BUILD_DECISION");
  });

  it("does not offer a build when landing on an already-maxed stall", () => {
    let s = newGame(1);
    s = withPlayer(s, 0, { money: 200000 });
    s = { ...s, ownership: { 1: p0, 3: p0 }, buildings: { 1: 4 }, phase: "AWAITING_AIRPORT" };
    const after = reduce(s, { type: "SELECT_AIRPORT_TILE", squareId: 1 }).state;
    expect(after.phase).not.toBe("AWAITING_BUILD_DECISION");
  });

  it("graduated gate: partial ownership caps the level at stalls owned", () => {
    // owns 1 of Norte's 2 stalls: first landing builds level 1...
    const first = reduce(landedOn(1, { ownership: { 1: p0 } }), { type: "BUILD_HOUSE", squareId: 1 }).state;
    expect(first.buildings[1]).toBe(1);
    // ...but at level 1 with one stall owned the cap is hit — no further build
    const maxed = landedOn(1, { ownership: { 1: p0 }, buildings: { 1: 1 } });
    expect(reduce(maxed, { type: "BUILD_HOUSE", squareId: 1 }).state.buildings[1]).toBe(1);
  });

  it("graduated gate: the hotel is reserved for completing the district", () => {
    // Metrópole (6 stalls) at level 3, owning only 4 -> no hotel
    const partial = landedOn(31, {
      ownership: Object.fromEntries([31, 32, 34, 35].map((id) => [id, p0])),
      buildings: { 31: 3 },
      money: 1_000_000,
    });
    expect(reduce(partial, { type: "BUILD_HOUSE", squareId: 31 }).state.buildings[31]).toBe(3);
    // owning all six unlocks the hotel
    const whole = landedOn(31, {
      ownership: Object.fromEntries([31, 32, 34, 35, 37, 39].map((id) => [id, p0])),
      buildings: { 31: 3 },
      money: 1_000_000,
    });
    expect(reduce(whole, { type: "BUILD_HOUSE", squareId: 31 }).state.buildings[31]).toBe(4);
  });

  it("hard monopoly gate: refuses to build without the whole district", () => {
    const s = landedOn(1, { ownership: { 1: p0 }, tunables: { requireMonopolyToBuild: true } }); // missing sq 3
    expect(reduce(s, { type: "BUILD_HOUSE", squareId: 1 }).state.buildings[1]).toBeUndefined();
  });

  it("scales showdown rent by the build level", () => {
    // baseRent 100, hotel factor 5.5, owner-win 1.5x -> 825
    let s = newGame(1);
    s = withPlayer(s, 0, { position: 3 });
    s = { ...s, ownership: { 3: p1, 5: p1, 6: p1 }, buildings: { 3: 4 }, phase: "RENT_SHOWDOWN",
      pendingMinigame: {
        minigameId: asMinigameId("reflex-tap-duel"),
        participants: [{ playerId: p0, isAI: false }, { playerId: p1, isAI: false }],
        context: { reason: "RENT_SHOWDOWN" as const, stakeData: { baseRent: 100, propertyId: 3 } },
        config: {},
      } };
    const after = reduce(s, { type: "SUBMIT_MINIGAME_RESULT", result: result("COMPLETED", "P1_WIN", [p1, p0]) });
    // p0 can't cover 825 from 1500? 1500-825 = 675, fine
    expect(after.state.players[0]!.money).toBe(1500 - 825);
  });

  it("releases buildings when the owner goes bankrupt from the debt phase", () => {
    let s = newGame(1);
    s = withPlayer(s, 0, { position: 3, money: 40 });
    s = { ...s, ownership: { 3: p1, 5: p0 }, buildings: { 5: 2 } }; // p0 owns+built sq 5
    s = { ...s, phase: "RENT_SHOWDOWN", pendingMinigame: {
      minigameId: asMinigameId("reflex-tap-duel"),
      participants: [{ playerId: p0, isAI: false }, { playerId: p1, isAI: false }],
      context: { reason: "RENT_SHOWDOWN" as const, stakeData: { baseRent: 100, propertyId: 3 } },
      config: {},
    } };
    const owed = reduce(s, { type: "SUBMIT_MINIGAME_RESULT", result: result("COMPLETED", "P1_WIN", [p1, p0]) }).state;
    expect(owed.phase).toBe("AWAITING_DEBT_PAYMENT");
    const after = reduce(owed, { type: "DECLARE_BANKRUPT", playerId: p0 }).state;
    expect(after.players[0]!.bankrupt).toBe(true);
    expect(after.buildings[5]).toBeUndefined(); // released with the property
  });
});

describe("selling", () => {
  it("voluntarily sells a bare property on your turn for the full price", () => {
    let s: GameState = { ...newGame(1), phase: "AWAITING_ROLL", ownership: { 1: p0 } };
    s = withPlayer(s, 0, { money: 1000 });
    const price = s.board[1]!.property!.price;
    const after = reduce(s, { type: "SELL_TILE", squareId: 1 }).state;
    expect(after.ownership[1]).toBeUndefined();
    expect(after.players[0]!.money).toBe(1000 + price); // sellFraction 1.0 = full price
    expect(after.phase).toBe("AWAITING_ROLL"); // voluntary sale, turn continues
  });

  it("selling a built stall sells the top house level first, keeping the land", () => {
    let s: GameState = { ...newGame(1), phase: "AWAITING_ROLL", ownership: { 1: p0 }, buildings: { 1: 2 } };
    s = withPlayer(s, 0, { money: 1000 });
    const refund = Math.round(s.board[1]!.property!.price * s.tunables.buildCostFraction * s.tunables.sellFraction);
    const after = reduce(s, { type: "SELL_TILE", squareId: 1 }).state;
    expect(after.buildings[1]).toBe(1); // one level down, still owned
    expect(after.ownership[1]).toBe(p0);
    expect(after.players[0]!.money).toBe(1000 + refund);
  });

  it("can't sell a stall you don't own", () => {
    const s: GameState = { ...newGame(1), phase: "AWAITING_ROLL", ownership: { 1: p1 } };
    const after = reduce(s, { type: "SELL_TILE", squareId: 1 }).state;
    expect(after.ownership[1]).toBe(p1);
  });
});

describe("Copa (World Cup) rent boost", () => {
  it("doubles the chosen property's rent for the rest of the game", () => {
    // p0 owns square 3; land it on Copa (square 20) and boost square 3
    let s = newGame(1);
    s = { ...s, ownership: { 3: p0 }, phase: "AWAITING_WORLD_CUP" as const };
    const boosted = reduce(s, { type: "SELECT_WORLD_CUP_TILE", squareId: 3 }).state;
    expect(boosted.rentBoosts[3]).toBe(2);

    // now p1 lands on square 3: rent = baseRent 100 * draw 1.0 * boost 2 = 200
    let r: GameState = { ...boosted, phase: "RENT_SHOWDOWN" };
    r = withPlayer(r, 1, { position: 3 });
    r = {
      ...r,
      activePlayerIndex: 1,
      pendingMinigame: {
        minigameId: asMinigameId("reflex-tap-duel"),
        participants: [
          { playerId: p1, isAI: false },
          { playerId: p0, isAI: false },
        ],
        context: { reason: "RENT_SHOWDOWN" as const, stakeData: { baseRent: 100, propertyId: 3 } },
        config: {},
      },
    };
    const after = reduce(r, { type: "SUBMIT_MINIGAME_RESULT", result: result("COMPLETED", "DRAW", [p1, p0]) }).state;
    expect(after.players[1]!.money).toBe(1500 - 200);
  });

  it("refuses to boost a property you don't own", () => {
    let s = newGame(1);
    s = { ...s, ownership: { 3: p1 }, phase: "AWAITING_WORLD_CUP" as const };
    const after = reduce(s, { type: "SELECT_WORLD_CUP_TILE", squareId: 3 }).state;
    expect(after.rentBoosts[3]).toBeUndefined();
  });

  it("stacks: re-boosting the same tile multiplies again", () => {
    let s: GameState = { ...newGame(1), ownership: { 3: p0 }, phase: "AWAITING_WORLD_CUP" };
    s = reduce(s, { type: "SELECT_WORLD_CUP_TILE", squareId: 3 }).state;
    expect(s.rentBoosts[3]).toBe(2);
    // land Copa again as p0 and re-pick the same stall: ×2 again -> ×4
    s = { ...s, phase: "AWAITING_WORLD_CUP", activePlayerIndex: 0 };
    s = reduce(s, { type: "SELECT_WORLD_CUP_TILE", squareId: 3 }).state;
    expect(s.rentBoosts[3]).toBe(4);
  });
});

// The engine must never park in a choice phase that has no legal choice — that's
// the class of bug behind the fixed Copa hang (the sim loops forever / a human
// stares at a dead pick screen). Flying via the airport lets us drive resolveLanding
// onto any square deterministically, without fishing for dice.
describe("no-legal-choice phases auto-advance (softlock guards)", () => {
  function flyTo(squareId: number, patch: Partial<GameState> = {}): GameState {
    const s: GameState = { ...newGame(1), phase: "AWAITING_AIRPORT", ...patch };
    return reduce(s, { type: "SELECT_AIRPORT_TILE", squareId }).state;
  }

  it("skips Copa when the lander owns nothing to boost", () => {
    // land on Copa (square 20) owning no property -> no pick, turn proceeds
    const after = flyTo(20);
    expect(after.phase).not.toBe("AWAITING_WORLD_CUP");
  });

  it("offers Copa when the lander owns an unboosted stall", () => {
    const after = flyTo(20, { ownership: { 3: p0 } });
    expect(after.phase).toBe("AWAITING_WORLD_CUP");
  });

  it("still offers Copa on an already-boosted stall (boosts stack)", () => {
    const after = flyTo(20, { ownership: { 3: p0 }, rentBoosts: { 3: 2 } });
    expect(after.phase).toBe("AWAITING_WORLD_CUP");
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

describe("bankruptcy cleanup across paths", () => {
  it("tax bankruptcy frees the debtor's buildings and Copa boosts, and ends a 2p game", () => {
    // p0 owns a built + boosted stall but can't cover the tax; fly them onto it
    let s: GameState = {
      ...newGame(1, { taxAmount: 100 }),
      phase: "AWAITING_AIRPORT",
      ownership: { 5: p0 },
      buildings: { 5: 2 },
      rentBoosts: { 5: 2 },
    };
    s = withPlayer(s, 0, { money: 40 }); // owes 100
    const owed = reduce(s, { type: "SELECT_AIRPORT_TILE", squareId: 4 }).state; // square 4 = TAX
    expect(owed.phase).toBe("AWAITING_DEBT_PAYMENT");
    const after = reduce(owed, { type: "DECLARE_BANKRUPT", playerId: p0 }).state;
    expect(after.players[0]!.bankrupt).toBe(true);
    expect(after.buildings[5]).toBeUndefined(); // buildings released with the stall
    expect(after.rentBoosts[5]).toBeUndefined(); // Copa boost released too
    expect(after.phase).toBe("GAME_OVER"); // only p1 left solvent
    expect(after.winnerId).toBe(p1);
  });

  it("jail-fine you can't cover opens the debt phase; bankrupting runs the same cleanup", () => {
    let owed: GameState | null = null;
    for (let seed = 1; seed < 200 && !owed; seed++) {
      let g = newGame(seed);
      g = withPlayer(g, 0, { inJail: true, position: 10, jailTurns: g.tunables.jail.maxTurns - 1, money: 10 });
      g = { ...g, ownership: { 5: p0 }, buildings: { 5: 1 } };
      const out = reduce(g, { type: "ROLL_DICE" }).state;
      if (out.phase === "AWAITING_DEBT_PAYMENT") owed = out;
    }
    expect(owed).not.toBeNull();
    const bust = reduce(owed!, { type: "DECLARE_BANKRUPT", playerId: p0 }).state;
    expect(bust.players[0]!.bankrupt).toBe(true);
    expect(bust.buildings[5]).toBeUndefined();
  });

  it("rejects flying to the airport square itself (no self-loop)", () => {
    const s: GameState = { ...newGame(1), phase: "AWAITING_AIRPORT" };
    const after = reduce(s, { type: "SELECT_AIRPORT_TILE", squareId: 30 }).state; // square 30 = Aeroporto
    expect(after.phase).toBe("AWAITING_AIRPORT"); // unchanged, waiting for a real pick
    expect(after.players[0]!.position).not.toBe(30);
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

  it("island monopoly: owning all four islands wins outright", () => {
    let s: GameState = { ...newGame(1), phase: "TURN_END", activePlayerIndex: 0 };
    s = { ...s, ownership: Object.fromEntries(ISLAND_IDS.map((id) => [id, p0])) };
    const after = reduce(s, { type: "END_TURN" }).state;
    expect(after.phase).toBe("GAME_OVER");
    expect(after.winnerId).toBe(p0);
  });

  it("owning only three islands does not win", () => {
    let s: GameState = { ...newGame(1), phase: "TURN_END", activePlayerIndex: 0 };
    s = { ...s, ownership: Object.fromEntries(ISLAND_IDS.slice(0, 3).map((id) => [id, p0])) };
    const after = reduce(s, { type: "END_TURN" }).state;
    expect(after.phase).not.toBe("GAME_OVER");
  });

  it("forfeit removes a player without ending a 3-player game", () => {
    const p2 = asPlayerId("p2");
    const s3: GameState = {
      ...createInitialState({
        seed: 1,
        players: [
          { id: p0, name: "A", isAI: false },
          { id: p1, name: "B", isAI: false },
          { id: p2, name: "C", isAI: false },
        ],
      }),
      phase: "AWAITING_ROLL",
    };
    const after = reduce(s3, { type: "FORFEIT", playerId: p1 }).state; // p1 isn't active
    expect(after.players.find((p) => p.id === p1)!.bankrupt).toBe(true);
    expect(after.phase).not.toBe("GAME_OVER"); // p0 and p2 remain
  });

  it("wealth goal: first to the target net worth wins outright", () => {
    let s = newGame(1, { netWorthGoal: 5000 });
    s = withPlayer(s, 0, { money: 6000 }); // net worth over the goal
    s = { ...s, phase: "TURN_END", activePlayerIndex: 0 };
    const after = reduce(s, { type: "END_TURN" }).state;
    expect(after.phase).toBe("GAME_OVER");
    expect(after.winnerId).toBe(p0);
  });

  it("wealth goal doesn't fire below the target", () => {
    let s = newGame(1, { netWorthGoal: 5000 });
    s = withPlayer(s, 0, { money: 4000 });
    s = { ...s, phase: "TURN_END", activePlayerIndex: 0 };
    const after = reduce(s, { type: "END_TURN" }).state;
    expect(after.phase).not.toBe("GAME_OVER");
  });

  it("time up (END_ON_TIME) ends the game on net worth, richest wins", () => {
    let s = newGame(1);
    s = withPlayer(s, 0, { money: 500 });
    s = withPlayer(s, 1, { money: 9000 });
    const after = reduce(s, { type: "END_ON_TIME" }).state;
    expect(after.phase).toBe("GAME_OVER");
    expect(after.winnerId).toBe(p1); // richest solvent player
  });
});

describe("jail", () => {
  it("lands on the airport (square 30) and pauses to pick a destination", () => {
    // square 30 is now Aeroporto: landing pauses at AWAITING_AIRPORT (no jail)
    let landed = false;
    let s = newGame(1, { diceCount: 1 });
    for (let seed = 1; seed < 200 && !landed; seed++) {
      let g = newGame(seed, { diceCount: 1 });
      g = withPlayer(g, 0, { position: 29 });
      const out = reduce(g, { type: "ROLL_DICE" });
      if (out.state.phase === "AWAITING_AIRPORT") {
        s = out.state;
        landed = true;
      }
    }
    expect(landed).toBe(true);
    expect(s.phase).toBe("AWAITING_AIRPORT");
    expect(s.players[0]!.inJail).toBe(false);
    // flying to a chosen square resolves landing there
    const after = reduce(s, { type: "SELECT_AIRPORT_TILE", squareId: 5 }).state;
    expect(after.players[0]!.position).toBe(5);
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
    s = withPlayer(s, 0, { inJail: true, position: 10, money: 20000 });
    const after = reduce(s, { type: "PAY_JAIL_FINE" }).state;
    expect(after.players[0]!.inJail).toBe(false);
    expect(after.players[0]!.money).toBe(20000 - s.tunables.jail.fine);
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
