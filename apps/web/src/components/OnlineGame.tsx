import type { ReactNode } from "react";
import { useOnlineStore } from "../store/onlineStore.js";
import { Board } from "./Board.js";
import { Hud } from "./Hud.js";
import { OnlineReflexDuel } from "./OnlineReflexDuel.js";

export function OnlineGame({ onLeave }: { onLeave: () => void }): JSX.Element {
  const { status, roomId, state, you, error, showdown, sendAction, sendTap, disconnect } = useOnlineStore();

  function leave(): void {
    disconnect();
    onLeave();
  }

  if (!state) {
    return (
      <Frame onLeave={leave}>
        <Status status={status} roomId={roomId} error={error} />
      </Frame>
    );
  }

  const active = state.players[state.activePlayerIndex];
  const yourTurn = !!active && active.id === you;
  const over = state.phase === "GAME_OVER";
  const inJail = !!active?.inJail;
  const canPayFine =
    yourTurn && inJail && state.phase === "AWAITING_ROLL" && !!active && active.money >= state.tunables.jail.fine;
  const inShowdown = state.phase === "RENT_SHOWDOWN";

  return (
    <Frame onLeave={leave}>
      <Status status={status} roomId={roomId} error={error} />

      {over ? (
        <div style={{ margin: "16px 0", padding: 12, background: "#1d3a1d", border: "1px solid #3c6", borderRadius: 4 }}>
          <strong>Game over.</strong> Winner: {state.players.find((p) => p.id === state.winnerId)?.name ?? state.winnerId}
        </div>
      ) : (
        <div style={{ margin: "8px 0", opacity: 0.85 }}>
          {inShowdown ? "Rent showdown in progress…" : yourTurn ? "Your turn." : `Waiting for ${active?.name ?? "opponent"}…`}
        </div>
      )}

      <section style={{ margin: "16px 0" }}>
        <Hud state={state} />
      </section>

      {!inShowdown && (
        <section style={{ display: "flex", gap: 8, margin: "16px 0", flexWrap: "wrap" }}>
          <button disabled={over || !yourTurn || state.phase !== "AWAITING_ROLL"} onClick={() => sendAction("ROLL_DICE")}>
            {inJail ? "Roll (try to escape jail)" : "Roll dice"}
          </button>
          <button disabled={!canPayFine} onClick={() => sendAction("PAY_JAIL_FINE")}>
            Pay fine (₸{state.tunables.jail.fine})
          </button>
          <button
            disabled={over || !yourTurn || state.phase !== "AWAITING_BUY_DECISION"}
            onClick={() => sendAction("BUY_PROPERTY")}
          >
            Buy
          </button>
          <button
            disabled={over || !yourTurn || state.phase !== "AWAITING_BUY_DECISION"}
            onClick={() => sendAction("DECLINE_BUY")}
          >
            Decline
          </button>
          <button disabled={over || !yourTurn} onClick={() => sendAction("END_TURN")}>
            End turn
          </button>
        </section>
      )}

      {inShowdown && showdown && (
        <OnlineReflexDuel
          key={(state.pendingMinigame?.context.stakeData.propertyId ?? 0) + "-" + state.activePlayerIndex}
          signal={showdown}
          onTap={sendTap}
        />
      )}

      <section>
        <Board state={state} />
      </section>
    </Frame>
  );
}

function Frame({ children, onLeave }: { children: ReactNode; onLeave: () => void }): JSX.Element {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", color: "#eee", background: "#111", minHeight: "100vh", padding: 24 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Party Monopoly — Online</h1>
        <button onClick={onLeave}>Leave</button>
      </header>
      {children}
    </main>
  );
}

function Status({ status, roomId, error }: { status: string; roomId: string | null; error: string | null }): JSX.Element {
  const text =
    status === "connecting"
      ? "Connecting…"
      : status === "waiting"
        ? "Waiting for an opponent to join…"
        : status === "reconnecting"
          ? "Connection lost — reconnecting…"
          : status === "playing"
            ? "Opponent joined — playing."
            : status === "left"
              ? "Opponent left. The game has ended."
              : status === "error"
                ? `Error: ${error ?? "unknown"}`
                : "";
  return (
    <div style={{ margin: "8px 0", display: "flex", gap: 12, alignItems: "center" }}>
      {roomId && (
        <span>
          Room code: <strong style={{ fontFamily: "monospace" }}>{roomId}</strong>
        </span>
      )}
      {text && <span style={{ opacity: 0.85 }}>{text}</span>}
    </div>
  );
}
