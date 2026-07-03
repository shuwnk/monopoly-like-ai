import { DEFAULT_REFLEX_TAP_DUEL_CONFIG, type ReflexInput } from "@party-monopoly/minigame-harness";
import type { MinigameResult } from "@party-monopoly/types";

// how the tap was made. device asymmetry (touch vs mouse vs keyboard latency) is
// a top fairness risk, so we record it per seat and can slice a session by it.
export type InputDevice = "keyboard" | "mouse" | "touch" | "pen" | "bot" | "unknown";

// taps quicker than this look inhuman; online adjudication demotes them (anti-
// anticipation guard). the lab records raw times so we can count how many real
// taps the floor would eat.
const FLOOR_MS = DEFAULT_REFLEX_TAP_DUEL_CONFIG.minHumanReactionMs;

// One duel's worth of raw numbers, plucked from the result + both inputs. Kept
// flat and serializable so a session log is just an array of these.
export interface DuelRecord {
  winner: "P0" | "P1" | "DRAW";
  aborted: boolean;
  p0ReactionMs: number | null;
  p1ReactionMs: number | null;
  p0FalseStart: boolean;
  p1FalseStart: boolean;
  // how each seat tapped this round (keyboard / mouse / touch / …)
  p0Device?: InputDevice;
  p1Device?: InputDevice;
  // the red hold before green, ms. correlating this with reaction time is how a
  // fairness session detects anticipation (short reactions after long holds).
  preGoDelayMs?: number | null;
  // 0-based index within the session, for ordering/drift analysis
  roundIndex?: number;
}

// extra context the component/session knows but the MinigameResult doesn't
export interface RecordMeta {
  preGoDelayMs?: number | null;
  roundIndex?: number;
  devices?: readonly [InputDevice, InputDevice];
}

export function toRecord(
  result: MinigameResult,
  inputs: readonly [ReflexInput, ReflexInput],
  meta: RecordMeta = {},
): DuelRecord {
  const [p0, p1] = inputs;
  return {
    winner: result.outcome === "P0_WIN" ? "P0" : result.outcome === "P1_WIN" ? "P1" : "DRAW",
    aborted: result.status === "ABORTED",
    p0ReactionMs: p0.reactionMs,
    p1ReactionMs: p1.reactionMs,
    p0FalseStart: p0.falseStart,
    p1FalseStart: p1.falseStart,
    ...(meta.devices ? { p0Device: meta.devices[0], p1Device: meta.devices[1] } : {}),
    ...(meta.preGoDelayMs !== undefined ? { preGoDelayMs: meta.preGoDelayMs } : {}),
    ...(meta.roundIndex !== undefined ? { roundIndex: meta.roundIndex } : {}),
  };
}

// a real (non-false-start) tap faster than the human floor
function isSubFloor(reactionMs: number | null, falseStart: boolean): boolean {
  return !falseStart && reactionMs !== null && reactionMs < FLOOR_MS;
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
  // median is the honest central tendency: near-timeout/outlier taps skew the mean
  p0MedianReactionMs: number | null;
  p1MedianReactionMs: number | null;
  p0FalseStarts: number;
  p1FalseStarts: number;
  // real taps under the human-reaction floor: online would demote these, so a
  // nonzero count is a fairness flag worth eyeballing before trusting win rates.
  p0SubFloor: number;
  p1SubFloor: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function aggregate(records: readonly DuelRecord[]): DuelStats {
  let p0Wins = 0;
  let p1Wins = 0;
  let draws = 0;
  let p0FalseStarts = 0;
  let p1FalseStarts = 0;
  let p0SubFloor = 0;
  let p1SubFloor = 0;
  const p0Reactions: number[] = [];
  const p1Reactions: number[] = [];

  for (const r of records) {
    if (r.winner === "P0") p0Wins++;
    else if (r.winner === "P1") p1Wins++;
    else draws++;
    if (r.p0FalseStart) p0FalseStarts++;
    if (r.p1FalseStart) p1FalseStarts++;
    if (isSubFloor(r.p0ReactionMs, r.p0FalseStart)) p0SubFloor++;
    if (isSubFloor(r.p1ReactionMs, r.p1FalseStart)) p1SubFloor++;
    if (!r.p0FalseStart && r.p0ReactionMs !== null) p0Reactions.push(r.p0ReactionMs);
    if (!r.p1FalseStart && r.p1ReactionMs !== null) p1Reactions.push(r.p1ReactionMs);
  }

  const mean = (xs: readonly number[]): number | null =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const played = records.length;
  return {
    played,
    p0Wins,
    p1Wins,
    draws,
    p0WinRate: played ? p0Wins / played : 0,
    p1WinRate: played ? p1Wins / played : 0,
    p0AvgReactionMs: mean(p0Reactions),
    p1AvgReactionMs: mean(p1Reactions),
    p0MedianReactionMs: median(p0Reactions),
    p1MedianReactionMs: median(p1Reactions),
    p0FalseStarts,
    p1FalseStarts,
    p0SubFloor,
    p1SubFloor,
  };
}
