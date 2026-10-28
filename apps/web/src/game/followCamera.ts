// Pummel Party's `CameraFollow` (Square mode) — the fixed, pitched camera the top-down
// minigames share: it looks at the centroid of the alive players, each tracked through a
// 50 Hz 0.4 lerp, and slides its start position by at most ±maxMove/2 across the follow
// area (`CalculateTarget`), easing there with `lerp(pos, target, 1 − 0.6^dt)`.
// Source: ~/Projects/rea-work/pummel-party/decompiled/Assembly-CSharp/CameraFollow.cs;
// the Breaking Blocks numbers are the CameraParent in scenes_scenes_boxdrop_scene.bundle.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FollowCameraTuning {
  /** the rig's resting position (`m_startPosition`) */
  start: Vec3;
  /** the camera's downward pitch */
  pitchDeg: number;
  /** vertical field of view */
  fov: number;
  /** `m_maxXMoveDist` / `m_maxZMoveDist`: the full travel across the area */
  maxXMoveDist: number;
  maxZMoveDist: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  followDeadPlayers: boolean;
}

// CameraParent at (−0.4, 14.096, −10.376) (MinigameRoot scale 0.8 applied), pitched 62.818°,
// Camera FOV 65; CameraFollow Square, area x ±7.5 / z ±10, max move 3 / 3, dead players ignored.
export const BREAKING_BLOCKS_CAMERA: FollowCameraTuning = {
  start: { x: -0.4, y: 14.096, z: -10.376 },
  pitchDeg: 62.818,
  fov: 65,
  maxXMoveDist: 3,
  maxZMoveDist: 3,
  minX: -7.5,
  maxX: 7.5,
  minZ: -10,
  maxZ: 10,
  followDeadPlayers: false,
};

export interface FollowTarget {
  x: number;
  y: number;
  z: number;
  dead: boolean;
}

const FIXED_STEP = 0.02; // Unity's default FixedUpdate
const TARGET_LERP = 0.4; // `Vector3.Lerp(lerpPos, position, 0.4f)` per fixed step
const EASE_BASE = 0.6; // `1f - Mathf.Pow(0.6f, dt)`

export class FollowCamera {
  readonly position: Vec3;
  private readonly lerpPos: Vec3[] = [];
  private fixedAcc = 0;
  private lastTarget: Vec3;

  constructor(public readonly tuning: FollowCameraTuning) {
    this.position = { ...tuning.start };
    this.lastTarget = { ...tuning.start };
  }

  /** `AddTarget`: start tracking a fighter and snap the rig onto the new centroid */
  addTarget(p: Vec3): void {
    this.lerpPos.push({ x: p.x, y: p.y, z: p.z });
  }

  /** `AddTarget`'s `SnapToTarget`: jump straight to the target of the current fighters */
  snap(targets: readonly FollowTarget[]): void {
    const t = this.calculateTarget(targets);
    this.position.x = t.x;
    this.position.y = this.tuning.start.y;
    this.position.z = t.z;
  }

  /** forget the fighters (match restart) */
  reset(): void {
    this.lerpPos.length = 0;
    this.fixedAcc = 0;
    this.position.x = this.tuning.start.x;
    this.position.y = this.tuning.start.y;
    this.position.z = this.tuning.start.z;
    this.lastTarget = { ...this.tuning.start };
  }

  /** one frame: `FixedUpdate` catches the tracked positions up, `Update` eases the rig */
  update(targets: readonly FollowTarget[], dt: number): Vec3 {
    this.fixedAcc += dt;
    while (this.fixedAcc >= FIXED_STEP) {
      this.fixedAcc -= FIXED_STEP;
      for (let i = 0; i < this.lerpPos.length && i < targets.length; i++) {
        const t = targets[i]!;
        if (t.dead && !this.tuning.followDeadPlayers) continue;
        const l = this.lerpPos[i]!;
        l.x += (t.x - l.x) * TARGET_LERP;
        l.y += (t.y - l.y) * TARGET_LERP;
        l.z += (t.z - l.z) * TARGET_LERP;
      }
    }
    const target = this.calculateTarget(targets);
    const k = 1 - Math.pow(EASE_BASE, dt);
    this.position.x += (target.x - this.position.x) * k;
    this.position.y += (target.y - this.position.y) * k;
    this.position.z += (target.z - this.position.z) * k;
    return this.position;
  }

  /** `CalculateTarget` (Square): the start position slid by the centroid's place in the area */
  calculateTarget(targets: readonly FollowTarget[]): Vec3 {
    const T = this.tuning;
    let n = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < this.lerpPos.length && i < targets.length; i++) {
      if (targets[i]!.dead && !T.followDeadPlayers) continue;
      cx += this.lerpPos[i]!.x;
      cz += this.lerpPos[i]!.z;
      n++;
    }
    if (this.lerpPos.length > 0 && n === 0) return this.lastTarget; // everyone dead: hold
    if (n > 0) {
      cx /= n;
      cz /= n;
    }
    const ux = T.maxX !== T.minX ? Math.min(1, Math.max(0, (cx - T.minX) / (T.maxX - T.minX))) - 0.5 : 0;
    const uz = T.maxZ !== T.minZ ? Math.min(1, Math.max(0, (cz - T.minZ) / (T.maxZ - T.minZ))) - 0.5 : 0;
    this.lastTarget = { x: T.start.x + ux * T.maxXMoveDist, y: T.start.y, z: T.start.z + uz * T.maxZMoveDist };
    return this.lastTarget;
  }

  /** the view direction: pitched down from +z */
  forward(): Vec3 {
    const p = (this.tuning.pitchDeg * Math.PI) / 180;
    return { x: 0, y: -Math.sin(p), z: Math.cos(p) };
  }
}
