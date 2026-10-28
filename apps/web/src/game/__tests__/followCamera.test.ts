import { describe, expect, it } from "vitest";
import { BREAKING_BLOCKS_CAMERA, FollowCamera, type FollowTarget } from "../followCamera.js";

const DT = 1 / 60;
const alive = (x: number, z: number): FollowTarget => ({ x, y: 0.34, z, dead: false });

describe("follow camera", () => {
  it("rests at the rig position when the fighters are centred", () => {
    const cam = new FollowCamera(BREAKING_BLOCKS_CAMERA);
    cam.addTarget(alive(-1, 0));
    cam.addTarget(alive(1, 0));
    const t = cam.calculateTarget([alive(-1, 0), alive(1, 0)]);
    expect(t).toEqual(BREAKING_BLOCKS_CAMERA.start);
  });

  it("slides at most half the max move toward the edge of the area", () => {
    const cam = new FollowCamera(BREAKING_BLOCKS_CAMERA);
    cam.addTarget(alive(9, 9)); // outside the ±7.5 / ±10 area: clamped
    cam.snap([alive(9, 9)]);
    expect(cam.position.x).toBeCloseTo(-0.4 + 1.5);
    expect(cam.position.z).toBeCloseTo(-10.376 + 1.5 * (9 / 10));
    expect(cam.position.y).toBe(14.096);
  });

  it("eases toward the target with 1 − 0.6^dt and catches the fighters up at 50 Hz", () => {
    const cam = new FollowCamera(BREAKING_BLOCKS_CAMERA);
    cam.addTarget(alive(0, 0));
    const far = [alive(7.5, 0)];
    cam.update(far, DT); // no fixed step has run yet: the tracked position is still the old one
    expect(cam.position.x).toBe(-0.4);
    cam.update(far, DT); // the first 50 Hz step moves the tracked position 40 % of the way
    expect(cam.position.x).toBeGreaterThan(-0.4);
    expect(cam.position.x).toBeLessThan(-0.4 + 1.5 * (1 - Math.pow(0.6, DT)) + 1e-9); // never faster than the ease allows
    for (let t = 0; t < 14; t += DT) cam.update(far, DT);
    expect(cam.position.x).toBeCloseTo(-0.4 + 1.5, 2); // settled at the right edge (0.6^14 ≈ 0.001 left)
  });

  it("ignores dead fighters and holds the last target when nobody is left", () => {
    const cam = new FollowCamera(BREAKING_BLOCKS_CAMERA);
    cam.addTarget(alive(-7.5, 0));
    cam.addTarget(alive(7.5, 0));
    for (let t = 0; t < 2; t += DT) cam.update([alive(-7.5, 0), alive(7.5, 0)], DT);
    expect(cam.position.x).toBeCloseTo(-0.4, 2);
    const oneDead = [{ ...alive(-7.5, 0), dead: true }, alive(7.5, 0)];
    for (let t = 0; t < 14; t += DT) cam.update(oneDead, DT);
    expect(cam.position.x).toBeCloseTo(-0.4 + 1.5, 2);
    const held = cam.calculateTarget(oneDead.map((t) => ({ ...t, dead: true })));
    expect(held.x).toBeCloseTo(-0.4 + 1.5);
  });

  it("looks down the pitch", () => {
    const f = new FollowCamera(BREAKING_BLOCKS_CAMERA).forward();
    expect(f.y).toBeCloseTo(-0.89, 2);
    expect(f.z).toBeCloseTo(0.457, 2);
  });
});
