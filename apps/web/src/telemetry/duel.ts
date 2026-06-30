import type { ReflexInput } from "@party-monopoly/minigame-harness";
import type { MinigameResult } from "@party-monopoly/types";

// One duel's worth of raw numbers, plucked from the result + both inputs. Kept
// flat and serializable so a session log is just an array of these.
export interface DuelRecord {
  winner: "P0" | "P1" | "DRAW";
  aborted: boolean;
  p0ReactionMs: number | null;
  p1ReactionMs: number | null;
  p0FalseStart: boolean;
  p1FalseStart: boolean;
}

export function toRecord(result: MinigameResult, inputs: readonly [ReflexInput, ReflexInput]): DuelRecord {
  const [p0, p1] = inputs;
  return {
    winner: result.outcome === "P0_WIN" ? "P0" : result.outcome === "P1_WIN" ? "P1" : "DRAW",
    aborted: result.status === "ABORTED",
    p0ReactionMs: p0.reactionMs,
    p1ReactionMs: p1.reactionMs,
    p0FalseStart: p0.falseStart,
    p1FalseStart: p1.falseStart,
  };
}

export interface DuelStats {
  played: number;
  p0Wins: number;
  p1Wins: number;
  draws: number;
  p0WinRate: number; // 0..1
  p1WinRate: number;
  p0AvgReactionMs: number | null; // over non-false-start taps only
  p1AvgReactionMs: number | null;
  p0FalseStarts: number;
  p1FalseStarts: number;
}

export function aggregate(records: readonly DuelRecord[]): DuelStats {
  let p0Wins = 0;
  let p1Wins = 0;
  let draws = 0;
  let p0FalseStarts = 0;
  let p1FalseStarts = 0;
  let p0Sum = 0;
  let p0Count = 0;
  let p1Sum = 0;
  let p1Count = 0;

  for (const r of records) {
    if (r.winner === "P0") p0Wins++;
    else if (r.winner === "P1") p1Wins++;
    else draws++;
    if (r.p0FalseStart) p0FalseStarts++;
    if (r.p1FalseStart) p1FalseStarts++;
    if (!r.p0FalseStart && r.p0ReactionMs !== null) {
      p0Sum += r.p0ReactionMs;
      p0Count++;
    }
    if (!r.p1FalseStart && r.p1ReactionMs !== null) {
      p1Sum += r.p1ReactionMs;
      p1Count++;
    }
  }

  const played = records.length;
  return {
    played,
    p0Wins,
    p1Wins,
    draws,
    p0WinRate: played ? p0Wins / played : 0,
    p1WinRate: played ? p1Wins / played : 0,
    p0AvgReactionMs: p0Count ? p0Sum / p0Count : null,
    p1AvgReactionMs: p1Count ? p1Sum / p1Count : null,
    p0FalseStarts,
    p1FalseStarts,
  };
}
