import * as THREE from "three";

// Shared 3D "arena kit" — the renderer/scene/lights/loop/teardown that every
// Three.js minigame boots the same way. Extracted from BarnBrawlPractice so each
// game is a thin consumer instead of a copy of the whole engine setup.
//
// Everything visual is parameterised (background, fog, sun, fill) so a moody barn
// and a bright floor arena share one code path. Game-specific dressing (dust,
// god-rays, plank battens) stays in the game and is added to `scene` after boot.

export interface StageOpts {
  width?: number;
  height?: number;
  background?: string;
  fog?: { color: string; near: number; far: number } | null;
  sun?: { color?: string; intensity?: number; pos?: [number, number, number]; extent?: number };
  hemi?: { sky?: string; ground?: string; intensity?: number };
  fov?: number;
  toneMapping?: THREE.ToneMapping;
  toneMappingExposure?: number;
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  /** start the rAF loop; `onFrame` gets dt (clamped to 0.05s) and the raw timestamp */
  start(onFrame: (dt: number, now: number) => void): void;
  /** cancel the loop, dispose the renderer, and free every geometry/material in the scene */
  dispose(): void;
}

export function createStage(canvas: HTMLCanvasElement, opts: StageOpts = {}): Stage {
  const W = opts.width ?? 960;
  const H = opts.height ?? 540;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (opts.toneMapping !== undefined) {
    renderer.toneMapping = opts.toneMapping;
    renderer.toneMappingExposure = opts.toneMappingExposure ?? 1;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? "#140e07");
  if (opts.fog !== null) {
    const f = opts.fog ?? { color: "#1b1208", near: 14, far: 52 };
    scene.fog = new THREE.Fog(f.color, f.near, f.far);
  }

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 72, W / H, 0.1, 300);

  const hemi = opts.hemi ?? {};
  scene.add(new THREE.HemisphereLight(hemi.sky ?? "#ffe6bf", hemi.ground ?? "#221810", hemi.intensity ?? 0.34));

  const s = opts.sun ?? {};
  const sun = new THREE.DirectionalLight(s.color ?? "#ffcf8c", s.intensity ?? 1.15);
  const [sx, sy, sz] = s.pos ?? [-16, 22, 10];
  sun.position.set(sx, sy, sz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 80;
  const ext = s.extent ?? 28;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -ext;
  sc.right = ext;
  sc.top = ext;
  sc.bottom = -ext;
  scene.add(sun);

  let raf = 0;
  let last = performance.now();
  const start = (onFrame: (dt: number, now: number) => void): void => {
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      onFrame(dt, now);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };

  const dispose = (): void => {
    cancelAnimationFrame(raf);
    renderer.dispose();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
      }
    });
  };

  return { renderer, scene, camera, sun, start, dispose };
}
