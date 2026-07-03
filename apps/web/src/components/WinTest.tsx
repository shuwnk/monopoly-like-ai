import { useState } from "react";
import { createInitialState, ISLAND_IDS, reduce, type GameState } from "@party-monopoly/engine";
import { asPlayerId, type PlayerId } from "@party-monopoly/types";
import { IsoBoard } from "./IsoBoard.js";
import { CURRENCY } from "../theme.js";

// Test bed for the win conditions: each button sets up a scenario and fires the
// triggering action, so you can confirm the right player wins for the right
// reason without playing a whole game.

const P: PlayerId[] = [asPlayerId("p0"), asPlayerId("p1"), asPlayerId("p2"), asPlayerId("p3")];

function base(): GameState {
  return createInitialState({
    seed: Date.now(),
    players: P.map((id, i) => ({ id, name: i === 0 ? "You" : `Rival ${i}`, isAI: i > 0 })),
  });
}

export function WinTest({ onLeave }: { onLeave: () => void }): JSX.Element {
  const [state, setState] = useState<GameState>(base);
  const [log, setLog] = useState<string[]>([]);
  const goal = state.tunables.netWorthGoal;

  // set up a scenario on a fresh board, fire the action, and report the outcome
  function run(label: string, setup: (s: GameState) => GameState, action: Parameters<typeof reduce>[1]): void {
    const next = reduce(setup(base()), action).state;
    setState(next);
    const won = next.phase === "GAME_OVER";
    const winner = next.players.find((p) => p.id === next.winnerId)?.name ?? "nobody";
    setLog((l) => [`${won ? "✅" : "❌"} ${label} → ${won ? `winner: ${winner}` : "no win fired"}`, ...l]);
  }

  function reset(): void {
    setState(base());
    setLog([]);
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Party Monopoly — Win Conditions</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={reset}>Reset</button>
          <button onClick={onLeave}>Leave</button>
        </div>
      </header>

      <section style={{ margin: "12px 0", fontSize: 13, color: "var(--muted)" }}>
        Each button arms a scenario where <strong>You (p0)</strong> should win, then fires the trigger. ✅ = the right win
        fired.
      </section>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 16px" }}>
        <button
          className="primary"
          onClick={() =>
            run(
              "Island monopoly (own all 4 islands)",
              (s) => ({ ...s, phase: "TURN_END", ownership: Object.fromEntries(ISLAND_IDS.map((id) => [id, P[0]!])) }),
              { type: "END_TURN" },
            )
          }
        >
          🏝️ Island monopoly
        </button>
        <button
          className="primary"
          onClick={() =>
            run(
              `Wealth goal (net worth ≥ ${CURRENCY}${Math.round(goal / 1000)}K)`,
              (s) => ({ ...s, phase: "TURN_END", players: s.players.map((p, i) => (i === 0 ? { ...p, money: goal + 1000 } : p)) }),
              { type: "END_TURN" },
            )
          }
        >
          💰 Wealth goal
        </button>
        <button
          className="primary"
          onClick={() =>
            run(
              "Knockout (last player standing)",
              (s) => ({ ...s, phase: "TURN_END", players: s.players.map((p, i) => (i > 0 ? { ...p, bankrupt: true, money: 0 } : p)) }),
              { type: "END_TURN" },
            )
          }
        >
          💥 Knockout
        </button>
        <button
          className="primary"
          onClick={() =>
            run(
              "Time up (richest wins)",
              (s) => ({ ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, money: 999999 } : { ...p, money: 1000 })) }),
              { type: "END_ON_TIME" },
            )
          }
        >
          ⏱️ Time up
        </button>
      </section>

      {log.length > 0 && (
        <section style={{ margin: "8px 0 16px", fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
          {log.slice(0, 8).map((line, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>
              {line}
            </div>
          ))}
        </section>
      )}

      <section>
        <IsoBoard state={state} />
      </section>
    </main>
  );
}
