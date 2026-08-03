import * as THREE from "three";
import type { Avatar } from "../game/avatars.js";
import { animateChar, buildAvatar3D, type Char3D } from "../game/avatar3d.js";

// A render-only avatar wrapper. Grid games and netcode clients drive avatars from
// their own sim/snapshots — they don't need the barn's physics controller, just a
// puppet they can place, face, and animate. (The full CharacterController with
// gravity/collision lives with the shooter migration later.)

export interface Puppet {
  rig: Char3D;
  group: THREE.Group;
  /** shortest-arc turn toward a heading (radians); pass dt to smooth, omit to snap */
  faceYaw(yaw: number, dt?: number): void;
  /** drive the walk/idle cycle from horizontal speed (units/sec) */
  animate(speed: number, dt: number): void;
  dispose(): void;
}

export function createPuppet(scene: THREE.Scene, avatar: Avatar, opts?: { outline?: THREE.ColorRepresentation; toon?: boolean }): Puppet {
  const rig = buildAvatar3D(avatar, { ...(opts?.outline !== undefined ? { outline: opts.outline } : {}), ...(opts?.toon ? { toon: true } : {}) });
  scene.add(rig.group);
  return {
    rig,
    group: rig.group,
    faceYaw(yaw, dt) {
      if (dt === undefined) {
        rig.group.rotation.y = yaw;
        return;
      }
      let d = yaw - rig.group.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rig.group.rotation.y += d * Math.min(1, dt * 16);
    },
    animate(speed, dt) {
      animateChar(rig, speed, dt);
    },
    dispose() {
      scene.remove(rig.group);
      rig.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
        }
      });
    },
  };
}
