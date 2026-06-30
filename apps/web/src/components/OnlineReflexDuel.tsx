import { useEffect, useRef, useState } from "react";
import type { ShowdownSignal } from "../store/onlineStore.js";
import { DuelSignal } from "./DuelSignal.js";

// single-seat reflex duel. the server drives timing: red on "start", green on
// "go" (we measure from then), the opponent is on another machine. after a tap
// we wait — the next authoritative state ends the showdown.
export function OnlineReflexDuel({
  signal,
  onTap,
}: {
  signal: ShowdownSignal;
  onTap: (reactionMs: number | null, falseStart: boolean) => void;
}): JSX.Element {
  const lit = signal.phase === "go";
  const [tapped, setTapped] = useState(false);
  const goAt = useRef<number | null>(null);

  // a new "go" (seq bump) means measuring starts now
  useEffect(() => {
    if (signal.phase === "go") goAt.current = performance.now();
  }, [signal.phase, signal.seq]);

  function tap(): void {
    if (tapped) return;
    setTapped(true);
    if (goAt.current === null) onTap(null, true); // tapped on red
    else onTap(performance.now() - goAt.current, false);
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

  const message = tapped ? "Tapped — waiting for the other player…" : lit ? "TAP!" : "Wait for green…";
  return (
    <section style={{ margin: "16px 0", padding: 12, border: "1px solid #444", borderRadius: 4 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Rent Showdown — Reflex Tap Duel.</strong> Base rent ₸{signal.baseRent}. Tap <kbd>Space</kbd> on green.
      </div>
      <DuelSignal lit={lit} message={message} />
      <button style={{ width: "100%", padding: 16, marginTop: 8 }} disabled={tapped} onClick={tap}>
        Tap!
      </button>
    </section>
  );
}
