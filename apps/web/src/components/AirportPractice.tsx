import { useState } from "react";
import { createInitialState, reduce, type GameState } from "@party-monopoly/engine";
import { asPlayerId } from "@party-monopoly/types";
import { IsoBoard } from "./IsoBoard.js";
import { airportTargets } from "./TurnChoices.js";

// Isolated test bed for the Aeroporto pick — like Duel Practice, but for the
// fly-to-a-city selection. Arms a state parked at AWAITING_AIRPORT on a populated
// board so you can eyeball the grey/highlight and clicking, over and over.

const P0 = asPlayerId("p0");
const P1 = asPlayerId("p1");

// a board with some properties owned + built, active player standing on the airport
function armAirport(): GameState {
  const base = createInitialState({
    seed: Date.now(),
    players: [
      { id: P0, name: "You", isAI: false },
      { id: P1, name: "Rival", isAI: true },
    ],
  });
  const ownership: Record<number, typeof P0> = { 1: P0, 3: P1, 6: P0, 9: P1, 13: P0, 18: P1, 25: P0, 31: P1, 35: P0, 39: P1 };
  return {
    ...base,
    ownership,
    buildings: { 1: 1, 6: 2, 25: 3, 31: 2 },
    phase: "AWAITING_AIRPORT",
    players: base.players.map((p, i) => (i === 0 ? { ...p, position: 30 } : p)),
  };
}

export function AirportPractice({ onLeave }: { onLeave: () => void }): JSX.Element {
  const [state, setState] = useState<GameState>(armAirport);
  const [log, setLog] = useState<string[]>([]);
  const picking = state.phase === "AWAITING_AIRPORT";

  function fly(squareId: number): void {
    const name = state.board[squareId]?.name ?? `#${squareId}`;
    const next = reduce(state, { type: "SELECT_AIRPORT_TILE", squareId }).state;
    setState(next);
    setLog((l) => [
      `Flew to ${name} → landed on square ${next.players[0]!.position}, now ${next.phase.toLowerCase().replace(/_/g, " ")}`,
      ...l,
    ]);
  }

  function again(): void {
    setState(armAirport());
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Party Monopoly — Airport Practice</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="primary" onClick={again}>
            New airport
          </button>
          <button onClick={onLeave}>Leave</button>
        </div>
      </header>

      <section style={{ margin: "12px 0", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
        {picking
          ? "✈️ Aeroporto — tap a highlighted city on the board to fly there. Non-cities stay greyed out."
          : `You flew and the turn moved on (${state.phase.toLowerCase().replace(/_/g, " ")}). Hit “New airport” to test again.`}
      </section>

      {log.length > 0 && (
        <section style={{ margin: "8px 0", fontSize: 13, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>
          {log.slice(0, 6).map((line, i) => (
            <div key={i}>• {line}</div>
          ))}
        </section>
      )}

      <section>
        <IsoBoard
          state={state}
          {...(picking ? { pickTiles: airportTargets(state), onPickTile: fly } : {})}
        />
      </section>
    </main>
  );
}
