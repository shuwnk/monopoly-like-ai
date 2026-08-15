import { useState, type ReactNode } from "react";
import type { LobbyMessage } from "@party-monopoly/types";
import { useOnlineStore } from "../store/onlineStore.js";
import { CURRENCY } from "../theme.js";
import { avatarById } from "../game/avatars.js";
import { AvatarThumb } from "./AvatarThumb.js";
import { IsoBoard } from "./IsoBoard.js";
import { HowToWin } from "./HowToWin.js";
import { Hud } from "./Hud.js";
import { OnlineReflexDuel } from "./OnlineReflexDuel.js";
import { OnlinePartyRound } from "./OnlinePartyRound.js";
import { BuildPrompt, DebtPanel, airportTargets, copaTargets, sellTargets } from "./TurnChoices.js";

export function OnlineGame({ onLeave }: { onLeave: () => void }): JSX.Element {
  const { status, roomId, state, you, error, showdown, endsAt, lobby, party, startGame, sendAction, sendTap, dismissShowdown, disconnect } =
    useOnlineStore();
  const [sellMode, setSellMode] = useState(false);
  const [rules, setRules] = useState(false);

  function leave(): void {
    disconnect();
    onLeave();
  }

  // a party round takes over the screen: everyone plays the server-run FFA minigame, then
  // placement pays out and the board resumes (the server auto-submits the result)
  if (party) return <OnlinePartyRound />;

  if (!state) {
    return (
      <Frame onLeave={leave}>
        <Status status={status} roomId={roomId} error={error} />
        {lobby && <Lobby lobby={lobby} roomId={roomId} onStart={startGame} onRules={() => setRules(true)} />}
        {rules && <HowToWin onClose={() => setRules(false)} />}
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
    <Frame onLeave={leave} onRules={() => setRules(true)}>
      {rules && <HowToWin tunables={state.tunables} onClose={() => setRules(false)} />}
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
          payerName={state.players.find((p) => p.id === showdown.payerId)?.name ?? "Payer"}
          ownerName={state.players.find((p) => p.id === showdown.ownerId)?.name ?? "Owner"}
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

// Pre-game room: who's here, how to get the rest of your friends in, and (for the
// host) the start button. Empty seats are drawn too so the wait reads as progress.
function Lobby({
  lobby,
  roomId,
  onStart,
  onRules,
}: {
  lobby: LobbyMessage;
  roomId: string | null;
  onStart: () => void;
  onRules: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const link = roomId ? `${window.location.origin}${window.location.pathname}?room=${roomId}` : "";
  const empty = Math.max(0, lobby.capacity - lobby.players.length);

  function copy(what: "link" | "code", text: string): void {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        window.setTimeout(() => setCopied(null), 1600);
      },
      () => setCopied(null), // clipboard blocked (insecure context) — the text is on screen anyway
    );
  }

  return (
    <section style={{ margin: "16px 0", padding: 16, borderRadius: "var(--radius)", background: "var(--panel-2)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>
          {lobby.joined} / {lobby.capacity} players in
        </div>
        <button style={{ padding: "4px 10px", fontSize: 12 }} onClick={onRules}>
          How to win
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "14px 0" }}>
        {lobby.players.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              width: 84,
              padding: "8px 4px",
              borderRadius: 10,
              background: "var(--panel)",
              border: `2px solid ${p.id === lobby.you ? "var(--accent)" : "transparent"}`,
            }}
          >
            <AvatarThumb av={avatarById(p.avatar)} size={48} />
            <span style={{ fontSize: 12, fontWeight: 800, maxWidth: 76, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)", height: 12 }}>
              {p.id === lobby.hostId ? "host" : p.id === lobby.you ? "you" : ""}
            </span>
          </div>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <div
            key={`empty-${i}`}
            style={{
              display: "grid",
              placeItems: "center",
              width: 84,
              height: 92,
              borderRadius: 10,
              border: "2px dashed var(--border)",
              color: "var(--muted)",
              fontSize: 11,
            }}
          >
            waiting…
          </div>
        ))}
      </div>

      {roomId && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 14 }}>
          <span>
            Room code <strong style={{ fontFamily: "monospace", fontSize: 16 }}>{roomId}</strong>
          </span>
          <button style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => copy("code", roomId)}>
            {copied === "code" ? "Copied ✓" : "Copy code"}
          </button>
          <button style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => copy("link", link)}>
            {copied === "link" ? "Copied ✓" : "Copy invite link"}
          </button>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {lobby.host ? (
          <button className="primary" disabled={lobby.joined < 2} onClick={onStart}>
            {lobby.joined < 2 ? "Waiting for one more…" : `Start game (${lobby.joined} in)`}
          </button>
        ) : (
          <span style={{ color: "var(--muted)" }}>Waiting for the host to start…</span>
        )}
      </div>
    </section>
  );
}

function Frame({ children, onLeave, onRules }: { children: ReactNode; onLeave: () => void; onRules?: () => void }): JSX.Element {
  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 1440, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Party Monopoly — Online</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {onRules && <button onClick={onRules}>How to win</button>}
          <button onClick={onLeave}>Leave</button>
        </div>
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
        ? "In the lobby…"
        : status === "reconnecting"
          ? "Connection lost — reconnecting…"
          : status === "left"
            ? "You were disconnected. The others played on without you."
            : status === "error"
              ? `Error: ${error ?? "unknown"}`
              : ""; // "playing" needs no banner — the board says it
  return (
    <div style={{ margin: "8px 0", display: "flex", gap: 12, alignItems: "center" }}>
      {roomId && status !== "playing" && (
        <span>
          Room code: <strong style={{ fontFamily: "monospace" }}>{roomId}</strong>
        </span>
      )}
      {text && <span style={{ opacity: 0.85 }}>{text}</span>}
    </div>
  );
}
