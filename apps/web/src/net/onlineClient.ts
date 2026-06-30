import { Client, type Room } from "colyseus.js";
import type { GameState } from "@party-monopoly/engine";
import {
  C2S,
  S2C,
  type ActionMessage,
  type ClientActionType,
  type ErrorMessage,
  type PlayerId,
  type ShowdownStartMessage,
  type StateMessage,
  type TapMessage,
} from "@party-monopoly/types";

const DEFAULT_URL = "ws://localhost:2567";
const ROOM = "game";

export interface OnlineHandlers {
  onState: (state: GameState, you: PlayerId) => void;
  onShowdownStart: (baseRent: number) => void;
  onShowdownGo: () => void;
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

  async create(h: OnlineHandlers): Promise<string> {
    this.room = await this.client.create(ROOM);
    this.token = this.room.reconnectionToken;
    this.wire(h);
    return this.room.roomId;
  }

  async join(roomId: string, h: OnlineHandlers): Promise<void> {
    this.room = await this.client.joinById(roomId, {});
    this.token = this.room.reconnectionToken;
    this.wire(h);
  }

  async reconnect(h: OnlineHandlers): Promise<void> {
    if (!this.token) throw new Error("no reconnection token");
    this.room = await this.client.reconnect(this.token);
    this.token = this.room.reconnectionToken;
    this.wire(h);
  }

  sendAction(type: ClientActionType): void {
    this.room?.send(C2S.action, { action: { type } } satisfies ActionMessage);
  }

  sendTap(reactionMs: number | null, falseStart: boolean): void {
    this.room?.send(C2S.tap, { reactionMs, falseStart } satisfies TapMessage);
  }

  leave(): void {
    void this.room?.leave();
    this.room = null;
    this.token = null;
  }

  private wire(h: OnlineHandlers): void {
    const room = this.room!;
    room.onMessage(S2C.state, (m: StateMessage<GameState>) => h.onState(m.state, m.you));
    room.onMessage(S2C.showdownStart, (m: ShowdownStartMessage) => h.onShowdownStart(m.baseRent));
    room.onMessage(S2C.showdownGo, () => h.onShowdownGo());
    room.onMessage(S2C.error, (m: ErrorMessage) => h.onError(m.message));
    room.onError((code, message) => h.onError(message ?? `error ${code}`));
    room.onLeave((code) => h.onLeave(code));
  }
}
