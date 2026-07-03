import { useEffect, useRef, useState } from "react";
import { decideAction } from "@party-monopoly/ai";
import { useGameStore } from "../store/gameStore.js";
import { toRecord } from "../telemetry/duel.js";
import { Board } from "./Board.js";
import { IsoBoard } from "./IsoBoard.js";
import { DebugPanel } from "./DebugPanel.js";
import { Hud } from "./Hud.js";
import { ReflexTapDuel } from "./ReflexTapDuel.js";
import { BuildPrompt, DebtPanel, airportTargets, copaTargets, sellTargets } from "./TurnChoices.js";

// Hotseat shell: renders the mirrored snapshot and the buttons that dispatch
// actions through the reducer. With vsAI, player 2 (p1) is a bot — an effect
// drives its turn and it auto-plays the reflex duel.
export function HotseatGame({ onLeave, vsAI = false }: { onLeave: () => void; vsAI?: boolean }): JSX.Element {
  const state = useGameStore((s) => s.state);
  const dispatch = useGameStore((s) => s.dispatch);
  const newGame = useGameStore((s) => s.newGame);
  const newAIGame = useGameStore((s) => s.newAIGame);
  const logDuel = useGameStore((s) => s.logDuel);
  const aiPlayerId = useGameStore((s) => s.aiPlayerId);
  const aiSkill = useGameStore((s) => s.aiSkill);

  // the iso board is the only user-facing renderer; the flat board is a debug aid
  const [flat, setFlat] = useState(false);
  // voluntary "sell property" mode: turns the board into a sell-picker on your turn
  const [sellMode, setSellMode] = useState(false);
  const restart = (seed: number): void => (vsAI ? newAIGame(seed) : newGame(seed));

  const active = state.players[state.activePlayerIndex];
  const over = state.phase === "GAME_OVER";
  const inJail = !!active?.inJail;
  const canPayFine = inJail && state.phase === "AWAITING_ROLL" && active!.money >= state.tunables.jail.fine;

  // start the right kind of game when this screen mounts or the mode changes
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (vsAI) newAIGame(Date.now());
    else newGame(Date.now());
  }, [vsAI, newGame, newAIGame]);

  // drive the bot one action at a time. the effect re-runs on every snapshot, so
  // each dispatch lands a fresh state that schedules the next step. RENT_SHOWDOWN
  // is skipped here — the duel component drives that. the timer is the only
  // scheduler, so there's no double-dispatch; cleanup cancels a pending step.
  const aiTurn = !!aiPlayerId && active?.id === aiPlayerId && !over;
  useEffect(() => {
    if (!aiTurn) return;
    const action = decideAction(state, aiPlayerId!);
    if (!action) return;
    const t = window.setTimeout(() => dispatch(action), 650);
    return () => window.clearTimeout(t);
  }, [aiTurn, state, aiPlayerId, dispatch]);

  // which duel seat the bot plays, if any: participants are [payer, owner]
  const aiSeat = ((): 0 | 1 | undefined => {
    if (!aiPlayerId || !state.pendingMinigame) return undefined;
    const i = state.pendingMinigame.participants.findIndex((p) => p.playerId === aiPlayerId);
    return i === 0 || i === 1 ? i : undefined;
  })();

  const human = aiPlayerId ? "Play vs AI" : "Hotseat";

  // what the board acts as a picker for this turn: fly-to (airport) or sell-tile
  // (forced debt, or voluntary sell mode). null = normal, non-interactive board.
  const airportPick = !aiTurn && state.phase === "AWAITING_AIRPORT" && !!active;
  const copaPick = !aiTurn && state.phase === "AWAITING_WORLD_CUP" && !!active;
  const debtPick = !aiTurn && state.phase === "AWAITING_DEBT_PAYMENT" && !!active;
  const sellPick = !aiTurn && state.phase === "AWAITING_ROLL" && sellMode && !!active;
  const boardPick =
    airportPick
      ? { pickTiles: airportTargets(state), onPickTile: (id: number) => dispatch({ type: "SELECT_AIRPORT_TILE", squareId: id }) }
      : copaPick && active
        ? { pickTiles: copaTargets(state, active.id), onPickTile: (id: number) => dispatch({ type: "SELECT_WORLD_CUP_TILE", squareId: id }) }
        : (debtPick || sellPick) && active
          ? { pickTiles: sellTargets(state, active.id), onPickTile: (id: number) => dispatch({ type: "SELL_TILE", squareId: id }) }
          : null;

  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Party Monopoly — {human}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => restart(Date.now())}>New game</button>
          <button onClick={onLeave}>Leave</button>
        </div>
      </header>

      {over && (
        <div style={{ margin: "16px 0", padding: 12, background: "#1d3a1d", border: "1px solid #3c6", borderRadius: 4 }}>
          <strong>Game over.</strong> Winner: {state.players.find((p) => p.id === state.winnerId)?.name ?? state.winnerId}
        </div>
      )}

      <section style={{ margin: "16px 0" }}>
        <Hud state={state} />
      </section>

      {aiTurn && <div style={{ margin: "8px 0", opacity: 0.7 }}>Bot is thinking…</div>}

      <section style={{ display: "flex", gap: 8, margin: "16px 0", flexWrap: "wrap" }}>
        <button className="primary" disabled={over || aiTurn || state.phase !== "AWAITING_ROLL"} onClick={() => dispatch({ type: "ROLL_DICE" })}>
          {inJail ? "Roll (try to escape jail)" : "Roll dice"}
        </button>
        <button disabled={over || aiTurn || !canPayFine} onClick={() => dispatch({ type: "PAY_JAIL_FINE" })}>
          Pay fine (R${state.tunables.jail.fine})
        </button>
        <button disabled={over || aiTurn || state.phase !== "AWAITING_BUY_DECISION"} onClick={() => dispatch({ type: "BUY_PROPERTY" })}>
          Buy
        </button>
        <button disabled={over || aiTurn || state.phase !== "AWAITING_BUY_DECISION"} onClick={() => dispatch({ type: "DECLINE_BUY" })}>
          Decline
        </button>
        <button disabled={over || aiTurn} onClick={() => dispatch({ type: "END_TURN" })}>
          End turn
        </button>
        {!aiTurn && state.phase === "AWAITING_ROLL" && active && sellTargets(state, active.id).size > 0 && (
          <button onClick={() => setSellMode((v) => !v)}>{sellMode ? "Done selling" : "Sell property"}</button>
        )}
      </section>

      {!aiTurn && state.phase === "AWAITING_BUILD_DECISION" && active && (
        <BuildPrompt
          state={state}
          playerId={active.id}
          onBuild={(squareId) => dispatch({ type: "BUILD_HOUSE", squareId })}
          onSkip={() => dispatch({ type: "DECLINE_BUILD" })}
        />
      )}

      {copaPick && (
        <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
          ⚽ Copa — tap one of your highlighted cities on the board to double its rent.
        </section>
      )}

      {!aiTurn && state.phase === "AWAITING_AIRPORT" && active && (
        <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
          ✈️ Aeroporto — tap a highlighted city on the board to fly there.
        </section>
      )}

      {!aiTurn && debtPick && active && (
        <DebtPanel
          state={state}
          playerId={active.id}
          onAutoSell={() => dispatch({ type: "AUTO_SELL" })}
          onBankrupt={() => dispatch({ type: "DECLARE_BANKRUPT", playerId: active.id })}
        />
      )}

      {sellPick && (
        <section style={{ margin: "8px 0 16px", padding: 12, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 14, fontWeight: 700 }}>
          💰 Sell mode — tap a highlighted city to sell it (or its top house). <button style={{ marginLeft: 8 }} onClick={() => setSellMode(false)}>Done</button>
        </section>
      )}

      {state.phase === "RENT_SHOWDOWN" && state.pendingMinigame && (
        <ReflexTapDuel
          key={state.pendingMinigame.context.stakeData.propertyId + "-" + state.activePlayerIndex}
          request={state.pendingMinigame}
          onResult={(r) => dispatch({ type: "SUBMIT_MINIGAME_RESULT", result: r })}
          onMetrics={(r, inputs, meta) => logDuel(toRecord(r, inputs, { preGoDelayMs: meta.preGoDelayMs, devices: meta.devices }))}
          {...(aiSeat !== undefined ? { aiSeat, aiSkill } : {})}
        />
      )}

      <section>
        {flat ? <Board state={state} /> : <IsoBoard state={state} {...(boardPick ?? {})} />}
      </section>

      <DebugPanel onRestart={restart} flat={flat} onToggleFlat={() => setFlat((f) => !f)} />
    </main>
  );
}
