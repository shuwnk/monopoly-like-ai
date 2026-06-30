import type { MinigameResult, PlayerId } from "@party-monopoly/types";
import { REFLEX_TAP_DUEL_ID } from "./reflex-tap-duel.js";

// One round of input per player, measured by the renderer. reactionMs is from
// the green signal; null means they never tapped. falseStart means they tapped
// during red.
export interface ReflexInput {
  readonly reactionMs: number | null;
  readonly falseStart: boolean;
}

// Pure: turns the two players' round inputs into the final result. No DOM, no
// timers, no randomness — the component owns those and feeds us the numbers.
// p0 = payer, p1 = owner, matching MinigameRequest participant order.
export function adjudicateReflexDuel(
  p0: ReflexInput,
  p1: ReflexInput,
  payerId: PlayerId,
  ownerId: PlayerId,
  drawWindowMs: number,
): MinigameResult {
  // both jumped the gun: nobody wins, caller already gave them a re-arm
  if (p0.falseStart && p1.falseStart) return aborted(payerId, ownerId);
  if (p0.falseStart) return winner(ownerId, payerId, "P1_WIN");
  if (p1.falseStart) return winner(payerId, ownerId, "P0_WIN");

  const t0 = p0.reactionMs;
  const t1 = p1.reactionMs;

  if (t0 === null && t1 === null) return aborted(payerId, ownerId);
  if (t0 === null) return winner(ownerId, payerId, "P1_WIN");
  if (t1 === null) return winner(payerId, ownerId, "P0_WIN");

  if (Math.abs(t0 - t1) <= drawWindowMs) {
    return { minigameId: REFLEX_TAP_DUEL_ID, status: "COMPLETED", outcome: "DRAW", ranking: [payerId, ownerId] };
  }
  return t0 < t1 ? winner(payerId, ownerId, "P0_WIN") : winner(ownerId, payerId, "P1_WIN");
}

function winner(winId: PlayerId, loseId: PlayerId, outcome: "P0_WIN" | "P1_WIN"): MinigameResult {
  return { minigameId: REFLEX_TAP_DUEL_ID, status: "COMPLETED", outcome, ranking: [winId, loseId] };
}

function aborted(payerId: PlayerId, ownerId: PlayerId): MinigameResult {
  return { minigameId: REFLEX_TAP_DUEL_ID, status: "ABORTED", outcome: "DRAW", ranking: [payerId, ownerId] };
}
