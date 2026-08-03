import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { MinigameRequest, MinigameResult } from "@party-monopoly/types";
import { avatarRoster } from "../game/avatars.js";
import { useProfile } from "../store/profile.js";
import { createStage } from "../three/stage.js";
import { frameArena } from "../three/cameraRig.js";
import { createPuppet } from "../three/character.js";

// A quick 3D "rent duel": you (P0, the lander) vs the property owner (P1, a bot)
// scramble to grab more coins in a short window. The winner's side feeds the
// engine's rent multiplier via the same MinigameResult contract as the reflex
// duel — so nothing in the engine/online path changes. Only the active human
// plays; the owner is always AI here (one keyboard), like the Copa/Airport picks.

const HALFX = 6;
const HALFZ = 4;
const MOVE = 6.2;
const DURATION = 14; // seconds of play
const COUNTDOWN = 2;
const COIN_CAP = 6;
const SPAWN_EVERY = 0.55;

export function ArenaDuel({
  request,
  onResult,
  aiSeat,
  aiSkill = 0.6,
}: {
  request: MinigameRequest;
  onResult: (result: MinigameResult) => void;
  aiSeat?: 0 | 1;
  aiSkill?: number;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const youScoreRef = useRef<HTMLDivElement | null>(null);
  const oppScoreRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [, force] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const p0AI = aiSeat === 0; // the lander is an AI turn

    const stage = createStage(canvas, {
      width: canvas.width,
      height: canvas.height,
      background: "#0c1119",
      fov: 48,
      fog: null,
      sun: { color: "#fff0d4", intensity: 1.4, pos: [-5, 16, 7], extent: 12 },
      hemi: { sky: "#bcd4ff", ground: "#2a3550", intensity: 0.8 },
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.12,
    });
    const { scene, camera, renderer } = stage;
    renderer.shadowMap.enabled = false;
    stage.sun.castShadow = false;
    frameArena(camera, { center: new THREE.Vector3(0, 0, 0), radius: 8.4, tiltDeg: 52, yawDeg: 6, margin: 1.05 });

    const toonRamp = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
    toonRamp.minFilter = THREE.NearestFilter;
    toonRamp.magFilter = THREE.NearestFilter;
    toonRamp.needsUpdate = true;

    // arena floor + rim
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALFX * 2, HALFZ * 2), new THREE.MeshToonMaterial({ color: "#2f8a44", gradientMap: toonRamp }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const rimMat = new THREE.MeshToonMaterial({ color: "#245a30", gradientMap: toonRamp });
    for (const [w, d, x, z] of [[HALFX * 2 + 0.6, 0.5, 0, -HALFZ - 0.2], [HALFX * 2 + 0.6, 0.5, 0, HALFZ + 0.2], [0.5, HALFZ * 2 + 0.6, -HALFX - 0.2, 0], [0.5, HALFZ * 2 + 0.6, HALFX + 0.2, 0]] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), rimMat);
      b.position.set(x, 0.15, z);
      scene.add(b);
    }

    // two brawlers — you gold-outlined, owner red-outlined
    const roster = avatarRoster(useProfile.getState().avatar, 2);
    const you = createPuppet(scene, roster[0]!, { toon: true, outline: "#ffd23f" });
    const opp = createPuppet(scene, roster[1]!, { toon: true, outline: "#ff5566" });
    you.group.scale.setScalar(0.9);
    opp.group.scale.setScalar(0.9);

    // coins
    const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.1, 14);
    const coinMat = new THREE.MeshStandardMaterial({ color: "#ffd23f", emissive: "#ffae00", emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.4 });
    interface Coin { mesh: THREE.Mesh; x: number; z: number; active: boolean; }
    const coins: Coin[] = Array.from({ length: 10 }, () => {
      const m = new THREE.Mesh(coinGeo, coinMat);
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      scene.add(m);
      return { mesh: m, x: 0, z: 0, active: false };
    });
    const spawnCoin = (): void => {
      const c = coins.find((k) => !k.active);
      if (!c) return;
      c.x = (Math.random() - 0.5) * (HALFX * 2 - 1.4);
      c.z = (Math.random() - 0.5) * (HALFZ * 2 - 1.4);
      c.active = true;
      c.mesh.visible = true;
      c.mesh.position.set(c.x, 0.4, c.z);
    };

    // audio blip
    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC();
    const blip = (f: number, dur = 0.08): void => {
      const o = ac.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(f, ac.currentTime);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.14, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur);
    };

    // state
    const P = [
      { x: -HALFX * 0.6, z: 0, aim: 0, score: 0, ai: p0AI, pup: you },
      { x: HALFX * 0.6, z: 0, aim: Math.PI, score: 0, ai: true, pup: opp },
    ];
    const keys = new Set<string>();
    let mode: "countdown" | "playing" | "result" = "countdown";
    let clock = COUNTDOWN;
    let matchT = DURATION;
    let spawnT = 0.4;
    let resultT = 1.7;
    let done = false;

    const kd = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    const nearestCoin = (x: number, z: number): Coin | null => {
      let best: Coin | null = null;
      let bd = Infinity;
      for (const c of coins) {
        if (!c.active) continue;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    };

    const finish = (): void => {
      if (done) return;
      done = true;
      const winner = P[0]!.score >= P[1]!.score ? 0 : 1; // ties → the lander (P0)
      const p0 = request.participants[0]!.playerId;
      const p1 = request.participants[1]!.playerId;
      onResultRef.current({
        minigameId: request.minigameId,
        status: "COMPLETED",
        outcome: winner === 0 ? "P0_WIN" : "P1_WIN",
        ranking: winner === 0 ? [p0, p1] : [p1, p0],
        metrics: { p0: P[0]!.score, p1: P[1]!.score },
      });
    };

    let raf = 0;
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (mode === "countdown") {
        clock -= dt;
        if (bannerRef.current) bannerRef.current.textContent = clock > 0 ? String(Math.ceil(clock)) : "GO!";
        if (clock <= -0.5) {
          mode = "playing";
          void ac.resume();
          if (bannerRef.current) bannerRef.current.style.opacity = "0";
        }
      } else if (mode === "playing") {
        matchT -= dt;
        spawnT -= dt;
        if (spawnT <= 0 && coins.filter((c) => c.active).length < COIN_CAP) {
          spawnT = SPAWN_EVERY;
          spawnCoin();
        }
        for (const p of P) {
          let mx = 0;
          let mz = 0;
          if (!p.ai) {
            mx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
            mz = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
          } else {
            const tc = nearestCoin(p.x, p.z);
            if (tc) {
              mx = tc.x - p.x;
              mz = tc.z - p.z;
            }
          }
          const len = Math.hypot(mx, mz);
          if (len > 0.01) {
            const sp = MOVE * (p.ai ? 0.82 + aiSkill * 0.22 : 1) * dt;
            p.x = Math.max(-HALFX + 0.4, Math.min(HALFX - 0.4, p.x + (mx / len) * sp));
            p.z = Math.max(-HALFZ + 0.4, Math.min(HALFZ - 0.4, p.z + (mz / len) * sp));
            p.aim = Math.atan2(mx, mz);
          }
          // collect
          for (const c of coins) {
            if (c.active && Math.hypot(c.x - p.x, c.z - p.z) < 0.7) {
              c.active = false;
              c.mesh.visible = false;
              p.score++;
              if (!p.ai) blip(880);
              else blip(440);
            }
          }
          const g = p.pup.group;
          g.position.set(p.x, 0, p.z);
          p.pup.faceYaw(p.aim);
          p.pup.animate(len > 0.01 ? 5 : 2, dt);
        }
        if (matchT <= 0) {
          mode = "result";
          const w = P[0]!.score >= P[1]!.score ? 0 : 1;
          if (bannerRef.current) {
            bannerRef.current.style.opacity = "1";
            bannerRef.current.textContent = w === 0 ? "You win the duel!" : "Owner wins — full rent!";
            bannerRef.current.style.color = w === 0 ? "#4ade80" : "#ff6a6a";
          }
          blip(w === 0 ? 900 : 200, 0.4);
        }
      } else {
        resultT -= dt;
        if (resultT <= 0) finish();
      }

      // coins spin/bob
      for (const c of coins) if (c.active) {
        c.mesh.rotation.z += dt * 4;
        c.mesh.position.y = 0.4 + Math.sin(now * 0.005 + c.x) * 0.08;
      }
      if (youScoreRef.current) youScoreRef.current.textContent = `You  ${P[0]!.score}`;
      if (oppScoreRef.current) oppScoreRef.current.textContent = `${P[1]!.score}  Owner`;
      if (timerRef.current) timerRef.current.textContent = mode === "playing" ? `${Math.max(0, Math.ceil(matchT))}s` : "";

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    force((n) => n + 1); // ensure refs are attached

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      you.dispose();
      opp.dispose();
      toonRamp.dispose();
      void ac.close();
      stage.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>💰 Rent Duel — grab the most coins to slash the rent!</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>base rent {request.context.stakeData!.baseRent}</div>
      </div>
      <div style={{ position: "relative", width: "100%", maxWidth: 640, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={640} height={420} style={{ width: "100%", aspectRatio: "640 / 420", background: "#0c1119", borderRadius: 8, display: "block", cursor: "none" }} />
        <div ref={youScoreRef} style={{ position: "absolute", top: 10, left: 14, color: "#ffd23f", fontWeight: 900, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>You  0</div>
        <div ref={oppScoreRef} style={{ position: "absolute", top: 10, right: 14, color: "#ff8a8a", fontWeight: 900, fontSize: 18, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>0  Owner</div>
        <div ref={timerRef} style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", color: "#fff", fontWeight: 800, fontSize: 16, textShadow: "0 1px 3px #000", pointerEvents: "none" }} />
        <div ref={bannerRef} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#ffe6bf", fontWeight: 900, fontSize: 40, textShadow: "0 2px 12px #000", pointerEvents: "none" }}>3</div>
      </div>
      <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 6 }}>WASD to move · grab the gold coins · most coins wins the duel</p>
    </section>
  );
}
