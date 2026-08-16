import { Client, type Room } from "colyseus.js";
import type { GameState } from "@party-monopoly/engine";
import {
  C2S,
  FDClient,
  FDServer,
  S2C,
  type ActionMessage,
  type ClientActionType,
  type ErrorMessage,
  type FDOver,
  type FDSnapshot,
  type FDStart,
  type LobbyMessage,
  type PlayerId,
  type PlayerIdentity,
  type PlayerLook,
  type ShowdownResultMessage,
  type ShowdownStartMessage,
  type StateMessage,
  type TapMessage,
} from "@party-monopoly/types";

// point the client at a hosted server for online play, e.g.
// VITE_SERVER_URL=wss://party-monopoly.example.com ; falls back to local dev.
const DEFAULT_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "ws://localhost:2567";
const ROOM = "game";
// the reconnection token is stashed in sessionStorage so a browser REFRESH (which destroys
// the in-memory client) can still rejoin within the server's reconnect window
const TOKEN_KEY = "pm-reconnect";

export interface OnlineHandlers {
  onState: (state: GameState, you: PlayerId, endsAt?: number, looks?: Readonly<Record<string, PlayerLook>>) => void;
  onLobby: (lobby: LobbyMessage) => void;
  onShowdownStart: (msg: ShowdownStartMessage) => void;
  onShowdownGo: () => void;
  onShowdownResult: (result: ShowdownResultMessage) => void;
  // party round (inline Floor Drop): start = your fighter + roster, snap = 20Hz world, over = places
  onPartyStart: (msg: FDStart) => void;
  onPartySnap: (snap: FDSnapshot) => void;
  onPartyOver: (over: FDOver) => void;
  onError: (message: string) => void;
  onLeave: (code: number) => void;
}

// thin wrapper over colyseus.js. holds one room, wires the protocol messages to
// plain callbacks. no react in here.
export class OnlineClient {
  private client: Client;
  private room: Room | null = null;
  // refreshed on every (re)join; used to recover a dropped connection
  private token: string | null = null;

  constructor(url: string = DEFAULT_URL) {
    this.client = new Client(url);
  }

  get canReconnect(): boolean {
    return this.token !== null;
  }

  // is there a stashed session a page reload could try to resume?
  static hasStoredSession(): boolean {
    try {
      return !!sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return false;
    }
  }
  static clearStoredSession(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* sessionStorage unavailable — nothing to clear */
    }
  }
  private setToken(t: string): void {
    this.token = t;
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* sessionStorage unavailable — in-memory reconnect still works within the session */
    }
  }

  async create(h: OnlineHandlers, durationSec: number | undefined, maxPlayers: number | undefined, me: PlayerIdentity): Promise<string> {
    const opts: Record<string, unknown> = { ...identity(me) };
    if (durationSec !== undefined) opts.durationSec = durationSec;
    if (maxPlayers !== undefined) opts.maxPlayers = maxPlayers;
    this.room = await this.client.create(ROOM, opts);
    this.setToken(this.room.reconnectionToken);
    this.wire(h);
    return this.room.roomId;
  }

  sendStart(): void {
    this.room?.send(C2S.start, {});
  }

  sendRestart(): void {
    this.room?.send(C2S.restart, {});
  }

  async join(roomId: string, h: OnlineHandlers, me: PlayerIdentity): Promise<void> {
    this.room = await this.client.joinById(roomId, identity(me));
    this.setToken(this.room.reconnectionToken);
    this.wire(h);
  }

  async reconnect(h: OnlineHandlers): Promise<void> {
    if (!this.token) throw new Error("no reconnection token");
    this.room = await this.client.reconnect(this.token);
    this.setToken(this.room.reconnectionToken);
    this.wire(h);
  }

  // resume a session after a page reload, using the token stashed in sessionStorage
  async restore(h: OnlineHandlers): Promise<void> {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(TOKEN_KEY);
    } catch {
      stored = null;
    }
    if (!stored) throw new Error("no stored session");
    this.room = await this.client.reconnect(stored);
    this.setToken(this.room.reconnectionToken);
    this.wire(h);
  }

  sendAction(type: ClientActionType, squareId?: number): void {
    const action = squareId === undefined ? { type } : { type, squareId };
    this.room?.send(C2S.action, { action } satisfies ActionMessage);
  }

  sendTap(reactionMs: number | null, falseStart: boolean): void {
    this.room?.send(C2S.tap, { reactionMs, falseStart } satisfies TapMessage);
  }

  sendPartyInput(dx: number, dy: number): void {
    this.room?.send(FDClient.input, { dx, dy });
  }

  leave(): void {
    void this.room?.leave();
    this.room = null;
    this.token = null;
    OnlineClient.clearStoredSession();
  }

  private wire(h: OnlineHandlers): void {
    const room = this.room!;
    room.onMessage(S2C.state, (m: StateMessage<GameState>) => h.onState(m.state, m.you, m.endsAt, m.looks));
    room.onMessage(S2C.lobby, (m: LobbyMessage) => h.onLobby(m));
    room.onMessage(S2C.showdownStart, (m: ShowdownStartMessage) => h.onShowdownStart(m));
    room.onMessage(S2C.showdownGo, () => h.onShowdownGo());
    room.onMessage(S2C.showdownResult, (m: ShowdownResultMessage) => h.onShowdownResult(m));
    room.onMessage(FDServer.start, (m: FDStart) => h.onPartyStart(m));
    room.onMessage(FDServer.snap, (m: FDSnapshot) => h.onPartySnap(m));
    room.onMessage(FDServer.over, (m: FDOver) => h.onPartyOver(m));
    room.onMessage(S2C.error, (m: ErrorMessage) => h.onError(m.message));
    room.onError((code, message) => h.onError(message ?? `error ${code}`));
    room.onLeave((code) => h.onLeave(code));
    // now that we're listening, ask for whatever we should be looking at — the
    // lobby (or state) the server sent while our own join was still in flight
    room.send(C2S.sync, {});
  }
}

// only send the fields the player actually set; the server names them otherwise
function identity(me: PlayerIdentity): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (me.name) out.name = me.name;
  if (me.look) out.look = me.look;
  return out;
}
