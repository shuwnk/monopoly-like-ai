import { Room, type Client } from "colyseus";
import { createInitialState, reduce, type GameAction, type GameEvent, type GameState } from "@party-monopoly/engine";
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
  type LobbySeat,
  type MinigameResult,
  type PlayerId,
  type PlayerIdentity,
  type PlayerLook,
  EMPTY_LOOK,
  sanitizeLook,
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
// how long we wait on a normal turn decision (roll / buy) before auto-playing it,
// so a distracted or dropped active player can't freeze the room mid-turn. More
// generous than a forced pick since it's a real decision.
const TURN_TIMEOUT_MS = 30000;
// hold a dropped player's seat this long before giving up on the game
const RECONNECT_WINDOW_S = 30;
// game-length bounds (seconds) for the host's countdown, and the fallback default
const MIN_DURATION_S = 60;
const MAX_DURATION_S = 3600;
const DEFAULT_DURATION_S = 900; // 15 min
// player-count bounds; the host picks how many the room seats
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
// how many recent events a room remembers for the admin panel
const EVENT_LOG_MAX = 400;
// a display name is shown to the whole table, so it gets trimmed and capped
const MAX_NAME_LEN = 14;

export class GameRoom extends Room {
  private game: GameState | null = null;
  // sessionId -> playerId
  private seats = new Map<string, PlayerId>();
  // seat -> who that player says they are. Keyed by seat, not sessionId, so a
  // reconnecting player keeps their name.
  private profiles = new Map<PlayerId, { name: string; look: PlayerLook }>();
  // collected taps for the current showdown, keyed by playerId
  private taps = new Map<PlayerId, ReflexInput>();
  // the two players in the live duel; everyone else spectates and may not tap
  private duellists: PlayerId[] = [];
  private goTimer: ReturnType<typeof setTimeout> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  // a duel is live between startShowdown() and its resolution; guards against
  // re-arming an in-progress duel when a bystander's forfeit re-broadcasts state
  private showdownArmed = false;
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
  // recent events, newest last. Goes to stdout (so it shows up in the host's log
  // stream) AND is kept here so the admin panel can show what just happened in a
  // room without anyone needing shell access.
  private events: { t: number; msg: string }[] = [];

  override onCreate(options: CreateRoomOptions | undefined) {
    const d = Number(options?.durationSec);
    if (Number.isFinite(d)) this.durationSec = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, Math.round(d)));
    const p = Number(options?.maxPlayers);
    this.maxClients = Number.isFinite(p) ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(p))) : MIN_PLAYERS;
    this.onMessage(C2S.action, (client, msg: ActionMessage) => this.onAction(client, msg));
    this.onMessage(C2S.tap, (client, msg: TapMessage) => this.onTap(client, msg));
    this.onMessage(C2S.start, (client) => this.onStartRequest(client));
    this.onMessage(C2S.sync, (client) => this.sendSnapshot(client));
    this.onMessage(C2S.restart, (client) => this.onRestartRequest(client));
    // movement input during a party round (reuses the Floor Drop wire protocol)
    this.onMessage(FDClient.input, (client, msg: FDInput) => {
      const id = this.partySeat.get(client.sessionId);
      if (id !== undefined) this.partySim?.setInput(id, msg.dx, msg.dy);
    });
  }

  override onJoin(client: Client, options?: PlayerIdentity) {
    const seat = this.nextSeat();
    if (this.started || !seat) {
      client.leave();
      return;
    }
    this.seats.set(client.sessionId, seat);
    this.profiles.set(seat, {
      name: this.uniqueName(cleanName(options?.name) || `Player ${this.seats.size}`),
      look: sanitizeLook(options?.look),
    });
    this.note(`join ${seat} "${this.nameOf(seat)}" (${this.seats.size}/${this.maxClients})`);
    if (this.seats.size >= this.maxClients) this.startGame();
    else this.broadcastLobby();
  }

  // Whoever holds the lowest occupied seat hosts. Pinning it to p0 meant that if
  // the creator left the lobby, nobody remaining could start and the room was
  // dead until everyone gave up and re-shared a new code.
  private hostSeat(): PlayerId | null {
    return [...this.seats.values()].sort()[0] ?? null;
  }

  // host may start early once at least two players are in the lobby
  private onStartRequest(client: Client) {
    if (this.started || this.seats.get(client.sessionId) !== this.hostSeat() || this.seats.size < MIN_PLAYERS) return;
    this.startGame();
  }

  // The host may replay the match with whoever is still in the room. Same seats,
  // same names, fresh board and clock — nobody has to swap room codes to go again.
  private onRestartRequest(client: Client) {
    const seat = this.seats.get(client.sessionId);
    if (!seat || seat !== this.hostSeat()) {
      if (seat) this.note(`restart refused for ${seat} "${this.nameOf(seat)}" — not the host`);
      return;
    }
    if (!this.started) return; // still in the lobby; there is nothing to restart
    this.note(`host "${this.nameOf(seat)}" restarted the match`);
    const res = this.resetMatch();
    if (!res.ok) this.sendError(client, res.error ?? "could not restart");
  }

  override async onLeave(client: Client, consented: boolean) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;

    // Leaving DURING a party round must not touch the board: a forfeit nulls
    // pendingMinigame while the phase stays PARTY_ROUND, which would crash/stall the parked
    // round. Instead hand the fighter to a bot (so the sim finishes) and queue the leave to be
    // resolved once the round does. Party rounds are short, so no reconnection window here.
    if (this.partySim) {
      // Hand the fighter to a bot so the round still finishes for everyone else.
      const fid = this.partySeat.get(client.sessionId);
      if (fid !== undefined) this.partySim.makeBot(fid);
      this.partySeat.delete(client.sessionId);

      if (consented) {
        this.note(`leave ${seat} "${this.nameOf(seat)}" during a party round (deliberate)`);
        this.seats.delete(client.sessionId);
        this.pendingLeaves.push(seat);
        return;
      }
      // An accidental drop gets the same grace as one on the board. Party rounds
      // are real-time minigames played on phones — backgrounding the browser for
      // two seconds used to bankrupt you with no way back in.
      this.note(`dropped ${seat} "${this.nameOf(seat)}" during a party round — holding the seat ${RECONNECT_WINDOW_S}s`);
      try {
        const back = await this.allowReconnection(client, RECONNECT_WINDOW_S);
        this.seats.delete(client.sessionId);
        this.seats.set(back.sessionId, seat);
        this.note(`reconnected ${seat} "${this.nameOf(seat)}"`);
        this.rejoinPartyRound(back, seat);
        this.sendSnapshot(back);
      } catch {
        this.seats.delete(client.sessionId);
        this.note(`${seat} "${this.nameOf(seat)}" never came back — forfeiting`);
        // if the round is still running, defer; forfeiting mid-round aborts it
        if (this.partySim) this.pendingLeaves.push(seat);
        else this.forfeit(seat);
      }
      return;
    }

    // still in the lobby: free the seat and refresh everyone (or close if empty)
    if (!this.started) {
      this.note(`leave ${seat} "${this.nameOf(seat)}" from the lobby`);
      this.seats.delete(client.sessionId);
      this.profiles.delete(seat); // free the name too, so the reused seat re-registers
      if (this.seats.size === 0) this.disconnect();
      else this.broadcastLobby();
      return;
    }

    // mid-game: a deliberate leave forfeits; a drop holds the seat for a window
    if (consented) {
      this.note(`leave ${seat} "${this.nameOf(seat)}" mid-game (deliberate) — forfeiting`);
      this.seats.delete(client.sessionId);
      this.forfeit(seat);
      return;
    }
    try {
      this.note(`dropped ${seat} "${this.nameOf(seat)}" — holding the seat ${RECONNECT_WINDOW_S}s`);
      const back = await this.allowReconnection(client, RECONNECT_WINDOW_S);
      this.note(`reconnected ${seat} "${this.nameOf(seat)}"`);
      this.seats.delete(client.sessionId);
      this.seats.set(back.sessionId, seat);
      back.send(S2C.state, { state: this.game!, you: seat, looks: this.looks(), ...(this.endsAt !== null ? { endsAt: this.endsAt } : {}) } satisfies StateMessage<GameState>);
    } catch {
      this.note(`${seat} "${this.nameOf(seat)}" never came back — forfeiting`);
      this.seats.delete(client.sessionId);
      // A forfeit lands on the engine immediately; if a party round happens to be
      // running, that aborts it for the whole table over one absent player. Defer
      // it the same way a mid-round leave does.
      if (this.partySim) this.pendingLeaves.push(seat);
      else this.forfeit(seat);
    }
  }

  // Put a reconnected player back into the round in progress — otherwise they sit
  // on a frozen board until it ends, and their fighter never moves.
  private rejoinPartyRound(client: Client, seat: PlayerId) {
    if (!this.partySim) return;
    const fid = this.partyPlayers.indexOf(seat);
    if (fid < 0) return;
    this.partySeat.set(client.sessionId, fid);
    this.partySim.takeOver(fid);
    const roster = this.partySim.fighters.map((f) => {
      const owner = this.partyPlayers[f.id];
      return { id: f.id, name: f.name, color: f.color, bot: f.isBot, look: owner ? this.lookOf(owner) : EMPTY_LOOK };
    });
    client.send(FDServer.start, { you: fid, players: roster } satisfies FDStart);
    this.note(`${seat} "${this.nameOf(seat)}" rejoined the party round as fighter ${fid}`);
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

  // two friends called "Alex" would be unreadable at the table; suffix the later one
  private uniqueName(want: string): string {
    const taken = new Set([...this.profiles.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(want.toLowerCase())) return want;
    for (let n = 2; ; n++) {
      const tryName = `${want} ${n}`;
      if (!taken.has(tryName.toLowerCase())) return tryName;
    }
  }

  // seats in join order, with the name/avatar each player picked
  private roster(): LobbySeat[] {
    return [...this.seats.values()]
      .sort()
      .map((id) => ({ id, name: this.nameOf(id), look: this.lookOf(id) }));
  }

  private nameOf(seat: PlayerId): string {
    return this.profiles.get(seat)?.name ?? `Player ${Number(seat.slice(1)) + 1}`;
  }

  private lookOf(seat: PlayerId): PlayerLook {
    return this.profiles.get(seat)?.look ?? EMPTY_LOOK;
  }

  // every seated player's look, so a client can draw the whole table correctly
  private looks(): Record<string, PlayerLook> {
    const out: Record<string, PlayerLook> = {};
    for (const id of this.seats.values()) out[id] = this.lookOf(id);
    return out;
  }

  private broadcastLobby() {
    for (const c of this.clients) this.sendLobby(c);
  }

  private sendLobby(client: Client) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    client.send(S2C.lobby, {
      joined: this.seats.size,
      capacity: this.maxClients,
      host: seat === this.hostSeat(),
      you: seat,
      hostId: this.hostSeat() ?? seat,
      players: this.roster(),
    } satisfies LobbyMessage);
  }

  // whatever this client should be looking at right now. Answers C2S.sync, which
  // a client sends once its handlers are attached — the message its own join
  // triggered went out before it could listen for it.
  private sendSnapshot(client: Client) {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    if (!this.game) {
      this.sendLobby(client);
      return;
    }
    client.send(S2C.state, {
      state: this.game,
      you: seat,
      looks: this.looks(),
      ...(this.endsAt !== null ? { endsAt: this.endsAt } : {}),
    } satisfies StateMessage<GameState>);
  }

  // a seated player left mid-game: remove them from the game without stalling it
  private forfeit(seat: PlayerId) {
    if (this.game && this.game.phase !== "GAME_OVER") {
      this.note(`forfeit ${seat} "${this.nameOf(seat)}"`);
      this.applyAction({ type: "FORFEIT", playerId: seat });
    }
  }

  override onDispose() {
    this.note("room disposed");
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
    this.showdownArmed = false;
    this.duellists = [];
  }

  private startGame() {
    if (this.started) return;
    this.started = true;
    void this.lock(); // no late joiners once the game is under way
    // seat the players who actually joined, in seat order (p0, p1, …)
    const seated = [...this.seats.values()].sort();
    this.game = createInitialState({
      seed: Date.now(),
      players: seated.map((id) => ({ id, name: this.nameOf(id), isAI: false })),
      // online party rounds run Floor Drop only — it's the one minigame with a server-side
      // authoritative sim. Barn Brawl / Bomberman have no server sim yet, so restrict the pick.
      tunables: { partyGames: ["floordrop"] },
    });
    // start the host-authoritative countdown; at zero the richest player wins
    this.endsAt = Date.now() + this.durationSec * 1000;
    this.gameTimer = setTimeout(() => this.timeUp(), this.durationSec * 1000);
    this.note(`game started — ${seated.length} players, ${this.durationSec}s: ${seated.map((id) => this.nameOf(id)).join(", ")}`);
    this.broadcastState();
    this.schedulePickFallback(); // arm the first player's turn timer
  }

  private timeUp() {
    this.gameTimer = null;
    if (!this.game || this.game.phase === "GAME_OVER") return;
    this.note("clock hit zero — ending on net worth");
    const res = reduce(this.game, { type: "END_ON_TIME" });
    for (const e of res.events) this.note(`  · ${this.describe(e)}`);
    this.game = res.state;
    this.broadcastState();
  }

  // Render one engine event as a line. Names rather than seat ids where possible —
  // when reading a log you think in players, not indices.
  private describe(e: GameEvent): string {
    const who = (id: PlayerId): string => `${id} "${this.nameOf(id)}"`;
    const sq = (id: number): string => `${id} (${this.game?.board[id]?.name ?? "?"})`;
    switch (e.type) {
      case "DICE_ROLLED":
        return `${who(e.playerId)} rolled ${e.dice.join("+")} = ${e.dice.reduce((a, b) => a + b, 0)}`;
      case "PLAYER_MOVED":
        return `${who(e.playerId)} moved to ${sq(e.to)}${e.passedGo ? " (passed GO)" : ""}`;
      case "PROPERTY_BOUGHT":
        return `${who(e.playerId)} bought ${sq(e.propertyId)} for ${e.price}`;
      case "HOUSE_BUILT":
        return `${who(e.playerId)} built level ${e.level} on ${sq(e.squareId)} for ${e.cost}`;
      case "TILE_SOLD":
        return `${who(e.playerId)} sold ${e.wasHouse ? "a house on " : ""}${sq(e.squareId)} for ${e.refund}`;
      case "DEBT_PAID":
        return `${who(e.playerId)} paid a debt of ${e.amount}`;
      case "WORLD_CUP_BOOST":
        return `${who(e.playerId)} Copa-boosted ${sq(e.squareId)} ×${e.multiplier}`;
      case "AIRPORT_TRAVEL":
        return `${who(e.playerId)} flew to ${sq(e.to)}`;
      case "MINIGAME_REQUESTED":
        return `minigame requested: ${e.request.minigameId} (${e.request.participants.map((p) => p.playerId).join(" vs ")})`;
      case "RENT_PAID":
        return `${who(e.from)} paid rent ${e.amount} to ${who(e.to)} (×${e.multiplier})`;
      case "PARTY_ROUND_PAYOUT":
        return `${who(e.playerId)} placed #${e.place} in the party round → ${e.amount}`;
      case "SENT_TO_JAIL":
        return `${who(e.playerId)} was sent to jail`;
      case "PLAYER_BANKRUPT":
        return `${who(e.playerId)} went BANKRUPT (released ${e.releasedProperties.length} properties)`;
      case "TURN_ENDED":
        return `turn ended → ${who(e.nextPlayerId)}`;
      case "GAME_OVER":
        return `GAME OVER — winner ${who(e.winnerId)}`;
    }
  }

  // One line per notable thing. Prefixed with the room id because a busy server
  // interleaves several games in the same stream.
  private note(msg: string) {
    const at = Date.now();
    this.events.push({ t: at, msg });
    if (this.events.length > EVENT_LOG_MAX) this.events.shift();
    console.log(`[room ${this.roomId}] ${msg}`);
  }

  // --- admin (reached only through the token-guarded /admin API in admin.ts) ---

  // Everything needed to watch and diagnose this room from outside. Includes the
  // full game state so the panel can render the real board, not a summary of it.
  adminSnapshot() {
    return {
      roomId: this.roomId,
      started: this.started,
      clients: this.clients.length,
      maxClients: this.maxClients,
      endsAt: this.endsAt,
      durationSec: this.durationSec,
      phase: this.game?.phase ?? "LOBBY",
      // who holds which seat, and whether they're currently connected
      seats: [...this.seats.values()].sort().map((id) => ({
        id,
        name: this.nameOf(id),
        look: this.lookOf(id),
        connected: this.clients.some((c) => this.seats.get(c.sessionId) === id),
      })),
      looks: this.looks(),
      // what the room is waiting on — the usual reason a game looks stuck
      waitingOn: this.game && this.game.phase !== "GAME_OVER" ? (this.game.players[this.game.activePlayerIndex]?.id ?? null) : null,
      duel: this.showdownArmed ? this.duellists : null,
      partyRound: !!this.partySim,
      events: this.events,
      state: this.game,
    };
  }

  // Operator actions for a game that has gone wrong. Deliberately expressed in
  // terms the engine already validates — nothing here writes state directly.
  adminAction(type: string, arg?: string) {
    this.note(`ADMIN action "${type}"${arg ? ` (${arg})` : ""}`);
    switch (type) {
      case "nudge":
        // play the current player's turn for them — the same fallback a timeout
        // would fire, but now. Unsticks a room waiting on someone who left.
        if (!this.game || this.game.phase === "GAME_OVER") return { ok: false, error: "no live game" };
        this.autoResolvePick();
        return { ok: true, phase: this.game.phase };
      case "kick": {
        const seat = [...this.seats.values()].find((id) => id === arg);
        if (!seat) return { ok: false, error: "no such seat" };
        this.forfeit(seat);
        return { ok: true };
      }
      case "reset":
        return this.resetMatch();
      case "close":
        this.disconnect();
        return { ok: true };
      default:
        return { ok: false, error: `unknown action: ${type}` };
    }
  }

  // Restart the match with the players who are still here, keeping the room and
  // everyone's connection. The clock restarts too.
  private resetMatch(): { ok: boolean; error?: string; players?: number } {
    const seated = [...this.seats.values()].sort();
    if (seated.length < MIN_PLAYERS) return { ok: false, error: "not enough players to restart" };
    this.clearTimers();
    this.abortPartyRound();
    this.showdownArmed = false;
    this.duellists = [];
    this.taps.clear();
    this.pendingLeaves = [];
    this.game = createInitialState({
      seed: Date.now(),
      players: seated.map((id) => ({ id, name: this.nameOf(id), isAI: false })),
      tunables: { partyGames: ["floordrop"] },
    });
    this.endsAt = Date.now() + this.durationSec * 1000;
    this.gameTimer = setTimeout(() => this.timeUp(), this.durationSec * 1000);
    this.broadcastState();
    this.schedulePickFallback();
    return { ok: true, players: seated.length };
  }

  private onAction(client: Client, msg: ActionMessage) {
    if (!this.game) return;
    const you = this.seats.get(client.sessionId);
    if (!you) return;

    const type = msg.action.type;
    if (!isLegalAction(this.game, you, type)) {
      // the usual cause is a stale client UI, but it is also what a tampered
      // client trips over — either way it is worth seeing
      this.note(`REJECTED ${type} from ${you} "${this.nameOf(you)}" in phase ${this.game.phase}`);
      this.sendError(client, "illegal action");
      return;
    }

    const action = this.toGameAction(msg.action, you);
    if (!action) {
      this.note(`MALFORMED ${type} from ${you} "${this.nameOf(you)}"`);
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
    const before = this.game!;
    const res = reduce(before, action);
    this.game = res.state;
    // The engine tells us exactly what happened — dice, rent, builds, bankruptcies.
    // Logging its own event stream means the room log IS the game history, rather
    // than a guess reconstructed from state diffs.
    this.note(`action ${action.type}${"playerId" in action ? ` by ${String(action.playerId)}` : ""}`);
    for (const e of res.events) this.note(`  · ${this.describe(e)}`);
    if (before.phase !== res.state.phase) this.note(`  phase ${before.phase} → ${res.state.phase}`);
    this.broadcastState();
    const phase = this.game.phase;

    if (phase === "RENT_SHOWDOWN") {
      this.clearPickTimer();
      // arm a fresh duel only on ENTERING the phase — a bystander's forfeit
      // re-broadcasts state while a duel is already running (showdownArmed)
      if (!this.showdownArmed) this.startShowdown();
      return;
    }
    // any other phase means we're no longer in a duel: kill stray duel timers so a
    // late go/tap callback can't fire against a resolved or aborted showdown
    this.clearShowdownTimers();

    if (phase === "PARTY_ROUND") {
      this.clearPickTimer();
      // start a party round only on ENTERING the phase — never re-enter one already
      // running (a stray re-entry would rebuild the sim / deref a cleared pendingMinigame)
      if (!this.partySim) this.startPartyRound();
      return;
    }
    // a forfeit can abort a party round out from under its live sim (the engine
    // resumes the board); tear the stale sim down so it can't keep ticking.
    if (this.partySim) this.abortPartyRound();
    this.schedulePickFallback();
  }

  // Every phase where the room waits on one player arms a fallback so an idle or
  // dropped player can't stall it: the forced picks (Copa / Aeroporto / build / debt)
  // auto-resolve to a sensible default, and a normal turn (roll / buy) auto-plays.
  // The client shows a prompt / turn UI; this only fires if they don't act in time.
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
    } else if (phase === "AWAITING_ROLL" || phase === "AWAITING_BUY_DECISION") {
      this.pickTimer = setTimeout(() => this.autoResolvePick(), TURN_TIMEOUT_MS);
    }
  }

  private autoResolvePick() {
    this.clearPickTimer();
    const game = this.game;
    if (!game) return;
    const who = game.players[game.activePlayerIndex];
    this.note(`timeout in ${game.phase} — auto-playing for ${who?.id ?? "?"} "${who?.name ?? "?"}"`);
    if (game.phase === "AWAITING_ROLL") {
      this.applyAction({ type: "ROLL_DICE" }); // default: take the turn for them
    } else if (game.phase === "AWAITING_BUY_DECISION") {
      this.applyAction({ type: "DECLINE_BUY" }); // default: don't spend an absent player's cash
    } else if (game.phase === "AWAITING_WORLD_CUP") {
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
    // defensive: only arm when the duel context is actually present
    if (!game.pendingMinigame?.context.stakeData) return;
    const [payer, owner] = game.pendingMinigame.participants;
    if (!payer || !owner) return;
    this.taps.clear();
    this.showdownArmed = true;
    this.duellists = [payer.playerId, owner.playerId];
    const baseRent = game.pendingMinigame.context.stakeData.baseRent;
    this.note(`showdown armed: ${this.nameOf(payer.playerId)} (payer) vs ${this.nameOf(owner.playerId)} (owner), base rent ${baseRent}`);
    this.broadcast(S2C.showdownStart, {
      baseRent,
      payerId: payer.playerId,
      ownerId: owner.playerId,
    } satisfies ShowdownStartMessage);

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
    // only the payer and the owner duel — a spectator's tap is ignored, and the
    // duel resolves as soon as those two have answered (not the whole table,
    // which at 3+ players would never happen and always burn the tap timeout)
    if (!you || !this.duellists.includes(you) || this.taps.has(you)) {
      if (you && !this.duellists.includes(you)) this.note(`tap from ${you} "${this.nameOf(you)}" IGNORED — not a duellist`);
      return;
    }

    this.note(`tap from ${you} "${this.nameOf(you)}": ${msg.falseStart ? "false start" : `${Math.round(msg.reactionMs ?? -1)}ms`}`);
    this.taps.set(you, { reactionMs: msg.reactionMs, falseStart: msg.falseStart });
    if (this.duellists.every((id) => this.taps.has(id))) this.resolveShowdown();
  }

  private resolveShowdown() {
    this.clearShowdownTimers();
    const game = this.game;
    // a bystander's forfeit can abort the duel between arming and resolution;
    // the phase (and pendingMinigame) guard means there's nothing left to resolve
    if (!game || game.phase !== "RENT_SHOWDOWN" || !game.pendingMinigame) return;

    const [payer, owner] = game.pendingMinigame.participants;
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
    this.note(
      `showdown result: ${this.nameOf(res.payerId)} ${fmtTap(res.payerTap)} vs ${this.nameOf(res.ownerId)} ${fmtTap(res.ownerTap)} → ${res.result.outcome}${res.result.status === "ABORTED" ? " (aborted)" : ""}`,
    );
    const sub = reduce(game, { type: "SUBMIT_MINIGAME_RESULT", result: res.result });
    for (const e of sub.events) this.note(`  · ${this.describe(e)}`);
    this.game = sub.state;
    this.broadcastState();
    // paying rent can push the payer into debt (or any other pausable phase) —
    // arm the fallback so a silent/dropped player there can't stall the room
    this.schedulePickFallback();
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
    // fighter id → the board player who owns it, so each fighter carries that
    // player's chosen look. Every client gets this SAME roster, which is what
    // stops two people seeing different characters for each other.
    const roster = this.partySim.fighters.map((f) => {
      const owner = this.partyPlayers[f.id];
      return { id: f.id, name: f.name, color: f.color, bot: f.isBot, look: owner ? this.lookOf(owner) : EMPTY_LOOK };
    });
    for (const c of this.clients) {
      const pid = this.seats.get(c.sessionId);
      const fid = pid ? this.partyPlayers.indexOf(pid) : -1;
      if (fid >= 0) {
        this.partySeat.set(c.sessionId, fid);
        c.send(FDServer.start, { you: fid, players: roster } satisfies FDStart);
      }
    }
    this.note(`party round started with ${roster.length} fighters (${this.partyPlayers.map((id) => this.nameOf(id)).join(", ")})`);
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
    this.partySim = null;
    this.partySeat.clear();
    if (!sim || !game) return;
    // the round may have been aborted out from under the sim — e.g. a participant's
    // reconnect window expired and forfeited them, which resumes the board. The engine
    // has already left PARTY_ROUND, so there's nothing to score; just flush leaves.
    if (game.phase === "PARTY_ROUND" && game.pendingMinigame) {
      // per-fighter placements → best-to-worst ranking over the board playerIds
      const ranking = [...sim.fighters]
        .sort((a, b) => (a.place || 1) - (b.place || 1))
        .map((f) => this.partyPlayers[f.id])
        .filter((id): id is PlayerId => id !== undefined);
      const result: MinigameResult = { minigameId: game.pendingMinigame.minigameId, status: "COMPLETED", outcome: "P0_WIN", ranking };
      this.note(`party round finished — order: ${ranking.map((id, i) => `#${i + 1} ${this.nameOf(id)}`).join(", ")}`);
      const sub = reduce(game, { type: "SUBMIT_MINIGAME_RESULT", result });
      for (const e of sub.events) this.note(`  · ${this.describe(e)}`);
      this.game = sub.state;
      this.broadcastState();
      this.schedulePickFallback(); // arm the resumed player's turn timer
    } else if (this.game) {
      // aborted out from under the sim — still push a state so nobody is left
      // looking at the party round
      this.note("party round resolved but the board had already moved on — resyncing clients");
      this.broadcastState();
    }
    this.flushPendingLeaves();
  }

  // a forfeit aborted the party round while its sim was still live: stop the sim,
  // tell clients to leave the party view, and drop the pending leaves. The engine
  // has already resumed the board, so no result is scored.
  private abortPartyRound() {
    if (this.partyOverTimer) clearTimeout(this.partyOverTimer);
    this.partyOverTimer = null;
    const sim = this.partySim;
    this.partySim = null;
    this.partySeat.clear();
    this.setSimulationInterval(); // stop ticking
    if (sim) {
      this.broadcast(FDServer.over, {
        winner: sim.winner?.name ?? "",
        places: sim.fighters.map((f) => [f.id, f.place === 0 ? 1 : f.place] as const),
      } satisfies FDOver);
    }
    // The client only leaves the party view when a board state arrives. Without
    // this, an aborted round left everyone stuck on the placement screen with a
    // game running behind it.
    if (this.game) this.broadcastState();
    this.flushPendingLeaves();
  }

  // apply any leaves that were deferred while a party round was running
  private flushPendingLeaves() {
    const leaves = this.pendingLeaves;
    this.pendingLeaves = [];
    for (const s of leaves) this.forfeit(s);
  }

  // --- helpers ---

  private broadcastState() {
    const state = this.game!;
    const clock = this.endsAt !== null ? { endsAt: this.endsAt } : {};
    const looks = this.looks();
    for (const c of this.clients) {
      const you = this.seats.get(c.sessionId);
      if (you) c.send(S2C.state, { state, you, looks, ...clock } satisfies StateMessage<GameState>);
    }
  }

  private sendError(client: Client, message: string) {
    client.send(S2C.error, { message } satisfies ErrorMessage);
  }
}

// A name a client sends goes on everyone's screen, so collapse whitespace, drop
// control characters, and cap the length. Empty means "no name given".
function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN);
}

// a tap in words, for the log
function fmtTap(t: ReflexInput): string {
  if (t.falseStart) return "jumped early";
  if (t.reactionMs === null) return "no tap";
  return `${Math.round(t.reactionMs)}ms`;
}
