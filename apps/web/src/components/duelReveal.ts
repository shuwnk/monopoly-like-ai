import type { ReflexInput } from "@party-monopoly/minigame-harness";
import type { MinigameOutcome } from "@party-monopoly/types";

// Shared post-duel reveal copy, used by both the hotseat and online duels so an
// outcome reads the same either way: turns "you lost" into "lost by 14 ms".

// a seat's outcome in words: the reaction time, or why it had none
export function reactionLabel(input: ReflexInput): string {
  if (input.falseStart) return "jumped early";
  if (input.reactionMs === null) return "no tap";
  return `${Math.round(input.reactionMs)} ms`;
}

// the one-line explanation of the result. a/b and the names are in participant
// order (a = payer/P0, b = owner/P1); callers pass whatever names fit the view.
export function marginLine(
  a: ReflexInput,
  b: ReflexInput,
  outcome: MinigameOutcome,
  aborted: boolean,
  nameA: string,
  nameB: string,
): string {
  if (aborted) return "Aborted — flat rent.";
  const winName = outcome === "P0_WIN" ? nameA : nameB;

  if (outcome === "DRAW") {
    if (a.reactionMs !== null && b.reactionMs !== null) {
      return `Draw — within ${Math.abs(Math.round(a.reactionMs - b.reactionMs))} ms.`;
    }
    return "Draw!";
  }
  // a decisive win where one side jumped early or never tapped
  if (a.falseStart || b.falseStart) return `${winName} wins — opponent jumped early.`;
  if (a.reactionMs === null || b.reactionMs === null) return `${winName} wins — opponent never tapped.`;
  return `${winName} wins by ${Math.abs(Math.round(a.reactionMs - b.reactionMs))} ms.`;
}
