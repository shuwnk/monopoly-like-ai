import { describe, expect, it } from "vitest";
import { BARN_BRAWL_CAMERA, ThirdPersonCamera, type RaycastFn } from "../thirdPersonCamera.js";

const open: RaycastFn = () => null;
const feet = { x: 0, y: 0, z: 0 };
const dt = 1 / 60;

describe("ThirdPersonCamera — pose", () => {
  it("sits maxDistance behind, offsetY up and offsetZ off the right shoulder when level", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 0; // facing +z: right is -x
    const pose = cam.update(feet, open, dt);
    expect(pose.position.x).toBeCloseTo(-0.5, 6);
    expect(pose.position.y).toBeCloseTo(1, 6);
    expect(pose.position.z).toBeCloseTo(-2, 6);
    // looks straight ahead: orbit distance + look-forward offset, no vertical drop
    expect(pose.lookAt.x).toBeCloseTo(-0.5, 6);
    expect(pose.lookAt.y).toBeCloseTo(1, 6);
    expect(pose.lookAt.z).toBeCloseTo(1, 6);
  });

  it("orbits with yaw", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 0;
    cam.yaw = 90; // facing +x: right is +z
    const pose = cam.update(feet, open, dt);
    expect(pose.position.x).toBeCloseTo(-2, 6);
    expect(pose.position.z).toBeCloseTo(0.5, 6);
  });

  it("pulls in and rises when looking down, and aims the look-at point downward", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 44.5; // half of the 89° clamp → orbit at 50 %, rise at half of (0.875 + 1)
    const pose = cam.update(feet, open, dt);
    const num = 1.75 / 2 + 1;
    expect(pose.position.z).toBeCloseTo(-1, 6);
    expect(pose.position.y).toBeCloseTo(1 + num * 0.5, 6);
    expect(pose.lookAt.y).toBeCloseTo(pose.position.y - num * 0.5 * 1.9, 6);
    expect(pose.lookAt.z).toBeCloseTo(pose.position.z + 1 + 0.5, 6);
  });

  it("never shortens the orbit below 5 % even at the pitch clamp", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 89;
    const pose = cam.update(feet, open, dt);
    expect(Math.hypot(pose.position.x, pose.position.z)).toBeGreaterThan(0.09);
  });

  it("starts at the 5° initial pitch", () => {
    expect(new ThirdPersonCamera(BARN_BRAWL_CAMERA).pitch).toBe(5);
  });
});

describe("ThirdPersonCamera — walls", () => {
  it("stops `wallOffset` short of a wall between the pivot and the camera", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 0;
    const pose = cam.update(feet, () => 1, dt);
    expect(pose.didHitWall).toBe(true);
    expect(Math.hypot(pose.position.x, pose.position.y, pose.position.z)).toBeCloseTo(0.8, 6);
  });

  it("eases back out at `distanceRecovery` once the wall is gone", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 0;
    cam.update(feet, () => 1, dt);
    const a = cam.update(feet, open, 0.1); // 0.8 + 5 × 0.1
    expect(Math.hypot(a.position.x, a.position.y, a.position.z)).toBeCloseTo(1.3, 6);
    const b = cam.update(feet, open, 1); // can't overshoot the free distance
    expect(Math.hypot(b.position.x, b.position.y, b.position.z)).toBeCloseTo(Math.hypot(0.5, 1, 2), 6);
    expect(b.didHitWall).toBe(true); // the flag clears on the frame after it reaches the free distance
    expect(cam.update(feet, open, dt).didHitWall).toBe(false);
  });

  it("ignores a hit beyond the camera's own distance", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 0;
    const pose = cam.update(feet, () => 10, dt);
    expect(pose.didHitWall).toBe(false);
    expect(pose.position.z).toBeCloseTo(-2, 6);
  });
});

describe("ThirdPersonCamera — input", () => {
  it("turns and tilts by 0.18° per mouse unit, clamping pitch to ±89°", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.pitch = 0;
    cam.rotate(100, 0);
    expect(cam.yaw).toBeCloseTo(-18, 6); // mouse right turns clockwise in this frame
    cam.rotate(0, 50);
    expect(cam.pitch).toBeCloseTo(9, 6); // mouse down looks down
    cam.rotate(0, 100000);
    expect(cam.pitch).toBe(89);
    cam.rotate(0, -100000);
    expect(cam.pitch).toBe(-89);
  });

  it("resetTo restores the spawn facing and the 5° pitch", () => {
    const cam = new ThirdPersonCamera(BARN_BRAWL_CAMERA);
    cam.rotate(300, 300);
    cam.resetTo(180);
    expect(cam.yaw).toBe(180);
    expect(cam.pitch).toBe(5);
    expect(cam.forward().z).toBeCloseTo(-1, 6);
  });
});
