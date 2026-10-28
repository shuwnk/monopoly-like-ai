// Pummel Party's minigame round presentation, as pure helpers every minigame can share:
// the spawn drop, the 3·2·1 countdown, the timer pulse, the kill-feed fade and the
// results dim/reveal. Sources: ~/Projects/rea-work/pummel-party/decompiled/Assembly-CSharp/
// MinigameController.cs (DoSpawnPlayersAnimation, the Countdown state), UIMinigameTimer.cs,
// UIMinigameResultScreen.cs and BarnBrawlKillFeedText.cs; FINDINGS.md §9. Only the numbers
// and the structure are reused, never the game's assets.

export const ROUND_FLOW = {
  spawnHeight: 10, // `heightOffset = 10f`: fighters start this far above their spot
  spawnGap: 0.1, // one fighter released every `WaitForSeconds(0.1f)`
  spawnGravity: 9.8, // `gravity = 9.8f`, plain v += g·dt
  spawnCap: 6, // `maxTime = 6f`: the fall loop gives up and snaps everyone down
  spawnSettle: 1.4 + 0.5, // 1.4 s after the last landing, then 0.5 s before the countdown
  countdownFrom: 3, // `countdown = 3`
  countdownStep: 0.5, // `countdown_time_step`: each number stays up this long; no "GO"
  timerPulse: 0.125, // UIMinigameTimer: scale ×1.25 over 0.125 s, ping-pong, each second
  timerPulseScale: 1.25,
  feedLife: 5, // BarnBrawlKillFeedText.lifeLength
  feedFade: 1, // BarnBrawlKillFeedText.fadeTime: the last second fades out
  feedAlpha: 200 / 255, // the names' colours get alpha 200
  resultsDim: 0.35, // the frozen last frame drops to 35 % brightness…
  resultsDimTime: 0.5, // …over half a second
  resultsWait: 1, // winner text after 1 s (`m_nextState = Time.time + 1f`)
  placementDelay: 0.25, // `placement_delay` between placements, first to last
} as const;

/** total countdown length: 3 numbers × 0.5 s */
export const COUNTDOWN_LENGTH = ROUND_FLOW.countdownFrom * ROUND_FLOW.countdownStep;

export interface Faller {
  y: number;
  targetY: number;
  vy: number;
  releaseAt: number;
  landed: boolean;
}

/** queue the drop: each fighter starts 10 above its spot, released 0.1 s after the previous */
export function makeFallers(targetYs: readonly number[]): Faller[] {
  return targetYs.map((targetY, i) => ({ y: targetY + ROUND_FLOW.spawnHeight, targetY, vy: 0, releaseAt: i * ROUND_FLOW.spawnGap, landed: false }));
}

/** advance the drop by dt at drop-clock t; returns the fallers that touched down this step */
export function stepFallers(fallers: Faller[], t: number, dt: number): Faller[] {
  const landed: Faller[] = [];
  for (const f of fallers) {
    if (f.landed || t < f.releaseAt) continue;
    f.vy += ROUND_FLOW.spawnGravity * dt;
    f.y -= f.vy * dt;
    if (f.y <= f.targetY || t >= ROUND_FLOW.spawnCap) {
      f.y = f.targetY;
      f.landed = true;
      landed.push(f);
    }
  }
  return landed;
}

/** the number on screen with `remaining` seconds of countdown left: 3, 2, 1, then 0 = play */
export function countdownNumber(remaining: number): number {
  return Math.max(0, Math.ceil(remaining / ROUND_FLOW.countdownStep));
}

/** the timer number's scale `since` seconds after it changed: up to ×1.25 at 0.125 s and back, easeInOutSine */
export function timerPulseScale(since: number): number {
  const p = ROUND_FLOW.timerPulse;
  if (since < 0 || since >= p * 2) return 1;
  const u = since < p ? since / p : (p * 2 - since) / p;
  return 1 + ((ROUND_FLOW.timerPulseScale - 1) * (1 - Math.cos(Math.PI * u))) / 2;
}

/** a kill-feed line's alpha with `remaining` seconds of its life left: steady, then a 1 s fade */
export function feedAlpha(remaining: number): number {
  return ROUND_FLOW.feedAlpha * Math.max(0, Math.min(1, remaining / ROUND_FLOW.feedFade));
}

/** brightness of the frozen last frame `t` seconds into the results: 1 → 0.35 over 0.5 s */
export function resultsBrightness(t: number): number {
  return 1 - (1 - ROUND_FLOW.resultsDim) * Math.max(0, Math.min(1, t / ROUND_FLOW.resultsDimTime));
}

/** seconds after the round ends before placement i (0 = the winner, shown with the winner text) appears */
export function placementDelay(i: number): number {
  return ROUND_FLOW.resultsWait + i * ROUND_FLOW.placementDelay;
}
