import { useState } from "react";
import { ISLAND_IDS, type GameState } from "@party-monopoly/engine";
import type { PlayerId } from "@party-monopoly/types";
import { CURRENCY } from "../theme.js";

const ISLANDS = new Set<number>(ISLAND_IDS);

// The build and Copa/Aeroporto pick controls, shared by hotseat and online so
// both stay in step with the reducer's rules. Callers wire onBuild/onPick to
// their own dispatch (local reducer vs. the network).

export interface PickOption {
  id: number;
  label: string;
}

// Copa targets for the board picker: every city you own (boosts STACK, so an
// already-boosted lot can be re-boosted to multiply again). Only PROPERTY tiles
// qualify, so islands and other specials — which can't be owned — are excluded.
export function copaTargets(state: GameState, playerId: PlayerId): Set<number> {
  const out = new Set<number>();
  for (const sq of state.board) {
    if (sq.type === "PROPERTY" && state.ownership[sq.id] === playerId && !ISLANDS.has(sq.id)) out.add(sq.id);
  }
  return out;
}

// Aeroporto destinations: the city (property) tiles. The player picks one on the
// board — those stay lit while everything else greys out.
export function airportTargets(state: GameState): Set<number> {
  return new Set(state.board.filter((sq) => sq.type === "PROPERTY").map((sq) => sq.id));
}

// tiles the player can sell — the ones they own (clicking sells the top house
// level, or the land itself if bare). Used for the board sell-picker.
export function sellTargets(state: GameState, playerId: PlayerId): Set<number> {
  const out = new Set<number>();
  for (const [sq, owner] of Object.entries(state.ownership)) if (owner === playerId) out.add(Number(sq));
  return out;
}

// the "you can't pay — sell or go bankrupt" panel. The board is already a sell
// picker (owned cities lit); this shows the shortfall and the shortcut buttons.
export function DebtPanel({
  state,
  playerId,
  onAutoSell,
  onBankrupt,
}: {
  state: GameState;
  playerId: PlayerId;
  onAutoSell: () => void;
  onBankrupt: () => void;
}): JSX.Element | null {
  const debt = state.pendingDebt;
  const player = state.players.find((p) => p.id === playerId);
  if (!debt || !player) return null;
  return (
    <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--bad)" }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>💸 You can't cover this payment — sell a city to raise it.</div>
      <div style={{ fontSize: 13, marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
        Needed <strong>{CURRENCY}{debt.amount.toLocaleString()}</strong> · You have <strong>{CURRENCY}{player.money.toLocaleString()}</strong>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="primary" onClick={onAutoSell}>Automatic sale</button>
        <button onClick={onBankrupt}>Bankrupt</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
        …or tap a highlighted city on the board to sell it yourself (top house first).
      </div>
    </section>
  );
}

// selection bar for the Copa / Aeroporto picks: buttons for a short list, a
// dropdown when there are many choices (e.g. every square for the airport)
export function PickBar({
  label,
  options,
  onPick,
  dropdown = false,
}: {
  label: string;
  options: PickOption[];
  onPick: (squareId: number) => void;
  dropdown?: boolean;
}): JSX.Element {
  const [sel, setSel] = useState<number>(options[0]?.id ?? 0);
  return (
    <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{label}</div>
      {dropdown ? (
        <div style={{ display: "flex", gap: 8 }}>
          <select value={sel} onChange={(e) => setSel(Number(e.target.value))} style={{ flex: 1 }}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => onPick(sel)}>
            Fly here
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {options.map((o) => (
            <button key={o.id} onClick={() => onPick(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// You improve a stall by landing on it: the engine offers a single one-level
// build on the stall you're standing on. This prompt shows that choice. The
// engine only enters the build phase when the build is legal and affordable, so
// this component trusts that and just renders cost + the resulting level.
export function BuildPrompt({
  state,
  playerId,
  onBuild,
  onSkip,
}: {
  state: GameState;
  playerId: PlayerId;
  onBuild: (squareId: number) => void;
  onSkip: () => void;
}): JSX.Element | null {
  const player = state.players.find((p) => p.id === playerId);
  const square = player ? state.board[player.position] : undefined;
  if (!player || !square?.property) return null;

  const level = state.buildings[square.id] ?? 0;
  const cost = Math.round(square.property.price * state.tunables.buildCostFraction);
  const next = level + 1;
  const nextLabel = next >= state.tunables.maxBuildLevel ? "a hotel" : `${next} house${next > 1 ? "s" : ""}`;
  const canAfford = player.money >= cost;

  return (
    <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
        🏗️ Improve {square.name} to {nextLabel}? {CURRENCY}
        {cost.toLocaleString()}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="primary" disabled={!canAfford} onClick={() => onBuild(square.id)}>
          Build ({CURRENCY}
          {cost.toLocaleString()})
        </button>
        <button onClick={onSkip}>Skip</button>
      </div>
    </section>
  );
}
