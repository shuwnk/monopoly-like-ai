import { netWorth, type GameState, type PlayerState } from "@party-monopoly/engine";
import { CURRENCY, groupColor, playerColor, playerTag } from "../theme.js";
import { Dice } from "./Dice.js";

export function Hud({ state }: { state: GameState }): JSX.Element {
  const cap = state.tunables.roundCap;
  const byNetWorth = state.tunables.tiebreakMetric === "NET_WORTH";
  // who's ahead right now — only meaningful with more than one player still in
  const solvent = state.players.filter((p) => !p.bankrupt);
  const leaderId =
    solvent.length > 1
      ? solvent.reduce((best, p) => (netWorth(state, p) > netWorth(state, best) ? p : best)).id
      : null;

  return (
    <div className="hud" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", textTransform: "capitalize" }}>
          {state.phase.toLowerCase().replace(/_/g, " ")} · round {state.round}
          {cap > 0 ? ` / ${cap}` : ""}
        </span>
        {cap > 0 && byNetWorth && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>★ leads on net worth — decides the game at the cap</span>
        )}
        {state.lastRoll && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Dice values={state.lastRoll} size={26} />
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {state.players.map((p, i) => (
          <PlayerCard
            key={p.id}
            player={p}
            idx={i}
            state={state}
            active={i === state.activePlayerIndex}
            leader={p.id === leaderId}
          />
        ))}
      </div>
    </div>
  );
}

function PlayerCard({
  player,
  idx,
  state,
  active,
  leader,
}: {
  player: PlayerState;
  idx: number;
  state: GameState;
  active: boolean;
  leader: boolean;
}): JSX.Element {
  const color = playerColor(idx);
  const owned = Object.entries(state.ownership)
    .filter(([, ownerId]) => ownerId === player.id)
    .map(([sq]) => groupColor(state.board[Number(sq)]?.property?.group))
    .filter((c): c is string => !!c);
  const worth = netWorth(state, player);
  const { propertyValue, buildingValue } = ownedValue(state, player);

  return (
    <div
      style={{
        flex: "1 1 180px",
        minWidth: 180,
        padding: 12,
        borderRadius: "var(--radius-sm)",
        background: "linear-gradient(165deg, var(--panel-2) 0%, var(--panel) 100%)",
        border: `1px solid ${active ? color : "var(--border)"}`,
        boxShadow: active ? `0 0 0 1px ${color}, 0 0 16px ${color}55` : "var(--shadow-sm)",
        opacity: player.bankrupt ? 0.45 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: color,
            color: "#0c0e13",
            fontSize: 10,
            fontWeight: 900,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1.5px solid rgba(255,255,255,0.7)",
          }}
        >
          {player.isAI ? "AI" : playerTag(idx)}
        </span>
        <strong style={{ flex: 1 }}>
          {leader && <span title="leading on net worth" style={{ color: "var(--gold)" }}>★ </span>}
          {player.name}
        </strong>
        {active && (
          <span style={{ fontSize: 11, fontWeight: 700, color }}>● turn</span>
        )}
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>cash</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0.3, fontVariantNumeric: "tabular-nums" }}>
        {CURRENCY}
        {player.money.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
        net worth {CURRENCY}
        {worth.toLocaleString()}
        {propertyValue > 0 ? ` · ${CURRENCY}${propertyValue.toLocaleString()} props` : ""}
        {buildingValue > 0 ? ` · ${CURRENCY}${buildingValue.toLocaleString()} built` : ""}
      </div>

      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 8, minHeight: 10 }}>
        {owned.length === 0 ? (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>no properties</span>
        ) : (
          owned.map((c, k) => (
            <span
              key={k}
              style={{ width: 16, height: 10, borderRadius: 3, background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.35)" }}
            />
          ))
        )}
      </div>

      {(player.inJail || player.bankrupt) && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          {player.inJail && <Badge text={`In the lockup (${player.jailTurns})`} color="var(--gold)" />}
          {player.bankrupt && <Badge text="BUSTED" color="var(--bad)" />}
        </div>
      )}
    </div>
  );
}

// property + building value the player holds, for the net-worth breakdown. sums
// the same way the engine's netWorth does, so the parts reconcile with the total.
function ownedValue(state: GameState, player: PlayerState): { propertyValue: number; buildingValue: number } {
  let propertyValue = 0;
  let buildingValue = 0;
  for (const [sq, ownerId] of Object.entries(state.ownership)) {
    if (ownerId !== player.id) continue;
    const price = state.board[Number(sq)]?.property?.price ?? 0;
    propertyValue += price;
    const level = state.buildings[Number(sq)] ?? 0;
    if (level > 0) buildingValue += level * Math.round(price * state.tunables.buildCostFraction);
  }
  return { propertyValue, buildingValue };
}

function Badge({ text, color }: { text: string; color: string }): JSX.Element {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 999,
        color,
        border: `1px solid ${color}`,
        background: "rgba(0,0,0,0.25)",
      }}
    >
      {text}
    </span>
  );
}
