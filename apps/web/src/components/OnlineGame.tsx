import { useState, type ReactNode } from "react";
import { useOnlineStore } from "../store/onlineStore.js";
import { CURRENCY } from "../theme.js";
import { IsoBoard } from "./IsoBoard.js";
import { Hud } from "./Hud.js";
import { OnlineReflexDuel } from "./OnlineReflexDuel.js";
import { BuildPrompt, DebtPanel, airportTargets, copaTargets, sellTargets } from "./TurnChoices.js";

export function OnlineGame({ onLeave }: { onLeave: () => void }): JSX.Element {
  const { status, roomId, state, you, error, showdown, endsAt, lobby, startGame, sendAction, sendTap, dismissShowdown, disconnect } =
    useOnlineStore();
  const [sellMode, setSellMode] = useState(false);

  function leave(): void {
    disconnect();
    onLeave();
  }

  if (!state) {
    return (
      <Frame onLeave={leave}>
        <Status status={status} roomId={roomId} error={error} />
        {lobby && (
          <section style={{ margin: "16px 0", padding: 16, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              {lobby.joined} / {lobby.capacity} players joined
            </div>
            {roomId && (
              <div style={{ marginTop: 6, fontSize: 14 }}>
                Share this code so friends can join: <strong style={{ fontFamily: "monospace", fontSize: 16 }}>{roomId}</strong>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              {lobby.host ? (
                <button className="primary" disabled={lobby.joined < 2} onClick={startGame}>
                  Start game ({lobby.joined} in)
                </button>
              ) : (
                <span style={{ color: "var(--muted)" }}>Waiting for the host to start…</span>
              )}
            </div>
          </section>
        )}
      </Frame>
    );
  }

  const active = state.players[state.activePlayerIndex];
  const yourTurn = !!active && active.id === you;
  const over = state.phase === "GAME_OVER";
  const inJail = !!active?.inJail;
  const canPayFine =
    yourTurn && inJail && state.phase === "AWAITING_ROLL" && !!active && active.money >= state.tunables.jail.fine;
  // the duel view stays up through the result reveal, which outlives the
  // RENT_SHOWDOWN phase (the resolved state has already advanced by then)
  const duelActive = !!showdown;

  // what the board picks for this turn: fly-to (airport) or sell-tile (debt / sell mode)
  const canAct = !duelActive && yourTurn && !!active;
  const airportPick = canAct && state.phase === "AWAITING_AIRPORT";
  const copaPick = canAct && state.phase === "AWAITING_WORLD_CUP";
  const debtPick = canAct && state.phase === "AWAITING_DEBT_PAYMENT";
  const sellPick = canAct && state.phase === "AWAITING_ROLL" && sellMode;
  const boardPick =
    airportPick
      ? { pickTiles: airportTargets(state), onPickTile: (id: number) => sendAction("SELECT_AIRPORT_TILE", id) }
      : copaPick && active
        ? { pickTiles: copaTargets(state, active.id), onPickTile: (id: number) => sendAction("SELECT_WORLD_CUP_TILE", id) }
        : (debtPick || sellPick) && active
          ? { pickTiles: sellTargets(state, active.id), onPickTile: (id: number) => sendAction("SELL_TILE", id) }
          : null;

  return (
    <Frame onLeave={leave}>
      <Status status={status} roomId={roomId} error={error} />

      {over ? (
        <div style={{ margin: "16px 0", padding: 12, background: "#1d3a1d", border: "1px solid #3c6", borderRadius: 4 }}>
          <strong>Game over.</strong> Winner: {state.players.find((p) => p.id === state.winnerId)?.name ?? state.winnerId}
        </div>
      ) : (
        <div style={{ margin: "8px 0", display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ opacity: 0.85 }}>
            {duelActive ? "Rent showdown in progress…" : yourTurn ? "Your turn." : `Waiting for ${active?.name ?? "opponent"}…`}
          </span>
          {state.tunables.netWorthGoal > 0 && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              reach {CURRENCY}
              {Math.round(state.tunables.netWorthGoal / 1000)}K net worth to win
            </span>
          )}
        </div>
      )}

      <section style={{ margin: "16px 0" }}>
        <Hud state={state} />
      </section>

      {!duelActive && (
        <section style={{ display: "flex", gap: 8, margin: "16px 0", flexWrap: "wrap" }}>
          <button className="primary" disabled={over || !yourTurn || state.phase !== "AWAITING_ROLL"} onClick={() => sendAction("ROLL_DICE")}>
            {inJail ? "Roll (try to escape jail)" : "Roll dice"}
          </button>
          <button disabled={!canPayFine} onClick={() => sendAction("PAY_JAIL_FINE")}>
            Pay fine (R${state.tunables.jail.fine})
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
          <button disabled={over || !yourTurn || state.phase !== "TURN_END"} onClick={() => sendAction("END_TURN")}>
            End turn
          </button>
          {yourTurn && active && state.phase === "AWAITING_ROLL" && sellTargets(state, active.id).size > 0 && (
            <button onClick={() => setSellMode((v) => !v)}>{sellMode ? "Done selling" : "Sell property"}</button>
          )}
        </section>
      )}

      {debtPick && active && (
        <DebtPanel
          state={state}
          playerId={active.id}
          onAutoSell={() => sendAction("AUTO_SELL")}
          onBankrupt={() => sendAction("DECLARE_BANKRUPT")}
        />
      )}

      {sellPick && (
        <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
          💰 Sell mode — tap a highlighted city to sell it (top house first).{" "}
          <button style={{ marginLeft: 8 }} onClick={() => setSellMode(false)}>Done</button>
        </section>
      )}

      {!duelActive && yourTurn && active && state.phase === "AWAITING_BUILD_DECISION" && (
        <BuildPrompt
          state={state}
          playerId={active.id}
          onBuild={(squareId) => sendAction("BUILD_HOUSE", squareId)}
          onSkip={() => sendAction("DECLINE_BUILD")}
        />
      )}

      {copaPick && (
        <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
          ⚽ Copa — tap one of your highlighted cities on the board to double its rent.
        </section>
      )}

      {!duelActive && yourTurn && active && state.phase === "AWAITING_AIRPORT" && (
        <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
          ✈️ Aeroporto — tap a highlighted city on the board to fly there.
        </section>
      )}

      {duelActive && showdown && (
        <OnlineReflexDuel
          key={"sd-" + showdown.id}
          signal={showdown}
          you={you}
          onTap={sendTap}
          onRevealDone={dismissShowdown}
        />
      )}

      <section>
        <IsoBoard state={state} {...(boardPick ?? {})} {...(endsAt !== null ? { endsAt } : {})} />
      </section>
    </Frame>
  );
}

function Frame({ children, onLeave }: { children: ReactNode; onLeave: () => void }): JSX.Element {
  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Party Monopoly — Online</h1>
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
