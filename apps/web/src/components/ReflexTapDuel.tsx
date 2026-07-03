import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MinigameRequest, MinigameResult } from "@party-monopoly/types";
import { DuelSignal } from "./DuelSignal.js";
import {
  adjudicateReflexDuel,
  DEFAULT_REFLEX_TAP_DUEL_CONFIG as CFG,
  type ReflexInput,
} from "@party-monopoly/minigame-harness";
import { aiReflexInput } from "@party-monopoly/ai";
import { marginLine, reactionLabel } from "./duelReveal.js";
import type { InputDevice } from "../telemetry/duel.js";

// Two-player hotseat reflex duel on one keyboard. Payer taps A, owner taps L,
// or use the on-screen buttons. Red panel -> green after a random delay; first
// valid tap after green wins, a tap during red is a false start. Wall-clock is
// fine here, this is the UI layer — only the engine stays clock-free.
//
// Pass aiSeat (0 or 1) to make that seat a bot: it auto-generates an input from
// aiReflexInput each round instead of waiting for a key. Without aiSeat the
// component is the unchanged two-human duel.

const PAYER_KEY = "a";
const OWNER_KEY = "l";
const TIMEOUT_MS = 3000; // give up on a player who never taps after green

type Phase = "waiting" | "go" | "done";
// per-seat feedback so a tap is never silent
type SeatStatus = "idle" | "early" | "tapped";

export function ReflexTapDuel({
  request,
  onResult,
  onMetrics,
  aiSeat,
  aiSkill = 0.6,
}: {
  request: MinigameRequest;
  onResult: (result: MinigameResult) => void;
  // optional telemetry hook: fired with the resolved result, both raw inputs,
  // and round meta (the red hold before green). existing callers can ignore it.
  onMetrics?: (
    result: MinigameResult,
    inputs: [ReflexInput, ReflexInput],
    meta: { preGoDelayMs: number | null; devices: [InputDevice, InputDevice] },
  ) => void;
  aiSeat?: 0 | 1;
  aiSkill?: number;
}): JSX.Element {
  const [payer, owner] = request.participants;
  const payerName = "Payer";
  const ownerName = "Owner";

  const [phase, setPhase] = useState<Phase>("waiting");
  const [message, setMessage] = useState("Wait for green…");
  // idle | early (false start) | tapped — drives the per-button feedback
  const [seatStatus, setSeatStatus] = useState<[SeatStatus, SeatStatus]>(["idle", "idle"]);
  // mirror of phase readable inside timer callbacks, where state is stale
  const phaseRef = useRef<Phase>("waiting");
  phaseRef.current = phase;
  const greenAt = useRef<number | null>(null);
  const inputs = useRef<[ReflexInput, ReflexInput]>([nullInput(), nullInput()]);
  // how each seat tapped this round, for the fairness telemetry
  const devices = useRef<[InputDevice, InputDevice]>(["unknown", "unknown"]);
  const rearmed = useRef(false);
  const timers = useRef<number[]>([]);
  // the randomized red hold for this round, surfaced to telemetry
  const preGoDelay = useRef<number | null>(null);
  // both inputs + result, shown after the duel so the outcome is legibly fair
  const [reveal, setReveal] = useState<{ a: ReflexInput; b: ReflexInput; result: MinigameResult } | null>(null);

  function clearTimers(): void {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }

  function arm(): void {
    clearTimers();
    greenAt.current = null;
    inputs.current = [nullInput(), nullInput()];
    devices.current = ["unknown", "unknown"];
    setPhase("waiting");
    setMessage("Wait for green…");
    setSeatStatus(["idle", "idle"]);
    setReveal(null);
    const delay = CFG.minDelayMs + Math.random() * (CFG.maxDelayMs - CFG.minDelayMs);
    preGoDelay.current = delay;

    // sample the bot's round up front so a false start can fire during red
    const ai = aiSeat !== undefined ? aiReflexInput(aiSkill) : null;
    if (ai?.falseStart) {
      timers.current.push(window.setTimeout(() => recordAI(aiSeat!, ai), delay * 0.5));
    }

    timers.current.push(
      window.setTimeout(() => {
        greenAt.current = performance.now();
        setPhase("go");
        setMessage("TAP!");
        if (ai && !ai.falseStart) {
          timers.current.push(window.setTimeout(() => recordAI(aiSeat!, ai), ai.reactionMs ?? TIMEOUT_MS));
        }
        timers.current.push(window.setTimeout(() => resolve(), TIMEOUT_MS));
      }, delay),
    );
  }

  // write the bot's pre-sampled input straight in (no wall-clock measure), then
  // settle the same way a human tap does
  function recordAI(seat: 0 | 1, input: ReflexInput): void {
    if (phaseRef.current === "done") return;
    if (settled(inputs.current[seat])) return;
    inputs.current[seat] = input;
    devices.current[seat] = "bot";
    setSeatStatus((s) => withSeat(s, seat, input.falseStart ? "early" : "tapped"));
    const [a, b] = inputs.current;
    if ((a.falseStart && b.falseStart) || (settled(a) && settled(b))) resolve();
  }

  // record one player's input for this round, then finish once both have acted.
  // reads phaseRef, not the phase state: the keydown handler is bound once on
  // mount and would otherwise close over a stale "waiting" and mis-flag every
  // key press as a false start.
  function tap(player: 0 | 1, device: InputDevice): void {
    if (player === aiSeat) return; // the bot drives its own seat
    const current = phaseRef.current;
    if (current === "done") return;
    if (inputs.current[player].falseStart || inputs.current[player].reactionMs !== null) return;
    devices.current[player] = device;

    if (current === "waiting") {
      inputs.current[player] = { reactionMs: null, falseStart: true };
      setSeatStatus((s) => withSeat(s, player, "early"));
    } else {
      inputs.current[player] = { reactionMs: performance.now() - greenAt.current!, falseStart: false };
      setSeatStatus((s) => withSeat(s, player, "tapped"));
    }

    const [a, b] = inputs.current;
    const bothFalse = a.falseStart && b.falseStart;
    const bothActed = settled(a) && settled(b);
    if (bothFalse || bothActed) resolve();
  }

  function resolve(): void {
    clearTimers();
    const [a, b] = inputs.current;

    // one re-arm on a double false start before we abort
    if (a.falseStart && b.falseStart && !rearmed.current) {
      rearmed.current = true;
      setMessage("Both jumped early — one more try…");
      timers.current.push(window.setTimeout(() => arm(), 1200));
      return;
    }

    setPhase("done");
    const result = adjudicateReflexDuel(a, b, payer!.playerId, owner!.playerId, CFG.drawWindowMs);
    setMessage(resultLine(result, payerName, ownerName));
    setReveal({ a, b, result });
    onMetrics?.(result, [a, b], { preGoDelayMs: preGoDelay.current, devices: [...devices.current] });
    // longer hold so both reaction times and the margin are readable before advancing
    timers.current.push(window.setTimeout(() => onResult(result), 2200));
  }

  useEffect(() => {
    arm();
    function onKey(e: KeyboardEvent): void {
      const k = e.key.toLowerCase();
      if (k === PAYER_KEY) tap(0, "keyboard");
      else if (k === OWNER_KEY) tap(1, "keyboard");
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimers();
    };
    // run once per mount; the parent remounts us per showdown via key
  }, []);

  const lit = phase === "go";
  return (
    <section style={{ margin: "16px 0", padding: 14, border: "1px solid var(--neon-a)", borderRadius: "var(--radius)", background: "var(--neon-bg)", color: "#e9ecf4", boxShadow: "0 0 26px rgba(224,57,143,0.35)" }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Rent Showdown — Reflex Tap Duel.</strong> Base rent R${request.context.stakeData.baseRent}.{" "}
        {aiSeat === undefined
          ? <>{payerName} taps <kbd>A</kbd>, {ownerName} taps <kbd>L</kbd>.</>
          : <>You tap <kbd>{aiSeat === 0 ? "L" : "A"}</kbd>, the bot reacts on its own.</>}
      </div>
      <DuelSignal lit={lit} message={message} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          style={seatButtonStyle(seatStatus[0], aiSeat === 0)}
          disabled={aiSeat === 0 || phase === "done" || settled(inputs.current[0])}
          onPointerDown={(e) => tap(0, pointerDevice(e.pointerType))}
        >
          {payerName} (A){seatSuffix(seatStatus[0], aiSeat === 0)}
        </button>
        <button
          style={seatButtonStyle(seatStatus[1], aiSeat === 1)}
          disabled={aiSeat === 1 || phase === "done" || settled(inputs.current[1])}
          onPointerDown={(e) => tap(1, pointerDevice(e.pointerType))}
        >
          {ownerName} (L){seatSuffix(seatStatus[1], aiSeat === 1)}
        </button>
      </div>
      {reveal && (
        <div style={{ marginTop: 8, padding: 10, background: "#181820", border: "1px solid #444", borderRadius: 4, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{payerName}: <strong>{reactionLabel(reveal.a)}</strong></span>
            <span>{ownerName}: <strong>{reactionLabel(reveal.b)}</strong></span>
          </div>
          <div style={{ marginTop: 6, textAlign: "center", opacity: 0.85 }}>
            {marginLine(reveal.a, reveal.b, reveal.result.outcome, reveal.result.status === "ABORTED", payerName, ownerName)}
          </div>
        </div>
      )}
    </section>
  );
}

// swap one seat's value in the [p0, p1] pair without mutating it
function withSeat<T>(pair: readonly [T, T], seat: 0 | 1, value: T): [T, T] {
  return seat === 0 ? [value, pair[1]] : [pair[0], value];
}

// a tap must never look like nothing happened: colour and label the button by
// what the seat just did (jumped early / tapped in time)
function seatButtonStyle(status: SeatStatus, isBot: boolean): CSSProperties {
  const base: CSSProperties = { flex: 1, padding: 16, borderRadius: 4, border: "1px solid #555", color: "#eee" };
  if (isBot) return { ...base, background: "#2a2a33", opacity: 0.6 };
  if (status === "early") return { ...base, background: "#4a1622", borderColor: "#FF5468", color: "#ffd7dd" };
  if (status === "tapped") return { ...base, background: "#12351f", borderColor: "#3DDC84", color: "#c8f7d8" };
  return { ...base, background: "#2a2a33" };
}

function seatSuffix(status: SeatStatus, isBot: boolean): string {
  if (isBot) return " — bot";
  if (status === "early") return " — too soon!";
  if (status === "tapped") return " — tapped ✓";
  return "";
}

// map a PointerEvent.pointerType onto our telemetry device tags
function pointerDevice(pointerType: string): InputDevice {
  return pointerType === "mouse" || pointerType === "touch" || pointerType === "pen" ? pointerType : "unknown";
}

function nullInput(): ReflexInput {
  return { reactionMs: null, falseStart: false };
}

function settled(i: ReflexInput): boolean {
  return i.falseStart || i.reactionMs !== null;
}

function resultLine(result: MinigameResult, payerName: string, ownerName: string): string {
  if (result.outcome === "DRAW") return result.status === "ABORTED" ? "Aborted — flat rent." : "Draw!";
  return result.outcome === "P0_WIN" ? `${payerName} wins!` : `${ownerName} wins!`;
}
