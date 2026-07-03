import type { CSSProperties } from "react";
import type { GameState, Square, SquareType } from "@party-monopoly/engine";
import { CURRENCY, groupColor, playerColor, playerTag } from "../theme.js";
import { Dice } from "./Dice.js";

type Side = "bottom" | "left" | "top" | "right" | "corner";

// place the 40 squares around an 11x11 ring: GO bottom-right, running
// counter-clockwise. center is left open for the branded panel.
function cell(i: number): { row: number; col: number; side: Side } {
  const corner = i === 0 || i === 10 || i === 20 || i === 30;
  if (i <= 10) return { row: 11, col: 11 - i, side: corner ? "corner" : "bottom" };
  if (i <= 20) return { row: 21 - i, col: 1, side: corner ? "corner" : "left" };
  if (i <= 30) return { row: 1, col: i - 19, side: corner ? "corner" : "top" };
  return { row: i - 29, col: 11, side: "right" };
}

// the thick district band sits on the edge facing the board center
function bandEdge(side: Side, color: string): CSSProperties {
  const thick = "9px";
  switch (side) {
    case "bottom": return { borderTop: `${thick} solid ${color}` };
    case "top": return { borderBottom: `${thick} solid ${color}` };
    case "left": return { borderRight: `${thick} solid ${color}` };
    case "right": return { borderLeft: `${thick} solid ${color}` };
    default: return {};
  }
}

// corner + special tiles get a label, a tint, and a glyph instead of a price
const SPECIAL: Partial<Record<SquareType, { label: string; glyph: string; tint: string }>> = {
  GO: { label: "GO", glyph: "→", tint: "rgba(35,196,214,0.16)" },
  JAIL: { label: "JAIL", glyph: "⌾", tint: "rgba(255,210,63,0.14)" },
  FREE_PARKING: { label: "FREE", glyph: "P", tint: "rgba(61,220,132,0.14)" },
  GO_TO_JAIL: { label: "GO TO JAIL", glyph: "!", tint: "rgba(255,84,104,0.16)" },
  TAX: { label: "TAX", glyph: CURRENCY, tint: "rgba(152,162,182,0.1)" },
  CHANCE: { label: "", glyph: "?", tint: "rgba(139,92,246,0.12)" },
  COMMUNITY: { label: "", glyph: "?", tint: "rgba(58,134,255,0.12)" },
};

export function Board({ state }: { state: GameState }): JSX.Element {
  const active = state.players[state.activePlayerIndex];
  return (
    <div
      className="board"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(11, 1fr)",
        gridTemplateRows: "repeat(11, 1fr)",
        gap: 4,
        width: "min(92vw, 720px)",
        aspectRatio: "1 / 1",
        margin: "0 auto",
        padding: 10,
        background: "linear-gradient(160deg, #10131c 0%, #0b0d13 100%)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow)",
      }}
    >
      <CenterPanel state={state} />
      {state.board.map((square) => (
        <Cell key={square.id} square={square} state={state} activePos={active?.position ?? -1} />
      ))}
    </div>
  );
}

function CenterPanel({ state }: { state: GameState }): JSX.Element {
  return (
    <div
      style={{
        gridRow: "2 / 11",
        gridColumn: "2 / 11",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        margin: 6,
        borderRadius: "var(--radius)",
        background: "radial-gradient(120% 120% at 50% 0%, rgba(224,57,143,0.08), transparent 60%)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: "clamp(18px, 3.4vw, 30px)",
            fontWeight: 900,
            letterSpacing: 3,
            background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          TOUR BRASIL
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, textTransform: "capitalize" }}>
          round {state.round} · {state.phase.toLowerCase().replace(/_/g, " ")}
        </div>
      </div>
      {state.lastRoll && <Dice values={state.lastRoll} size={38} />}
    </div>
  );
}

function Cell({
  square,
  state,
  activePos,
}: {
  square: Square;
  state: GameState;
  activePos: number;
}): JSX.Element {
  const { row, col, side } = cell(square.id);
  const ownerId = state.ownership[square.id];
  const ownerIdx = ownerId ? state.players.findIndex((p) => p.id === ownerId) : -1;
  const band = groupColor(square.property?.group);
  const pawns = state.players.filter((p) => p.position === square.id && !p.bankrupt);
  const special = square.type === "PROPERTY" ? undefined : SPECIAL[square.type];
  const isActiveTile = square.id === activePos;

  return (
    <div
      title={ownerIdx >= 0 ? `${square.name} — owned by ${state.players[ownerIdx]!.name}` : square.name}
      style={{
        gridRow: row,
        gridColumn: col,
        position: "relative",
        background: special
          ? `${special.tint}, linear-gradient(165deg, #1c212e, #14171f)`
          : "linear-gradient(165deg, #1a1e2a 0%, #12151d 100%)",
        border: "1px solid var(--border)",
        ...(band ? bandEdge(side, band) : {}),
        borderRadius: 6,
        padding: 3,
        overflow: "hidden",
        fontSize: 7.5,
        lineHeight: 1.15,
        display: "flex",
        flexDirection: "column",
        boxShadow: [
          ownerIdx >= 0 ? `inset 0 0 0 2px ${playerColor(ownerIdx)}` : "",
          isActiveTile ? "0 0 0 2px var(--accent), 0 0 12px rgba(224,57,143,0.55)" : "",
        ]
          .filter(Boolean)
          .join(", "),
      }}
    >
      {special ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 2 }}>
          <div style={{ fontSize: 15, opacity: 0.85 }}>{special.glyph}</div>
          <div style={{ fontWeight: 800, color: "#d7dcea" }}>{special.label || square.name}</div>
        </div>
      ) : (
        <>
          <Buildings level={state.buildings[square.id] ?? 0} maxLevel={state.tunables.maxBuildLevel} />
          <div style={{ fontWeight: 700, color: "#d7dcea" }}>{square.name}</div>
          {square.property && (
            <div style={{ marginTop: "auto", fontWeight: 700, color: band ?? "var(--muted)" }}>
              {CURRENCY}
              {square.property.price}
            </div>
          )}
        </>
      )}

      {pawns.length > 0 && (
        <div style={{ display: "flex", gap: 2, position: "absolute", bottom: 2, right: 2 }}>
          {pawns.map((p) => {
            const idx = state.players.indexOf(p);
            return <Pawn key={p.id} label={p.isAI ? "AI" : playerTag(idx)} color={playerColor(idx)} title={p.name} />;
          })}
        </div>
      )}
    </div>
  );
}

// classic Monopoly language: 1-3 green house pips, then a single gold hotel
function Buildings({ level, maxLevel }: { level: number; maxLevel: number }): JSX.Element | null {
  if (level <= 0) return null;
  if (level >= maxLevel) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 1 }}>
        <span
          title="Hotel"
          style={{
            fontSize: 7,
            fontWeight: 900,
            color: "#3a2600",
            background: "linear-gradient(180deg, #ffe071, var(--gold))",
            borderRadius: 3,
            padding: "0 4px",
            border: "1px solid rgba(0,0,0,0.35)",
          }}
        >
          HOTEL
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 2, justifyContent: "center", marginBottom: 1 }} title={`${level} house${level > 1 ? "s" : ""}`}>
      {Array.from({ length: level }, (_, i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            background: "var(--good)",
            borderRadius: "2px 2px 1px 1px",
            border: "1px solid rgba(0,0,0,0.4)",
          }}
        />
      ))}
    </div>
  );
}

function Pawn({ label, color, title }: { label: string; color: string; title: string }): JSX.Element {
  return (
    <span
      title={title}
      style={{
        minWidth: 13,
        height: 13,
        padding: "0 2px",
        borderRadius: 7,
        background: color,
        color: "#0c0e13",
        fontSize: 7,
        fontWeight: 900,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1.5px solid rgba(255,255,255,0.65)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
      }}
    >
      {label}
    </span>
  );
}
