import { describe, expect, it } from "vitest";
import { createInitialState, reduce, type GameState } from "@party-monopoly/engine";
import { asPlayerId } from "@party-monopoly/types";
import { isLegalAction } from "../validate.js";

const p0 = asPlayerId("p0");
const p1 = asPlayerId("p1");

function fresh(): GameState {
  return createInitialState({
    seed: 1,
    players: [
      { id: p0, name: "P0", isAI: false },
      { id: p1, name: "P1", isAI: false },
    ],
  });
}

// roll until the active player faces a buy decision, so we can test that phase
function untilBuyDecision(): GameState {
  for (let seed = 1; seed < 200; seed++) {
    let s = createInitialState({
      seed,
      players: [
        { id: p0, name: "P0", isAI: false },
        { id: p1, name: "P1", isAI: false },
      ],
    });
    s = reduce(s, { type: "ROLL_DICE" }).state;
    if (s.phase === "AWAITING_BUY_DECISION") return s;
  }
  throw new Error("no seed reached a buy decision");
}

describe("isLegalAction", () => {
  it("lets the active player roll on their turn", () => {
    expect(isLegalAction(fresh(), p0, "ROLL_DICE")).toBe(true);
  });

  it("rejects the off-turn player", () => {
    expect(isLegalAction(fresh(), p1, "ROLL_DICE")).toBe(false);
  });

  it("rejects buying before a buy decision is pending", () => {
    expect(isLegalAction(fresh(), p0, "BUY_PROPERTY")).toBe(false);
  });

  it("rejects rolling once a buy decision is pending", () => {
    const s = untilBuyDecision();
    const active = s.players[s.activePlayerIndex]!.id;
    expect(isLegalAction(s, active, "ROLL_DICE")).toBe(false);
    expect(isLegalAction(s, active, "BUY_PROPERTY")).toBe(true);
    expect(isLegalAction(s, active, "DECLINE_BUY")).toBe(true);
  });

  it("never allows an action during a showdown", () => {
    const s: GameState = { ...fresh(), phase: "RENT_SHOWDOWN" };
    expect(isLegalAction(s, p0, "ROLL_DICE")).toBe(false);
    expect(isLegalAction(s, p0, "END_TURN")).toBe(false);
  });

  it("never allows an action once the game is over", () => {
    const s: GameState = { ...fresh(), phase: "GAME_OVER" };
    expect(isLegalAction(s, p0, "ROLL_DICE")).toBe(false);
  });

  it("allows building only during the build-decision phase, on your turn", () => {
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_BUILD_DECISION" }, p0, "BUILD_HOUSE")).toBe(true);
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_BUILD_DECISION" }, p0, "DECLINE_BUILD")).toBe(true);
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_ROLL" }, p0, "BUILD_HOUSE")).toBe(false);
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_BUILD_DECISION" }, p1, "BUILD_HOUSE")).toBe(false); // off-turn
  });

  it("gates the Copa and airport picks to their own phases", () => {
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_WORLD_CUP" }, p0, "SELECT_WORLD_CUP_TILE")).toBe(true);
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_AIRPORT" }, p0, "SELECT_AIRPORT_TILE")).toBe(true);
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_ROLL" }, p0, "SELECT_WORLD_CUP_TILE")).toBe(false);
    expect(isLegalAction({ ...fresh(), phase: "AWAITING_WORLD_CUP" }, p1, "SELECT_WORLD_CUP_TILE")).toBe(false); // off-turn
  });
});
