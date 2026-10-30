// A port of Pummel Party's `ThirdPersonCamera`: a tight over-the-shoulder rig that
// orbits the player root — the capsule centre, ~0.95 above the feet (the character mesh
// is parented at y −0.954 in the player prefab) — pulls in as you look up or down, sits
// off the right shoulder, and slides in off walls then eases back out. Looking level,
// the camera therefore sits about a head above the character and the crosshair line
// runs through its head, with the body in the lower half of the frame. Pure maths — the
// caller supplies the raycast and applies the result to its camera.
//
// Source: ~/Projects/rea-work/pummel-party/decompiled/Assembly-CSharp/ThirdPersonCamera.cs
// (RotateCamera / UpdateCamera) and FINDINGS.md §4 + §8.
//
// Frame: right-handed, +y up, forward = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw)
// — the same basis the minigames and `animateChar` use. Pitch is positive looking DOWN,
// as in the original (`m_zRotation`), so its formulas port verbatim.

export interface CameraTuning {
  /** distance behind the pivot when looking level (`m_maxCameraDistance`) */
  maxDistance: number;
  /** height above the pivot when looking level (`m_cameraOffsetY`) */
  offsetY: number;
  /** sideways offset toward the right shoulder (`m_cameraOffsetZ`) */
  offsetZ: number;
  /** how far past the orbit distance the look-at point sits (`m_lookForwardOffset`) */
  lookForwardOffset: number;
  /** multiplies the pitch-driven drop of the look-at point (`m_lookScale`) */
  lookScale: number;
  /** gap kept between the camera and a wall it hit (`m_wallOffset`) */
  wallOffset: number;
  /** units/s the camera eases back out after a wall (`m_cameraDRecoverySpeed`) */
  distanceRecovery: number;
  pitchMin: number;
  pitchMax: number;
  /** degrees per mouse unit = mouse sensitivity × rotation speed (0.06 × 3) */
  degreesPerPixel: number;
  /** collider height; the pivot is its centre and the pitch rise scales with its half */
  characterHeight: number;
}

// Barn Brawl's player prefab (extracted/minigames/barnbrawl.json → ThirdPersonCamera):
// m_maxCameraDistance 2, m_cameraOffsetY 1. The rest are the code defaults from
// ThirdPersonCamera.cs: offsetZ 0.5, lookForward 1, lookScale 1.9, wallOffset 0.2,
// recovery 5/s, pitch ±89°, mouse 0.06 × y/z rotation speed 3. Character height 1.9:
// the CharacterController is centred on the root with the mesh 0.954 below it.
export const BARN_BRAWL_CAMERA: CameraTuning = {
  maxDistance: 2,
  offsetY: 1,
  offsetZ: 0.5,
  lookForwardOffset: 1,
  lookScale: 1.9,
  wallOffset: 0.2,
  distanceRecovery: 5,
  pitchMin: -89,
  pitchMax: 89,
  degreesPerPixel: 0.06 * 3,
  characterHeight: 1.9,
};

/** vertical field of view every Simple-mode / minigame camera uses (FINDINGS.md §8) */
export const PUMMEL_FOV = 70;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Distance along the ray (from `origin` in unit direction `dir`) to the first solid
 * thing within `maxDist`, or null if nothing is in the way.
 */
export type RaycastFn = (origin: Vec3, dir: Vec3, maxDist: number) => number | null;

export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
  /** true while the camera is pulled in by a wall */
  didHitWall: boolean;
}

const DEG = Math.PI / 180;

export class ThirdPersonCamera {
  /** degrees; the forward direction is (sin yaw, 0, cos yaw) */
  yaw = 0;
  /** degrees, positive looks down; `InitializeCamera` starts at 5 */
  pitch = 5;
  private currentDistance: number;
  private didHitWall = false;

  constructor(public readonly tuning: CameraTuning) {
    this.currentDistance = tuning.maxDistance;
  }

  /** radians, for a mesh's `rotation.y` */
  get yawRad(): number {
    return this.yaw * DEG;
  }

  forward(): Vec3 {
    const r = this.yawRad;
    return { x: Math.sin(r), y: 0, z: Math.cos(r) };
  }

  right(): Vec3 {
    const r = this.yawRad;
    return { x: -Math.cos(r), y: 0, z: Math.sin(r) };
  }

  /** `RotateCamera` with browser mouse deltas: +dx turns right, +dy (mouse down) looks down. */
  rotate(dx: number, dy: number): void {
    const k = this.tuning.degreesPerPixel;
    // turning right is a clockwise yaw in this frame, hence the sign
    this.yaw = (this.yaw - dx * k) % 360;
    this.pitch = Math.max(this.tuning.pitchMin, Math.min(this.tuning.pitchMax, this.pitch + dy * k));
  }

  /** respawn: `ZRotation = 5; YRotation = spawn facing` */
  resetTo(yawDeg: number): void {
    this.yaw = yawDeg;
    this.pitch = 5;
    this.currentDistance = this.tuning.maxDistance;
    this.didHitWall = false;
  }

  /**
   * `UpdateCamera`. `pivot` is the player root (capsule centre). `pitchKick` is an extra, transient
   * pitch in degrees (recoil) that isn't written back into the state.
   */
  update(pivot: Vec3, raycast: RaycastFn, dt: number, pitchKick = 0): CameraPose {
    const t = this.tuning;
    const pitch = Math.max(t.pitchMin, Math.min(t.pitchMax, this.pitch + pitchKick));
    const num = t.characterHeight / 2 + t.offsetY;
    const range = t.pitchMax - t.pitchMin;
    // -num at full look-up … +num at full look-down
    const rise = num * (-1 + (pitch - t.pitchMin) / (range / 2));
    // the orbit shortens toward 5 % as the view tilts away from level
    let value = 1;
    if (pitch > 0) value = 1 - pitch / t.pitchMax;
    else if (pitch < 0) value = 1 - Math.abs(pitch) / Math.abs(t.pitchMin);
    value = Math.max(0.05, Math.min(1, value));
    const dist = t.maxDistance * value;

    const f = this.forward();
    const r = this.right();
    let px = pivot.x - f.x * dist + r.x * t.offsetZ;
    let py = pivot.y + t.offsetY + rise;
    let pz = pivot.z - f.z * dist + r.z * t.offsetZ;
    const ox = px - pivot.x;
    const oy = py - pivot.y;
    const oz = pz - pivot.z;
    const magnitude = Math.hypot(ox, oy, oz);
    const dir = { x: ox / magnitude, y: oy / magnitude, z: oz / magnitude };

    const hit = raycast(pivot, dir, this.currentDistance + t.wallOffset + 0.05);
    if (hit !== null) {
      if (hit >= magnitude) {
        this.currentDistance = magnitude;
        this.didHitWall = false;
      } else {
        this.currentDistance = hit - t.wallOffset;
        this.didHitWall = true;
      }
    } else if (this.currentDistance < magnitude && this.didHitWall) {
      this.currentDistance = Math.max(0, Math.min(magnitude, this.currentDistance + t.distanceRecovery * dt));
    } else {
      this.currentDistance = magnitude;
      this.didHitWall = false;
    }
    px = pivot.x + this.currentDistance * dir.x;
    py = pivot.y + this.currentDistance * dir.y;
    pz = pivot.z + this.currentDistance * dir.z;

    const ahead = dist + t.lookForwardOffset * value;
    return {
      position: { x: px, y: py, z: pz },
      lookAt: { x: px + f.x * ahead, y: py - rise * t.lookScale, z: pz + f.z * ahead },
      didHitWall: this.didHitWall,
    };
  }
}
