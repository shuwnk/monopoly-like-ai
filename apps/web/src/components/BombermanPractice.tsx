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
  botThink,
  buildWheel,
  inBlast,
  newBotBrain,
  newField,
  placeBomb,
  resetBotBrain,
  resetField,
  resolveBody,
  roundPoints,
  SHOCKWAVE,
  SHOCKWAVE_MOVER,
  spawnNodes,
  stepBombs,
  type BotBrain,
  type BotDifficulty,
} from "../game/strategicShockwave.js";
import { FollowCamera, STRATEGIC_SHOCKWAVE_CAMERA } from "../game/followCamera.js";
import { BLAST_LIFE, createStrategicShockwaveScene, type SSSceneState } from "../three/strategicShockwaveScene.js";
import { DEV } from "../devMode.js";

// "Bomber" — Pummel Party's Strategic Shockwave: a stone wheel of 97 nodes (eight spokes,
// three rings) packed with crates. A bomb snaps to the nearest node and, three seconds later,
// blasts along its spoke and around its ring until it meets a crate; crates hide +1 range and
// +1 bomb buffs. Two 60 s rounds; when the clock runs out it is sudden death — range 30, ten
// bombs — for up to 20 s more. The rules and numbers come from the decompile (see
// game/strategicShockwave.ts); movement is the shared CharacterMover port, the round
// presentation the shared roundFlow helpers, the camera the CameraFollow port.
// WASD / arrows move, Space drops a bomb.

type Phase = "ready" | "spawning" | "countdown" | "playing" | "ending" | "results";

const N_DEFAULT = 4;
const NAMES = ["You", "Rex", "Bruiser", "Ziggy"];
// the reference bots take the lobby's difficulty; ours alternate Normal and Hard so one of
// them is slow to notice a blast and the next is not
const BOT_DIFFICULTY: BotDifficulty[] = [1, 2, 1, 2, 1, 2, 1];
const RAGDOLL_GRAVITY = 9.81;

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
  diedBefore: number; // `RoundScore`: fighters already dead when this one went
  ragVel: { x: number; y: number; z: number };
  maxBombs: number;
  bombsRemaining: number;
  range: number;
  score: number;
  roundsSurvived: number;
  brain: BotBrain | null;
}

interface ScoreRow {
  name: string;
  color: string;
  score: number;
  isYou: boolean;
  roundsSurvived: number;
}

interface DevHook {
  state(): unknown;
  /** stop the rAF-driven simulation so `tick` is the only clock */
  manual(on: boolean): void;
  tick(ms: number): void;
  begin(): void;
  bomb(): void;
  teleport(x: number, z: number): void;
  setClock(seconds: number): void;
}

export function BombermanPractice({ onLeave, party }: { onLeave: () => void; party?: PartyProps }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [round, setRound] = useState(1);
  const [results, setResults] = useState<ScoreRow[] | null>(null);
  const partyResultRef = useRef<MinigameResult | null>(null);
  const beginRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const cdRef = useRef<HTMLDivElement | null>(null);
  const rosterRef = useRef<HTMLDivElement | null>(null);
  const kitRef = useRef<HTMLDivElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const N = party ? party.seats.length : N_DEFAULT;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const nodes = buildWheel();
    const scene3d = createStrategicShockwaveScene(canvas, nodes);
    const rand = (): number => Math.random();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // ── audio: a few synthesised cues ──
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
      const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    })();
    const noise = (dur: number, gain: number, cut: number): void => {
      const n = ac.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      const f = ac.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cut;
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, ac.currentTime + dur);
      n.connect(f);
      f.connect(g);
      g.connect(master);
      n.start();
      n.stop(ac.currentTime + dur);
    };
    const boom = (): void => {
      noise(0.4, 0.55, 900);
      blip(80, 0.32, "sawtooth", 0.3, 38);
    };

    // ── the wheel ──
    const field = newField(nodes, N, rand);
    const blasts: Array<{ node: number; age: number }> = [];

    // ── fighters ──
    const roster = avatarRoster(resolveLook(myLook()), N);
    const names = party ? party.seats.map((s) => s.name) : NAMES;
    const fighters: Fighter[] = Array.from({ length: N }, (_, i) => ({
      id: i,
      av: roster[i]!,
      name: names[i] ?? `Bot ${i}`,
      isBot: i > 0,
      pos: { x: 0, y: 0, z: 0 },
      mover: new CharacterMover(SHOCKWAVE_MOVER),
      yaw: Math.PI,
      dropping: false,
      dead: false,
      gone: false,
      diedBefore: 0,
      ragVel: { x: 0, y: 0, z: 0 },
      maxBombs: SHOCKWAVE.startBombs,
      bombsRemaining: SHOCKWAVE.startBombs,
      range: SHOCKWAVE.startRange,
      score: 0,
      roundsSurvived: 0,
      brain: i > 0 ? newBotBrain(BOT_DIFFICULTY[(i - 1) % BOT_DIFFICULTY.length]!) : null,
    }));
    const me = fighters[0]!;
    const axisH = new DigitalAxis(REWIRED_DIGITAL_AXIS);
    const axisV = new DigitalAxis(REWIRED_DIGITAL_AXIS);
    const keys = new Set<string>();
    let bombQueued = false;
    const followCam = new FollowCamera(STRATEGIC_SHOCKWAVE_CAMERA);

    // ── match state ──
    let mode: Phase = "ready";
    let clock = 0;
    let roundNo = 1;
    let fallers: Faller[] = [];
    let spawnClock = 0;
    let spawnLandedAt = -1;
    let cdT = 0;
    let cdShown = -1;
    let mtime = 0; // round seconds remaining; runs to −20 through sudden death
    let suddenDeath = false;
    let bannerT = 0;
    let timerSec = Infinity;
    let timerTick = Infinity;
    let endT = 0;
    let resultsT = 0;
    let deadCount = 0;
    let hudDirty = true;

    const alive = (): Fighter[] => fighters.filter((f) => !f.dead);

    function tryBomb(f: Fighter): void {
      const bomb = f.bombsRemaining > 0 ? placeBomb(field, f.pos.x, f.pos.z, f.id, f.range) : null;
      if (!bomb) {
        if (!f.isBot) blip(150, 0.09, "square", 0.12, 110); // `error_sound`
        return;
      }
      f.bombsRemaining--; // `Bomb.Start`
      const n = nodes[bomb.node]!;
      const touch = (SHOCKWAVE.bombRadius + SHOCKWAVE.playerRadius) ** 2;
      bomb.pass = alive()
        .filter((o) => o !== f && (o.pos.x - n.x) ** 2 + (o.pos.z - n.z) ** 2 < touch)
        .map((o) => o.id);
      if (!f.isBot) blip(280, 0.08, "sine", 0.14, 180);
      hudDirty = true;
    }

    // `KillPlayer`: thrown away from the blast, counted, greyed on the roster
    function kill(f: Fighter, fromX: number, fromZ: number): void {
      if (f.dead) return;
      f.dead = true;
      f.diedBefore = deadCount++; // `players.Count - players_alive`
      let dx = f.pos.x - fromX;
      let dz = f.pos.z - fromZ;
      const l = Math.hypot(dx, dz);
      if (l < 1e-3) {
        const a = rand() * Math.PI * 2;
        dx = Math.sin(a);
        dz = Math.cos(a);
      } else {
        dx /= l;
        dz /= l;
      }
      const force = 3.5 + rand() * 2.5; // `Random.Range(3.5f, 6f)`
      f.ragVel = { x: dx * force, y: 4 + rand() * 2, z: dz * force };
      hudDirty = true;
      noise(0.45, 0.5, 1200); // `DeathSplash01`
      if (!f.isBot) blip(300, 0.5, "sawtooth", 0.25, 80);
    }

    // ── match flow ──
    function beginRound(): void {
      resetField(field, N, rand);
      blasts.length = 0;
      deadCount = 0;
      suddenDeath = false;
      bannerT = 0;
      const spawns = spawnNodes(N);
      fighters.forEach((f, i) => {
        const s = nodes[spawns[i % spawns.length]!]!;
        f.pos = { x: s.x, y: 0, z: s.z };
        f.mover.reset();
        f.mover.setForward(0, 1);
        f.yaw = Math.PI; // facing the camera
        f.dead = false;
        f.gone = false;
        f.diedBefore = 0;
        f.maxBombs = SHOCKWAVE.startBombs;
        f.bombsRemaining = SHOCKWAVE.startBombs;
        f.range = SHOCKWAVE.startRange;
        if (f.brain) resetBotBrain(f.brain);
      });
      axisH.reset();
      axisV.reset();
      bombQueued = false;
      followCam.reset();
      for (const f of fighters) followCam.addTarget(f.pos);
      followCam.snap(fighters.map((f) => ({ ...f.pos, dead: false })));
      // `DoSpawnPlayersAnimation`: everyone starts 10 units up and drops in 0.1 s apart
      fallers = makeFallers(fighters.map(() => 0));
      if (reduceMotion) {
        for (const f of fallers) {
          f.y = f.targetY;
          f.landed = true;
        }
      }
      fighters.forEach((f, i) => {
        f.pos.y = fallers[i]!.y;
        f.dropping = !fallers[i]!.landed;
      });
      spawnClock = 0;
      spawnLandedAt = -1;
      timerSec = Infinity;
      timerTick = Infinity;
      mtime = SHOCKWAVE.roundLength;
      if (bannerRef.current) bannerRef.current.style.opacity = "0";
      hudDirty = true;
      mode = "spawning";
      setRound(roundNo);
      setPhase("spawning");
    }

    function beginMatch(): void {
      roundNo = 1;
      for (const f of fighters) {
        f.score = 0;
        f.roundsSurvived = 0;
      }
      resultsT = 0;
      canvas.style.filter = "";
      setResults(null);
      void ac.resume();
      beginRound();
    }
    beginRef.current = beginMatch;

    // `RoundEnded`: bank the round, then the next round or the results
    function finishRound(): void {
      for (const f of fighters) f.score += roundPoints(f.dead, f.diedBefore, N);
      if (roundNo < SHOCKWAVE.rounds) {
        roundNo++;
        beginRound();
        return;
      }
      mode = "results";
      // equal points: whoever outlasted more rounds places higher
      const rows = [...fighters].sort((a, b) => b.score - a.score || b.roundsSurvived - a.roundsSurvived || a.id - b.id);
      const board: ScoreRow[] = rows.map((f) => ({ name: f.name, color: f.av.body, score: f.score, isYou: !f.isBot, roundsSurvived: f.roundsSurvived }));
      const place = rows.indexOf(me) + 1;
      if (party) {
        const places: number[] = new Array(N).fill(N);
        rows.forEach((f, rank) => (places[f.id] = rank + 1));
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

    function updateHud(): void {
      if (!hudDirty || !rosterRef.current) return; // the HUD mounts a render after the round begins
      hudDirty = false;
      rosterRef.current.replaceChildren(
        ...fighters.map((f) => {
          const chip = document.createElement("div");
          chip.style.cssText = `display:flex;align-items:center;gap:6px;padding:3px 8px;border-radius:12px;background:rgba(0,0,0,0.5);color:#fff;font-weight:800;font-size:13px;opacity:${f.dead ? 0.45 : 1}`;
          const dot = document.createElement("span");
          dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${f.av.body};display:inline-block`;
          const pts = document.createElement("span");
          pts.style.cssText = "color:#ffd23f;font-variant-numeric:tabular-nums";
          pts.textContent = String(f.score);
          chip.append(dot, document.createTextNode(f.dead ? `${f.name} ✕` : f.name), pts);
          return chip;
        }),
      );
      if (kitRef.current) kitRef.current.textContent = `💣 ${Math.max(0, me.bombsRemaining)} / ${me.maxBombs}   🔥 ${me.range}`;
    }

    function step(dt: number): void {
      clock += dt;

      if (mode === "results") {
        resultsT += dt;
        canvas.style.filter = `brightness(${resultsBrightness(resultsT).toFixed(3)})`;
        return;
      }

      if (mode === "spawning") {
        spawnClock += dt;
        for (const f of stepFallers(fallers, spawnClock, dt)) {
          fighters[fallers.indexOf(f)]!.dropping = false;
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
        // `BomberController.Update`: at zero everyone gets range 30 and ten bombs
        if (mtime <= 0 && !suddenDeath) {
          suddenDeath = true;
          bannerT = SHOCKWAVE.suddenDeathText;
          for (const f of fighters) {
            f.range = SHOCKWAVE.suddenDeathRange;
            f.maxBombs = SHOCKWAVE.suddenDeathBombs;
            f.bombsRemaining = SHOCKWAVE.suddenDeathBombs;
          }
          hudDirty = true;
          blip(220, 0.5, "sawtooth", 0.22, 110);
          blip(330, 0.5, "sawtooth", 0.16, 165);
        }
        if (timerRef.current) {
          const shown = suddenDeath ? Math.max(0, Math.ceil(mtime + SHOCKWAVE.suddenDeathLength)) : Math.max(0, Math.ceil(mtime));
          if (shown !== timerSec) {
            timerSec = shown;
            timerTick = clock;
            timerRef.current.textContent = `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, "0")}`;
          }
          const k = reduceMotion ? 1 : timerPulseScale(clock - timerTick);
          timerRef.current.style.transform = k === 1 ? "" : `scale(${k.toFixed(3)})`;
          timerRef.current.style.color = suddenDeath ? "#ff4d4d" : mtime <= 10 ? (Math.floor(mtime * 3) % 2 === 0 ? "#ff4d4d" : "#fff") : "#fff";
        }
        // the round ends with one fighter left, or 20 s into sudden death
        if (alive().length <= 1 || mtime <= -SHOCKWAVE.suddenDeathLength) {
          mode = "ending";
          endT = SHOCKWAVE.endHold;
          // whoever is standing now outlasted the round, even if a bomb still burning gets
          // them during the hold (the points come out the same either way)
          for (const f of alive()) f.roundsSurvived++;
        }
      } else if (mode === "ending") {
        endT -= dt;
        if (endT <= 0) {
          finishRound();
          return;
        }
      }

      if (bannerRef.current) {
        bannerT = Math.max(0, bannerT - dt);
        bannerRef.current.style.opacity = String(Math.min(1, bannerT * 2));
      }

      const inRound = mode === "playing" || mode === "countdown" || mode === "ending";
      const playable = mode === "playing";
      if (inRound) {
        // bombs keep burning through the end hold, as in the reference
        for (const boomed of stepBombs(field, dt)) {
          const owner = fighters[boomed.bomb.owner]!;
          owner.bombsRemaining++; // `Bomb.Update`
          const at = nodes[boomed.bomb.node]!;
          for (const h of boomed.bomb.hits) {
            blasts.push({ node: h, age: 0 });
            const n = nodes[h]!;
            for (const f of fighters) if (!f.dead && !f.dropping && inBlast(n, f.pos.x, f.pos.z)) kill(f, at.x, at.z);
          }
          scene3d.addShake(reduceMotion ? 0 : SHOCKWAVE.cameraShake);
          boom();
          hudDirty = true;
        }
        for (const b of blasts) b.age += dt;
        while (blasts.length && blasts[0]!.age >= BLAST_LIFE) blasts.shift();

        for (const f of fighters) {
          if (f.dead) {
            // the ragdoll is thrown clear and drops into the cave
            f.ragVel.y -= RAGDOLL_GRAVITY * dt;
            f.pos.x += f.ragVel.x * dt;
            f.pos.y += f.ragVel.y * dt;
            f.pos.z += f.ragVel.z * dt;
            if (f.pos.y < -4) f.gone = true;
            continue;
          }
          let ax = 0;
          let ay = 0;
          if (!f.isBot) {
            // the keys drive Rewired's digital axes (⅓ s to full), the axes the mover; forward is +z (away from the camera)
            const mv = moveVector(keys);
            ax = axisH.update(playable ? mv.dx : 0, dt);
            ay = axisV.update(playable ? -mv.dy : 0, dt);
            if (bombQueued && playable) tryBomb(f);
          } else if (playable && f.brain) {
            const d = botThink(field, f.brain, { slot: f.id, x: f.pos.x, z: f.pos.z, bombsRemaining: f.bombsRemaining, range: f.range }, clock, rand);
            if (d.placeBomb) tryBomb(f);
            const inp = f.mover.worldInput(d.dx, d.dz, false);
            ax = inp.axisX;
            ay = inp.axisY;
          }
          f.mover.calculateVelocity({ axisX: ax, axisY: ay, jump: false }, dt);
          f.pos.x += f.mover.vx * dt;
          f.pos.z += f.mover.vz * dt;
          const at = resolveBody(field, f.id, f.pos.x, f.pos.z); // crates, rivals' bombs, the wheel's edge
          f.pos.x = at.x;
          f.pos.z = at.z;
          f.mover.finishMove(true, false, dt); // the wheel is flat: always grounded
          // a bomb stops being walk-through once you have stepped off it
          for (const b of field.bombs) {
            const i = b.pass.indexOf(f.id);
            if (i === -1) continue;
            const n = nodes[b.node]!;
            if ((f.pos.x - n.x) ** 2 + (f.pos.z - n.z) ** 2 >= (SHOCKWAVE.bombRadius + SHOCKWAVE.playerRadius) ** 2) b.pass.splice(i, 1);
          }
          // `BomberBuff.OnTriggerEnter`
          for (let i = field.buffs.length - 1; i >= 0; i--) {
            const b = field.buffs[i]!;
            if ((f.pos.x - b.x) ** 2 + (f.pos.z - b.z) ** 2 >= (SHOCKWAVE.buffRadius + SHOCKWAVE.playerRadius) ** 2) continue;
            if (b.kind === "range") f.range++;
            else {
              f.maxBombs++;
              f.bombsRemaining++;
            }
            field.buffs.splice(i, 1);
            if (!f.isBot) blip(560, 0.14, "square", 0.2, 980);
            hudDirty = true;
          }
          // `RotateTowards(LookRotation(movementAxis), 1500°/s)`: the body faces the input direction
          if (ax !== 0 || ay !== 0) {
            const want = Math.atan2(-ax, ay); // forward (0, 1): the strafe axis runs along −x (screen-right)
            let d = want - f.yaw;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            const turn = ((SHOCKWAVE.bodyTurnSpeed * Math.PI) / 180) * dt;
            f.yaw += Math.abs(d) <= turn ? d : Math.sign(d) * turn;
          }
        }
      }
      bombQueued = false;

      followCam.update(fighters.map((f) => ({ ...f.pos, dead: f.dead })), dt);
      updateHud();
    }

    function view(): SSSceneState {
      return {
        blocked: field.blocked,
        threatened: field.hitting.map((h) => h > 0),
        bombs: field.bombs.map((b) => ({ node: b.node, fuse: b.fuse, color: fighters[b.owner]!.av.body })),
        blasts,
        buffs: field.buffs,
        fighters: fighters.map((f) => ({ id: f.id, av: f.av, x: f.pos.x, y: f.pos.y, z: f.pos.z, vx: f.mover.vx, vz: f.mover.vz, yaw: f.yaw, isYou: !f.isBot, dead: f.dead, gone: f.gone })),
        camera: followCam.position,
        time: clock,
      };
    }

    let last = performance.now();
    let raf = 0;
    let manual = false;
    function frame(now: number): void {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      if (!manual) step(dt);
      scene3d.draw(view(), manual ? 0 : dt);
      raf = requestAnimationFrame(frame);
    }

    const kd = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (bound("action", k) && !e.repeat) bombQueued = true;
      if (isGameKey(k)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent): void => void keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);

    // dev builds only: a readout and a manual clock, so an automated browser run can drive the
    // simulation when the tab's rAF is throttled
    const w = window as unknown as { __bomber?: DevHook };
    if (DEV) {
      w.__bomber = {
        state: () => ({
          mode,
          round: roundNo,
          mtime,
          suddenDeath,
          crates: field.blocked.filter(Boolean).length,
          bombs: field.bombs.map((b) => ({ node: b.node, owner: b.owner, fuse: b.fuse, hits: b.hits.length })),
          buffs: field.buffs.map((b) => ({ node: b.node, kind: b.kind })),
          fighters: fighters.map((f) => ({ name: f.name, x: f.pos.x, y: f.pos.y, z: f.pos.z, dead: f.dead, bombs: f.bombsRemaining, max: f.maxBombs, range: f.range, score: f.score, bot: f.brain?.state })),
        }),
        manual: (on) => {
          manual = on;
        },
        tick: (ms) => {
          for (let left = ms / 1000; left > 1e-9; left -= 1 / 60) step(Math.min(1 / 60, left));
        },
        begin: () => beginMatch(),
        bomb: () => {
          bombQueued = true;
        },
        teleport: (x, z) => {
          me.pos.x = x;
          me.pos.z = z;
        },
        setClock: (seconds) => {
          mtime = seconds;
        },
      };
    }

    if (party) beginMatch(); // a board round starts on its own
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      if (DEV) delete w.__bomber;
      if (ac.state !== "closed") void ac.close().catch(() => undefined);
      scene3d.dispose();
    };
  }, []);

  const inMatch = phase === "playing" || phase === "countdown" || phase === "spawning" || phase === "ending";
  const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  return (
    <main style={{ minHeight: "100vh", padding: 16, maxWidth: 1040, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Bomber</h1>
        <button onClick={onLeave}>Leave</button>
      </header>

      <div style={{ position: "relative", width: "100%", maxWidth: 960, margin: "0 auto" }}>
        <canvas ref={canvasRef} width={960} height={540} style={{ width: "100%", aspectRatio: "16 / 9", background: "#0b1620", borderRadius: 8, display: "block" }} />

        {inMatch && (
          <>
            {/* `CreateScoreUI(TopLeft)`: scores, and who is still up */}
            <div ref={rosterRef} style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6, flexWrap: "wrap", maxWidth: "70%", pointerEvents: "none" }} />
            {/* `CreateTimer(TopRight)`, pulsing each second; counts the sudden death down in red */}
            <div style={{ position: "absolute", top: 10, right: 16, textAlign: "right", pointerEvents: "none" }}>
              <div ref={timerRef} style={{ color: "#fff", fontWeight: 900, fontSize: 26, textShadow: "0 1px 4px #000", transformOrigin: "100% 50%" }}>
                {fmt(SHOCKWAVE.roundLength)}
              </div>
              <div style={{ color: "rgba(255,255,255,0.75)", fontWeight: 700, fontSize: 12, textShadow: "0 1px 3px #000" }}>
                Round {round} / {SHOCKWAVE.rounds}
              </div>
            </div>
            <div ref={kitRef} style={{ position: "absolute", bottom: 12, left: 16, color: "#fff", fontWeight: 800, fontSize: 15, textShadow: "0 1px 3px #000", pointerEvents: "none", whiteSpace: "pre" }}>
              💣 1 / 1   🔥 1
            </div>
            <div style={{ position: "absolute", bottom: 12, right: 16, color: "rgba(255,255,255,0.6)", fontSize: 12, textShadow: "0 1px 3px #000", pointerEvents: "none" }}>WASD move · Space bomb</div>
            {/* `ShowLargeText("Sudden Death", …, 4f)` */}
            <div ref={bannerRef} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", opacity: 0 }}>
              <div style={{ fontSize: 64, fontWeight: 900, color: "#ff4d4d", textShadow: "0 3px 18px #000", letterSpacing: 2, textTransform: "uppercase" }}>Sudden Death</div>
            </div>
          </>
        )}

        {phase === "spawning" && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div key={round} className="bb-reveal" style={{ fontSize: 44, fontWeight: 900, color: "#ffe6bf", textShadow: "0 3px 18px #000", letterSpacing: 2 }}>
              Round {round}
            </div>
          </div>
        )}

        {phase === "countdown" && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div ref={cdRef} className="bb-cd" style={{ fontSize: 112, fontWeight: 900, color: "#ffe6bf", textShadow: "0 3px 18px #000", letterSpacing: 2 }}>
              3
            </div>
          </div>
        )}

        {phase === "ready" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(8,14,20,0.84)", borderRadius: 8, textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: "#ffe6bf" }}>Bomber</div>
            <div style={{ fontSize: 15, opacity: 0.85, maxWidth: 520, lineHeight: 1.5 }}>
              <strong>WASD</strong> move · <strong>Space</strong> drop a bomb. A bomb goes off after {SHOCKWAVE.fuse} seconds and blasts along its spoke and around its ring until it hits a crate — the red skulls show where. Crates hide <span style={{ color: "#ff8a4c" }}>+1 range</span> and <span style={{ color: "#6dc9ff" }}>+1 bomb</span>. {SHOCKWAVE.rounds} rounds of {SHOCKWAVE.roundLength} seconds; when the clock runs out it is sudden death.
            </div>
            <button className="primary" style={{ fontSize: 18, padding: "10px 26px" }} onClick={() => beginRef.current?.()}>
              Start
            </button>
          </div>
        )}

        {phase === "results" && results && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 8, textAlign: "center", padding: 20, pointerEvents: "none" }}>
            <div className="bb-reveal" style={{ animationDelay: `${placementDelay(0)}s`, fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "#e9dcc8", textShadow: "0 1px 4px #000" }}>
              Match Over
            </div>
            <div className="bb-reveal" style={{ animationDelay: `${placementDelay(0)}s`, fontSize: 32, fontWeight: 900, color: results[0]!.color, textShadow: "0 2px 12px #000, 0 0 2px #000" }}>
              {results[0]!.isYou ? "You win!" : `${results[0]!.name} wins!`}
            </div>
            <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {results.map((r, i) => (
                <div
                  key={r.name + i}
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
                  <span style={{ color: r.roundsSurvived > 0 ? "#4ade80" : "#ff8a65" }}>
                    Survived {r.roundsSurvived} / {SHOCKWAVE.rounds}
                  </span>
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
