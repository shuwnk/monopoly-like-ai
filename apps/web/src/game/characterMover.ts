// A port of Pummel Party's `CharacterMover` (kinematic CharacterController, no
// rigidbody): per-axis linear acceleration toward the wanted velocity, separate
// ground/air rates, gravity, a coyote window after leaving the ground and a short
// jump buffer. Pure numbers in, numbers out — the caller owns collision and tells
// the mover whether it ended up grounded. Shared by the practice minigames so they
// all move the same way.
//
// Source: ~/Projects/rea-work/pummel-party/decompiled/Assembly-CSharp/CharacterMover.cs
// (CalculateVelocity / DoMovement / CheckGrounded) and FINDINGS.md §4.

export interface MoverTuning {
  /** units/s the character runs at */
  maxSpeed: number;
  /** units/s² toward the wanted velocity while grounded */
  acceleration: number;
  /** units/s² away from the current velocity while grounded (released / reversed input) */
  deceleration: number;
  airAcceleration: number;
  airDeceleration: number;
  gravity: number;
  /** jumps allowed before touching down again (0 disables jumping) */
  maxJumps: number;
  /** seconds after leaving the ground during which the first jump still counts as a ground jump */
  jumpLeewayTime: number;
  /** vertical velocity a jump sets (never lowers an existing upward velocity) */
  jumpVelocity: number;
  /** a jump pressed this long before it becomes legal still fires (`m_maxJumpBufferSeconds`) */
  jumpBufferTime: number;
}

// Barn Brawl's player prefab, from extracted/minigames/barnbrawl.json → CharacterMover:
// maxSpeed 8, acceleration 55, deceleration 55, airAcceleration 25, airDeceleration 0,
// gravity 30, maxJumps 1, jumpLeewayTime 10, jumpVelocity 10. The 10 s leeway is the
// shipped value: walking off a loft leaves you one jump for a long time, which is what
// makes dropping into the pit and hopping onto a crate feel forgiving.
export const BARN_BRAWL_MOVER: MoverTuning = {
  maxSpeed: 8,
  acceleration: 55,
  deceleration: 55,
  airAcceleration: 25,
  airDeceleration: 0,
  gravity: 30,
  maxJumps: 1,
  jumpLeewayTime: 10,
  jumpVelocity: 10,
  jumpBufferTime: 0.15,
};

// The Simple-mod defaults (FINDINGS.md §4 / §16): "the typical Pummel Party feel".
export const SIMPLE_MOD_MOVER: MoverTuning = {
  maxSpeed: 6,
  acceleration: 50,
  deceleration: 50,
  airAcceleration: 8,
  airDeceleration: 15,
  gravity: 25,
  maxJumps: 1,
  jumpLeewayTime: 0.2,
  jumpVelocity: 7,
  jumpBufferTime: 0.15,
};

export interface MoverInput {
  /** strafe axis, +1 = right, in [-1, 1] */
  axisX: number;
  /** forward axis, +1 = forward, in [-1, 1] */
  axisY: number;
  /** jump was pressed this frame (edge, not hold) */
  jump: boolean;
}

export class CharacterMover {
  /** world-space velocity; the caller integrates `v * dt` and resolves collisions */
  vx = 0;
  vy = 0;
  vz = 0;
  /** whether the last `finishMove` reported ground under the feet */
  grounded = false;

  private fx = 0; // forward basis (set by the camera yaw)
  private fz = 1;
  private sx = 1; // strafe basis = up × forward, in the right-handed +z-forward frame
  private sz = 0;
  private time = 0; // sim clock, advanced by dt (no wall clock)
  private lastGroundedTime = -Infinity;
  private jumpCount = 0;
  private hasBufferedJump = false;
  private readyToUseBufferedJump = false;
  private remainingJumpBuffer = 0;

  constructor(public readonly tuning: MoverTuning) {}

  /** `SetForwardVector`: movement is relative to this (normalised, planar) direction. */
  setForward(x: number, z: number): void {
    const len = Math.hypot(x, z) || 1;
    this.fx = x / len;
    this.fz = z / len;
    // Vector3.Cross(up, forward) — screen-right in the frame the minigames use
    this.sx = -this.fz;
    this.sz = this.fx;
  }

  /**
   * An input that moves along a world-space planar direction whatever the forward basis.
   * The AI path in the original builds `CharacterMoverInput(new Vector2(dir.x, dir.z))`
   * against the default (0,0,1) forward, i.e. the vector is already a world direction.
   */
  worldInput(dx: number, dz: number, jump: boolean): MoverInput {
    return { axisX: dx * this.sx + dz * this.sz, axisY: dx * this.fx + dz * this.fz, jump };
  }

  /** drop all motion (respawn / round reset — `mover.Velocity = Vector3.zero`) */
  reset(): void {
    this.vx = this.vy = this.vz = 0;
    this.grounded = false;
    this.jumpCount = 0;
    this.lastGroundedTime = -Infinity;
    this.clearBufferedJump();
  }

  /** the planar speed as a fraction of maxSpeed — what the animator calls `Velocity` */
  speedFraction(): number {
    return Math.hypot(this.vx, this.vz) / this.tuning.maxSpeed;
  }

  /**
   * `CalculateVelocity`: apply gravity, steer the planar velocity toward the input and
   * handle jump / coyote / buffer. Returns true on the frame a jump fires (animation,
   * sound). Call once per frame before integrating.
   */
  calculateVelocity(input: MoverInput, dt: number): boolean {
    const t = this.tuning;
    this.time += dt;
    this.vy -= t.gravity * dt;

    // joystick path: control = strafe·x + forward·y, clamped to unit length
    let cx = this.sx * input.axisX + this.fx * input.axisY;
    let cz = this.sz * input.axisX + this.fz * input.axisY;
    const mag = Math.hypot(cx, cz);
    if (mag > 1) {
      cx /= mag;
      cz /= mag;
    }
    const wantX = cx * t.maxSpeed;
    const wantZ = cz * t.maxSpeed;

    const accel = this.grounded ? t.acceleration : t.airAcceleration;
    const decel = this.grounded ? t.deceleration : t.airDeceleration;
    // per axis: accelerate while there is input on that axis and the velocity hasn't
    // overshot the target in the target's own direction; otherwise decelerate
    const rateX = (wantX < 0 && this.vx < wantX) || (wantX > 0 && this.vx > wantX) || wantX === 0 ? decel : accel;
    const rateZ = (wantZ < 0 && this.vz < wantZ) || (wantZ > 0 && this.vz > wantZ) || wantZ === 0 ? decel : accel;
    const dx = wantX - this.vx;
    const dz = wantZ - this.vz;
    const dl = Math.hypot(dx, dz);
    const nx = dl > 0 ? dx / dl : 0;
    const nz = dl > 0 ? dz / dl : 0;
    const stepX = nx * rateX * dt;
    const stepZ = nz * rateZ * dt;
    this.vx = Math.abs(dx) > Math.abs(stepX) ? this.vx + stepX : wantX;
    this.vz = Math.abs(dz) > Math.abs(stepZ) ? this.vz + stepZ : wantZ;

    // coyote: the first jump still counts as a ground jump for `jumpLeewayTime` after
    // leaving the ground; after that the ground jump is spent
    const inLeeway = this.time - this.lastGroundedTime < t.jumpLeewayTime;
    if (!this.grounded && this.jumpCount === 0 && !inLeeway) this.jumpCount++;

    this.updateBufferedJump(dt);
    const canJump = this.grounded || (this.jumpCount < t.maxJumps && (this.jumpCount > 0 || inLeeway));
    let jumped = false;
    if (t.maxJumps > 0 && (input.jump || this.readyToUseBufferedJump) && canJump) {
      this.jumpCount++;
      this.vy = Math.max(this.vy, t.jumpVelocity);
      this.hasBufferedJump = false;
      this.readyToUseBufferedJump = false;
      jumped = true;
    } else if (t.maxJumps > 0 && this.hasBufferedJump && canJump) {
      this.readyToUseBufferedJump = true; // fires next frame, like the original
    } else if (t.maxJumps > 0 && input.jump) {
      this.bufferJump();
    }
    return jumped;
  }

  /**
   * `DoMovement` + `CheckGrounded`: after the caller has moved and collided, report
   * the result. Grounded resets the jump counter and pins vy to -gravity·dt so the
   * character keeps pressing into the floor (and walks down slopes/steps).
   */
  finishMove(grounded: boolean, hitCeiling: boolean, dt: number): void {
    if (hitCeiling && this.vy > 0) this.vy = 0;
    this.grounded = grounded;
    if (grounded) {
      this.jumpCount = 0;
      this.vy = -this.tuning.gravity * dt;
      this.lastGroundedTime = this.time;
    }
  }

  private bufferJump(): void {
    this.remainingJumpBuffer = this.tuning.jumpBufferTime;
    this.hasBufferedJump = true;
  }

  private updateBufferedJump(dt: number): void {
    if (!this.hasBufferedJump) return;
    this.remainingJumpBuffer -= dt;
    if (this.remainingJumpBuffer <= 0) this.clearBufferedJump();
  }

  clearBufferedJump(): void {
    this.remainingJumpBuffer = this.tuning.jumpBufferTime;
    this.hasBufferedJump = false;
    this.readyToUseBufferedJump = false;
  }
}
