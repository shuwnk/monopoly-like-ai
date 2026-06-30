import { Room, type Client } from "colyseus";
import { createInitialState, reduce, type GameState } from "@party-monopoly/engine";
import { DEFAULT_REFLEX_TAP_DUEL_CONFIG } from "@party-monopoly/minigame-harness";
import type { ReflexInput } from "@party-monopoly/minigame-harness";
import {
  asPlayerId,
  C2S,
  S2C,
  type ActionMessage,
  type ErrorMessage,
  type PlayerId,
  type ShowdownStartMessage,
  type StateMessage,
  type TapMessage,
} from "@party-monopoly/types";
import { MISSING_TAP, adjudicateShowdown } from "./showdown.js";
import { isLegalAction } from "./validate.js";

const cfg = DEFAULT_REFLEX_TAP_DUEL_CONFIG;
// how long after "go" we wait for both taps before filling the rest as misses
const TAP_TIMEOUT_MS = 5000;
// hold a dropped player's seat this long before giving up on the game
const RECONNECT_WINDOW_S = 30;

// p0 = first to join, p1 = second
const SEATS: readonly PlayerId[] = [asPlayerId("p0"), asPlayerId("p1")];

export class GameRoom extends Room {
  override maxClients = 2;

  private game: GameState | null = null;
  // sessionId -> playerId
  private seats = new Map<string, PlayerId>();
  // collected taps for the current showdown, keyed by playerId
  private taps = new Map<PlayerId, ReflexInput>();
  private goTimer: ReturnType<typeof setTimeout> | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;

  override onCreate() {
    this.onMessage(C2S.action, (client, msg: ActionMessage) => this.onAction(client, msg));
    this.onMessage(C2S.tap, (client, msg: TapMessage) => this.onTap(client, msg));
  }

  override onJoin(client: Client) {
    const seat = SEATS[this.seats.size];
    if (!seat) {
      client.leave();
      return;
    }
    this.seats.set(client.sessionId, seat);
    if (this.seats.size === 2) this.startGame();
  }

  override async onLeave(client: Client, consented: boolean) {
    const seat = this.seats.get(client.sessionId);
    this.seats.delete(client.sessionId);
    if (!seat || !this.game) return;

    // a deliberate leave ends it; a network drop holds the seat for a window
    if (consented) {
      this.disconnect();
      return;
    }
    try {
      const back = await this.allowReconnection(client, RECONNECT_WINDOW_S);
      this.seats.set(back.sessionId, seat);
      back.send(S2C.state, { state: this.game, you: seat } satisfies StateMessage<GameState>);
    } catch {
      this.disconnect();
    }
  }

  override onDispose() {
    this.clearTimers();
  }

  private clearTimers() {
    if (this.goTimer) clearTimeout(this.goTimer);
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.goTimer = null;
    this.tapTimer = null;
  }

  private startGame() {
    this.game = createInitialState({
      seed: Date.now(),
      players: SEATS.map((id, i) => ({ id, name: `Player ${i + 1}`, isAI: false })),
    });
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

    // DECLARE_BANKRUPT carries the player id; the rest are bare
    const action = type === "DECLARE_BANKRUPT" ? { type, playerId: you } : { type };
    this.game = reduce(this.game, action).state;
    this.broadcastState();

    if (this.game.phase === "RENT_SHOWDOWN") this.startShowdown();
  }

  // --- showdown ---

  private startShowdown() {
    const game = this.game!;
    this.taps.clear();
    const baseRent = game.pendingMinigame!.context.stakeData.baseRent;
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
    this.clearTimers();
    const game = this.game;
    if (!game || game.phase !== "RENT_SHOWDOWN") return;

    const [payer, owner] = game.pendingMinigame!.participants;
    const payerTap = this.taps.get(payer!.playerId) ?? MISSING_TAP;
    const ownerTap = this.taps.get(owner!.playerId) ?? MISSING_TAP;

    const result = adjudicateShowdown(game, payerTap, ownerTap, cfg.drawWindowMs, cfg.minHumanReactionMs);
    this.game = reduce(game, { type: "SUBMIT_MINIGAME_RESULT", result }).state;
    this.broadcastState();
  }

  // --- helpers ---

  private broadcastState() {
    const state = this.game!;
    for (const c of this.clients) {
      const you = this.seats.get(c.sessionId);
      if (you) c.send(S2C.state, { state, you } satisfies StateMessage<GameState>);
    }
  }

  private sendError(client: Client, message: string) {
    client.send(S2C.error, { message } satisfies ErrorMessage);
  }
}
