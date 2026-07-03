import { describe, expect, it } from "vitest";
import { asPlayerId } from "@party-monopoly/types";
import { createInitialState, type GameState, type PlayerState } from "@party-monopoly/engine";
import { decideAction } from "../decide.js";

const p0 = asPlayerId("p0");
const p1 = asPlayerId("p1");

function game(): GameState {
  return createInitialState({
    seed: 1,
    players: [
      { id: p0, name: "Human", isAI: false },
      { id: p1, name: "Bot", isAI: true },
    ],
  });
}

function withPlayer(state: GameState, idx: number, patch: Partial<PlayerState>): GameState {
  return { ...state, players: state.players.map((p, i) => (i === idx ? { ...p, ...patch } : p)) };
}

// drive the bot (p1) by making it the active player
function botTurn(state: GameState): GameState {
  return { ...state, activePlayerIndex: 1 };
}

describe("decideAction", () => {
  it("rolls when awaiting a roll", () => {
    const s = botTurn(game());
    expect(decideAction(s, p1)).toEqual({ type: "ROLL_DICE" });
  });

  it("buys an affordable cheap property", () => {
    let s = botTurn(game());
    // park on square 1 (cheap property) with plenty of cash
    s = withPlayer(s, 1, { position: 1, money: 20000 });
    s = { ...s, phase: "AWAITING_BUY_DECISION" };
    expect(decideAction(s, p1)).toEqual({ type: "BUY_PROPERTY" });
  });

  it("declines a property it can't comfortably afford", () => {
    let s = botTurn(game());
    const price = s.board[1]!.property!.price;
    // cash just barely above price, but below the buffer threshold -> decline
    s = withPlayer(s, 1, { position: 1, money: price + 1 });
    s = { ...s, phase: "AWAITING_BUY_DECISION" };
    expect(decideAction(s, p1)).toEqual({ type: "DECLINE_BUY" });
  });

  it("ends the turn at TURN_END", () => {
    const s = { ...botTurn(game()), phase: "TURN_END" as const };
    expect(decideAction(s, p1)).toEqual({ type: "END_TURN" });
  });

  it("pays the jail fine after sitting a turn when it can afford it", () => {
    let s = botTurn(game());
    s = withPlayer(s, 1, { inJail: true, jailTurns: 1, money: 20000 });
    expect(decideAction(s, p1)).toEqual({ type: "PAY_JAIL_FINE" });
  });

  it("just rolls on the first jailed turn instead of paying", () => {
    let s = botTurn(game());
    s = withPlayer(s, 1, { inJail: true, jailTurns: 0, money: 1500 });
    expect(decideAction(s, p1)).toEqual({ type: "ROLL_DICE" });
  });

  it("returns null when it's the other player's turn", () => {
    const s = game(); // p0 active
    expect(decideAction(s, p1)).toBeNull();
  });

  it("returns null during a rent showdown", () => {
    const s = { ...botTurn(game()), phase: "RENT_SHOWDOWN" as const };
    expect(decideAction(s, p1)).toBeNull();
  });

  it("returns null when the game is over", () => {
    const s = { ...botTurn(game()), phase: "GAME_OVER" as const };
    expect(decideAction(s, p1)).toBeNull();
  });
});
