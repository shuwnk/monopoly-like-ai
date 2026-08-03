import { Room, type Client } from "colyseus";
import { createInitialState, reduce, type GameAction, type GameState } from "@party-monopoly/engine";
import { DEFAULT_REFLEX_TAP_DUEL_CONFIG } from "@party-monopoly/minigame-harness";
import type { ReflexInput } from "@party-monopoly/minigame-harness";
import {
  asPlayerId,
  C2S,
  FDClient,
  FDServer,
  S2C,
  type ActionMessage,
  type CreateRoomOptions,
  type ErrorMessage,
  type FDInput,
  type FDOver,
  type FDStart,
  type LobbyMessage,
  type MinigameResult,
  type PlayerId,
  type ShowdownResultMessage,
  type ShowdownStartMessage,
  type StateMessage,
  type TapMessage,
} from "@party-monopoly/types";
import { MISSING_TAP, resolveShowdown } from "./showdown.js";
import { FloorDropSim } from "./FloorDropSim.js";
import { isLegalAction } from "./validate.js";

const cfg = DEFAULT_REFLEX_TAP_DUEL_CONFIG;
// how long after "go" we wait for both taps before filling the rest as misses
const TAP_TIMEOUT_MS = 5000;
// party round: authoritative Floor Drop tick rate (20 Hz, matching the standalone room)
const PARTY_TICK_MS = 50;
// how long the final-placement screen holds before the board resumes
const PARTY_RESULT_MS = 3000;
// how long we wait for a player's Copa / Aeroporto pick before auto-resolving it
// with a sensible default, so an idle or dropped player can't stall the room
const PICK_TIMEOUT_MS = 20000;
// hold a dropped player's seat this long before giving up on the game
const RECONNECT_WINDOW_S = 30;
// game-length bounds (seconds) for the host's countdown, and the fallback default
const MIN_DURATION_S = 60;
const MAX_DURATION_S = 3600;
const DEFAULT_DURATION_S = 900; // 15 min
// player-count bounds; the host picks how many the room seats
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const HOST_SEAT = asPlayerId("p0"); // the first joiner is the host

export class GameRoom extends Room {
  private game: GameState | null = null;
  // sessionId -> playerId
  private seats = new Map<string, PlayerId>();
  // collected taps for the current showdown, keyed by playerId
  private taps = new Map<PlayerId, ReflexInput>();
  private goTimer: ReturnType<typeof setTimeout> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private pickTimer: ReturnType<typeof setTimeout> | null = null;
  private gameTimer: ReturnType<typeof setTimeout> | null = null;
  // host-chosen game length + the epoch-ms deadline once the game starts
  private durationSec = DEFAULT_DURATION_S;
  private endsAt: number | null = null;
  private started = false;
  // party round: an authoritative Floor Drop sim runs inline while the board is parked in
  // PARTY_ROUND. partySeat maps a sessionId -> fighter id for that round.
  private partySim: FloorDropSim | null = null;
  private partySeat = new Map<string, number>(); // sessionId -> fighter id
  private partyPlayers: PlayerId[] = []; // fighter id order -> board playerId (for the ranking)
  private partyOverTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLeaves: PlayerId[] = []; // players who left mid-party; forfeited once it resolves

  override onCreate(options: CreateRoomOptions | undefined) {
    const d = Number(options?.durationSec);
    if (Number.isFinite(d)) this.durationSec = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, Math.round(d)));
    const p = Number(options?.maxPlayers);
    this.maxClients = Number.isFinite(p) ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(p))) : MIN_PLAYERS;
    this.onMessage(C2S.action, (client, msg: ActionMessage) => this.onAction(client, msg));
    this.onMessage(C2S.tap, (client, msg: TapMessage) => this.onTap(client, msg));
    this.onMessage(C2S.start, (client) => this.onStartRequest(client));
    // movement input during a party round (reuses the Floor Drop wire protocol)
    this.onMessage(FDClient.input, (client, msg: FDInput) => {
      const id = this.partySeat.get(client.sessionId);
      if (id !== undefined) this.partySim?.setInput(id, msg.dx, msg.dy);
    });
  }

  override onJoin(client: Client) {
    const seat = this.nextSeat();
    if (this.started || !seat) {
      client.leave();
      return;
    }
    this.seats.set(client.sessionId, seat);
    if (this.seats.size >= this.maxClients) this.startGame();
    else this.broadcastLobby();
  }

  // host may start early once at least two players are in the lobby
  private onStartRequest(client: Client) {
    if (this.started || this.seats.get(client.sessionId) !== HOST_SEAT || this.seats.size < MIN_PLAYERS) return;
    this.startGame();
  }

  override async onLeave(client: Client, consented: boolean) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;

    // Leaving DURING a party round must not touch the board: a forfeit nulls
    // pendingMinigame while the phase stays PARTY_ROUND, which would crash/stall the parked
    // round. Instead hand the fighter to a bot (so the sim finishes) and queue the leave to be
    // resolved once the round does. Party rounds are short, so no reconnection window here.
    if (this.partySim) {
      const fid = this.partySeat.get(client.sessionId);
      if (fid !== undefined) this.partySim.makeBot(fid);
      this.partySeat.delete(client.sessionId);
      this.seats.delete(client.sessionId);
      this.pendingLeaves.push(seat);
      return;
    }

    // still in the lobby: free the seat and refresh everyone (or close if empty)
    if (!this.started) {
      this.seats.delete(client.sessionId);
      if (this.seats.size === 0) this.disconnect();
      else this.broadcastLobby();
      return;
    }

    // mid-game: a deliberate leave forfeits; a drop holds the seat for a window
    if (consented) {
      this.seats.delete(client.sessionId);
      this.forfeit(seat);
      return;
    }
    try {
      const back = await this.allowReconnection(client, RECONNECT_WINDOW_S);
      this.seats.delete(client.sessionId);
      this.seats.set(back.sessionId, seat);
      back.send(S2C.state, { state: this.game!, you: seat, ...(this.endsAt !== null ? { endsAt: this.endsAt } : {}) } satisfies StateMessage<GameState>);
    } catch {
      this.seats.delete(client.sessionId);
      this.forfeit(seat);
    }
  }

  // lowest unused seat id (p0..pN-1), or null if the room is full
  private nextSeat(): PlayerId | null {
    const used = new Set(this.seats.values());
    for (let i = 0; i < this.maxClients; i++) {
      const id = asPlayerId(`p${i}`);
      if (!used.has(id)) return id;
    }
    return null;
  }

  private broadcastLobby() {
    for (const c of this.clients) {
      const seat = this.seats.get(c.sessionId);
      if (seat) c.send(S2C.lobby, { joined: this.seats.size, capacity: this.maxClients, host: seat === HOST_SEAT } satisfies LobbyMessage);
    }
  }

  // a seated player left mid-game: remove them from the game without stalling it
  private forfeit(seat: PlayerId) {
    if (this.game && this.game.phase !== "GAME_OVER") this.applyAction({ type: "FORFEIT", playerId: seat });
  }

  override onDispose() {
    this.clearTimers();
  }

  private clearTimers() {
    if (this.goTimer) clearTimeout(this.goTimer);
    if (this.tapTimer) clearTimeout(this.tapTimer);
    if (this.gameTimer) clearTimeout(this.gameTimer);
    if (this.partyOverTimer) clearTimeout(this.partyOverTimer);
    this.clearPickTimer();
    this.goTimer = null;
    this.tapTimer = null;
    this.gameTimer = null;
    this.partyOverTimer = null;
  }

  private clearPickTimer() {
    if (this.pickTimer) clearTimeout(this.pickTimer);
    this.pickTimer = null;
  }

  // only the duel timers — NOT the game countdown, which must survive a showdown
  private clearShowdownTimers() {
    if (this.goTimer) clearTimeout(this.goTimer);
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.goTimer = null;
    this.tapTimer = null;
  }

  private startGame() {
    if (this.started) return;
    this.started = true;
    void this.lock(); // no late joiners once the game is under way
    // seat the players who actually joined, in seat order (p0, p1, …)
    const seated = [...this.seats.values()].sort();
    this.game = createInitialState({
      seed: Date.now(),
      players: seated.map((id, i) => ({ id, name: `Player ${i + 1}`, isAI: false })),
      // online party rounds run Floor Drop only — it's the one minigame with a server-side
      // authoritative sim. Barn Brawl / Bomberman have no server sim yet, so restrict the pick.
      tunables: { partyGames: ["floordrop"] },
    });
    // start the host-authoritative countdown; at zero the richest player wins
    this.endsAt = Date.now() + this.durationSec * 1000;
    this.gameTimer = setTimeout(() => this.timeUp(), this.durationSec * 1000);
    this.broadcastState();
  }

  private timeUp() {
    this.gameTimer = null;
    if (!this.game || this.game.phase === "GAME_OVER") return;
    this.game = reduce(this.game, { type: "END_ON_TIME" }).state;
    this.broadcastState();
  }

  private onAction(client: Client, msg: ActionMessage) {
    if (!this.game) return;
    const you = this.seats.get(client.sessionId);
    if (!you) return;

    const type = msg.action.type;
    if (!isLegalAction(this.game, you, type)) {
      this.sendError(client, "illegal action");
      return;
    }

    const action = this.toGameAction(msg.action, you);
    if (!action) {
      this.sendError(client, "malformed action");
      return;
    }
    this.applyAction(action);
  }

  // Turn a wire ClientAction into an engine GameAction, threading the squareId
  // for the picks and the player id for bankruptcy. Rejects (null) a targeted
  // action with no square — the reducer would silently no-op it otherwise.
  private toGameAction(action: ActionMessage["action"], you: PlayerId): GameAction | null {
    switch (action.type) {
      case "DECLARE_BANKRUPT":
        return { type: action.type, playerId: you };
      case "BUILD_HOUSE":
      case "SELL_TILE":
      case "SELECT_WORLD_CUP_TILE":
      case "SELECT_AIRPORT_TILE":
        return typeof action.squareId === "number" ? { type: action.type, squareId: action.squareId } : null;
      default:
        return { type: action.type };
    }
  }

  // Apply one action, broadcast, then advance side-effects: a rent duel starts a
  // showdown; a Copa/Aeroporto pause arms the pick-timeout so a silent player
  // can't stall the room. Every state change funnels through here.
  private applyAction(action: GameAction) {
    this.game = reduce(this.game!, action).state;
    this.broadcastState();

    if (this.game.phase === "RENT_SHOWDOWN") {
      this.clearPickTimer();
      this.startShowdown();
      return;
    }
    // start a party round only on ENTERING the phase — never re-enter one already running
    // (a stray re-entry would rebuild the sim / deref a cleared pendingMinigame)
    if (this.game.phase === "PARTY_ROUND") {
      this.clearPickTimer();
      if (!this.partySim) this.startPartyRound();
      return;
    }
    this.schedulePickFallback();
  }

  // Copa / Aeroporto / build-on-landing pause the engine for the active player's
  // choice. The client shows a prompt; this only fires if they don't answer in time.
  private schedulePickFallback() {
    this.clearPickTimer();
    const phase = this.game!.phase;
    if (
      phase === "AWAITING_WORLD_CUP" ||
      phase === "AWAITING_AIRPORT" ||
      phase === "AWAITING_BUILD_DECISION" ||
      phase === "AWAITING_DEBT_PAYMENT"
    ) {
      this.pickTimer = setTimeout(() => this.autoResolvePick(), PICK_TIMEOUT_MS);
    }
  }

  private autoResolvePick() {
    this.clearPickTimer();
    const game = this.game;
    if (!game) return;
    if (game.phase === "AWAITING_WORLD_CUP") {
      // boost the player's first not-yet-boosted stall (the engine guarantees one exists)
      const active = game.players[game.activePlayerIndex]!;
      const stall = Object.entries(game.ownership).find(
        ([sq, owner]) => owner === active.id && (game.rentBoosts[Number(sq)] ?? 1) <= 1,
      );
      if (stall) this.applyAction({ type: "SELECT_WORLD_CUP_TILE", squareId: Number(stall[0]) });
    } else if (game.phase === "AWAITING_AIRPORT") {
      this.applyAction({ type: "SELECT_AIRPORT_TILE", squareId: 0 }); // default: fly to GO
    } else if (game.phase === "AWAITING_BUILD_DECISION") {
      this.applyAction({ type: "DECLINE_BUILD" }); // default: don't spend
    } else if (game.phase === "AWAITING_DEBT_PAYMENT") {
      this.applyAction({ type: "AUTO_SELL" }); // default: liquidate to pay, else bankrupt
    }
  }

  // --- showdown ---

  private startShowdown() {
    const game = this.game!;
    this.taps.clear();
    const baseRent = game.pendingMinigame!.context.stakeData!.baseRent;
    this.broadcast(S2C.showdownStart, { baseRent } satisfies ShowdownStartMessage);

    const delay = cfg.minDelayMs + Math.random() * (cfg.maxDelayMs - cfg.minDelayMs);
    this.goTimer = setTimeout(() => this.goSignal(), delay);
  }

  private goSignal() {
    this.broadcast(S2C.showdownGo, {});
    this.tapTimer = setTimeout(() => this.resolveShowdown(), TAP_TIMEOUT_MS);
  }

  private onTap(client: Client, msg: TapMessage) {
    if (!this.game || this.game.phase !== "RENT_SHOWDOWN") return;
    const you = this.seats.get(client.sessionId);
    if (!you || this.taps.has(you)) return;

    this.taps.set(you, { reactionMs: msg.reactionMs, falseStart: msg.falseStart });
    if (this.taps.size === this.seats.size) this.resolveShowdown();
  }

  private resolveShowdown() {
    this.clearShowdownTimers();
    const game = this.game;
    if (!game || game.phase !== "RENT_SHOWDOWN") return;

    const [payer, owner] = game.pendingMinigame!.participants;
    const payerTap = this.taps.get(payer!.playerId) ?? MISSING_TAP;
    const ownerTap = this.taps.get(owner!.playerId) ?? MISSING_TAP;

    const res = resolveShowdown(game, payerTap, ownerTap, cfg.drawWindowMs, cfg.minHumanReactionMs);
    // tell both clients the reveal before the resolved state clears the duel
    this.broadcast(S2C.showdownResult, {
      payerId: res.payerId,
      ownerId: res.ownerId,
      payerReactionMs: res.payerTap.reactionMs,
      ownerReactionMs: res.ownerTap.reactionMs,
      payerFalseStart: res.payerTap.falseStart,
      ownerFalseStart: res.ownerTap.falseStart,
      outcome: res.result.outcome,
      aborted: res.result.status === "ABORTED",
    } satisfies ShowdownResultMessage);
    this.game = reduce(game, { type: "SUBMIT_MINIGAME_RESULT", result: res.result }).state;
    this.broadcastState();
  }

  // --- party round (inline Floor Drop: the board room hosts an authoritative sim while
  // parked in PARTY_ROUND, then feeds the placement ranking back to the engine) ---

  private startPartyRound() {
    const game = this.game!;
    const parts = game.pendingMinigame!.participants; // the seated solvent players
    this.partyPlayers = parts.map((p) => p.playerId);
    // fighter id i ↔ participant i; a connected client controls their own fighter, others are bots
    const humans = parts.map((p, i) => {
      const player = game.players.find((pl) => pl.id === p.playerId);
      return { id: i, name: player?.name ?? `Player ${i + 1}` };
    });
    this.partySim = new FloorDropSim(humans, humans.length);
    this.partySeat.clear();
    const roster = this.partySim.fighters.map((f) => ({ id: f.id, name: f.name, color: f.color, bot: f.isBot }));
    for (const c of this.clients) {
      const pid = this.seats.get(c.sessionId);
      const fid = pid ? this.partyPlayers.indexOf(pid) : -1;
      if (fid >= 0) {
        this.partySeat.set(c.sessionId, fid);
        c.send(FDServer.start, { you: fid, players: roster } satisfies FDStart);
      }
    }
    this.setSimulationInterval((dtMs) => this.partyTick(dtMs), PARTY_TICK_MS);
  }

  private partyTick(dtMs: number) {
    const sim = this.partySim;
    if (!sim) return;
    sim.update(Math.min(0.05, dtMs / 1000));
    this.broadcast(FDServer.snap, sim.snapshot());
    if (sim.over) this.endPartyRound();
  }

  // sim finished: show the placement screen, then resume the board after a beat
  private endPartyRound() {
    const sim = this.partySim;
    if (!sim) return;
    this.setSimulationInterval(); // stop ticking (no callback = clear)
    this.broadcast(FDServer.over, {
      winner: sim.winner?.name ?? "",
      places: sim.fighters.map((f) => [f.id, f.place === 0 ? 1 : f.place] as const),
    } satisfies FDOver);
    this.partyOverTimer = setTimeout(() => this.resolvePartyRound(), PARTY_RESULT_MS);
  }

  private resolvePartyRound() {
    this.partyOverTimer = null;
    const sim = this.partySim;
    const game = this.game;
    if (!sim || !game) return;
    // per-fighter placements → best-to-worst ranking over the board playerIds
    const ranking = [...sim.fighters]
      .sort((a, b) => (a.place || 1) - (b.place || 1))
      .map((f) => this.partyPlayers[f.id])
      .filter((id): id is PlayerId => id !== undefined);
    const result: MinigameResult = { minigameId: game.pendingMinigame!.minigameId, status: "COMPLETED", outcome: "P0_WIN", ranking };
    this.partySim = null;
    this.partySeat.clear();
    this.game = reduce(game, { type: "SUBMIT_MINIGAME_RESULT", result }).state;
    this.broadcastState();
    // now that the board has resumed, apply any leaves that happened during the round
    const leaves = this.pendingLeaves;
    this.pendingLeaves = [];
    for (const s of leaves) this.forfeit(s);
  }

  // --- helpers ---

  private broadcastState() {
    const state = this.game!;
    const clock = this.endsAt !== null ? { endsAt: this.endsAt } : {};
    for (const c of this.clients) {
      const you = this.seats.get(c.sessionId);
      if (you) c.send(S2C.state, { state, you, ...clock } satisfies StateMessage<GameState>);
    }
  }

  private sendError(client: Client, message: string) {
    client.send(S2C.error, { message } satisfies ErrorMessage);
  }
}
