import type { PlayerId } from "./ids.js";

// Online wire protocol between the Colyseus server and a client. The server is
// authoritative: it holds the GameState, runs reduce(), and arbitrates the
// reflex showdown. Clients send intents and taps, never results.

// client -> server message names
export const C2S = {
  action: "action",
  tap: "tap",
} as const;

// server -> client message names
export const S2C = {
  state: "state",
  showdownStart: "showdown:start",
  showdownGo: "showdown:go",
  error: "error",
} as const;

// the player-initiated actions a client may request. SUBMIT_MINIGAME_RESULT is
// deliberately absent: the server runs the showdown and submits it itself.
export type ClientActionType =
  | "ROLL_DICE"
  | "BUY_PROPERTY"
  | "DECLINE_BUY"
  | "PAY_JAIL_FINE"
  | "END_TURN"
  | "DECLARE_BANKRUPT";

export interface ClientAction {
  readonly type: ClientActionType;
}

export interface ActionMessage {
  readonly action: ClientAction;
}

// sent during a showdown. reactionMs is measured from the client's receipt of
// "showdown:go" (not a wall clock), so there's no clock to sync. falseStart
// means the player tapped while the screen was still red.
export interface TapMessage {
  readonly reactionMs: number | null;
  readonly falseStart: boolean;
}

// State is generic so this package needn't depend on the engine (which depends
// on this package). Both server and client pin TState to the engine's GameState.
export interface StateMessage<TState> {
  readonly state: TState;
  // which player this recipient controls
  readonly you: PlayerId;
}

// red — get ready. carries the flat rent so the client can show the stakes.
export interface ShowdownStartMessage {
  readonly baseRent: number;
}

// green now; start measuring reaction from the moment this arrives.
export type ShowdownGoMessage = Record<string, never>;

export interface ErrorMessage {
  readonly message: string;
}
