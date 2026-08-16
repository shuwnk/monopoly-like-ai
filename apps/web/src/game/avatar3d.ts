import * as THREE from "three";
import { HATS, type Avatar, type HatId } from "./avatars.js";

// A slim low-poly HUMANOID mascot (Pummel-Party style), rigged as a jointed body:
// hips and shoulders pivot, knees and elbows bend under them, the head sits on its
// own neck pivot and the scarf trails. `animateChar` drives the whole thing from
// velocity, so a character walks, strafes, backpedals, banks into turns and lands
// on bent knees instead of swinging like a pendulum.
export type BodyMat = THREE.MeshStandardMaterial | THREE.MeshToonMaterial;

// Per-character animation state. Lives on the rig so animateChar stays a pure
// function of (rig, motion, dt) — nothing for callers to thread through.
interface AnimState {
  moveT: number; // 0 idle → 1 running, eased (kills the pop when you start/stop)
  airT: number; // 0 grounded → 1 airborne
  land: number; // landing compression impulse, decays
  wasGrounded: boolean;
  lean: number; // torso pitch from acceleration
  bank: number; // torso roll from turning / strafing
  twist: number; // torso yaw, lagged behind the stride
  armX: [number, number]; // shoulder angles, eased so the arms carry inertia
  tail: number; // scarf swing, lags the body
  aim: number; // eased weapon-carry blend
  prevF: number; // last forward speed (for acceleration)
  prevYaw: number; // last facing (for turn rate)
  dirF: number; // eased local movement direction, forward component
  dirR: number; // …and rightward, so a strafe doesn't snap into a forward stride
}

export interface Char3D {
  group: THREE.Group;
  hit: THREE.Mesh[];
  tint: BodyMat;
  pelvis: THREE.Group; // carries the legs AND the torso, so the whole body rides the stride
  legs: [THREE.Group, THREE.Group]; // hip pivots
  shins: [THREE.Group, THREE.Group]; // knee pivots (children of legs)
  feet: [THREE.Mesh, THREE.Mesh]; // ankles, kept level with the floor
  arms: [THREE.Group, THREE.Group]; // shoulder pivots
  fores: [THREE.Group, THREE.Group]; // elbow pivots (children of arms)
  hands: [THREE.Mesh, THREE.Mesh];
  head: THREE.Group; // neck pivot
  tail: THREE.Group; // scarf pivot (secondary motion)
  upper: THREE.Group;
  phase: number;
  anim: AnimState;
}

// how far up the body the neck sits; head parts are positioned relative to it
const NECK_Y = 1.45;
// leg segment lengths, used to work out how far the pelvis must drop for the
// planted foot to actually reach the floor (a straight leg swung out front is
// shorter, vertically, than one standing under you)
const HIP_Y = 0.72;
const THIGH = 0.3; // hip → knee
const SHIN = 0.365; // knee → sole
const REACH = THIGH + SHIN; // fully extended leg

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

  // everything below the waist AND above it hangs off the pelvis, so raising or
  // dropping it moves the whole body as one mass
  const pelvis = new THREE.Group();
  g.add(pelvis);
  const upper = new THREE.Group();
  pelvis.add(upper);
  const addU = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    upper.add(m);
    return m;
  };

  // ── legs: hip → thigh → knee → shin → foot ──
  const legs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  const feet: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.16, HIP_Y, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.2, 3, 6), bodyMat);
    thigh.position.y = -0.16;
    thigh.castShadow = true;

    const knee = new THREE.Group();
    knee.position.y = -0.3;
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.2, 3, 6), bodyMat);
    shin.position.y = -0.14;
    shin.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.36), dark);
    foot.position.set(0, -0.3, 0.08);
    foot.castShadow = true;
    knee.add(shin, foot);

    hip.add(thigh, knee);
    pelvis.add(hip);
    legs.push(hip);
    shins.push(knee);
    feet.push(foot);
  }

  // ── torso + belly ──
  const torso = addU(new THREE.CapsuleGeometry(0.28, 0.42, 4, 8), bodyMat, 0, 1.08, 0);
  torso.scale.set(1, 1, 0.8);
  addU(new THREE.SphereGeometry(0.2, 8, 6), bellyMat, 0, 1.02, 0.2).scale.set(1, 1.2, 0.5);

  // ── arms: shoulder → upper arm → elbow → forearm → hand ──
  const arms: THREE.Group[] = [];
  const fores: THREE.Group[] = [];
  const hands: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.34, 1.22, 0.04);
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.16, 3, 6), bodyMat);
    upperArm.position.y = -0.14;
    upperArm.castShadow = true;

    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.16, 3, 6), bodyMat);
    forearm.position.y = -0.12;
    forearm.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 6), dark);
    hand.position.set(0, -0.26, 0.04);
    elbow.add(forearm, hand);

    sh.add(upperArm, elbow);
    sh.rotation.x = -0.3;
    upper.add(sh);
    arms.push(sh);
    fores.push(elbow);
    hands.push(hand);
  }

  // ── head on its own neck pivot, so it can stay level while the torso works ──
  const head = new THREE.Group();
  head.position.set(0, NECK_Y, 0);
  upper.add(head);
  const addH = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y - NECK_Y, z);
    m.castShadow = cast;
    head.add(m);
    return m;
  };

  const skull = addH(new THREE.SphereGeometry(0.42, 9, 7), bodyMat, 0, 1.72, 0.02);
  skull.scale.set(1, 1.02, 1.02);
  addH(new THREE.BoxGeometry(0.3, 0.24, 0.24), bellyMat, 0, 1.6, 0.38).rotation.x = 0.05;
  const mask = addH(new THREE.BoxGeometry(0.9, 0.26, 0.7), dark, 0, 1.8, 0.04);
  mask.rotation.x = 0.06;
  const visor = addH(new THREE.BoxGeometry(0.86, 0.07, 0.02), accMat, 0, 1.86, 0.44, false);
  visor.rotation.x = 0.06;
  for (const s of [-1, 1]) {
    addH(new THREE.SphereGeometry(0.11, 8, 8), white, s * 0.17, 1.8, 0.42, false);
    addH(new THREE.SphereGeometry(0.055, 8, 8), mk("#141414", 0.3), s * 0.17, 1.8, 0.52, false);
  }

  skull.userData.isHead = true; // shots here count as headshots

  buildFeature(head, av, accMat, bodyMat);
  if (av.hat) buildHat(head, av.hat, mk);

  // ── scarf: collar on the chest, tails on a pivot so they trail the body ──
  const collar = addU(new THREE.TorusGeometry(0.26, 0.09, 6, 12), accMat, 0, 1.4, 0);
  collar.rotation.x = Math.PI / 2;
  const tail = new THREE.Group();
  tail.position.set(0.04, 1.35, -0.2);
  upper.add(tail);
  const addT = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx: number): void => {
    const m = new THREE.Mesh(geo, accMat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    tail.add(m);
  };
  addT(new THREE.BoxGeometry(0.26, 0.5, 0.06), -0.02, -0.25, -0.08, -0.25);
  addT(new THREE.BoxGeometry(0.24, 0.5, 0.06), 0.02, -0.67, -0.14, 0.15);

  // optional inverted-hull outline so this character pops against a busy background
  // (used to tint enemies hot so they read at any distance / any lighting)
  if (opts?.outline !== undefined) {
    const oMat = new THREE.MeshBasicMaterial({ color: opts.outline, side: THREE.BackSide });
    for (const m of [torso, skull]) {
      const o = new THREE.Mesh(m.geometry, oMat);
      o.scale.setScalar(1.09);
      m.add(o); // child, so it tracks the body; not in the hit list so it won't affect raycasts
    }
  }

  return {
    group: g,
    hit: [torso, skull],
    tint: bodyMat,
    pelvis,
    legs: [legs[0]!, legs[1]!],
    shins: [shins[0]!, shins[1]!],
    feet: [feet[0]!, feet[1]!],
    arms: [arms[0]!, arms[1]!],
    fores: [fores[0]!, fores[1]!],
    hands: [hands[0]!, hands[1]!],
    head,
    tail,
    upper,
    phase: Math.random() * 6,
    anim: {
      moveT: 0,
      airT: 0,
      land: 0,
      wasGrounded: true,
      lean: 0,
      bank: 0,
      twist: 0,
      armX: [-0.3, -0.3],
      tail: 0,
      aim: 0,
      prevF: 0,
      prevYaw: 0,
      dirF: 1,
      dirR: 0,
    },
  };
}

// What the character is doing this frame. All optional: with none of it, the rig
// animates exactly as a forward-running character, which is what a caller that
// only knows a scalar speed wants.
export interface CharMotion {
  /** world-space planar velocity — lets the legs stride sideways/backwards */
  vx?: number;
  vz?: number;
  /** false while airborne: legs tuck, and touching down plays a landing compression */
  grounded?: boolean;
  /** 0..1 — bring both hands up onto a held weapon instead of swinging them freely */
  aim?: number;
}

const damp = (cur: number, to: number, rate: number, dt: number): number => cur + (to - cur) * Math.min(1, dt * rate);

// Drive the body from horizontal speed (units/sec) and, when the caller has it,
// the velocity vector — so strafing shuffles sideways instead of moonwalking.
export function animateChar(c: Char3D, speed: number, dt: number, motion?: CharMotion): void {
  const a = c.anim;
  const step = Math.min(dt, 0.05); // a long frame must not fling the body

  // ── where the movement is going, in the body's own frame ──
  // the barn's basis: forward = (sin yaw, 0, cos yaw), right = (-cos yaw, 0, sin yaw)
  const yaw = c.group.rotation.y;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  let dirF = 1;
  let dirR = 0;
  if (motion && (motion.vx !== undefined || motion.vz !== undefined)) {
    const vx = motion.vx ?? 0;
    const vz = motion.vz ?? 0;
    const len = Math.hypot(vx, vz);
    if (len > 0.25) {
      dirF = (vx * sy + vz * cy) / len;
      dirR = (-vx * cy + vz * sy) / len;
    } else {
      dirF = a.dirF; // too slow to have a direction — hold the last one rather than snapping
      dirR = a.dirR;
    }
  }
  a.dirF = damp(a.dirF, dirF, 9, step);
  a.dirR = damp(a.dirR, dirR, 9, step);

  // ── blend between idle and locomotion instead of switching ──
  const moving = Math.min(1, Math.max(0, (speed - 0.35) / 1.6));
  a.moveT = damp(a.moveT, moving, moving > a.moveT ? 8 : 6, step); // spin up fast, wind down softer
  const w = a.moveT;

  // ── airborne / landing ──
  const grounded = motion?.grounded ?? true;
  if (grounded && !a.wasGrounded) a.land = 1;
  a.wasGrounded = grounded;
  a.airT = damp(a.airT, grounded ? 0 : 1, grounded ? 12 : 9, step);
  a.land = Math.max(0, a.land - step * 4.5);
  const landPop = Math.sin(a.land * Math.PI) * a.land; // quick dip that eases back out

  // ── stride clock: cadence rises with speed; a slow sway keeps an idle alive ──
  c.phase += step * (3.4 + speed * 0.72) * w + step * 1.5 * (1 - w);
  if (c.phase > Math.PI * 200) c.phase -= Math.PI * 200; // keep the float small

  const amp = (0.3 + Math.min(0.42, speed * 0.055)) * w; // stride length grows with speed
  const strideF = a.dirF;
  const strideR = a.dirR;

  // ── legs: hip swings along the travel direction, knee bends only while swinging ──
  for (let i = 0; i < 2; i++) {
    const ph = c.phase + (i === 0 ? 0 : Math.PI);
    const sw = Math.sin(ph);
    const pass = Math.cos(ph); // >0 while this leg is swinging through
    const hip = c.legs[i]!;
    const knee = c.shins[i]!;
    const foot = c.feet[i]!;

    // fore-aft stride, plus a lateral scissor when the movement is sideways
    const swing = -sw * amp * strideF;
    const side = -sw * amp * 0.5 * strideR;
    // in the air the legs tuck under; on landing they absorb
    const tuck = a.airT * 0.55;
    const hipX = swing * (1 - a.airT) - tuck * 0.7;
    // the knee only cycles while actually walking — scaled by w, or a standing
    // character would pump its knees on the spot
    const kneeSwing = Math.max(0, pass) ** 1.3 * (0.55 + amp * 0.7) * w;
    const kneeX = kneeSwing * (1 - a.airT) + a.airT * 1.15 + landPop * 0.8 + 0.06;

    hip.rotation.x = damp(hip.rotation.x, hipX, 22, step);
    hip.rotation.z = damp(hip.rotation.z, side * (1 - a.airT) + (i === 0 ? 0.03 : -0.03), 20, step);
    knee.rotation.x = damp(knee.rotation.x, kneeX, 22, step);
    // ankle keeps the sole roughly level with the floor instead of pointing wherever the leg does
    foot.rotation.x = damp(foot.rotation.x, -(hip.rotation.x + knee.rotation.x) * 0.55 + a.airT * 0.3, 18, step);
  }

  // ── pelvis: ride the legs instead of bobbing on a guessed sine ──
  // A leg swung out in front reaches less far down than one standing straight under
  // you, so the hips have to drop for that foot to touch. Measuring the reach of the
  // more-extended leg and dropping by the shortfall gives the real gait bob for free:
  // the body rises over the planted leg and sinks at double support, and the foot
  // stays on the floor instead of skating above it.
  let reach = 0;
  for (let i = 0; i < 2; i++) {
    const hipA = c.legs[i]!.rotation.x;
    const kneeA = c.shins[i]!.rotation.x;
    reach = Math.max(reach, THIGH * Math.cos(hipA) + SHIN * Math.cos(hipA + kneeA));
  }
  // The landing dip is NOT applied here — it comes from the knees folding (below),
  // which this reach calculation already turns into a drop. Adding it twice would
  // punch the feet through the floor on every touchdown.
  const plant = (reach - REACH) * (1 - a.airT); // ≤ 0: how far the hips must sink
  c.pelvis.position.y = damp(c.pelvis.position.y, plant + a.airT * 0.06, 24, step);
  // a touch of independent torso float on top, so the upper body isn't welded to the hips
  c.upper.position.y = damp(c.upper.position.y, -plant * 0.25 - landPop * 0.05, 14, step);

  // ── torso: counter-twist to the stride, lean into acceleration, bank into turns ──
  const fSpeed = speed * a.dirF;
  const accel = (fSpeed - a.prevF) / Math.max(step, 1e-4);
  a.prevF = fSpeed;
  let dYaw = yaw - a.prevYaw;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  a.prevYaw = yaw;
  const turnRate = dYaw / Math.max(step, 1e-4);

  const leanTo = Math.max(-0.16, Math.min(0.26, 0.03 + speed * 0.012 * a.dirF + accel * 0.012)) * w + 0.02;
  const bankTo = Math.max(-0.2, Math.min(0.2, turnRate * 0.06 + a.dirR * 0.1 * w));
  const twistTo = -Math.sin(c.phase) * amp * 0.26 * a.dirF;
  a.lean = damp(a.lean, leanTo, 6, step);
  a.bank = damp(a.bank, bankTo, 7, step);
  a.twist = damp(a.twist, twistTo, 16, step); // lagging the stride is what makes it read as mass
  c.upper.rotation.set(a.lean, a.twist, a.bank);

  // ── head stays level and keeps facing the way the body is going ──
  c.head.rotation.y = damp(c.head.rotation.y, -a.twist * 0.75, 10, step);
  c.head.rotation.x = damp(c.head.rotation.x, -a.lean * 0.7 + landPop * 0.12, 9, step);
  c.head.rotation.z = damp(c.head.rotation.z, -a.bank * 0.55, 9, step);

  // ── arms: counter-swing with elbow bend, eased so they carry a little inertia ──
  // With a weapon up, both hands come forward onto it and only breathe with the
  // stride — arms that swing freely straight past the gun the character is meant
  // to be holding is the detail that reads most like a puppet.
  a.aim = damp(a.aim, motion?.aim ?? 0, 8, step);
  const ai = a.aim;
  for (let i = 0; i < 2; i++) {
    // same phase term as the leg on this side, but added rather than subtracted —
    // so this arm swings back as that leg swings forward, the way a body walks
    const sw = Math.sin(c.phase + (i === 0 ? 0 : Math.PI));
    const idleX = -0.34 + Math.sin(c.phase * 0.9 + i) * 0.04;
    const runX = -0.42 - amp * 0.35 + sw * amp * 0.8 * a.dirF;
    const freeX = (idleX * (1 - w) + runX * w) * (1 - a.airT) + a.airT * -1.25;
    // Shouldered: the gun hand (i=1) is posed so it actually lands on the weapon the
    // barn holds out at (0.3, 1.02, 0.52); the off hand braces forward beside it. The
    // arm is too short to reach across for a two-handed grip, so it doesn't pretend to.
    const heldX = (i === 1 ? -0.7 : -0.55) + sw * amp * 0.12 + landPop * 0.1;
    a.armX[i] = damp(a.armX[i]!, freeX * (1 - ai) + heldX * ai, 13, step); // the lag IS the inertia
    const arm = c.arms[i]!;
    arm.rotation.x = a.armX[i]!;
    const freeZ = (i === 0 ? 1 : -1) * (0.12 + Math.abs(sw) * 0.07 * w) - a.bank * 0.4;
    const heldZ = i === 0 ? 0.34 : -0.1;
    arm.rotation.z = damp(arm.rotation.z, freeZ * (1 - ai) + heldZ * ai, 12, step);
    // elbow folds more as the arm swings forward, and stays softly bent at rest
    const freeFold = -(0.22 + Math.max(0, -a.armX[i]! - 0.3) * 0.85 + w * 0.25 + a.airT * 0.5 + landPop * 0.3);
    const heldFold = -(1.05 + landPop * 0.25);
    c.fores[i]!.rotation.x = damp(c.fores[i]!.rotation.x, freeFold * (1 - ai) + heldFold * ai, 14, step);
  }

  // ── scarf trails the body: lifted by speed, thrown wide by turns ──
  a.tail = damp(a.tail, -0.1 - speed * 0.055 - w * 0.12, 5, step);
  c.tail.rotation.x = a.tail + Math.sin(c.phase * 2) * 0.05 * w;
  c.tail.rotation.z = damp(c.tail.rotation.z, -turnRate * 0.1, 4, step);
}

// Cosmetic headgear, parented to the head group so it rides every head turn and
// bob. Sits above the skull (radius 0.42 centred at y=1.72 world). Decoration
// only: no mesh here is in the hit list, so it can never absorb a shot.
function buildHat(head: THREE.Group, hat: HatId, mk: (color: string, rough?: number) => BodyMat): void {
  const color = HATS.find((h) => h.id === hat)?.color ?? "#e53935";
  const mat = mk(color, 0.65);
  const dark = mk("#22262e", 0.5);
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y - NECK_Y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
    head.add(mesh);
    return mesh;
  };

  switch (hat) {
    case "cap":
      put(new THREE.SphereGeometry(0.44, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0, 2.0, 0);
      put(new THREE.BoxGeometry(0.62, 0.05, 0.42), mat, 0, 1.99, 0.42); // peak
      break;
    case "helmet":
      put(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0, 1.96, 0);
      put(new THREE.TorusGeometry(0.5, 0.05, 6, 14, Math.PI), mk("#eceff1", 0.4), 0, 1.98, 0, Math.PI / 2);
      break;
    case "crown": {
      put(new THREE.CylinderGeometry(0.4, 0.42, 0.16, 10), mat, 0, 2.06, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        put(new THREE.ConeGeometry(0.07, 0.2, 6), mat, Math.cos(a) * 0.33, 2.2, Math.sin(a) * 0.33);
      }
      break;
    }
    case "party":
      put(new THREE.ConeGeometry(0.3, 0.66, 10), mat, 0, 2.28, 0);
      put(new THREE.SphereGeometry(0.1, 8, 6), mk("#fff59d", 0.5), 0, 2.62, 0);
      break;
    case "cans":
      put(new THREE.TorusGeometry(0.44, 0.055, 6, 14, Math.PI), dark, 0, 2.02, 0, Math.PI / 2);
      for (const s of [-1, 1]) put(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 10), mat, s * 0.44, 1.78, 0).rotation.z = Math.PI / 2;
      break;
    case "band":
      put(new THREE.CylinderGeometry(0.44, 0.44, 0.15, 12), mat, 0, 1.94, 0);
      put(new THREE.ConeGeometry(0.1, 0.3, 6), mat, 0.4, 1.9, -0.24, Math.PI / 2); // trailing knot
      break;
  }
}

function buildFeature(parent: THREE.Group, av: Avatar, acc: THREE.Material, body: THREE.Material): void {
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y - NECK_Y, z);
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
