import { useEffect, useRef, useState } from "react";
import type { MinigameResult } from "@party-monopoly/types";
import { avatarRoster, type Avatar, resolveLook } from "../game/avatars.js";
import { bound, isGameKey, moveVector } from "../game/keybinds.js";
import { myLook, useProfile } from "../store/profile.js";
import { partyResult, type PartyProps } from "../game/partyRound.js";
import { CharacterMover } from "../game/characterMover.js";
import { DigitalAxis, REWIRED_DIGITAL_AXIS } from "../game/digitalAxis.js";
import { COUNTDOWN_LENGTH, countdownNumber, makeFallers, placementDelay, resultsBrightness, ROUND_FLOW, stepFallers, timerPulseScale, type Faller } from "../game/roundFlow.js";
import {
  ARENA_HALF,
  BREAKING_BLOCKS,
  BREAKING_BLOCKS_MOVER,
  CRATE_TOP_Y,
  closestCrate,
  crateAt,
  crateCenter,
  crateCost,
  crateDropping,
  cratePath,
  crateSolid,
  idleCrate,
  randomUnit,
  scoreFor,
  shouldCrateDrop,
  spreadSpawns,
  startCrateDrop,
  stepCrate,
  waveTargetsDropping,
  WaveScheduler,
  type Cell,
  type CrateDrop,
  type CrateRef,
} from "../game/breakingBlocks.js";
import { BREAKING_BLOCKS_CAMERA, FollowCamera } from "../game/followCamera.js";
import { createBreakingBlocksScene, type BBFighterView } from "../three/breakingBlocksScene.js";

// "Floor Drop" — Pummel Party's Breaking Blocks: a 10 × 10 raft of crates over lava. Every
// few seconds a pattern of crates shakes, drops away and comes back; anyone standing on one
// falls in. Last one standing, or whoever is still up when the 70 s run out, wins. The rules
// and numbers come from the decompile (see game/breakingBlocks.ts); movement is the shared
// CharacterMover port, the round presentation the shared roundFlow helpers, the camera the
// CameraFollow port. WASD / arrows move, Space jumps.

type Phase = "ready" | "spawning" | "countdown" | "playing" | "ending" | "results";

const N_DEFAULT = 4;
const NAMES = ["You", "Bot α", "Bot β", "Bot γ"];
const FOOT_R = 0.3; // the capsule's footprint: standing needs a crate under any of these points
const STEP_UP = 0.3; // `slopeAdjustMax` 0.3: a rising crate lifts you, a lower neighbour is stepped down onto
const RAGDOLL_GRAVITY = 9.81; // the ragdoll is a plain rigidbody

interface Fighter {
  id: number;
  av: Avatar;
  name: string;
  isBot: boolean;
  pos: { x: number; y: number; z: number };
  mover: CharacterMover;
  yaw: number;
  dropping: boolean; // still in the spawn drop
  dead: boolean;
  gone: boolean;
  deathOrder: number;
  deathAt: number; // round seconds elapsed when they fell
  ragVel: { x: number; y: number; z: number };
  ragT: number;
  // bot state (`BoxDropPlayer`'s AI fields)
  target: { x: number; z: number };
  chooseDropping: boolean;
  moveUntil: number;
  pathTimer: number;
  path: Cell[];
}

interface ScoreRow {
  name: string;
  color: string;
  score: number;
  isYou: boolean;
  survived: boolean;
  fellAt: number;
}

export function FloorDropPractice({ onLeave, party }: { onLeave: () => void; party?: PartyProps }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [results, setResults] = useState<ScoreRow[] | null>(null);
  const partyResultRef = useRef<MinigameResult | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const cdRef = useRef<HTMLDivElement | null>(null);
  const rosterRef = useRef<HTMLDivElement | null>(null);
  const N = party ? party.seats.length : N_DEFAULT;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene3d = createBreakingBlocksScene(canvas);
    const rand = (): number => Math.random();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // ── audio: a few synthesised cues (ticks, the rumble, the splash) ──
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctor();
    const master = ac.createGain();
    master.gain.value = 0.3;
    master.connect(ac.destination);
    const blip = (f: number, dur: number, type: OscillatorType, gain: number, sweep?: number): void => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, ac.currentTime);
      if (sweep !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, sweep), ac.currentTime + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
      o.connect(g);
      g.connect(master);
      o.start();
      o.stop(ac.currentTime + dur);
    };
    const noiseBuf = ((): AudioBuffer => {
      const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    })();
    const noise = (dur: number, gain: number, cut: number, fadeIn = 0.02): void => {
      const n = ac.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cut;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0008, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + fadeIn);
      g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
      n.connect(f);
      f.connect(g);
      g.connect(master);
      n.start();
      n.stop(ac.currentTime + dur);
    };

    // ── the raft ──
    const n = BREAKING_BLOCKS.dimensions;
    const crates: CrateDrop[] = Array.from({ length: n * n }, () => idleCrate());
    const crateIdx = (x: number, y: number): number => x * n + y;
    const crateRefs = (): CrateRef[] => crates.map((c, i) => ({ x: Math.floor(i / n), y: i % n, dropping: crateDropping(c) }));
    const stepCost = (x: number, y: number): number => crateCost(crates[crateIdx(x, y)]!);
    let scheduler = new WaveScheduler();

    // ── fighters ──
    const roster = avatarRoster(resolveLook(myLook()), N);
    const names = party ? party.seats.map((s) => s.name) : NAMES;
    const fighters: Fighter[] = Array.from({ length: N }, (_, i) => ({
      id: i,
      av: roster[i]!,
      name: names[i] ?? `Bot ${i}`,
      isBot: i > 0,
      pos: { x: 0, y: CRATE_TOP_Y, z: 0 },
      mover: new CharacterMover(BREAKING_BLOCKS_MOVER),
      yaw: Math.PI,
      dropping: false,
      dead: false,
      gone: false,
      deathOrder: -1,
      deathAt: 0,
      ragVel: { x: 0, y: 0, z: 0 },
      ragT: 0,
      target: { x: 0, z: 0 },
      chooseDropping: false,
      moveUntil: 0,
      pathTimer: 0,
      path: [],
    }));
    const me = fighters[0]!;
    const axisH = new DigitalAxis(REWIRED_DIGITAL_AXIS);
    const axisV = new DigitalAxis(REWIRED_DIGITAL_AXIS);
    const keys = new Set<string>();
    let jumpQueued = false;
    const followCam = new FollowCamera(BREAKING_BLOCKS_CAMERA);

    // ── match state ──
    let mode: Phase = "ready";
    let clock = 0;
    let fallers: Faller[] = [];
    let spawnClock = 0;
    let spawnLandedAt = -1;
    let cdT = 0;
    let cdShown = -1;
    let mtime = 0; // round seconds remaining
    let timerSec = -1;
    let timerTick = Infinity;
    let endT = 0;
    let resultsT = 0;
    let deadCount = 0;
    let rosterDirty = true;

    const roundElapsed = (): number => BREAKING_BLOCKS.roundLength - mtime;
    const alive = (): Fighter[] => fighters.filter((f) => !f.dead);

    // ── collision against the crates: no walls, just tops to stand on and sides to bump ──
    const footprint: Array<[number, number]> = [
      [0, 0],
      [FOOT_R, 0],
      [-FOOT_R, 0],
      [0, FOOT_R],
      [0, -FOOT_R],
    ];
    // the highest solid crate top under the footprint, or -Infinity over a gap / off the raft
    function groundAt(px: number, pz: number): number {
      let best = -Infinity;
      for (const [ox, oz] of footprint) {
        const cell = crateAt(px + ox, pz + oz);
        if (!cell) continue;
        const c = crates[crateIdx(cell.x, cell.y)]!;
        if (!crateSolid(c)) continue;
        best = Math.max(best, CRATE_TOP_Y + c.off.y);
      }
      return best;
    }
    // would the footprint, moved by (dx, dz), run into a crate side taller than a step?
    function blockedMove(px: number, py: number, pz: number, dx: number, dz: number): boolean {
      for (const [ox, oz] of footprint) {
        const cell = crateAt(px + dx + ox, pz + dz + oz);
        if (!cell) continue;
        const c = crates[crateIdx(cell.x, cell.y)]!;
        if (crateSolid(c) && CRATE_TOP_Y + c.off.y > py + STEP_UP) return true;
      }
      return false;
    }
    // `CharacterController.Move` + `SmoothSlope`: slide, then settle onto the ground or fall
    function stepBody(f: Fighter, dt: number): void {
      const m = f.mover;
      const p = f.pos;
      const wasGrounded = m.grounded;
      const sx = m.vx * dt;
      const sz = m.vz * dt;
      if (!blockedMove(p.x, p.y, p.z, sx, 0)) p.x += sx;
      if (!blockedMove(p.x, p.y, p.z, 0, sz)) p.z += sz;
      const ground = groundAt(p.x, p.z);
      let ny = p.y + m.vy * dt;
      let landed = false;
      if (ny <= ground) {
        ny = ground;
        landed = true;
      } else if (ground > p.y && ground - p.y <= STEP_UP) {
        ny = Math.min(ground, p.y + 9 * dt); // a shaking crate rising under you carries you up
        landed = true;
      } else if (wasGrounded && m.vy <= 0 && p.y - ground > 0 && p.y - ground < STEP_UP) {
        ny = ground; // stepping onto a lower neighbour stays planted
        landed = true;
      }
      p.y = ny;
      m.finishMove(landed, false, dt);
    }

    // `KillPlayer`: ragdoll away, count the death, tell the UI
    function kill(f: Fighter): void {
      if (f.dead) return;
      f.dead = true;
      f.deathOrder = deadCount++;
      f.deathAt = roundElapsed();
      const u = randomUnit(rand); // `onUnitSphere; y = 100; x *= 100; z *= 40; * 0.05`
      f.ragVel = { x: u.x * 5, y: 5, z: u.z * 2 };
      f.ragT = 0;
      rosterDirty = true;
      noise(0.45, 0.5, 900, 0.01); // `DeathSplash01`
      if (!f.isBot) blip(300, 0.5, "sawtooth", 0.25, 80);
    }

    // ── bots (`BoxDropPlayer.GetAIInput` without the NavMeshAgent) ──
    function updateTargetBox(b: Fighter, dropping: boolean, minDistance: number, maxDistance = 1000): void {
      const c = closestCrate(crateRefs(), b.pos, dropping, minDistance, maxDistance);
      if (c) {
        const p = crateCenter(c.x, c.y);
        const u = randomUnit(rand);
        b.target = { x: p.x + u.x, z: p.z + u.z };
      } else {
        const u = randomUnit(rand);
        b.target = { x: u.x * 10, z: u.z * 10 };
      }
      b.path = [];
      b.pathTimer = 0;
    }
    function onDropBoxes(): void {
      for (const b of fighters) {
        if (!b.isBot || b.dead) continue;
        b.chooseDropping = waveTargetsDropping(rand);
        updateTargetBox(b, b.chooseDropping, 6);
      }
    }
    function cellOf(x: number, z: number): Cell {
      const c = crateAt(x, z);
      if (c) return c;
      const k = (v: number): number => Math.max(0, Math.min(n - 1, Math.floor((v + ARENA_HALF) / BREAKING_BLOCKS.scale)));
      return { x: k(x), y: k(z) };
    }
    function botInput(b: Fighter, dt: number): { dx: number; dz: number } {
      // the agent re-plans every 0.1–0.15 s (`pathUpdateTimer`)
      b.pathTimer -= dt;
      if (b.pathTimer <= 0) {
        b.pathTimer = 0.1 + rand() * 0.05;
        b.path = cratePath(cellOf(b.pos.x, b.pos.z), cellOf(b.target.x, b.target.z), stepCost);
      }
      // drop waypoints already reached
      while (b.path.length) {
        const w = crateCenter(b.path[0]!.x, b.path[0]!.y);
        if (Math.hypot(w.x - b.pos.x, w.z - b.pos.z) > 0.45) break;
        b.path.shift();
      }
      const end = b.path.length ? crateCenter(b.path[b.path.length - 1]!.x, b.path[b.path.length - 1]!.y) : { x: b.pos.x, z: b.pos.z };
      const toTarget2 = (b.target.x - b.pos.x) ** 2 + (b.target.z - b.pos.z) ** 2;
      const toEnd = Math.hypot(end.x - b.pos.x, end.z - b.pos.z);
      if (toTarget2 > 0.36 && toEnd > 0.5) {
        const w = b.path.length ? crateCenter(b.path[0]!.x, b.path[0]!.y) : { x: b.target.x, z: b.target.z };
        const dx = w.x - b.pos.x;
        const dz = w.z - b.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        b.moveUntil = clock + 1.5 + rand();
        return { dx: dx / l, dz: dz / l };
      }
      // arrived (or the goal is gone): wait 1.5–2.5 s, then look for a crate within 2.5
      if (clock >= b.moveUntil) {
        b.moveUntil = clock + 1.5 + rand();
        updateTargetBox(b, b.chooseDropping, 0, 2.5);
      }
      return { dx: 0, dz: 0 };
    }

    // ── match flow ──
    function beginMatch(): void {
      for (const c of crates) Object.assign(c, idleCrate());
      scheduler = new WaveScheduler();
      deadCount = 0;
      const spawns = spreadSpawns(N);
      fighters.forEach((f, i) => {
        const s = spawns[i]!;
        f.pos = { x: s.x, y: CRATE_TOP_Y, z: s.z };
        f.mover.reset();
        f.mover.setForward(0, 1);
        f.yaw = Math.PI; // the spawn points face the camera
        f.dead = false;
        f.gone = false;
        f.deathOrder = -1;
        f.ragT = 0;
        const u = randomUnit(rand);
        f.target = { x: u.x * 10, z: u.z * 10 };
        f.chooseDropping = false;
        f.moveUntil = 0;
        f.pathTimer = 0;
        f.path = [];
      });
      axisH.reset();
      axisV.reset();
      followCam.reset();
      for (const f of fighters) followCam.addTarget(f.pos);
      followCam.snap(fighters.map((f) => ({ ...f.pos, dead: false })));
      // `DoSpawnPlayersAnimation`: everyone starts 10 units up and drops in 0.1 s apart
      fallers = makeFallers(fighters.map(() => CRATE_TOP_Y));
      if (reduceMotion) {
        for (const f of fallers) {
          f.y = f.targetY;
          f.landed = true;
        }
      }
      fighters.forEach((f, i) => {
        f.pos.y = fallers[i]!.y;
        f.dropping = !fallers[i]!.landed;
        if (!f.dropping) f.mover.finishMove(true, false, 0);
      });
      spawnClock = 0;
      spawnLandedAt = -1;
      timerSec = -1;
      timerTick = Infinity;
      resultsT = 0;
      mtime = BREAKING_BLOCKS.roundLength;
      canvas.style.filter = "";
      rosterDirty = true;
      mode = "spawning";
      setResults(null);
      setPhase("spawning");
      void ac.resume();
    }
    beginRef.current = beginMatch;

    function finishMatch(): void {
      mode = "results";
      // `BuildResults`: survivors score 10 × players, the dead 10 × (death order + 1)
      const rows = fighters.map((f) => ({ f, score: scoreFor(f.dead, f.deathOrder, N) }));
      rows.sort((a, b) => b.score - a.score || a.f.id - b.f.id);
      const board: ScoreRow[] = rows.map(({ f, score }) => ({ name: f.name, color: f.av.body, score, isYou: !f.isBot, survived: !f.dead, fellAt: f.deathAt }));
      const place = rows.findIndex((r) => r.f === me) + 1;
      if (party) {
        const places: number[] = new Array(N).fill(N);
        rows.forEach((r, rank) => (places[r.f.id] = rank + 1));
        partyResultRef.current = partyResult(party.minigameId, party.seats, places);
      } else {
        useProfile.getState().award(Math.round(15 + (85 * (N - place)) / Math.max(1, N - 1)));
      }
      resultsT = 0;
      setResults(board);
      setPhase("results");
      if (place === 1) {
        blip(520, 0.15, "square", 0.22, 780);
        blip(780, 0.2, "square", 0.18, 1040);
      }
    }

    function updateRoster(): void {
      if (!rosterRef.current || !rosterDirty) return;
      rosterDirty = false;
      rosterRef.current.replaceChildren(
        ...fighters.map((f) => {
          const chip = document.createElement("div");
          chip.style.cssText = `display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:12px;background:rgba(0,0,0,0.45);color:#fff;font-weight:800;font-size:13px;opacity:${f.dead ? 0.45 : 1}`;
          const dot = document.createElement("span");
          dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${f.av.body};display:inline-block`;
          chip.append(dot, document.createTextNode(f.dead ? `${f.name} ✕` : f.name));
          return chip;
        }),
      );
    }

    let last = performance.now();
    let raf = 0;
    function frame(now: number): void {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;

      if (mode === "results") {
        resultsT += dt;
        canvas.style.filter = `brightness(${resultsBrightness(resultsT).toFixed(3)})`;
        scene3d.draw(view(), dt);
        raf = requestAnimationFrame(frame);
        return;
      }

      if (mode === "spawning") {
        spawnClock += dt;
        for (const f of stepFallers(fallers, spawnClock, dt)) {
          const i = fallers.indexOf(f);
          const ft = fighters[i]!;
          ft.dropping = false;
          ft.mover.reset();
          ft.mover.finishMove(true, false, dt);
          blip(110, 0.1, "triangle", 0.12, 50);
        }
        fighters.forEach((f, i) => (f.pos.y = fallers[i]!.y));
        if (spawnLandedAt < 0 && fallers.every((f) => f.landed)) spawnLandedAt = spawnClock;
        if (spawnLandedAt >= 0 && spawnClock - spawnLandedAt >= ROUND_FLOW.spawnSettle) {
          cdT = COUNTDOWN_LENGTH;
          cdShown = -1;
          mode = "countdown";
          setPhase("countdown");
        }
      } else if (mode === "countdown") {
        cdT -= dt;
        const c = countdownNumber(cdT);
        if (c !== cdShown) {
          cdShown = c;
          if (c > 0) {
            blip(1320, 0.07, "square", 0.16);
            if (cdRef.current) {
              cdRef.current.textContent = String(c);
              cdRef.current.style.animation = "none";
              void cdRef.current.offsetWidth;
              cdRef.current.style.animation = "";
            }
          }
        }
        if (cdT <= 0) {
          mode = "playing";
          setPhase("playing");
        }
      } else if (mode === "playing") {
        mtime -= dt;
        if (timerRef.current) {
          const s = Math.max(0, Math.ceil(mtime));
          if (s !== timerSec) {
            timerSec = s;
            timerTick = clock;
            timerRef.current.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
          }
          const k = reduceMotion ? 1 : timerPulseScale(clock - timerTick);
          timerRef.current.style.transform = k === 1 ? "" : `scale(${k.toFixed(3)})`;
          timerRef.current.style.color = mtime <= 10 ? (Math.floor(mtime * 3) % 2 === 0 ? "#ff4d4d" : "#fff") : "#fff";
        }
        // the waves: queue every 2.5 s, run 1 s later, shake the camera and tell the bots
        const wave = scheduler.update(dt, roundElapsed(), rand);
        if (wave) {
          for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) if (shouldCrateDrop(x, y, wave.permutation)) startCrateDrop(crates[crateIdx(x, y)]!, wave.delay, rand);
          scene3d.addShake(BREAKING_BLOCKS.cameraShake);
          noise(wave.delay + 0.5, 0.35, 180, 0.1); // the shake + rumble loops, faded after `delay + 0.5`
          onDropBoxes();
        }
        // the round ends when the timer runs out or (solo mode) one fighter is left
        if (mtime <= 0 || alive().length <= 1) {
          mode = "ending";
          endT = BREAKING_BLOCKS.endHold;
        }
      } else if (mode === "ending") {
        endT -= dt;
        if (endT <= 0) finishMatch();
      }

      const inRound = mode === "playing" || mode === "countdown" || mode === "ending";
      const playable = mode === "playing";
      if (inRound) {
        for (const c of crates) stepCrate(c, dt, rand);
        for (const f of fighters) {
          if (f.dead) {
            // the ragdoll flies off and sinks; hide it once it is well under the lava
            f.ragT += dt;
            f.ragVel.y -= RAGDOLL_GRAVITY * dt;
            f.pos.x += f.ragVel.x * dt;
            f.pos.y += f.ragVel.y * dt;
            f.pos.z += f.ragVel.z * dt;
            if (f.pos.y < BREAKING_BLOCKS.deathY - 4) f.gone = true;
            continue;
          }
          let ax = 0;
          let ay = 0;
          let jump = false;
          if (!f.isBot) {
            // the keys drive Rewired's digital axes (⅓ s to full), the axes the mover; forward is +z (away from the camera)
            const mv = moveVector(keys);
            ax = axisH.update(playable ? mv.dx : 0, dt);
            ay = axisV.update(playable ? -mv.dy : 0, dt);
            jump = jumpQueued && playable;
          } else if (playable) {
            // the AI steers in world space; `worldInput` turns that into the mover's axes
            const d = botInput(f, dt);
            const inp = f.mover.worldInput(d.dx, d.dz, false);
            ax = inp.axisX;
            ay = inp.axisY;
          }
          if (f.mover.calculateVelocity({ axisX: ax, axisY: ay, jump }, dt)) blip(420, 0.08, "triangle", 0.05, 640);
          stepBody(f, dt);
          // `RotateTowards(LookRotation(movementAxis), 1500°/s)`: the body faces the input direction
          if (ax !== 0 || ay !== 0) {
            // with forward (0, 1) the mover's strafe axis runs along −x (screen-right), so the
            // world direction of the input is (−ax, ay); the rig's yaw basis is (sin, cos)
            const want = Math.atan2(-ax, ay);
            let d = want - f.yaw;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            const step = ((BREAKING_BLOCKS.bodyTurnSpeed * Math.PI) / 180) * dt;
            f.yaw += Math.abs(d) <= step ? d : Math.sign(d) * step;
          }
          if (f.pos.y < BREAKING_BLOCKS.deathY) kill(f);
        }
      }
      jumpQueued = false;

      followCam.update(fighters.map((f) => ({ ...f.pos, dead: f.dead })), dt);
      updateRoster();
      scene3d.draw(view(), dt);
      raf = requestAnimationFrame(frame);
    }

    function view(): { crates: CrateDrop[]; fighters: BBFighterView[]; camera: { x: number; y: number; z: number }; time: number } {
      return {
        crates,
        fighters: fighters.map((f) => ({ id: f.id, av: f.av, x: f.pos.x, y: f.pos.y, z: f.pos.z, vx: f.mover.vx, vz: f.mover.vz, yaw: f.yaw, grounded: f.mover.grounded, isYou: !f.isBot, dead: f.dead, gone: f.gone })),
        camera: followCam.position,
        time: clock,
      };
    }

    const kd = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (bound("action", k) && !e.repeat) jumpQueued = true;
      if (isGameKey(k)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    if (party) beginMatch(); // a board round starts on its own
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      void ac.close();
      scene3d.dispose();
    };
  }, []);

  const inMatch = phase === "playing" || phase === "countdown" || phase === "spawning" || phase === "ending";
  const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <main style={{ minHeight: "100vh", padding: 16, maxWidth: 1040, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Floor Drop</h1>
        <button onClick={onLeave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 960, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={960} height={540} style={{ width: "100%", aspectRatio: "16 / 9", background: "#314d79", borderRadius: 8, display: "block" }} />

        {inMatch && (
          <>
            {/* `CreateScoreUI(TopLeft)`: who is still up (`SetPlayerDeadUI` greys the fallen) */}
            <div ref={rosterRef} style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6, flexWrap: "wrap", pointerEvents: "none" }} />
            {/* `CreateTimer(TopRight)`, pulsing each second */}
            <div ref={timerRef} style={{ position: "absolute", top: 10, right: 16, color: "#fff", fontWeight: 900, fontSize: 26, textShadow: "0 1px 4px #000", pointerEvents: "none", transformOrigin: "50% 50%" }}>
              {fmt(BREAKING_BLOCKS.roundLength)}
            </div>
            <div style={{ position: "absolute", bottom: 12, right: 16, color: "rgba(255,255,255,0.6)", fontSize: 12, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>WASD move · Space jump</div>
          </>
        )}

        {phase === "countdown" && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div ref={cdRef} className="bb-cd" style={{ fontSize: 112, fontWeight: 900, color: "#ffe6bf", textShadow: "0 3px 18px #000", letterSpacing: 2 }}>
              3
            </div>
          </div>
        )}

        {phase === "ready" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(14,18,30,0.82)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#ffe6bf" }}>Floor Drop</div>
            <div style={{ fontSize: 15, opacity: 0.85, maxWidth: 480, lineHeight: 1.5 }}>
              <strong>WASD</strong> move · <strong>Space</strong> jump. The crates shake before they drop away — get off them. They come back, the lava doesn't give you back. Last one standing after {BREAKING_BLOCKS.roundLength} seconds wins.
            </div>
            <button className="primary" style={{ fontSize: 18, padding: "10px 26px" }} onClick={() => beginRef.current?.()}>
              Start
            </button>
          </div>
        )}

        {phase === "results" && results && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 8, textAlign: "center", padding: 20, pointerEvents: "none" }}>
            <div className="bb-reveal" style={{ animationDelay: `${placementDelay(0)}s`, fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "#e9dcc8", textShadow: "0 1px 4px #000" }}>
              Round Over
            </div>
            <div className="bb-reveal" style={{ animationDelay: `${placementDelay(0)}s`, fontSize: 32, fontWeight: 900, color: results[0]!.color, textShadow: "0 2px 12px #000, 0 0 2px #000" }}>
              {results[0]!.isYou ? "You win!" : `${results[0]!.name} wins!`}
            </div>
            <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {results.map((r, i) => (
                <div
                  key={r.name}
                  className="bb-reveal"
                  style={{
                    animationDelay: `${placementDelay(i)}s`,
                    display: "grid",
                    gridTemplateColumns: "24px 18px 1fr auto auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    color: "#fff",
                    background: r.isYou ? "rgba(96,72,20,0.88)" : "rgba(14,18,30,0.82)",
                    border: i === 0 ? "1px solid #ffd23f" : "1px solid rgba(255,255,255,0.08)",
                    fontWeight: r.isYou ? 800 : 600,
                  }}
                >
                  <span style={{ opacity: 0.7 }}>#{i + 1}</span>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", background: r.color, justifySelf: "center" }} />
                  <span style={{ textAlign: "left" }}>{r.name}</span>
                  <span style={{ color: "#ffd23f" }}>{r.score} pts</span>
                  <span style={{ color: r.survived ? "#4ade80" : "#ff8a65" }}>{r.survived ? "Survived" : `Fell ${fmt(r.fellAt)}`}</span>
                </div>
              ))}
            </div>
            <div className="bb-reveal" style={{ animationDelay: `${placementDelay(results.length)}s`, display: "flex", gap: 10, marginTop: 8, pointerEvents: "auto" }}>
              {party ? (
                <button className="primary" style={{ fontSize: 16, padding: "9px 22px" }} onClick={() => party.onResult(partyResultRef.current!)}>
                  Continue →
                </button>
              ) : (
                <>
                  <button className="primary" style={{ fontSize: 16, padding: "9px 22px" }} onClick={() => beginRef.current?.()}>
                    Play Again
                  </button>
                  <button style={{ fontSize: 16, padding: "9px 22px" }} onClick={onLeave}>
                    Leave
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
