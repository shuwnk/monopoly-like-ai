import { describe, expect, it } from "vitest";
import { createInitialState, type GameState } from "@party-monopoly/engine";
import { DEFAULT_REFLEX_TAP_DUEL_CONFIG, type ReflexInput } from "@party-monopoly/minigame-harness";
import { asMinigameId, asPlayerId } from "@party-monopoly/types";
import { MISSING_TAP, adjudicateShowdown, sanitizeTap } from "../showdown.js";

const payer = asPlayerId("p0");
const owner = asPlayerId("p1");
const win = DEFAULT_REFLEX_TAP_DUEL_CONFIG.drawWindowMs;
const floor = DEFAULT_REFLEX_TAP_DUEL_CONFIG.minHumanReactionMs;

// a state parked on a showdown between p0 (payer) and p1 (owner)
function showdownState(): GameState {
  const base = createInitialState({
    seed: 1,
    players: [
      { id: payer, name: "P0", isAI: false },
      { id: owner, name: "P1", isAI: false },
    ],
  });
  return {
    ...base,
    phase: "RENT_SHOWDOWN",
    pendingMinigame: {
      minigameId: asMinigameId("reflex-tap-duel"),
      participants: [
        { playerId: payer, isAI: false },
        { playerId: owner, isAI: false },
      ],
      context: { reason: "RENT_SHOWDOWN", stakeData: { baseRent: 50, propertyId: 1 } },
      config: {},
    },
  };
}

const tapped = (ms: number): ReflexInput => ({ reactionMs: ms, falseStart: false });

describe("adjudicateShowdown", () => {
  it("the faster payer wins", () => {
    const r = adjudicateShowdown(showdownState(), tapped(150), tapped(400), win, floor);
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P0_WIN", ranking: [payer, owner] });
  });

  it("a missing tap loses to the player who tapped", () => {
    const r = adjudicateShowdown(showdownState(), MISSING_TAP, tapped(400), win, floor);
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P1_WIN", ranking: [owner, payer] });
  });

  it("both missing aborts to flat rent", () => {
    const r = adjudicateShowdown(showdownState(), MISSING_TAP, MISSING_TAP, win, floor);
    expect(r).toMatchObject({ status: "ABORTED", outcome: "DRAW" });
  });

  it("a spoofed superhuman reaction can't beat an honest tap", () => {
    // payer claims an impossible 5ms; it's demoted to a false start and loses
    const r = adjudicateShowdown(showdownState(), tapped(5), tapped(400), win, floor);
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P1_WIN", ranking: [owner, payer] });
  });

  it("throws when no showdown is pending", () => {
    const s: GameState = { ...showdownState(), pendingMinigame: null };
    expect(() => adjudicateShowdown(s, tapped(100), tapped(200), win, floor)).toThrow();
  });
});

describe("sanitizeTap", () => {
  it("demotes a below-floor reaction to a false start", () => {
    expect(sanitizeTap(tapped(5), 100)).toEqual({ reactionMs: null, falseStart: true });
  });

  it("keeps an at-or-above-floor reaction", () => {
    expect(sanitizeTap(tapped(100), 100)).toEqual({ reactionMs: 100, falseStart: false });
  });

  it("leaves an existing false start and a missing tap alone", () => {
    expect(sanitizeTap({ reactionMs: null, falseStart: true }, 100)).toEqual({ reactionMs: null, falseStart: true });
    expect(sanitizeTap(MISSING_TAP, 100)).toEqual(MISSING_TAP);
  });
});
