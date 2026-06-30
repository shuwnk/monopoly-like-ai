import type { GameState } from "@party-monopoly/engine";
import { adjudicateReflexDuel, type ReflexInput } from "@party-monopoly/minigame-harness";
import type { MinigameResult } from "@party-monopoly/types";

// a tap we never received: treat as no reaction, no false start
export const MISSING_TAP: ReflexInput = { reactionMs: null, falseStart: false };

// Client-reported reaction times are untrusted. A time below the human floor is
// either anticipation or a spoofed client trying to auto-win, so we demote it to
// a false start — it can't beat an honest tap.
export function sanitizeTap(tap: ReflexInput, minHumanReactionMs: number): ReflexInput {
  if (!tap.falseStart && tap.reactionMs !== null && tap.reactionMs < minHumanReactionMs) {
    return { reactionMs: null, falseStart: true };
  }
  return tap;
}

// Pure: given the two collected taps and the pending showdown, produce the
// result the server will submit. participant index 0 = payer, 1 = owner,
// matching how the reducer built the request.
export function adjudicateShowdown(
  state: GameState,
  payerTap: ReflexInput,
  ownerTap: ReflexInput,
  drawWindowMs: number,
  minHumanReactionMs: number,
): MinigameResult {
  const req = state.pendingMinigame;
  if (!req) throw new Error("no pending minigame");
  const payerId = req.participants[0]!.playerId;
  const ownerId = req.participants[1]!.playerId;
  return adjudicateReflexDuel(
    sanitizeTap(payerTap, minHumanReactionMs),
    sanitizeTap(ownerTap, minHumanReactionMs),
    payerId,
    ownerId,
    drawWindowMs,
  );
}
