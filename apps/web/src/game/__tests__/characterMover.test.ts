import { describe, expect, it } from "vitest";
import { BARN_BRAWL_MOVER, CharacterMover, SIMPLE_MOD_MOVER, type MoverInput, type MoverTuning } from "../characterMover.js";
import { BARN_BRAWL_CAMERA, ThirdPersonCamera } from "../thirdPersonCamera.js";

const idle: MoverInput = { axisX: 0, axisY: 0, jump: false };
const forward: MoverInput = { axisX: 0, axisY: 1, jump: false };
const jump: MoverInput = { axisX: 0, axisY: 0, jump: true };

/** one frame on flat ground: steer, "move", land */
function groundFrame(m: CharacterMover, input: MoverInput, dt: number): boolean {
  const jumped = m.calculateVelocity(input, dt);
  m.finishMove(!jumped && m.vy <= 0, false, dt);
  return jumped;
}
/** one frame in the air (nothing under the feet) */
function airFrame(m: CharacterMover, input: MoverInput, dt: number): boolean {
  const jumped = m.calculateVelocity(input, dt);
  m.finishMove(false, false, dt);
  return jumped;
}
function standing(t: MoverTuning = BARN_BRAWL_MOVER): CharacterMover {
  const m = new CharacterMover(t);
  m.finishMove(true, false, 1 / 60);
  return m;
}

describe("CharacterMover — planar steering", () => {
  it("accelerates linearly at `acceleration` and snaps onto maxSpeed", () => {
    const m = standing();
    groundFrame(m, forward, 0.1); // 55 × 0.1 = 5.5 of the 8 wanted
    expect(m.vz).toBeCloseTo(5.5, 6);
    expect(m.vx).toBeCloseTo(0, 6);
    groundFrame(m, forward, 0.1); // the remaining 2.5 is less than one step → snap
    expect(m.vz).toBeCloseTo(8, 6);
  });

  it("decelerates at `deceleration` when the input is released", () => {
    const m = standing();
    groundFrame(m, forward, 1);
    groundFrame(m, idle, 0.1); // 55 × 0.1 = 5.5 off the 8
    expect(m.vz).toBeCloseTo(2.5, 6);
    groundFrame(m, idle, 0.1);
    expect(m.vz).toBe(0);
  });

  it("reverses at the acceleration rate but reins in an overshoot at the deceleration rate", () => {
    // the original only decelerates when the velocity is already past the target in the
    // target's own direction (or there is no input) — a reversal is an acceleration
    const m = standing({ ...BARN_BRAWL_MOVER, acceleration: 100, deceleration: 10 });
    groundFrame(m, forward, 1);
    groundFrame(m, { axisX: 0, axisY: -1, jump: false }, 0.1); // 8 → wants -8: 100 × 0.1 toward it
    expect(m.vz).toBeCloseTo(-2, 6);
    const o = standing({ ...BARN_BRAWL_MOVER, acceleration: 100, deceleration: 10 });
    groundFrame(o, forward, 1);
    groundFrame(o, { axisX: 0, axisY: 0.5, jump: false }, 0.1); // 8 → wants 4: overshoot, 10 × 0.1
    expect(o.vz).toBeCloseTo(7, 6);
  });

  it("holds planar velocity in the air with Barn Brawl's zero air deceleration", () => {
    const m = standing();
    groundFrame(m, forward, 1);
    airFrame(m, forward, 1 / 60); // the frame that leaves the ground still steers at ground rates
    airFrame(m, idle, 0.5);
    expect(m.vz).toBeCloseTo(8, 6);
  });

  it("steers in the air at `airAcceleration`", () => {
    const m = standing();
    airFrame(m, idle, 1 / 60); // now airborne
    airFrame(m, { axisX: 1, axisY: 0, jump: false }, 0.1); // 25 × 0.1
    expect(Math.hypot(m.vx, m.vz)).toBeCloseTo(2.5, 6);
  });

  it("clamps diagonal input to unit length so diagonals aren't faster", () => {
    const m = standing();
    groundFrame(m, { axisX: 1, axisY: 1, jump: false }, 1);
    expect(Math.hypot(m.vx, m.vz)).toBeCloseTo(8, 6);
  });

  it("moves relative to the forward vector the camera sets", () => {
    const m = standing();
    m.setForward(1, 0); // facing +x
    groundFrame(m, forward, 1);
    expect(m.vx).toBeCloseTo(8, 6);
    expect(m.vz).toBeCloseTo(0, 6);
    groundFrame(m, { axisX: 1, axisY: 0, jump: false }, 1); // screen-right of +x is +z in this frame
    expect(m.vz).toBeCloseTo(8, 6);
  });

  it("worldInput() moves along a world direction whatever the forward basis is", () => {
    const m = standing();
    m.setForward(0.6, 0.8);
    groundFrame(m, m.worldInput(1, 0, false), 1);
    expect(m.vx).toBeCloseTo(8, 6);
    expect(m.vz).toBeCloseTo(0, 6);
    groundFrame(m, m.worldInput(0, -1, false), 1);
    expect(m.vx).toBeCloseTo(0, 6);
    expect(m.vz).toBeCloseTo(-8, 6);
  });

  it("strafes along the same right vector the ThirdPersonCamera uses", () => {
    for (const yaw of [0, 37, 90, 200, 315]) {
      const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
      cam.yaw = yaw;
      const f = cam.forward();
      const r = cam.right();
      const m = standing();
      m.setForward(f.x, f.z);
      groundFrame(m, { axisX: 1, axisY: 0, jump: false }, 1);
      expect(m.vx).toBeCloseTo(r.x * 8, 6);
      expect(m.vz).toBeCloseTo(r.z * 8, 6);
    }
  });
});

describe("CharacterMover — gravity and ground", () => {
  it("accumulates gravity while airborne and pins vy to -g·dt on the ground", () => {
    const m = standing();
    airFrame(m, idle, 0.1);
    airFrame(m, idle, 0.1);
    expect(m.vy).toBeCloseTo(-30 * 0.1 * 2 - 30 * (1 / 60), 6);
    groundFrame(m, idle, 0.1);
    expect(m.vy).toBeCloseTo(-3, 6);
    expect(m.grounded).toBe(true);
  });

  it("kills upward velocity on a ceiling hit", () => {
    const m = standing();
    m.calculateVelocity(jump, 1 / 60);
    expect(m.vy).toBe(10);
    m.finishMove(false, true, 1 / 60);
    expect(m.vy).toBe(0);
  });
});

describe("CharacterMover — jumping", () => {
  it("jumps to `jumpVelocity` from the ground and reports the edge", () => {
    const m = standing();
    expect(groundFrame(m, jump, 1 / 60)).toBe(true);
    expect(m.vy).toBe(10);
    expect(m.grounded).toBe(false);
  });

  it("only allows one jump per landing", () => {
    const m = standing();
    groundFrame(m, jump, 1 / 60);
    airFrame(m, idle, 0.1);
    expect(airFrame(m, jump, 1 / 60)).toBe(false);
    for (let i = 0; i < 7; i++) airFrame(m, idle, 0.1); // come back down (10 / 30 × 2 ≈ 0.67 s)
    groundFrame(m, idle, 1 / 60); // land
    expect(groundFrame(m, jump, 1 / 60)).toBe(true);
  });

  it("allows a coyote jump inside the leeway window after walking off a ledge", () => {
    const m = standing(SIMPLE_MOD_MOVER); // 0.2 s leeway
    airFrame(m, idle, 0.1);
    expect(airFrame(m, jump, 1 / 60)).toBe(true);
    expect(m.vy).toBe(7);
  });

  it("spends the ground jump once the leeway has passed", () => {
    const m = standing(SIMPLE_MOD_MOVER);
    airFrame(m, idle, 0.15);
    airFrame(m, idle, 0.15); // 0.3 s airborne > 0.2 s leeway
    expect(airFrame(m, jump, 1 / 60)).toBe(false);
  });

  it("keeps the coyote jump for Barn Brawl's 10 s leeway", () => {
    const m = standing();
    for (let i = 0; i < 50; i++) airFrame(m, idle, 0.1); // 5 s falling
    expect(airFrame(m, jump, 1 / 60)).toBe(true);
  });

  it("buffers a jump pressed just before landing", () => {
    const m = standing();
    groundFrame(m, jump, 1 / 60);
    for (let i = 0; i < 6; i++) airFrame(m, idle, 0.1);
    expect(airFrame(m, jump, 1 / 60)).toBe(false); // pressed in the air, 0.05 s before touchdown
    airFrame(m, idle, 0.05);
    groundFrame(m, idle, 1 / 60); // land
    expect(groundFrame(m, idle, 1 / 60)).toBe(false); // grounded now → the buffered press becomes "ready"
    expect(groundFrame(m, idle, 1 / 60)).toBe(true); // …and fires the frame after, like the original
    expect(m.vy).toBe(10);
  });

  it("drops a buffered jump older than `jumpBufferTime`", () => {
    const m = standing();
    groundFrame(m, jump, 1 / 60);
    for (let i = 0; i < 6; i++) airFrame(m, idle, 0.1);
    airFrame(m, jump, 1 / 60);
    airFrame(m, idle, 0.2); // 0.2 s > 0.15 s buffer
    groundFrame(m, idle, 1 / 60);
    expect(groundFrame(m, idle, 1 / 60)).toBe(false);
    expect(groundFrame(m, idle, 1 / 60)).toBe(false);
  });

  it("reset() clears motion and jump state", () => {
    const m = standing();
    groundFrame(m, forward, 1);
    groundFrame(m, jump, 1 / 60);
    m.reset();
    expect([m.vx, m.vy, m.vz]).toEqual([0, 0, 0]);
    expect(m.speedFraction()).toBe(0);
  });
});
