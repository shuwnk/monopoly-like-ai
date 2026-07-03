import { useState } from "react";
import { createInitialState, reduce, type GameState } from "@party-monopoly/engine";
import { asPlayerId } from "@party-monopoly/types";
import { IsoBoard } from "./IsoBoard.js";
import { copaTargets } from "./TurnChoices.js";

// Isolated test bed for the Copa (World Cup) pick — like Airport Practice. Only
// YOUR own, not-yet-boosted cities light up; the rival's cities, islands and
// specials stay greyed out.

const P0 = asPlayerId("p0");
const P1 = asPlayerId("p1");

function armCopa(): GameState {
  const base = createInitialState({
    seed: Date.now(),
    players: [
      { id: P0, name: "You", isAI: false },
      { id: P1, name: "Rival", isAI: true },
    ],
  });
  // p0 owns several cities (one already boosted → excluded); p1 owns the rest
  const ownership: Record<number, typeof P0> = { 1: P0, 3: P1, 6: P0, 9: P1, 13: P0, 18: P1, 25: P0, 31: P1, 35: P0, 39: P0 };
  return {
    ...base,
    ownership,
    buildings: { 1: 1, 6: 2, 25: 3 },
    rentBoosts: { 6: 2 }, // already boosted, so it should stay greyed out
    phase: "AWAITING_WORLD_CUP",
  };
}

export function CopaPractice({ onLeave }: { onLeave: () => void }): JSX.Element {
  const [state, setState] = useState<GameState>(armCopa);
  const [log, setLog] = useState<string[]>([]);
  const picking = state.phase === "AWAITING_WORLD_CUP";

  function boost(squareId: number): void {
    const name = state.board[squareId]?.name ?? `#${squareId}`;
    const next = reduce(state, { type: "SELECT_WORLD_CUP_TILE", squareId }).state;
    // stay in the Copa pick so you can boost several cities and watch each value
    // double — the reducer would otherwise end the turn (and the rich test player
    // would instantly hit the win goal). Keep the accumulated rentBoosts.
    setState({ ...next, phase: "AWAITING_WORLD_CUP", winnerId: null });
    setLog((l) => [`Boosted ${name} → value now ×${next.rentBoosts[squareId] ?? 1}`, ...l]);
  }

  function again(): void {
    setState(armCopa());
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Party Monopoly — Copa Practice</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="primary" onClick={again}>
            New Copa
          </button>
          <button onClick={onLeave}>Leave</button>
        </div>
      </header>

      <section style={{ margin: "12px 0", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
        {picking
          ? "⚽ Copa — tap one of YOUR highlighted cities to multiply its rent. Boosts STACK (tap again to go ×4, ×8…). Rival cities, islands and specials stay greyed out."
          : `Boosted. Hit “New Copa” to test again.`}
      </section>

      {log.length > 0 && (
        <section style={{ margin: "8px 0", fontSize: 13, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>
          {log.slice(0, 6).map((line, i) => (
            <div key={i}>• {line}</div>
          ))}
        </section>
      )}

      <section>
        <IsoBoard state={state} {...(picking ? { pickTiles: copaTargets(state, P0), onPickTile: boost } : {})} />
      </section>
    </main>
  );
}
