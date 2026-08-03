import * as THREE from "three";
import type { Avatar } from "../game/avatars.js";
import { createStage, type Stage } from "./stage.js";
import { createPuppet, type Puppet } from "./character.js";

// Shared 3D renderer for Floor Drop — driven by normalised per-frame state so BOTH
// the standalone practice sim and the online snapshot client render through it. The
// caller keeps owning the simulation; this only draws tiles + avatars + camera.
//
// The scene owns its own tile animation (warning wobble → accelerating tumble) keyed
// off tile-state TRANSITIONS, so the collapse looks physical regardless of how coarse
// the caller's drop timer is. The `drop` field on the state is accepted but ignored.

export interface FDSceneFighter {
  id: number;
  av: Avatar;
  x: number; // grid column coord (tile-centre based, e.g. 2.5)
  y: number; // grid row coord
  falling: boolean;
  fallT: number; // seconds into the fall
  isYou: boolean;
  air?: number; // hop height while jumping
}
export interface FDSceneHazard {
  x: number; // grid centre
  y: number;
  size: number; // footprint half-extent (tiles)
  warning: boolean; // telegraph phase (not yet falling)
  h: number; // world height of the box above the floor
}
export interface FDSceneState {
  tiles: ArrayLike<number>; // 0 solid · 1 warning · 2 hole
  drop?: ArrayLike<number>; // (ignored — the scene animates the drop itself)
  time: number;
  shake: number;
  fighters: FDSceneFighter[];
  hazards?: FDSceneHazard[];
}
export interface FDScene {
  scene: THREE.Scene;
  draw(state: FDSceneState, dt: number): void;
  dispose(): void;
}

const TOP_A = "#4a86df";
const TOP_B = "#3f74c8";
const WARN_HOT = "#ff5140";
const TILE_FALL = 0.9; // how long a collapsed tile keeps tumbling before it's hidden

export function createFloorDropScene(canvas: HTMLCanvasElement, grid: number, opts?: { fallTime?: number }): FDScene {
  const FALL_TIME = opts?.fallTime ?? 0.6; // avatar fall length (matches the sim)
  const half = grid / 2;

  const stage: Stage = createStage(canvas, {
    width: canvas.width,
    height: canvas.height,
    background: "#0b1030",
    fov: 50, // longer lens — flattens fisheye, and lets the horizon into frame
    fog: { color: "#3a4a90", near: grid * 2.6, far: grid * 5.4 },
    sun: { color: "#ffe6c0", intensity: 1.5, pos: [-grid * 0.5, grid * 1.5, grid * 0.7], extent: grid * 0.9 },
    hemi: { sky: "#bfe0ff", ground: "#3a2c52", intensity: 0.85 },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.12,
  });
  const { scene, camera, renderer } = stage;
  // real shadows (a whole pass over 225 tiles + avatars) are the main cost — blob shadows replace them
  renderer.shadowMap.enabled = false;
  stage.sun.castShadow = false;
  // cool back-rim so avatars separate from the void
  const rim = new THREE.DirectionalLight("#6f8cff", 0.4);
  rim.position.set(grid * 0.6, grid * 0.7, -grid * 0.6);
  scene.add(rim);

  // ── self-contained camera rig: lower 3/4 angle, horizon in frame, dynamic push-in ──
  const camTilt = THREE.MathUtils.degToRad(40);
  const camYaw0 = THREE.MathUtils.degToRad(26);
  const fovV = (camera.fov * Math.PI) / 180;
  const fitDist = (r: number): number => (r / Math.sin(fovV / 2)) * 1.02;
  let rigDist = fitDist(grid * 0.55);
  let rigCx = 0;
  let rigCz = 0;
  let trauma = 0;
  let sceneClock = 0;

  // ── atmosphere: two grids at different depths + drifting motes give the void real depth ──
  const farGrid = new THREE.GridHelper(grid * 4, 30, 0x2a4c86, 0x16233c);
  farGrid.position.y = -26;
  (farGrid.material as THREE.Material).transparent = true;
  (farGrid.material as THREE.Material).opacity = 0.32;
  scene.add(farGrid);
  const farGrid2 = new THREE.GridHelper(grid * 6, 24, 0x1e3a6a, 0x14203a);
  farGrid2.position.y = -48;
  (farGrid2.material as THREE.Material).transparent = true;
  (farGrid2.material as THREE.Material).opacity = 0.16;
  scene.add(farGrid2);

  const moteN = 150;
  const mp = new Float32Array(moteN * 3);
  for (let i = 0; i < moteN; i++) {
    mp[i * 3] = (Math.random() - 0.5) * grid * 2.2;
    mp[i * 3 + 1] = Math.random() * grid * 1.6 - grid * 0.6;
    mp[i * 3 + 2] = (Math.random() - 0.5) * grid * 2.2;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: "#8fb0ff", size: 0.09, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(motes);

  // raised bevel frame so the platform reads as a solid floating object
  const frameMat = new THREE.MeshStandardMaterial({ color: "#28324e", roughness: 0.7, flatShading: true });
  for (const [w, d, x, z] of [
    [grid + 0.5, 0.4, 0, -half - 0.15],
    [grid + 0.5, 0.4, 0, half + 0.15],
    [0.4, grid + 0.5, -half - 0.15, 0],
    [0.4, grid + 0.5, half + 0.15, 0],
  ] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), frameMat);
    b.position.set(x, -0.45, z);
    b.receiveShadow = true;
    scene.add(b);
  }

  // ── sky dome: a dusk gradient behind everything (unlit, unfogged) ──
  const skyTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 256;
    const g = cv.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#e69a5c"); // horizon (uv bottom)
    grd.addColorStop(0.28, "#8a6a9c");
    grd.addColorStop(0.62, "#39406f");
    grd.addColorStop(1, "#141a3a"); // zenith
    g.fillStyle = grd;
    g.fillRect(0, 0, 8, 256);
    return new THREE.CanvasTexture(cv);
  })();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(grid * 3.4, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky);

  // ── slow-drifting cloud puffs + floating background islands for parallax/scale ──
  const puffTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,240,255,0.9)");
    grd.addColorStop(1, "rgba(255,240,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const clouds: THREE.Sprite[] = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
    s.position.set((Math.random() - 0.5) * grid * 4, grid * 0.5 + Math.random() * grid, -grid * (1.2 + Math.random()));
    s.scale.setScalar(grid * (0.5 + Math.random() * 0.5));
    scene.add(s);
    clouds.push(s);
  }
  // low cloud deck BELOW the platform — you look down through it, selling the altitude
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0.2, depthWrite: false, fog: false }));
    s.position.set((Math.random() - 0.5) * grid * 3, -6 - Math.random() * 8, (Math.random() - 0.5) * grid * 3);
    s.scale.setScalar(grid * (0.7 + Math.random() * 0.6));
    scene.add(s);
    clouds.push(s);
  }
  const islandMat = new THREE.MeshStandardMaterial({ color: "#4a4066", roughness: 1, flatShading: true });
  const islandTop = new THREE.MeshStandardMaterial({ color: "#5d7a54", roughness: 1, flatShading: true });
  interface Island { grp: THREE.Group; y0: number; bob: number; phase: number; spin: number; }
  const islands: Island[] = [];
  for (let i = 0; i < 6; i++) {
    const grp = new THREE.Group();
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const rad = grid * (1.5 + Math.random() * 0.8);
    grp.position.set(Math.cos(a) * rad, -grid * (0.2 + Math.random() * 0.5), Math.sin(a) * rad);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(1.4 + Math.random(), 2.2 + Math.random(), 6), islandMat);
    rock.rotation.x = Math.PI; // point down like a floating shard
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.5 + Math.random() * 0.6, 1.3, 0.7, 6), islandTop);
    cap.position.y = 0.5;
    grp.add(rock, cap);
    grp.scale.setScalar(0.7 + Math.random() * 0.8);
    scene.add(grp);
    islands.push({ grp, y0: grp.position.y, bob: 0.4 + Math.random() * 0.4, phase: Math.random() * 6, spin: (Math.random() - 0.5) * 0.3 });
  }

  // ── tiles: one mesh + material each, plus per-tile collapse animation state ──
  // cel ramp shared by all tiles (cheaper per-pixel than PBR, and matches the toon avatars)
  const toonRamp = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
  toonRamp.minFilter = THREE.NearestFilter;
  toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  const tileGeo = new THREE.BoxGeometry(0.94, 0.5, 0.94);
  interface Tile {
    mesh: THREE.Mesh;
    mat: THREE.MeshToonMaterial;
    checker: boolean;
    prev: number; // last frame's state
    fall: number; // >0 once collapsing (drives the tumble)
    spinX: number;
    spinZ: number;
  }
  const tiles: Tile[] = [];
  const tileGroup = new THREE.Group();
  scene.add(tileGroup);
  for (let r = 0; r < grid; r++)
    for (let c = 0; c < grid; c++) {
      const checker = (c + r) % 2 === 0;
      // opaque by default — only a collapsing tile flips to transparent, so the ~220 solid
      // tiles never pay the alpha-blend/sort cost every frame
      const mat = new THREE.MeshToonMaterial({ color: checker ? TOP_A : TOP_B, gradientMap: toonRamp });
      const mesh = new THREE.Mesh(tileGeo, mat);
      mesh.position.set(c + 0.5 - half, -0.25, r + 0.5 - half);
      tileGroup.add(mesh);
      tiles.push({ mesh, mat, checker, prev: 0, fall: 0, spinX: (Math.random() - 0.5) * 8, spinZ: (Math.random() - 0.5) * 8 });
    }

  // ── falling-box hazards: a ground telegraph + the dropping stone ──
  const hazTeleGeo = new THREE.PlaneGeometry(1, 1);
  const hazBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  const hazBoxMat = new THREE.MeshToonMaterial({ color: "#8b8f9c", gradientMap: toonRamp });
  interface Haz { tele: THREE.Mesh; box: THREE.Mesh; }
  const hazPool: Haz[] = Array.from({ length: 10 }, () => {
    const tele = new THREE.Mesh(hazTeleGeo, new THREE.MeshBasicMaterial({ color: "#ff3b3b", transparent: true, opacity: 0.4, depthWrite: false }));
    tele.rotation.x = -Math.PI / 2;
    tele.position.y = 0.08;
    tele.visible = false;
    const box = new THREE.Mesh(hazBoxGeo, hazBoxMat);
    box.visible = false;
    scene.add(tele, box);
    return { tele, box };
  });

  // ── avatar puppets, pooled by fighter id, smoothed world position ──
  const BASE_SCALE = 1.08;
  interface Ent {
    puppet: Puppet;
    wx: number;
    wz: number;
    vx: number; // smoothed velocity (for stable facing + walk speed)
    vz: number;
    spd: number; // smoothed speed
    fell: boolean; // was falling last frame
    dx: number; // fall drift
    dz: number;
    sx: number; // fall tumble spin
    sz: number;
    marker: THREE.Mesh | undefined;
    blob: THREE.Mesh;
  }
  const ents = new Map<number, Ent>();

  const makeBlob = (): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: puffTex, color: "#0a0e20", transparent: true, opacity: 0.4, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    return m;
  };
  const makeMarker = (): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 4), new THREE.MeshBasicMaterial({ color: "#ffe14d" }));
    m.rotation.x = Math.PI;
    scene.add(m);
    return m;
  };

  // cached colours so the per-frame tile animation allocates nothing
  const cWarnHot = new THREE.Color(WARN_HOT);
  const cWarnA = new THREE.Color("#8a5a2c");
  const cWarnB = new THREE.Color("#7a4e26");
  const cEmiss = new THREE.Color("#ff2a10");
  const cSolidA = new THREE.Color(TOP_A);
  const cSolidB = new THREE.Color(TOP_B);
  const cBlack = new THREE.Color("#000000");

  const draw = (state: FDSceneState, dt: number): void => {
    sceneClock += dt;
    // live-tile footprint drives the dynamic push-in (endgame tightens the frame)
    let sumX = 0;
    let sumZ = 0;
    let solidN = 0;
    let maxExt = 0;

    // drifting motes fall slowly and wrap around
    const pos = moteGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < moteN; i++) {
      let y = pos.getY(i) - dt * 0.5;
      if (y < -grid * 0.8) y = grid;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    motes.rotation.y += dt * 0.02;

    // parallax decor: bob the islands, drift the clouds
    for (const is of islands) {
      is.grp.position.y = is.y0 + Math.sin(sceneClock * is.bob + is.phase) * 0.4;
      is.grp.rotation.y += dt * is.spin;
    }
    for (const s of clouds) {
      s.position.x += dt * 0.35;
      if (s.position.x > grid * 2.2) s.position.x = -grid * 2.2;
    }

    // tiles — solid tiles are static (never touched), so we only animate the handful
    // that are warning or collapsing this frame
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]!;
      const s = state.tiles[i] ?? 2;
      if (s === 0 || s === 1) {
        const cx = (i % grid) + 0.5 - half;
        const cz = ((i / grid) | 0) + 0.5 - half;
        sumX += cx;
        sumZ += cz;
        solidN++;
        maxExt = Math.max(maxExt, Math.abs(cx), Math.abs(cz));
      }
      if (s !== t.prev) {
        // handle transitions once
        if (s === 2) {
          t.fall = 0.0001; // begin the tumble
          t.mat.transparent = true;
          t.mat.needsUpdate = true;
        } else if (s === 0) {
          // fully restore — this is also how the board refreshes on a match restart
          t.fall = 0;
          t.mesh.visible = true;
          t.mesh.position.y = -0.25;
          t.mesh.rotation.set(0, 0, 0);
          t.mat.color.copy(t.checker ? cSolidA : cSolidB);
          t.mat.emissive.copy(cBlack);
          t.mat.opacity = 1;
          t.mat.transparent = false;
          t.mat.needsUpdate = true;
        }
        t.prev = s;
      }

      if (t.fall > 0) {
        t.fall += dt;
        const ft = t.fall;
        t.mesh.visible = ft <= TILE_FALL;
        t.mesh.position.y = -0.25 - ft * ft * 15; // accelerate downward
        t.mesh.rotation.x = ft * t.spinX;
        t.mesh.rotation.z = ft * t.spinZ;
        t.mat.opacity = Math.max(0, 1 - ft / TILE_FALL);
      } else if (s === 1) {
        // warning: buzz in place + hot emissive pulse (no allocations)
        t.mesh.position.y = -0.25 + Math.sin(state.time * 26 + i * 0.7) * 0.05;
        const hot = (Math.sin(state.time * 18 + i) + 1) * 0.5;
        t.mat.color.copy(cWarnHot).lerp(t.checker ? cWarnA : cWarnB, 1 - hot);
        t.mat.emissive.copy(cEmiss).multiplyScalar(hot * 0.6);
      }
    }

    // fighters
    const seen = new Set<number>();
    let youX: number | null = null;
    let youZ = 0;
    for (const f of state.fighters) {
      seen.add(f.id);
      const tx = f.x - half;
      const tz = f.y - half;
      let e = ents.get(f.id);
      if (!e) {
        e = { puppet: createPuppet(scene, f.av, { toon: true, outline: f.isYou ? "#ffd23f" : "#141428" }), wx: tx, wz: tz, vx: 0, vz: 0, spd: 0, fell: false, dx: 0, dz: 0, sx: 0, sz: 0, marker: f.isYou ? makeMarker() : undefined, blob: makeBlob() };
        ents.set(f.id, e);
      }
      const ox = e.wx;
      const oz = e.wz;
      e.wx += (tx - e.wx) * Math.min(1, dt * 14);
      e.wz += (tz - e.wz) * Math.min(1, dt * 14);
      const vx = e.wx - ox;
      const vz = e.wz - oz;
      const g = e.puppet.group;
      if (f.isYou) {
        youX = e.wx;
        youZ = e.wz;
      }

      if (f.falling) {
        if (!e.fell) {
          // kick off a tumble: drift outward from the platform centre + random spin
          const outLen = Math.hypot(e.wx, e.wz) || 1;
          e.dx = (e.wx / outLen) * 1.2 + (Math.random() - 0.5) * 0.6;
          e.dz = (e.wz / outLen) * 1.2 + (Math.random() - 0.5) * 0.6;
          e.sx = (Math.random() - 0.5) * 9;
          e.sz = (Math.random() - 0.5) * 9;
          e.fell = true;
        }
        const ft = f.fallT;
        const k = Math.max(0, 1 - ft / FALL_TIME);
        g.position.set(e.wx + e.dx * ft, -ft * ft * 12, e.wz + e.dz * ft); // accelerate + fling out
        g.rotation.x = e.sx * ft;
        g.rotation.z = e.sz * ft;
        g.scale.setScalar(BASE_SCALE * Math.max(0.05, 0.4 + k * 0.6));
        e.puppet.animate(9, dt); // panicked limb flail
        if (e.marker) e.marker.visible = false;
        e.blob.visible = false;
      } else {
        e.fell = false;
        const air = f.air ?? 0;
        e.blob.visible = true;
        e.blob.position.set(e.wx, 0.03, e.wz);
        const bs = 1.5 / (1 + air * 0.5); // shadow shrinks as you jump higher (lands read)
        e.blob.scale.set(bs, bs, 1);
        (e.blob.material as THREE.MeshBasicMaterial).opacity = 0.4 / (1 + air * 0.6);
        g.position.set(e.wx, air, e.wz);
        g.rotation.x = 0;
        g.rotation.z = 0;
        g.scale.setScalar(BASE_SCALE);
        // low-pass the velocity so facing + the walk cycle don't jitter off tiny deltas
        e.vx += (vx - e.vx) * Math.min(1, dt * 9);
        e.vz += (vz - e.vz) * Math.min(1, dt * 9);
        const rawSpeed = Math.hypot(e.vx, e.vz) / Math.max(dt, 1e-4);
        e.spd += (rawSpeed - e.spd) * Math.min(1, dt * 8);
        e.puppet.animate(e.spd, dt);
        if (rawSpeed > 1.2) e.puppet.faceYaw(Math.atan2(e.vx, e.vz), dt);
        if (e.marker) {
          e.marker.visible = true;
          e.marker.position.set(e.wx, 3.1 + Math.sin(state.time * 3) * 0.14, e.wz);
        }
      }
    }
    for (const [id, e] of [...ents]) {
      if (seen.has(id)) continue;
      e.puppet.dispose();
      scene.remove(e.blob);
      e.blob.geometry.dispose();
      (e.blob.material as THREE.Material).dispose();
      if (e.marker) {
        scene.remove(e.marker);
        e.marker.geometry.dispose();
        (e.marker.material as THREE.Material).dispose();
      }
      ents.delete(id);
    }

    // hazards: pulsing red telegraph, then the stone slamming down
    const hz = state.hazards ?? [];
    for (let i = 0; i < hazPool.length; i++) {
      const h = hz[i];
      const p = hazPool[i]!;
      if (!h) {
        p.tele.visible = false;
        p.box.visible = false;
        continue;
      }
      const sz = h.size * 2;
      p.tele.visible = true;
      p.tele.position.set(h.x - half, 0.08, h.y - half);
      p.tele.scale.set(sz, sz, 1);
      (p.tele.material as THREE.MeshBasicMaterial).opacity = h.warning ? 0.25 + (Math.sin(sceneClock * 22) + 1) * 0.22 : 0.55;
      if (!h.warning) {
        p.box.visible = true;
        p.box.position.set(h.x - half, h.h + sz * 0.5, h.y - half);
        p.box.scale.set(sz, sz, sz);
      } else {
        p.box.visible = false;
      }
    }

    // ── camera rig: dynamic push-in + centroid drift + idle sway + trauma shake ──
    const targetR = Math.min(grid * 0.55, Math.max(grid * 0.3, maxExt + 1.4));
    rigDist += (fitDist(targetR) - rigDist) * Math.min(1, dt * 0.6); // slow dolly, never snaps
    const cx = solidN > 0 ? sumX / solidN : 0;
    const cz = solidN > 0 ? sumZ / solidN : 0;
    rigCx += (Math.max(-grid * 0.15, Math.min(grid * 0.15, cx)) - rigCx) * Math.min(1, dt * 0.4);
    rigCz += (Math.max(-grid * 0.15, Math.min(grid * 0.15, cz)) - rigCz) * Math.min(1, dt * 0.4);
    const yaw = camYaw0 + Math.sin(sceneClock * 0.13) * 0.049; // ±2.8° idle sway
    const bob = Math.sin(sceneClock * 0.21) * 0.25;
    camera.position.set(rigCx + Math.cos(camTilt) * Math.sin(yaw) * rigDist, Math.sin(camTilt) * rigDist + bob, rigCz + Math.cos(camTilt) * Math.cos(yaw) * rigDist);
    // look at the platform with the horizon in the top of frame, biased gently toward YOU
    let lx = rigCx;
    let lz = rigCz;
    if (youX !== null) {
      lx += Math.max(-1.5, Math.min(1.5, (youX - rigCx) * 0.13));
      lz += Math.max(-1.5, Math.min(1.5, (youZ - rigCz) * 0.13));
    }
    camera.lookAt(lx, 1.5, lz);
    // trauma-based rotational shake (weightier than position jitter)
    trauma = Math.max(trauma, state.shake / 0.14);
    trauma = Math.max(0, trauma - dt * 2);
    const s2 = trauma * trauma;
    if (s2 > 0.0001) {
      camera.rotation.z += (Math.sin(sceneClock * 41) + Math.sin(sceneClock * 27.7)) * 0.011 * s2;
      camera.rotation.x += (Math.sin(sceneClock * 35.3) + Math.sin(sceneClock * 22.1)) * 0.008 * s2;
    }

    renderer.render(scene, camera);
  };

  return {
    scene,
    draw,
    dispose() {
      for (const e of ents.values()) e.puppet.dispose();
      ents.clear();
      tileGeo.dispose();
      toonRamp.dispose();
      skyTex.dispose();
      puffTex.dispose();
      stage.dispose();
    },
  };
}
