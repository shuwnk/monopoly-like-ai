import type { CSSProperties } from "react";
import type { GameState, Square } from "@party-monopoly/engine";
import { CURRENCY, playerColor, playerTag } from "../theme.js";

const GROUP_COLORS: Record<string, string> = {
  "Lantern Lane": "#f5a623",
  "Skewer Row": "#e0533d",
  "Bubble Tea Block": "#2ec4b6",
  "Arcade Alley": "#8b5cf6",
  "Karaoke Quarter": "#ff5fa2",
  "Sneaker Strip": "#3a86ff",
  "Gadget Gallery": "#2bd96b",
  "Golden Pagoda Plaza": "#ffd23f",
};

type Side = "bottom" | "left" | "top" | "right" | "corner";

// place the 40 squares around an 11x11 ring: GO bottom-right, running
// counter-clockwise. center is left open for the title.
function cell(i: number): { row: number; col: number; side: Side } {
  const corner = i === 0 || i === 10 || i === 20 || i === 30;
  if (i <= 10) return { row: 11, col: 11 - i, side: corner ? "corner" : "bottom" };
  if (i <= 20) return { row: 21 - i, col: 1, side: corner ? "corner" : "left" };
  if (i <= 30) return { row: 1, col: i - 19, side: corner ? "corner" : "top" };
  return { row: i - 29, col: 11, side: "right" };
}

// district band sits on the edge facing the board center
function bandEdge(side: Side, color: string): CSSProperties {
  switch (side) {
    case "bottom": return { borderTop: `5px solid ${color}` };
    case "top": return { borderBottom: `5px solid ${color}` };
    case "left": return { borderRight: `5px solid ${color}` };
    case "right": return { borderLeft: `5px solid ${color}` };
    default: return {};
  }
}

export function Board({ state }: { state: GameState }): JSX.Element {
  return (
    <div
      className="board"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(11, 1fr)",
        gridTemplateRows: "repeat(11, 1fr)",
        gap: 3,
        width: "min(92vw, 680px)",
        aspectRatio: "1 / 1",
        margin: "0 auto",
      }}
    >
      <div
        style={{
          gridRow: "2 / 11",
          gridColumn: "2 / 11",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
          transform: "rotate(-45deg)",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1, color: "#bbb" }}>NEON NIGHT MARKET</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>round {state.round} · {state.phase.toLowerCase().replace(/_/g, " ")}</div>
      </div>

      {state.board.map((square) => (
        <Cell key={square.id} square={square} state={state} />
      ))}
    </div>
  );
}

function Cell({ square, state }: { square: Square; state: GameState }): JSX.Element {
  const { row, col, side } = cell(square.id);
  const ownerId = state.ownership[square.id];
  const ownerIdx = ownerId ? state.players.findIndex((p) => p.id === ownerId) : -1;
  const band = square.property?.group ? GROUP_COLORS[square.property.group] : undefined;
  const pawns = state.players.filter((p) => p.position === square.id && !p.bankrupt);
  const corner = side === "corner";

  return (
    <div
      title={ownerIdx >= 0 ? `${square.name} — owned by ${state.players[ownerIdx]!.name}` : square.name}
      style={{
        gridRow: row,
        gridColumn: col,
        position: "relative",
        background: corner ? "#202024" : "#171719",
        border: "1px solid #333",
        ...(band ? bandEdge(side, band) : {}),
        borderRadius: 3,
        padding: 2,
        overflow: "hidden",
        fontSize: 7.5,
        lineHeight: 1.15,
        display: "flex",
        flexDirection: "column",
        boxShadow: ownerIdx >= 0 ? `inset 0 0 0 2px ${playerColor(ownerIdx)}` : undefined,
      }}
    >
      <div style={{ fontWeight: 700, color: corner ? "#ddd" : "#cfcfcf" }}>{square.name}</div>
      {square.property && (
        <div style={{ opacity: 0.65, marginTop: "auto" }}>
          {CURRENCY}
          {square.property.price}
        </div>
      )}
      {pawns.length > 0 && (
        <div style={{ display: "flex", gap: 2, position: "absolute", bottom: 2, right: 2 }}>
          {pawns.map((p) => {
            const idx = state.players.indexOf(p);
            return (
              <span
                key={p.id}
                title={p.name}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: playerColor(idx),
                  color: "#111",
                  fontSize: 7,
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {p.isAI ? "AI" : playerTag(idx)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
