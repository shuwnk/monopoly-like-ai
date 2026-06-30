import { useEffect, useRef, useState } from "react";
import type { MinigameRequest, MinigameResult } from "@party-monopoly/types";
import { DuelSignal } from "./DuelSignal.js";
import {
  adjudicateReflexDuel,
  DEFAULT_REFLEX_TAP_DUEL_CONFIG as CFG,
  type ReflexInput,
} from "@party-monopoly/minigame-harness";
import { aiReflexInput } from "@party-monopoly/ai";

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

export function ReflexTapDuel({
  request,
  onResult,
  onMetrics,
  aiSeat,
  aiSkill = 0.6,
}: {
  request: MinigameRequest;
  onResult: (result: MinigameResult) => void;
  // optional telemetry hook: fired with the resolved result and both raw inputs.
  // existing callers (HotseatGame) can ignore it.
  onMetrics?: (result: MinigameResult, inputs: [ReflexInput, ReflexInput]) => void;
  aiSeat?: 0 | 1;
  aiSkill?: number;
}): JSX.Element {
  const [payer, owner] = request.participants;
  const payerName = "Payer";
  const ownerName = "Owner";

  const [phase, setPhase] = useState<Phase>("waiting");
  const [message, setMessage] = useState("Wait for green…");
  // mirror of phase readable inside timer callbacks, where state is stale
  const phaseRef = useRef<Phase>("waiting");
  phaseRef.current = phase;
  const greenAt = useRef<number | null>(null);
  const inputs = useRef<[ReflexInput, ReflexInput]>([nullInput(), nullInput()]);
  const rearmed = useRef(false);
  const timers = useRef<number[]>([]);

  function clearTimers(): void {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }

  function arm(): void {
    clearTimers();
    greenAt.current = null;
    inputs.current = [nullInput(), nullInput()];
    setPhase("waiting");
    setMessage("Wait for green…");
    const delay = CFG.minDelayMs + Math.random() * (CFG.maxDelayMs - CFG.minDelayMs);

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
    const [a, b] = inputs.current;
    if ((a.falseStart && b.falseStart) || (settled(a) && settled(b))) resolve();
  }

  // record one player's input for this round, then finish once both have acted
  function tap(player: 0 | 1): void {
    if (player === aiSeat) return; // the bot drives its own seat
    if (phase === "done") return;
    if (inputs.current[player].falseStart || inputs.current[player].reactionMs !== null) return;

    if (phase === "waiting") {
      inputs.current[player] = { reactionMs: null, falseStart: true };
    } else {
      inputs.current[player] = { reactionMs: performance.now() - greenAt.current!, falseStart: false };
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
    onMetrics?.(result, [a, b]);
    timers.current.push(window.setTimeout(() => onResult(result), 1200));
  }

  useEffect(() => {
    arm();
    function onKey(e: KeyboardEvent): void {
      const k = e.key.toLowerCase();
      if (k === PAYER_KEY) tap(0);
      else if (k === OWNER_KEY) tap(1);
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
    <section style={{ margin: "16px 0", padding: 12, border: "1px solid #444", borderRadius: 4 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Rent Showdown — Reflex Tap Duel.</strong> Base rent ₸{request.context.stakeData.baseRent}.{" "}
        {aiSeat === undefined
          ? <>{payerName} taps <kbd>A</kbd>, {ownerName} taps <kbd>L</kbd>.</>
          : <>You tap <kbd>{aiSeat === 0 ? "L" : "A"}</kbd>, the bot reacts on its own.</>}
      </div>
      <DuelSignal lit={lit} message={message} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button style={{ flex: 1, padding: 16 }} disabled={aiSeat === 0} onClick={() => tap(0)}>
          {payerName} (A){aiSeat === 0 ? " — bot" : ""}
        </button>
        <button style={{ flex: 1, padding: 16 }} disabled={aiSeat === 1} onClick={() => tap(1)}>
          {ownerName} (L){aiSeat === 1 ? " — bot" : ""}
        </button>
      </div>
    </section>
  );
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
