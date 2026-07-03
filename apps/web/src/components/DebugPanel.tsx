import { useState } from "react";
import { aggregate } from "../telemetry/duel.js";
import { useGameStore } from "../store/gameStore.js";

// Collapsible dev panel for hotseat / vs-AI. Shows seed + live counters and lets
// a tester shove the active player into edge states fast. All mutations go
// through the store's debugPatch, which patches the local snapshot only.
export function DebugPanel({
  onRestart,
  flat,
  onToggleFlat,
}: {
  onRestart: (seed: number) => void;
  // the flat board is a debug-only renderer now; these wire its toggle
  flat?: boolean;
  onToggleFlat?: () => void;
}): JSX.Element {
  const state = useGameStore((s) => s.state);
  const showdowns = useGameStore((s) => s.showdowns);
  const duelLog = useGameStore((s) => s.duelLog);
  const debugPatch = useGameStore((s) => s.debugPatch);

  const [open, setOpen] = useState(false);
  const [seedText, setSeedText] = useState(String(state.seed));
  const [square, setSquare] = useState("");
  const [money, setMoney] = useState("");

  const active = state.players[state.activePlayerIndex];
  const boardSize = state.board.length;
  const stats = aggregate(duelLog);

  return (
    <section style={{ margin: "16px 0", border: "1px dashed #666", borderRadius: 4, fontSize: 13 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", textAlign: "left", padding: "6px 10px", background: "#222", color: "#bbb", border: "none" }}
      >
        {open ? "▾" : "▸"} DEBUG
      </button>

      {open && (
        <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", opacity: 0.85 }}>
            <span>round: {state.round}</span>
            <span>showdowns: {showdowns}</span>
            <span>duels logged: {duelLog.length}</span>
          </div>

          <form
            style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              const seed = Number(seedText);
              if (Number.isFinite(seed)) onRestart(seed);
            }}
          >
            <label>
              seed{" "}
              <input value={seedText} onChange={(e) => setSeedText(e.target.value)} style={{ width: 140, padding: 4 }} />
            </label>
            <button type="submit">restart with seed</button>
          </form>

          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ opacity: 0.7 }}>active: {active?.name ?? "—"}</span>
            <input
              value={square}
              onChange={(e) => setSquare(e.target.value)}
              placeholder={`square 0..${boardSize - 1}`}
              style={{ width: 110, padding: 4 }}
            />
            <button
              disabled={!active}
              onClick={() => {
                const n = Number(square);
                if (active && Number.isInteger(n) && n >= 0 && n < boardSize) {
                  debugPatch({ player: { id: active.id, position: n } });
                }
              }}
            >
              teleport
            </button>
            <input
              value={money}
              onChange={(e) => setMoney(e.target.value)}
              placeholder="money"
              style={{ width: 90, padding: 4 }}
            />
            <button
              disabled={!active}
              onClick={() => {
                const n = Number(money);
                if (active && Number.isFinite(n)) debugPatch({ player: { id: active.id, money: n } });
              }}
            >
              set money
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ opacity: 0.7 }}>preview:</span>
            <button
              disabled={!active}
              onClick={() => {
                if (!active) return;
                // give the active player four stalls at levels 1..4 so all the
                // house/hotel visuals show at once
                debugPatch({
                  ownership: { 1: active.id, 3: active.id, 5: active.id, 6: active.id },
                  buildings: { 1: 1, 3: 2, 5: 3, 6: 4 },
                });
              }}
            >
              demo houses (1→hotel)
            </button>
            {onToggleFlat && (
              <button onClick={onToggleFlat}>{flat ? "iso board" : "flat board"}</button>
            )}
          </div>

          {duelLog.length > 0 && (
            <div style={{ opacity: 0.85 }}>
              duels: P0 {stats.p0Wins} / P1 {stats.p1Wins} / draw {stats.draws} · false starts {stats.p0FalseStarts}/
              {stats.p1FalseStarts} · avg ms {fmt(stats.p0AvgReactionMs)}/{fmt(stats.p1AvgReactionMs)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function fmt(n: number | null): string {
  return n === null ? "—" : Math.round(n).toString();
}
