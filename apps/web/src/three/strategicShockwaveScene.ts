import * as THREE from "three";
import type { Avatar } from "../game/avatars.js";
import { animateChar } from "../game/avatar3d.js";
import { FLOOR, SHOCKWAVE, SPOKES, type Buff, type WheelNode } from "../game/strategicShockwave.js";
import { STRATEGIC_SHOCKWAVE_CAMERA } from "../game/followCamera.js";
import { createStage, type Stage } from "./stage.js";
import { createPuppet, type Puppet } from "./character.js";

// The Strategic Shockwave arena renderer: a stone wheel hanging in a cave over water, lit the
// way the extracted scene is (scenes_scenes_bomber_scene.bundle: teal ambient
// (0.12, 0.28, 0.28), a dim blue directional (0.57, 0.75, 1) × 0.2, eight green point lights
// (0.55, 0.85, 0.32) and six yellow lanterns (1, 0.81, 0.18) around the wheel, camera
// background (0.19, 0.30, 0.47), no fog, FOV 40). The caller owns the simulation and hands
// over normalised state each frame; this only draws. Our own meshes and textures throughout —
// the reference's assets are never used.

export interface SSFighterView {
  id: number;
  av: Avatar;
  x: number; // feet, world
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  isYou: boolean;
  dead: boolean; // ragdolling: tumble
  gone: boolean; // out of sight: hide
}

export interface SSBombView {
  node: number;
  /** seconds left on the fuse */
  fuse: number;
  color: string;
}

export interface SSBlastView {
  node: number;
  /** seconds since the blast */
  age: number;
}

export interface SSBuffView {
  x: number;
  z: number;
  kind: Exclude<Buff, "none">;
}

export interface SSSceneState {
  blocked: readonly boolean[];
  /** nodes a live bomb will hit: the skull markers */
  threatened: readonly boolean[];
  bombs: readonly SSBombView[];
  blasts: readonly SSBlastView[];
  buffs: readonly SSBuffView[];
  fighters: readonly SSFighterView[];
  camera: { x: number; y: number; z: number };
  time: number;
}

export interface SSScene {
  addShake(strength: number): void;
  draw(state: SSSceneState, dt: number): void;
  dispose(): void;
}

export const BLAST_LIFE = 0.45; // how long a blast column stays on screen (ours)
const PUPPET_SCALE = 0.55; // the rig is ~1.9 tall; the reference body is a 1-unit capsule
const WATER_Y = -2.3; // the scene's Water planes sit 2.3 under the floor
const SLAB = 0.7; // floor thickness
const SHAKE = { damping: 1.4, noiseScale: 15, maxAngleDeg: 4, maxOffset: 0.5 };

const noise1 = (t: number, seed: number): number => (Math.sin(t * 1.7 + seed) + Math.sin(t * 2.3 + seed * 1.3) * 0.6 + Math.sin(t * 3.1 + seed * 0.7) * 0.4) / 2;

function crateTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#a8743a";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? "#9a6932" : "#b47e42";
    g.fillRect(0, i * 26, 128, 24);
  }
  g.strokeStyle = "#5f3d1c";
  g.lineWidth = 12;
  g.strokeRect(6, 6, 116, 116);
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(10, 10);
  g.lineTo(118, 118);
  g.moveTo(118, 10);
  g.lineTo(10, 118);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skullTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = "#ff3b2f";
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#ff3b2f";
  g.beginPath();
  g.arc(64, 56, 26, 0, Math.PI * 2);
  g.fill();
  g.fillRect(48, 70, 32, 22);
  g.fillStyle = "#1a0605";
  g.beginPath();
  g.arc(54, 56, 7, 0, Math.PI * 2);
  g.arc(74, 56, 7, 0, Math.PI * 2);
  g.fill();
  g.fillRect(56, 80, 4, 12);
  g.fillRect(68, 80, 4, 12);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStrategicShockwaveScene(canvas: HTMLCanvasElement, nodes: readonly WheelNode[]): SSScene {
  const stage: Stage = createStage(canvas, {
    width: canvas.width,
    height: canvas.height,
    background: "#0b1620",
    fog: null,
    fov: STRATEGIC_SHOCKWAVE_CAMERA.fov,
    // the scene's directional is only 0.2; ours carries the shading the baked cave light did
    sun: { color: "#9ec4ff", intensity: 1.25, pos: [-6, 22, -8], extent: 16 },
    hemi: { sky: "#6fb0ac", ground: "#1d3f3c", intensity: 1.1 },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.15,
  });
  const { scene, camera, renderer } = stage;

  // ── the wheel: hub, two ring corridors, eight spokes ──
  const stoneMat = new THREE.MeshStandardMaterial({ color: "#6f7480", roughness: 0.95, flatShading: true });
  const slab = (mesh: THREE.Mesh): void => {
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(FLOOR.hubRadius, FLOOR.hubRadius - 0.25, SLAB, 32), stoneMat);
  hub.position.y = -SLAB / 2;
  slab(hub);
  for (const [inner, outer] of FLOOR.rings) {
    // a lathe of the corridor's cross-section: flat top, slightly undercut sides
    // (outer edge first: a lathe's faces look outward when the profile climbs on the outside)
    const profile = [new THREE.Vector2(outer - 0.2, -SLAB), new THREE.Vector2(outer, 0), new THREE.Vector2(inner, 0), new THREE.Vector2(inner + 0.2, -SLAB)];
    slab(new THREE.Mesh(new THREE.LatheGeometry(profile, 72), stoneMat));
  }
  for (let k = 0; k < SPOKES; k++) {
    const a = (k * Math.PI * 2) / SPOKES;
    const m = new THREE.Mesh(new THREE.BoxGeometry(FLOOR.spokeHalfWidth * 2, SLAB, FLOOR.spokeLength - 0.4), stoneMat);
    m.position.set((Math.sin(a) * (FLOOR.spokeLength - 0.4)) / 2, -SLAB / 2 - 0.004, (Math.cos(a) * (FLOOR.spokeLength - 0.4)) / 2);
    m.rotation.y = a;
    slab(m);
  }
  // a plate on every node, so the places a bomb can sit read at a glance
  const plateGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.03, 8);
  const plateMat = new THREE.MeshStandardMaterial({ color: "#8a909c", roughness: 0.8, flatShading: true });
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, nodes.length);
  const mtx = new THREE.Matrix4();
  nodes.forEach((n, i) => {
    mtx.makeRotationY(n.rot + Math.PI / 8);
    mtx.setPosition(n.x, 0.012, n.z);
    plates.setMatrixAt(i, mtx);
  });
  plates.receiveShadow = true;
  scene.add(plates);

  // ── the cave: water below, rock around, lights the colours of the scene's ──
  const water = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: "#1f6f78", roughness: 0.25, metalness: 0.3, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);
  const rockMat = new THREE.MeshStandardMaterial({ color: "#3b4450", roughness: 1, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rock = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): void => {
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    scene.add(m);
  };
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r = 15.5 + (i % 3) * 2.2;
    rock(Math.sin(a) * r, WATER_Y + 0.4 + (i % 4) * 0.5, Math.cos(a) * r, 3.2 + (i % 3), 2.4 + (i % 5) * 0.7, 3 + (i % 2) * 1.5, a);
  }
  // the pillar the hub stands on, and stubs under the ring
  rock(0, WATER_Y + 0.2, 0, 1.9, 2.6, 1.9);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    rock(Math.sin(a) * 5.9, WATER_Y + 0.3, Math.cos(a) * 5.9, 1.1, 2.3, 1.1, a);
    rock(Math.sin(a) * 9.1, WATER_Y + 0.3, Math.cos(a) * 9.1, 1.3, 2.3, 1.3, a);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + 0.4;
    const green = new THREE.PointLight("#8dd851", 26, 13, 1.8);
    green.position.set(Math.sin(a) * 12.5, 2.2, Math.cos(a) * 12.5);
    scene.add(green);
  }
  const lantern = new THREE.PointLight("#ffce2f", 14, 9, 1.8);
  lantern.position.set(0, 3.4, 0);
  scene.add(lantern);

  // ── crates (`Blocker`, 1.25 across) ──
  const crateTex = crateTexture();
  const crateSize = SHOCKWAVE.crateHalf * 2 * 0.9;
  const crateGeo = new THREE.BoxGeometry(crateSize, crateSize, crateSize);
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 });
  const crates = nodes.map((n) => {
    const m = new THREE.Mesh(crateGeo, crateMat);
    m.position.set(n.x, crateSize / 2, n.z);
    m.rotation.y = n.rot;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  });

  // ── skull markers on threatened nodes (`SkullIndicator`) ──
  const skullTex = skullTexture();
  const skullGeo = new THREE.PlaneGeometry(1.05, 1.05);
  const skulls = nodes.map((n) => {
    const m = new THREE.Mesh(skullGeo, new THREE.MeshBasicMaterial({ map: skullTex, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(n.x, 0.05, n.z);
    m.visible = false;
    scene.add(m);
    return m;
  });

  // ── pools: bombs, blasts, buffs ──
  const bombGeo = new THREE.SphereGeometry(0.36, 14, 10);
  const fuseGeo = new THREE.SphereGeometry(0.09, 6, 5);
  const bandGeo = new THREE.TorusGeometry(0.37, 0.05, 6, 18);
  const bombPool = Array.from({ length: 48 }, () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bombGeo, new THREE.MeshStandardMaterial({ color: "#16181d", roughness: 0.45, metalness: 0.3 }));
    body.castShadow = true;
    const spark = new THREE.Mesh(fuseGeo, new THREE.MeshBasicMaterial({ color: "#ffd45a" }));
    spark.position.set(0.12, 0.4, 0);
    const band = new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color: "#fff" }));
    band.rotation.x = Math.PI / 2;
    g.add(body, spark, band);
    g.visible = false;
    scene.add(g);
    return { g, body, spark, band };
  });
  const blastGeo = new THREE.BoxGeometry(SHOCKWAVE.blastHalf * 2, 1.5, SHOCKWAVE.blastHalf * 2);
  const blastPool = Array.from({ length: 160 }, () => {
    const m = new THREE.Mesh(blastGeo, new THREE.MeshBasicMaterial({ color: "#ffa23a", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    return m;
  });
  const blastLight = new THREE.PointLight("#ff9a3a", 0, 16, 1.6);
  blastLight.position.set(0, 2, 0);
  scene.add(blastLight);
  // BuffBombRange glows (1, 0.35, 0), BuffBombCount (0.43, 0.79, 1)
  const buffColor: Record<Exclude<Buff, "none">, string> = { range: "#ff5a00", count: "#6dc9ff" };
  const buffGeo = { range: new THREE.OctahedronGeometry(0.3, 0), count: new THREE.SphereGeometry(0.26, 10, 8) };
  const buffPool = Array.from({ length: 40 }, () => {
    const m = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(buffGeo.range, new THREE.MeshStandardMaterial({ color: "#fff", emissive: "#000", emissiveIntensity: 1.3, roughness: 0.4, flatShading: true }));
    m.visible = false;
    scene.add(m);
    return m;
  });

  // ── fighters ──
  interface Ent {
    puppet: Puppet;
    marker: THREE.Mesh | undefined;
    spin: number;
  }
  const ents = new Map<number, Ent>();
  const markerGeo = new THREE.ConeGeometry(0.2, 0.4, 4);
  const markerMat = new THREE.MeshBasicMaterial({ color: "#ffe14d" });

  // ── camera ──
  camera.fov = STRATEGIC_SHOCKWAVE_CAMERA.fov;
  camera.near = 0.3;
  camera.far = 300;
  camera.updateProjectionMatrix();
  const look = new THREE.Vector3();
  const pitch = (STRATEGIC_SHOCKWAVE_CAMERA.pitchDeg * Math.PI) / 180;
  let trauma = 0;
  let clock = 0;

  const draw = (state: SSSceneState, dt: number): void => {
    clock += dt;

    for (let i = 0; i < nodes.length; i++) {
      crates[i]!.visible = state.blocked[i] === true;
      const s = skulls[i]!;
      const mat = s.material as THREE.MeshBasicMaterial;
      // `SkullIndicatorEnable` / `Disable`: fade in and out rather than pop
      const want = state.threatened[i] && !state.blocked[i] ? 0.75 + Math.sin(clock * 9) * 0.2 : 0;
      mat.opacity += (want - mat.opacity) * Math.min(1, dt * 14);
      s.visible = mat.opacity > 0.02;
    }

    let bn = 0;
    for (const b of state.bombs) {
      const e = bombPool[bn++];
      if (!e) break;
      const n = nodes[b.node]!;
      // the pulse quickens as the fuse runs down
      const urgency = 1 - Math.max(0, Math.min(1, b.fuse / SHOCKWAVE.fuse));
      const pulse = 1 + Math.sin(clock * (7 + urgency * 22)) * (0.05 + urgency * 0.09);
      e.g.visible = true;
      e.g.position.set(n.x, 0.36, n.z);
      e.g.scale.setScalar(pulse);
      (e.band.material as THREE.MeshBasicMaterial).color.set(b.color);
      (e.body.material as THREE.MeshStandardMaterial).emissive.setRGB(urgency * 0.55, urgency * 0.08, 0);
      e.spark.scale.setScalar(0.8 + Math.sin(clock * 30) * 0.3);
    }
    for (let j = bn; j < bombPool.length; j++) bombPool[j]!.g.visible = false;

    let fn = 0;
    let glow = 0;
    for (const f of state.blasts) {
      const m = blastPool[fn++];
      if (!m) break;
      const n = nodes[f.node]!;
      const k = Math.max(0, 1 - f.age / BLAST_LIFE);
      m.visible = true;
      m.position.set(n.x, 0.75 * (0.4 + k * 0.6), n.z);
      m.rotation.y = n.rot;
      m.scale.set(0.75 + k * 0.25, 0.4 + k * 0.6, 0.75 + k * 0.25);
      (m.material as THREE.MeshBasicMaterial).opacity = k * 0.9;
      glow = Math.max(glow, k);
    }
    for (let j = fn; j < blastPool.length; j++) blastPool[j]!.visible = false;
    blastLight.intensity = glow * 40;

    let un = 0;
    for (const b of state.buffs) {
      const m = buffPool[un++];
      if (!m) break;
      m.visible = true;
      m.geometry = buffGeo[b.kind];
      m.position.set(b.x, 0.5 + Math.sin(clock * 3 + b.x) * 0.09, b.z);
      m.rotation.y = clock * 2.2;
      m.material.color.set(buffColor[b.kind]);
      m.material.emissive.set(buffColor[b.kind]);
    }
    for (let j = un; j < buffPool.length; j++) buffPool[j]!.visible = false;

    const seen = new Set<number>();
    for (const f of state.fighters) {
      seen.add(f.id);
      let e = ents.get(f.id);
      if (!e) {
        const puppet = createPuppet(scene, f.av, { outline: f.isYou ? "#ffd23f" : "#141428" });
        puppet.group.scale.setScalar(PUPPET_SCALE);
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
        e.spin += dt * 9; // `SpawnRagdoll`: a spin stands in for the ragdoll
        g.rotation.set(e.spin, f.yaw, e.spin * 0.6);
        e.puppet.animate(0, dt);
        continue;
      }
      g.rotation.set(0, f.yaw, 0);
      // the rig is scaled down, so its stride sees the speed scaled back up
      animateChar(e.puppet.rig, Math.hypot(f.vx, f.vz) / PUPPET_SCALE, dt, { vx: f.vx / PUPPET_SCALE, vz: f.vz / PUPPET_SCALE, grounded: true });
      if (e.marker) e.marker.position.set(f.x, f.y + 1.75 + Math.sin(state.time * 3) * 0.1, f.z);
    }
    for (const [id, e] of [...ents]) {
      if (seen.has(id)) continue;
      e.puppet.dispose();
      if (e.marker) scene.remove(e.marker);
      ents.delete(id);
    }

    trauma = Math.max(0, trauma - dt * SHAKE.damping);
    const s = trauma * trauma;
    camera.position.set(state.camera.x, state.camera.y, state.camera.z);
    look.set(state.camera.x, state.camera.y - Math.sin(pitch), state.camera.z + Math.cos(pitch));
    camera.lookAt(look);
    if (s > 0.0001) {
      const t = clock * SHAKE.noiseScale;
      const a = (SHAKE.maxAngleDeg * Math.PI) / 180;
      camera.rotation.x += noise1(t, 1) * a * s;
      camera.rotation.z += noise1(t, 3) * a * s;
      camera.position.x += noise1(t, 4) * SHAKE.maxOffset * s;
      camera.position.y += noise1(t, 5) * SHAKE.maxOffset * s;
    }

    renderer.render(scene, camera);
  };

  return {
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
      crateTex.dispose();
      skullTex.dispose();
      buffGeo.count.dispose();
      buffGeo.range.dispose();
      plates.dispose();
      stage.dispose();
    },
  };
}
