import * as THREE from "three";
import type { Avatar } from "./avatars.js";

// A slim low-poly HUMANOID mascot (Pummel-Party style), now RIGGED: legs and arms
// pivot from hip/shoulder and an "upper" group bobs, so `animateChar` can drive a
// walk cycle. Built from the picked 2D avatar's palette + feature.
export type BodyMat = THREE.MeshStandardMaterial | THREE.MeshToonMaterial;
export interface Char3D {
  group: THREE.Group;
  hit: THREE.Mesh[];
  tint: BodyMat;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  upper: THREE.Group;
  phase: number;
}

const flat = (color: string, rough = 0.8): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });

// shared 3-band cel ramp for toon-shaded builds (Brawl Stars look)
let _ramp: THREE.DataTexture | null = null;
const ramp = (): THREE.DataTexture => {
  if (!_ramp) {
    _ramp = new THREE.DataTexture(new Uint8Array([88, 168, 255]), 3, 1, THREE.RedFormat);
    _ramp.minFilter = THREE.NearestFilter;
    _ramp.magFilter = THREE.NearestFilter;
    _ramp.needsUpdate = true;
  }
  return _ramp;
};

export function buildAvatar3D(av: Avatar, opts?: { outline?: THREE.ColorRepresentation; toon?: boolean }): Char3D {
  const g = new THREE.Group();
  const toon = opts?.toon ?? false;
  const mk = (color: string, rough = 0.8): BodyMat => {
    if (!toon) return flat(color, rough);
    return new THREE.MeshToonMaterial({ color, gradientMap: ramp() });
  };
  const bodyMat = mk(av.body);
  const bellyMat = mk(av.belly, 0.85);
  const accMat = mk(av.accent, 0.7);
  const dark = mk("#1b1b1e", 0.5);
  const white = mk("#f2f2f2", 0.4);

  const upper = new THREE.Group();
  g.add(upper);
  const addU = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    upper.add(m);
    return m;
  };

  // ── legs (pivot at the hip) ──
  const legs: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const lg = new THREE.Group();
    lg.position.set(s * 0.16, 0.72, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.48, 3, 6), bodyMat);
    leg.position.y = -0.28;
    leg.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.36), dark);
    foot.position.set(0, -0.6, 0.08);
    foot.castShadow = true;
    lg.add(leg, foot);
    g.add(lg);
    legs.push(lg);
  }

  // ── torso + belly ──
  const torso = addU(new THREE.CapsuleGeometry(0.28, 0.42, 4, 8), bodyMat, 0, 1.08, 0);
  torso.scale.set(1, 1, 0.8);
  addU(new THREE.SphereGeometry(0.2, 8, 6), bellyMat, 0, 1.02, 0.2).scale.set(1, 1.2, 0.5);

  // ── arms (pivot at the shoulder, angled forward) ──
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const ag = new THREE.Group();
    ag.position.set(s * 0.34, 1.22, 0.04);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 3, 6), bodyMat);
    arm.position.set(0, -0.22, 0.05);
    arm.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 6), dark);
    hand.position.set(0, -0.42, 0.16);
    ag.add(arm, hand);
    ag.rotation.x = -0.5;
    upper.add(ag);
    arms.push(ag);
  }

  // ── head + face ──
  const head = addU(new THREE.SphereGeometry(0.42, 9, 7), bodyMat, 0, 1.72, 0.02);
  head.scale.set(1, 1.02, 1.02);
  addU(new THREE.BoxGeometry(0.3, 0.24, 0.24), bellyMat, 0, 1.6, 0.38).rotation.x = 0.05;
  const mask = addU(new THREE.BoxGeometry(0.9, 0.26, 0.7), dark, 0, 1.8, 0.04);
  mask.rotation.x = 0.06;
  const visor = addU(new THREE.BoxGeometry(0.86, 0.07, 0.02), accMat, 0, 1.86, 0.44, false);
  visor.rotation.x = 0.06;
  for (const s of [-1, 1]) {
    addU(new THREE.SphereGeometry(0.11, 8, 8), white, s * 0.17, 1.8, 0.42, false);
    addU(new THREE.SphereGeometry(0.055, 8, 8), mk("#141414", 0.3), s * 0.17, 1.8, 0.52, false);
  }

  head.userData.isHead = true; // shots here count as headshots

  buildFeature(upper, av, accMat, bodyMat);

  // ── scarf: collar + trailing tails ──
  const collar = addU(new THREE.TorusGeometry(0.26, 0.09, 6, 12), accMat, 0, 1.4, 0);
  collar.rotation.x = Math.PI / 2;
  addU(new THREE.BoxGeometry(0.26, 0.5, 0.06), accMat, 0.02, 1.1, -0.28).rotation.x = -0.25;
  addU(new THREE.BoxGeometry(0.24, 0.5, 0.06), accMat, 0.06, 0.68, -0.34).rotation.x = 0.15;

  // optional inverted-hull outline so this character pops against a busy background
  // (used to tint enemies hot so they read at any distance / any lighting)
  if (opts?.outline !== undefined) {
    const oMat = new THREE.MeshBasicMaterial({ color: opts.outline, side: THREE.BackSide });
    for (const m of [torso, head]) {
      const o = new THREE.Mesh(m.geometry, oMat);
      o.scale.setScalar(1.09);
      m.add(o); // child, so it tracks the body; not in the hit list so it won't affect raycasts
    }
  }

  return { group: g, hit: [torso, head], tint: bodyMat, legs: [legs[0]!, legs[1]!], arms: [arms[0]!, arms[1]!], upper, phase: Math.random() * 6 };
}

// drive a natural walk/run cycle from horizontal speed (units/sec)
export function animateChar(c: Char3D, speed: number, dt: number): void {
  const moving = speed > 0.4;
  // step frequency scales with speed (walk → run); a slow breathing idle otherwise
  c.phase += dt * (moving ? 4.2 + speed * 1.1 : 1.7);
  const s = Math.sin(c.phase);

  if (moving) {
    const amp = Math.min(0.9, 0.34 + speed * 0.12); // a real stride, growing with speed
    // legs stride opposite from the hip
    c.legs[0].rotation.x = s * amp;
    c.legs[1].rotation.x = -s * amp;
    // arms counter-swing to the legs, with a little outward flare so they clear the body
    const arm = amp * 0.85;
    c.arms[0].rotation.x = -0.4 + s * arm;
    c.arms[1].rotation.x = -0.4 - s * arm;
    c.arms[0].rotation.z = 0.14 + Math.abs(s) * 0.06;
    c.arms[1].rotation.z = -0.14 - Math.abs(s) * 0.06;
    // vertical bob: the body rises at each footfall (twice per stride), never sideways
    c.upper.position.y = Math.abs(s) * amp * 0.13;
    // torso COUNTER-ROTATES with the stride — the natural twist, not a side-to-side tilt
    c.upper.rotation.y = -s * amp * 0.2;
    c.upper.rotation.z = 0;
    c.upper.rotation.x = Math.min(0.18, 0.05 + speed * 0.02); // lean into the run
  } else {
    // idle: gentle breathing + a relaxed arm sway so the avatar is never frozen
    const b = Math.sin(c.phase);
    c.legs[0].rotation.x += (0 - c.legs[0].rotation.x) * Math.min(1, dt * 8);
    c.legs[1].rotation.x += (0 - c.legs[1].rotation.x) * Math.min(1, dt * 8);
    c.arms[0].rotation.x = -0.42 + b * 0.05;
    c.arms[1].rotation.x = -0.42 - b * 0.05;
    c.arms[0].rotation.z = 0.12;
    c.arms[1].rotation.z = -0.12;
    c.upper.position.y = b * 0.02;
    c.upper.rotation.y = Math.sin(c.phase * 0.5) * 0.04; // slow weight shift / look-around
    c.upper.rotation.z = 0;
    c.upper.rotation.x = b * 0.015;
  }
}

function buildFeature(parent: THREE.Group, av: Avatar, acc: THREE.Material, body: THREE.Material): void {
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = true;
    parent.add(m);
  };
  const cone = (r: number, h: number): THREE.ConeGeometry => new THREE.ConeGeometry(r, h, 8);
  switch (av.feat) {
    case "ears":
      put(cone(0.15, 0.4), body, -0.26, 2.02, 0.02, -0.35);
      put(cone(0.15, 0.4), body, 0.26, 2.02, 0.02, 0.35);
      break;
    case "horns":
      put(cone(0.12, 0.42), acc, -0.28, 2.0, 0.05, -0.55);
      put(cone(0.12, 0.42), acc, 0.28, 2.0, 0.05, 0.55);
      break;
    case "flame":
      put(cone(0.14, 0.5), acc, 0, 2.12, 0);
      put(cone(0.1, 0.34), acc, -0.2, 2.02, 0);
      put(cone(0.1, 0.34), acc, 0.2, 2.02, 0);
      break;
    case "spikes":
      for (let i = -1; i <= 1; i++) put(cone(0.09, 0.3), acc, i * 0.22, 2.05, 0);
      break;
    case "crest":
      for (let i = -1; i <= 1; i++) put(cone(0.08, 0.36 - Math.abs(i) * 0.08), acc, i * 0.15, 2.05, 0);
      break;
    case "antenna":
      put(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), acc, 0, 2.18, 0);
      put(new THREE.SphereGeometry(0.11, 10, 8), acc, 0, 2.42, 0);
      break;
    case "leaf":
      put(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 8), acc, 0, 2.1, 0);
      put(new THREE.SphereGeometry(0.14, 10, 8), acc, 0.15, 2.3, 0, 0.6);
      break;
    case "robot":
      put(new THREE.BoxGeometry(0.28, 0.16, 0.28), acc, 0, 2.06, 0);
      put(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), acc, 0, 2.22, 0);
      put(new THREE.SphereGeometry(0.09, 10, 8), acc, 0, 2.34, 0);
      break;
  }
}
