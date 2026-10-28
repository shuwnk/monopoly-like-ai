import { describe, expect, it } from "vitest";
import { COUNTDOWN_LENGTH, countdownNumber, feedAlpha, makeFallers, placementDelay, resultsBrightness, stepFallers, timerPulseScale } from "../roundFlow.js";

const DT = 1 / 60;

describe("spawn drop", () => {
  it("queues each fighter 10 units up, released 0.1 s apart", () => {
    const f = makeFallers([0, 2.5, 0]);
    expect(f.map((x) => x.y)).toEqual([10, 12.5, 10]);
    expect(f.map((x) => x.releaseAt)).toEqual([0, 0.1, 0.2]);
    expect(f.every((x) => !x.landed && x.vy === 0)).toBe(true);
  });

  it("holds a fighter until its release time", () => {
    const f = makeFallers([0, 0]);
    stepFallers(f, 0.05, DT);
    expect(f[0]!.y).toBeLessThan(10);
    expect(f[1]!.y).toBe(10);
  });

  it("free-falls at 9.8 and lands after about 1.43 s, snapping onto the spot", () => {
    const f = makeFallers([1]);
    let t = 0;
    let landedAt = -1;
    while (landedAt < 0 && t < 3) {
      t += DT;
      const landed = stepFallers(f, t, DT);
      if (landed.length) landedAt = t;
    }
    expect(landedAt).toBeGreaterThan(1.38); // √(2·10/9.8) ≈ 1.43 s
    expect(landedAt).toBeLessThan(1.47);
    expect(f[0]!.y).toBe(1);
    expect(f[0]!.landed).toBe(true);
    expect(stepFallers(f, t + DT, DT)).toEqual([]); // reported once
  });

  it("gives up and snaps everyone down at the 6 s cap", () => {
    const f = makeFallers([0]);
    f[0]!.targetY = -1000; // never reachable by falling
    expect(stepFallers(f, 5.9, DT)).toEqual([]);
    expect(stepFallers(f, 6, DT)).toHaveLength(1);
    expect(f[0]!.y).toBe(-1000);
  });
});

describe("countdown", () => {
  it("shows 3, 2, 1 for half a second each and nothing after", () => {
    expect(COUNTDOWN_LENGTH).toBe(1.5);
    expect(countdownNumber(1.5)).toBe(3);
    expect(countdownNumber(1.01)).toBe(3);
    expect(countdownNumber(1)).toBe(2);
    expect(countdownNumber(0.5)).toBe(1);
    expect(countdownNumber(0.01)).toBe(1);
    expect(countdownNumber(0)).toBe(0);
    expect(countdownNumber(-0.2)).toBe(0);
  });
});

describe("timer pulse", () => {
  it("peaks at ×1.25 after 0.125 s and is back to ×1 at 0.25 s", () => {
    expect(timerPulseScale(0)).toBe(1);
    expect(timerPulseScale(0.125)).toBeCloseTo(1.25, 6);
    expect(timerPulseScale(0.25)).toBe(1);
    expect(timerPulseScale(1)).toBe(1);
    expect(timerPulseScale(-1)).toBe(1); // before the first tick
  });

  it("is a symmetric ease-in-out", () => {
    expect(timerPulseScale(0.05)).toBeCloseTo(timerPulseScale(0.2), 6);
    expect(timerPulseScale(0.0625)).toBeCloseTo(1.125, 6); // halfway up the ease is the midpoint
    expect(timerPulseScale(0.03)).toBeLessThan(timerPulseScale(0.06));
  });
});

describe("kill feed", () => {
  it("sits at alpha 200/255 and fades out over the last second", () => {
    expect(feedAlpha(5)).toBeCloseTo(200 / 255, 6);
    expect(feedAlpha(1)).toBeCloseTo(200 / 255, 6);
    expect(feedAlpha(0.5)).toBeCloseTo(100 / 255, 6);
    expect(feedAlpha(0)).toBe(0);
  });
});

describe("results", () => {
  it("dims the frozen frame to 35 % over half a second", () => {
    expect(resultsBrightness(0)).toBe(1);
    expect(resultsBrightness(0.25)).toBeCloseTo(0.675, 6);
    expect(resultsBrightness(0.5)).toBeCloseTo(0.35, 6);
    expect(resultsBrightness(3)).toBeCloseTo(0.35, 6);
  });

  it("reveals the winner after 1 s and the rest 0.25 s apart", () => {
    expect(placementDelay(0)).toBe(1);
    expect(placementDelay(1)).toBe(1.25);
    expect(placementDelay(3)).toBe(1.75);
  });
});
