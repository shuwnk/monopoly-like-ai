import { describe, expect, it } from "vitest";
import { DigitalAxis } from "../digitalAxis.js";

const DT = 1 / 60;
const run = (a: DigitalAxis, target: number, seconds: number): number => {
  let v = a.value;
  for (let t = 0; t < seconds - 1e-9; t += DT) v = a.update(target, DT);
  return v;
};

describe("Rewired digital axis", () => {
  it("ramps from standing to full input in a third of a second", () => {
    const a = new DigitalAxis();
    expect(run(a, 1, 0.1)).toBeCloseTo(0.3, 1);
    expect(run(a, 1, 0.25)).toBe(1);
    expect(run(a, 1, 1)).toBe(1); // never overshoots
  });

  it("falls back to 0 at the same rate when released", () => {
    const a = new DigitalAxis();
    run(a, -1, 1);
    expect(a.value).toBe(-1);
    expect(run(a, 0, 0.1)).toBeCloseTo(-0.7, 1);
    expect(run(a, 0, 0.3)).toBe(0);
  });

  it("snaps through 0 when the opposite key is pressed", () => {
    const a = new DigitalAxis();
    run(a, 1, 1);
    const v = a.update(-1, DT);
    expect(v).toBeLessThan(0);
    expect(v).toBeGreaterThan(-0.1); // restarted from 0, not from +1
  });

  it("can be tuned and reset", () => {
    const a = new DigitalAxis({ sensitivity: 100, gravity: 100, snap: false });
    expect(a.update(1, DT)).toBe(1);
    a.reset();
    expect(a.value).toBe(0);
  });
});
