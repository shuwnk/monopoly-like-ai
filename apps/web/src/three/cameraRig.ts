import * as THREE from "three";

// Camera helpers for the 3D minigames.
//
// `frameArena` — a fixed, angled whole-arena view for the grid games (Floor Drop,
// Floor Brawl, Bomberman). Deliberately NOT straight-down: a shallow tilt keeps the
// humanoid avatars reading as characters rather than head-dots. It sizes the distance
// from the camera's FOV so the whole arena of the given radius fits in frame.

export function frameArena(
  camera: THREE.PerspectiveCamera,
  opts: { center: THREE.Vector3; radius: number; tiltDeg?: number; yawDeg?: number; margin?: number },
): void {
  const tilt = ((opts.tiltDeg ?? 52) * Math.PI) / 180; // angle above the ground plane
  const yaw = ((opts.yawDeg ?? 16) * Math.PI) / 180; // slight orbit so it's not dead-on
  const fovV = (camera.fov * Math.PI) / 180;
  const dist = (opts.radius / Math.sin(fovV / 2)) * (opts.margin ?? 1.06);
  const off = new THREE.Vector3(Math.cos(tilt) * Math.sin(yaw), Math.sin(tilt), Math.cos(tilt) * Math.cos(yaw)).multiplyScalar(dist);
  camera.position.copy(opts.center).add(off);
  camera.lookAt(opts.center);
  camera.updateProjectionMatrix();
}
