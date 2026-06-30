import { asMinigameId, type MinigameId } from "@party-monopoly/types";

// Reflex Tap Duel, the MVP minigame: screen shows red, turns green after a
// random delay, first post-green tap wins, tapping during red loses. Only the
// shared contract (id + config) lives here; the playable renderer is in apps/web.

export const REFLEX_TAP_DUEL_ID: MinigameId = asMinigameId("reflex-tap-duel");

export interface ReflexTapDuelConfig {
  // bounds of the random red->green delay, ms
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  // taps within this window of each other count as a draw
  readonly drawWindowMs: number;
  // a reaction faster than this is superhuman — anticipation or a spoofed
  // client. the server treats it as a false start so it can't win.
  readonly minHumanReactionMs: number;
}

export const DEFAULT_REFLEX_TAP_DUEL_CONFIG: ReflexTapDuelConfig = {
  minDelayMs: 1500,
  maxDelayMs: 4000,
  drawWindowMs: 25,
  minHumanReactionMs: 100,
};
