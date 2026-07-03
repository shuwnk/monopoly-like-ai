import { useEffect, useRef, useState } from "react";
import type { PlayerId } from "@party-monopoly/types";
import type { ShowdownSignal } from "../store/onlineStore.js";
import { DuelSignal } from "./DuelSignal.js";
import { marginLine, reactionLabel } from "./duelReveal.js";

// how long to hold the reveal before letting the resolved board take over
const REVEAL_MS = 2200;

// single-seat reflex duel. the server drives timing: red on "start", green on
// "go" (we measure from then), the opponent is on another machine. after a tap
// we wait for the server's "result", show both reaction times, then dismiss.
export function OnlineReflexDuel({
  signal,
  you,
  onTap,
  onRevealDone,
}: {
  signal: ShowdownSignal;
  you: PlayerId | null;
  onTap: (reactionMs: number | null, falseStart: boolean) => void;
  onRevealDone: () => void;
}): JSX.Element {
  const lit = signal.phase === "go";
  // null until this client taps; then whether it was an early (red) tap
  const [myTap, setMyTap] = useState<{ falseStart: boolean } | null>(null);
  const goAt = useRef<number | null>(null);

  // a new "go" (seq bump) means measuring starts now
  useEffect(() => {
    if (signal.phase === "go") goAt.current = performance.now();
  }, [signal.phase, signal.seq]);

  function tap(): void {
    if (myTap || signal.phase === "result") return;
    if (goAt.current === null) {
      setMyTap({ falseStart: true });
      onTap(null, true); // tapped on red
    } else {
      setMyTap({ falseStart: false });
      onTap(performance.now() - goAt.current, false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        tap();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // once the server's result lands, hold the reveal briefly then release the view
  useEffect(() => {
    if (signal.phase !== "result") return;
    const t = window.setTimeout(onRevealDone, REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [signal.phase, signal.id, onRevealDone]);

  const message = myTap
    ? myTap.falseStart
      ? "Too soon — you jumped early!"
      : "Tapped ✓ — waiting for the other player…"
    : lit
      ? "TAP!"
      : "Wait for green…";

  return (
    <section style={{ margin: "16px 0", padding: 14, border: "1px solid var(--neon-a)", borderRadius: "var(--radius)", background: "var(--neon-bg)", color: "#e9ecf4", boxShadow: "0 0 26px rgba(224,57,143,0.35)" }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Rent Showdown — Reflex Tap Duel.</strong> Base rent R${signal.baseRent}. Tap <kbd>Space</kbd> on green.
      </div>
      <DuelSignal lit={lit} message={signal.phase === "result" ? "Result" : message} />
      {signal.phase === "result" && signal.result ? (
        <Reveal signal={signal} you={you} />
      ) : (
        <button
          style={{ width: "100%", padding: 16, marginTop: 8 }}
          disabled={myTap !== null}
          onClick={tap}
        >
          Tap!
        </button>
      )}
    </section>
  );
}

// both reaction times labelled You / Opponent (the recipient maps itself via
// its PlayerId), plus the margin line — the same reveal the hotseat duel shows
function Reveal({ signal, you }: { signal: ShowdownSignal; you: PlayerId | null }): JSX.Element {
  const r = signal.result!;
  const youArePayer = you !== null && you === r.payerId;
  const payerName = youArePayer ? "You" : "Opponent";
  const ownerName = youArePayer ? "Opponent" : "You";
  const a = { reactionMs: r.payerReactionMs, falseStart: r.payerFalseStart };
  const b = { reactionMs: r.ownerReactionMs, falseStart: r.ownerFalseStart };

  return (
    <div style={{ marginTop: 8, padding: 10, background: "#181820", border: "1px solid #444", borderRadius: 4, fontSize: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>
          {payerName}: <strong>{reactionLabel(a)}</strong>
        </span>
        <span>
          {ownerName}: <strong>{reactionLabel(b)}</strong>
        </span>
      </div>
      <div style={{ marginTop: 6, textAlign: "center", opacity: 0.85 }}>
        {marginLine(a, b, r.outcome, r.aborted, payerName, ownerName)}
      </div>
    </div>
  );
}
