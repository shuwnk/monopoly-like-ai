import { useEffect, useRef, useState } from "react";
import type { PlayerId } from "@party-monopoly/types";
import type { ShowdownSignal } from "../store/onlineStore.js";
import { DuelSignal } from "./DuelSignal.js";
import { marginLine, reactionLabel } from "./duelReveal.js";

// how long to hold the reveal before letting the resolved board take over
const REVEAL_MS = 2200;

// Single-seat reflex duel. The server drives timing: red on "start", green on
// "go" (we measure from then), the opponent is on another machine. After a tap
// we wait for the server's "result", show both reaction times, then dismiss.
//
// Only the payer and the owner duel. At a table of 3+ everyone else gets the same
// view as a scoreboard: no tap button, no keys, and both duellists named — a
// spectator's tap is ignored by the server anyway.
export function OnlineReflexDuel({
  signal,
  you,
  payerName,
  ownerName,
  onTap,
  onRevealDone,
}: {
  signal: ShowdownSignal;
  you: PlayerId | null;
  payerName: string;
  ownerName: string;
  onTap: (reactionMs: number | null, falseStart: boolean) => void;
  onRevealDone: () => void;
}): JSX.Element {
  const lit = signal.phase === "go";
  // null until this client taps; then whether it was an early (red) tap
  const [myTap, setMyTap] = useState<{ falseStart: boolean } | null>(null);
  const goAt = useRef<number | null>(null);
  const youArePayer = you !== null && you === signal.payerId;
  const youAreOwner = you !== null && you === signal.ownerId;
  const spectating = !youArePayer && !youAreOwner;

  // a new "go" (seq bump) means measuring starts now
  useEffect(() => {
    if (signal.phase === "go") goAt.current = performance.now();
  }, [signal.phase, signal.seq]);

  function tap(): void {
    if (spectating || myTap || signal.phase === "result") return;
    if (goAt.current === null) {
      setMyTap({ falseStart: true });
      onTap(null, true); // tapped on red
    } else {
      setMyTap({ falseStart: false });
      onTap(performance.now() - goAt.current, false);
    }
  }

  useEffect(() => {
    if (spectating) return;
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

  const message = spectating
    ? lit
      ? "GO!"
      : "Watch — they're waiting for green…"
    : myTap
      ? myTap.falseStart
        ? "Too soon — you jumped early!"
        : "Tapped ✓ — waiting for the other player…"
      : lit
        ? "TAP!"
        : "Wait for green…";

  return (
    <section style={{ margin: "16px 0", padding: 14, border: "1px solid var(--neon-a)", borderRadius: "var(--radius)", background: "var(--neon-bg)", color: "#e9ecf4", boxShadow: "0 0 26px rgba(224,57,143,0.35)" }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Rent Showdown — {payerName} vs {ownerName}.</strong> Base rent R${signal.baseRent}.{" "}
        {spectating ? "You're watching this one." : (
          <>
            Tap <kbd>Space</kbd> on green.
          </>
        )}
      </div>
      <DuelSignal lit={lit} message={signal.phase === "result" ? "Result" : message} />
      {signal.phase === "result" && signal.result ? (
        <Reveal signal={signal} youArePayer={youArePayer} spectating={spectating} payerName={payerName} ownerName={ownerName} />
      ) : (
        !spectating && (
          <button style={{ width: "100%", padding: 16, marginTop: 8 }} disabled={myTap !== null} onClick={tap}>
            Tap!
          </button>
        )
      )}
    </section>
  );
}

// both reaction times plus the margin line — the same reveal the hotseat duel
// shows. A duellist reads You / Opponent; everyone else reads both real names.
function Reveal({
  signal,
  youArePayer,
  spectating,
  payerName,
  ownerName,
}: {
  signal: ShowdownSignal;
  youArePayer: boolean;
  spectating: boolean;
  payerName: string;
  ownerName: string;
}): JSX.Element {
  const r = signal.result!;
  const payerLabel = spectating ? payerName : youArePayer ? "You" : "Opponent";
  const ownerLabel = spectating ? ownerName : youArePayer ? "Opponent" : "You";
  const a = { reactionMs: r.payerReactionMs, falseStart: r.payerFalseStart };
  const b = { reactionMs: r.ownerReactionMs, falseStart: r.ownerFalseStart };

  return (
    <div style={{ marginTop: 8, padding: 10, background: "#181820", border: "1px solid #444", borderRadius: 4, fontSize: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span>
          {payerLabel}: <strong>{reactionLabel(a)}</strong>
        </span>
        <span>
          {ownerLabel}: <strong>{reactionLabel(b)}</strong>
        </span>
      </div>
      <div style={{ marginTop: 6, textAlign: "center", opacity: 0.85 }}>
        {marginLine(a, b, r.outcome, r.aborted, payerLabel, ownerLabel)}
      </div>
    </div>
  );
}
