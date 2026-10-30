import * as THREE from "three";
import type { Avatar } from "../game/avatars.js";
import { animateChar } from "../game/avatar3d.js";
import { BREAKING_BLOCKS, crateCenter, type CrateDrop } from "../game/breakingBlocks.js";
import { BREAKING_BLOCKS_CAMERA } from "../game/followCamera.js";
import { createStage, type Stage } from "./stage.js";
import { createPuppet, type Puppet } from "./character.js";

// The Breaking Blocks arena renderer: 100 crates over a lava pit, lit and framed the way the
// extracted scene is (scenes_scenes_boxdrop_scene.bundle: warm sun (1, 0.67, 0.32) × 0.8 from
// (58.9°, −50.8°), dark red ambient, background (0.19, 0.30, 0.48), no fog, FOV 65, the
// CameraShake rig). The caller owns the simulation and hands over normalised state each
// frame; this only draws crates, lava, dressing, puppets and the camera. Our own meshes and
// textures throughout — the reference's assets are never used.

export interface BBFighterView {
  id: number;
  av: Avatar;
  x: number; // feet, world
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number; // facing, radians
  grounded: boolean;
  isYou: boolean;
  dead: boolean; // ragdolling: tumble
  gone: boolean; // out of sight: hide
}

export interface BBSceneState {
  crates: readonly CrateDrop[]; // row-major: index = x · 10 + y, like `BoxController.m_boxes`
  fighters: readonly BBFighterView[];
  camera: { x: number; y: number; z: number };
  time: number;
}

export interface BBScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** `CameraShake.AddShake`: add trauma (0.25 per wave) */
  addShake(strength: number): void;
  draw(state: BBSceneState, dt: number): void;
  dispose(): void;
}

const LAVA_Y = -6.2; // the lava surface: just under the −6 kill line

// `CameraShake`: type Both, damping 1, noise scale 15, max yaw/pitch/roll 15°, max offset 1
const SHAKE = { damping: 1, noiseScale: 15, maxAngleDeg: 15, maxOffset: 1 };

// a cheap smooth noise in [-1, 1] for the shake (Perlin in the reference)
const noise1 = (t: number, seed: number): number => (Math.sin(t * 1.7 + seed) + Math.sin(t * 2.3 + seed * 1.3) * 0.6 + Math.sin(t * 3.1 + seed * 0.7) * 0.4) / 2;

function crateTexture(kind: "wood" | "dark" | "metal"): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const base = kind === "wood" ? "#b07a3c" : kind === "dark" ? "#7a4f28" : "#6c7079";
  const line = kind === "metal" ? "#444851" : kind === "wood" ? "#7d5324" : "#51331a";
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  // planks
  g.fillStyle = line;
  for (let i = 1; i < 4; i++) g.fillRect(0, i * 32 - 1, 128, 3);
  // grain / rivets
  g.fillStyle = kind === "metal" ? "#9aa0ab" : "rgba(0,0,0,0.12)";
  if (kind === "metal") {
    for (let x = 12; x < 128; x += 26) for (let y = 12; y < 128; y += 26) g.fillRect(x, y, 4, 4);
  } else {
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 10 + Math.random() * 30, 1);
  }
  // frame
  g.strokeStyle = line;
  g.lineWidth = 8;
  g.strokeRect(0, 0, 128, 128);
  // diagonal brace
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(6, 122);
  g.lineTo(122, 6);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function lavaTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#ff6a1a";
  g.fillRect(0, 0, 256, 256);
  // dark crust plates with glowing cracks between them
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 10 + Math.random() * 22;
    const grd = g.createRadialGradient(x, y, r * 0.3, x, y, r);
    grd.addColorStop(0, "#3a1208");
    grd.addColorStop(0.8, "#5a1c08");
    grd.addColorStop(1, "rgba(255,120,30,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 25; i++) {
    g.fillStyle = "rgba(255,230,120,0.5)";
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}

export function createBreakingBlocksScene(canvas: HTMLCanvasElement): BBScene {
  const stage: Stage = createStage(canvas, {
    width: canvas.width,
    height: canvas.height,
    background: "#314d79", // Camera background (0.192, 0.302, 0.475)
    fog: null, // RenderSettings.fog off
    fov: BREAKING_BLOCKS_CAMERA.fov,
    // Directional light (1, 0.67, 0.316) × 0.8 travelling along (−0.40, −0.86, 0.33)
    sun: { color: "#ffab51", intensity: 1.7, pos: [0.401 * 34, 0.856 * 34, -0.327 * 34], extent: 24 },
    // ambient (0.096, 0.044, 0.044) from above, the lava's glow from below
    hemi: { sky: "#3a2228", ground: "#c2521c", intensity: 0.55 },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.05,
  });
  const { scene, camera, renderer } = stage;
  stage.sun.shadow.camera.far = 90;

  // ── crates ──
  const crateGeo = new THREE.BoxGeometry(BREAKING_BLOCKS.scale, BREAKING_BLOCKS.scale, BREAKING_BLOCKS.scale);
  const texes = { wood: crateTexture("wood"), dark: crateTexture("dark"), metal: crateTexture("metal") };
  const crateMats = [
    new THREE.MeshStandardMaterial({ map: texes.wood, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ map: texes.dark, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: texes.metal, roughness: 0.55, metalness: 0.35 }),
  ];
  const n = BREAKING_BLOCKS.dimensions;
  const crates: THREE.Mesh[] = [];
  const crateGroup = new THREE.Group();
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++) {
      // `BoxDropBox.Init`: the four corners get the plain crate, the rest a random variant,
      // and every crate is spun by a random multiple of 90°
      const corner = (x === 0 || x === n - 1) && (y === 0 || y === n - 1);
      const mat = corner ? crateMats[0]! : crateMats[Math.random() < 0.7 ? (Math.random() < 0.5 ? 0 : 1) : 2]!;
      const m = new THREE.Mesh(crateGeo, mat);
      const c = crateCenter(x, y);
      m.position.set(c.x, c.y, c.z);
      m.userData.spin = (Math.floor(Math.random() * 4) * Math.PI) / 2;
      m.castShadow = true;
      m.receiveShadow = true;
      crateGroup.add(m);
      crates.push(m);
    }
  scene.add(crateGroup);
  const restQuat = new THREE.Quaternion();
  const dropQuat = new THREE.Quaternion();

  // ── lava and the pit ──
  const lavaTex = lavaTexture();
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshBasicMaterial({ map: lavaTex, color: "#ffb070" }));
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = LAVA_Y;
  scene.add(lava);
  // a hot haze just above the lava so the crates read as hanging over heat
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshBasicMaterial({ color: "#ff7a2a", transparent: true, opacity: 0.18, depthWrite: false }));
  haze.rotation.x = -Math.PI / 2;
  haze.position.y = LAVA_Y + 0.6;
  scene.add(haze);
  const lavaLight = new THREE.PointLight("#ff6a1a", 60, 60, 1.6);
  lavaLight.position.set(0, LAVA_Y + 2, 0);
  scene.add(lavaLight);

  // `FlowRocks`: slabs of crust drifting down the flow at 0.1 u/s and wrapping (Effect_LavaFlow)
  const rockMat = new THREE.MeshStandardMaterial({ color: "#2b1a14", roughness: 1, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  interface FlowRock { mesh: THREE.Mesh }
  const flowRocks: FlowRock[] = [];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.position.set((Math.random() - 0.5) * 60, LAVA_Y - 0.1, (Math.random() - 0.5) * 60);
    m.scale.set(1.5 + Math.random() * 2, 0.5 + Math.random() * 0.4, 1.5 + Math.random() * 2);
    m.rotation.y = Math.random() * Math.PI;
    m.receiveShadow = true;
    scene.add(m);
    flowRocks.push({ mesh: m });
  }

  // the pit walls and the horizon dressing: dark rock banks around the pit, a ruined wall and
  // tower on the left and a boulder field on the right (the `Static` group, roughly placed)
  const bankMat = new THREE.MeshStandardMaterial({ color: "#3a2a26", roughness: 1, flatShading: true });
  const dressing = new THREE.Group();
  const bank = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): void => {
    const m = new THREE.Mesh(rockGeo, bankMat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    m.receiveShadow = true;
    m.castShadow = true;
    dressing.add(m);
  };
  bank(22, -6, 16, 7, 4, 6, 0.4);
  bank(29, -5.5, 8, 6, 5, 5, 1.1);
  bank(26, -7, -4, 5, 3, 5, 0.2);
  bank(-22, -6.5, 4, 6, 3.5, 6, 0.7);
  bank(-27, -5, 12, 7, 5, 6, 1.9);
  bank(-24, -7, -8, 5, 3, 5, 0.3);
  bank(4, -7.5, 24, 9, 4, 6, 0.1);
  bank(-8, -7, 26, 8, 3.5, 6, 2.2);
  const stoneMat = new THREE.MeshStandardMaterial({ color: "#5a5a66", roughness: 0.95, flatShading: true });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(9, 7, 1.6), stoneMat);
  wall.position.set(-21, -3.5, 7);
  wall.rotation.y = -0.53; // SM_Bld_Castle_Wall_01 at yaw −30°
  wall.castShadow = true;
  dressing.add(wall);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3, 11, 8), stoneMat);
  tower.position.set(-17.4, -1.6, 7.8); // the stacked SM_Bld_Castle_Tower_01 pieces
  tower.castShadow = true;
  dressing.add(tower);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 3, 8), new THREE.MeshStandardMaterial({ color: "#7a3a2a", roughness: 0.9, flatShading: true }));
  roof.position.set(-17.4, 5.4, 7.8);
  dressing.add(roof);
  scene.add(dressing);

  // ── fighters ──
  interface Ent {
    puppet: Puppet;
    marker: THREE.Mesh | undefined;
    spin: number;
  }
  const ents = new Map<number, Ent>();
  const markerGeo = new THREE.ConeGeometry(0.26, 0.5, 4);
  const markerMat = new THREE.MeshBasicMaterial({ color: "#ffe14d" });

  // ── camera ──
  camera.fov = BREAKING_BLOCKS_CAMERA.fov;
  camera.near = 0.3;
  camera.far = 400;
  camera.updateProjectionMatrix();
  const look = new THREE.Vector3();
  const pitch = (BREAKING_BLOCKS_CAMERA.pitchDeg * Math.PI) / 180;
  let trauma = 0;
  let clock = 0;

  const draw = (state: BBSceneState, dt: number): void => {
    clock += dt;

    // crates: rest pose + the drop routine's offset and rotation
    for (let i = 0; i < crates.length; i++) {
      const m = crates[i]!;
      const d = state.crates[i];
      const x = Math.floor(i / n);
      const y = i % n;
      const c = crateCenter(x, y);
      restQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, m.userData.spin as number);
      if (!d || d.phase === "idle") {
        m.position.set(c.x, c.y, c.z);
        m.quaternion.copy(restQuat);
        m.visible = true;
        continue;
      }
      m.position.set(c.x + d.off.x, c.y + d.off.y, c.z + d.off.z);
      dropQuat.set(d.rot.x, d.rot.y, d.rot.z, d.rot.w);
      m.quaternion.copy(dropQuat).multiply(restQuat);
      m.visible = m.position.y > LAVA_Y - 3; // gone under the lava
    }

    // lava flow
    lavaTex.offset.y -= dt * 0.012;
    (haze.material as THREE.MeshBasicMaterial).opacity = 0.15 + Math.sin(clock * 1.3) * 0.03;
    lavaLight.intensity = 55 + Math.sin(clock * 2.1) * 6;
    for (const r of flowRocks) {
      r.mesh.position.z -= dt * 0.1;
      if (r.mesh.position.z < -34) {
        r.mesh.position.z = 34;
        r.mesh.position.x = (Math.random() - 0.5) * 60; // `m_randomOffset` ±20 on reset
      }
    }

    // fighters
    const seen = new Set<number>();
    for (const f of state.fighters) {
      seen.add(f.id);
      let e = ents.get(f.id);
      if (!e) {
        const puppet = createPuppet(scene, f.av, { outline: f.isYou ? "#ffd23f" : "#141428" });
        puppet.group.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = true;
        });
        let marker: THREE.Mesh | undefined;
        if (f.isYou) {
          marker = new THREE.Mesh(markerGeo, markerMat);
          marker.rotation.x = Math.PI;
          scene.add(marker);
        }
        e = { puppet, marker, spin: 0 };
        ents.set(f.id, e);
      }
      const g = e.puppet.group;
      g.visible = !f.gone;
      if (e.marker) e.marker.visible = !f.gone && !f.dead;
      if (f.gone) continue;
      g.position.set(f.x, f.y, f.z);
      if (f.dead) {
        // `SpawnRagdoll`: the body tumbles away; a spin stands in for the ragdoll
        e.spin += dt * 7;
        g.rotation.set(e.spin, f.yaw, e.spin * 0.6);
        e.puppet.animate(0, dt);
        continue;
      }
      g.rotation.set(0, f.yaw, 0);
      // the rig strides along the velocity and plays its landing compression off `grounded`
      animateChar(e.puppet.rig, Math.hypot(f.vx, f.vz), dt, { vx: f.vx, vz: f.vz, grounded: f.grounded });
      if (e.marker) e.marker.position.set(f.x, f.y + 3.1 + Math.sin(state.time * 3) * 0.14, f.z);
    }
    for (const [id, e] of [...ents]) {
      if (seen.has(id)) continue;
      e.puppet.dispose();
      if (e.marker) scene.remove(e.marker);
      ents.delete(id);
    }

    // camera: the follow rig's position, pitched down, plus the trauma shake
    trauma = Math.max(0, trauma - dt * SHAKE.damping);
    const s = trauma * trauma;
    camera.position.set(state.camera.x, state.camera.y, state.camera.z);
    look.set(state.camera.x, state.camera.y - Math.sin(pitch), state.camera.z + Math.cos(pitch));
    camera.lookAt(look);
    if (s > 0.0001) {
      const t = clock * SHAKE.noiseScale;
      const a = (SHAKE.maxAngleDeg * Math.PI) / 180;
      camera.rotation.x += noise1(t, 1) * a * s;
      camera.rotation.y += noise1(t, 2) * a * s;
      camera.rotation.z += noise1(t, 3) * a * s;
      camera.position.x += noise1(t, 4) * SHAKE.maxOffset * s;
      camera.position.y += noise1(t, 5) * SHAKE.maxOffset * s;
    }

    renderer.render(scene, camera);
  };

  return {
    scene,
    camera,
    renderer,
    addShake(strength) {
      trauma = Math.min(1, trauma + strength);
    },
    draw,
    dispose() {
      for (const e of ents.values()) {
        e.puppet.dispose();
        if (e.marker) scene.remove(e.marker);
      }
      ents.clear();
      markerGeo.dispose();
      markerMat.dispose();
      for (const t of Object.values(texes)) t.dispose();
      lavaTex.dispose();
      stage.dispose();
    },
  };
}
