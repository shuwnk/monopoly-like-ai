import type { GameState } from "@party-monopoly/engine";
import { adjudicateReflexDuel, type ReflexInput } from "@party-monopoly/minigame-harness";
import type { MinigameResult, PlayerId } from "@party-monopoly/types";

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

// the result plus the sanitized taps that produced it, so the room can both
// submit the result and tell each client what the reaction times actually were
export interface ShowdownResolution {
  readonly result: MinigameResult;
  readonly payerId: PlayerId;
  readonly ownerId: PlayerId;
  readonly payerTap: ReflexInput; // sanitized
  readonly ownerTap: ReflexInput; // sanitized
}

// Pure: given the two collected taps and the pending showdown, produce the
// result and the sanitized taps. participant index 0 = payer, 1 = owner,
// matching how the reducer built the request.
export function resolveShowdown(
  state: GameState,
  payerTap: ReflexInput,
  ownerTap: ReflexInput,
  drawWindowMs: number,
  minHumanReactionMs: number,
): ShowdownResolution {
  const req = state.pendingMinigame;
  if (!req) throw new Error("no pending minigame");
  const payerId = req.participants[0]!.playerId;
  const ownerId = req.participants[1]!.playerId;
  const p = sanitizeTap(payerTap, minHumanReactionMs);
  const o = sanitizeTap(ownerTap, minHumanReactionMs);
  return { result: adjudicateReflexDuel(p, o, payerId, ownerId, drawWindowMs), payerId, ownerId, payerTap: p, ownerTap: o };
}

// convenience for callers (and tests) that only need the result
export function adjudicateShowdown(
  state: GameState,
  payerTap: ReflexInput,
  ownerTap: ReflexInput,
  drawWindowMs: number,
  minHumanReactionMs: number,
): MinigameResult {
  return resolveShowdown(state, payerTap, ownerTap, drawWindowMs, minHumanReactionMs).result;
}
