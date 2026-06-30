import { describe, expect, it } from "vitest";
import { asPlayerId } from "@party-monopoly/types";
import { adjudicateReflexDuel, type ReflexInput } from "../reflex-adjudicate.js";
import { DEFAULT_REFLEX_TAP_DUEL_CONFIG } from "../reflex-tap-duel.js";

const payer = asPlayerId("p0");
const owner = asPlayerId("p1");
const win = DEFAULT_REFLEX_TAP_DUEL_CONFIG.drawWindowMs;

function adj(p0: ReflexInput, p1: ReflexInput) {
  return adjudicateReflexDuel(p0, p1, payer, owner, win);
}

const tapped = (ms: number): ReflexInput => ({ reactionMs: ms, falseStart: false });
const timeout: ReflexInput = { reactionMs: null, falseStart: false };
const jumped: ReflexInput = { reactionMs: null, falseStart: true };

describe("adjudicateReflexDuel", () => {
  it("payer false start hands it to the owner", () => {
    const r = adj(jumped, tapped(300));
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P1_WIN", ranking: [owner, payer] });
  });

  it("owner false start hands it to the payer", () => {
    const r = adj(tapped(300), jumped);
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P0_WIN", ranking: [payer, owner] });
  });

  it("double false start aborts as a draw", () => {
    const r = adj(jumped, jumped);
    expect(r).toMatchObject({ status: "ABORTED", outcome: "DRAW", ranking: [payer, owner] });
  });

  it("faster reaction wins", () => {
    const r = adj(tapped(180), tapped(420));
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P0_WIN", ranking: [payer, owner] });
  });

  it("reactions within the draw window are a draw", () => {
    const r = adj(tapped(300), tapped(300 + win));
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "DRAW", ranking: [payer, owner] });
  });

  it("just outside the window is decisive", () => {
    const r = adj(tapped(300), tapped(300 + win + 1));
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P0_WIN", ranking: [payer, owner] });
  });

  it("the only tapper wins when the other times out", () => {
    const r = adj(timeout, tapped(500));
    expect(r).toMatchObject({ status: "COMPLETED", outcome: "P1_WIN", ranking: [owner, payer] });
  });

  it("both timing out aborts as a draw", () => {
    const r = adj(timeout, timeout);
    expect(r).toMatchObject({ status: "ABORTED", outcome: "DRAW", ranking: [payer, owner] });
  });
});
