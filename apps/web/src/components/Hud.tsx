import type { GameState } from "@party-monopoly/engine";
import { CURRENCY, playerColor, playerTag } from "../theme.js";

export function Hud({ state }: { state: GameState }): JSX.Element {
  return (
    <div className="hud" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <strong>Phase:</strong> {state.phase} · round {state.round}
        {state.lastRoll && <> · last roll: [{state.lastRoll.join(", ")}]</>}
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {state.players.map((p, i) => {
          const active = i === state.activePlayerIndex;
          return (
            <div
              key={p.id}
              style={{
                padding: 8,
                borderRadius: 4,
                border: `2px solid ${active ? playerColor(i) : "#444"}`,
                opacity: p.bankrupt ? 0.4 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: playerColor(i),
                    color: "#111",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {p.isAI ? "AI" : playerTag(i)}
                </span>
                <strong>{p.name}</strong> {active && <span style={{ opacity: 0.7 }}>· active</span>}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                {CURRENCY}
                {p.money}
              </div>
              <div style={{ opacity: 0.7 }}>square #{p.position}</div>
              {p.inJail && <div>in the lockup ({p.jailTurns})</div>}
              {p.bankrupt && <div>busted</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
