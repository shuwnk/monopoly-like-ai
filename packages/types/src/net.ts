import type { PlayerId } from "./ids.js";
import type { MinigameOutcome } from "./minigame.js";

// Online wire protocol between the Colyseus server and a client. The server is
// authoritative: it holds the GameState, runs reduce(), and arbitrates the
// reflex showdown. Clients send intents and taps, never results.

// client -> server message names
export const C2S = {
  action: "action",
  tap: "tap",
  start: "start", // host asks to start the game before the room is full
  // "I'm listening now" — sent once the client has its handlers attached, so the
  // server re-sends the lobby (or the live state). Without it a client can miss
  // the message its own join triggered, since that is sent before the join
  // promise resolves and the handlers exist.
  sync: "sync",
} as const;

// server -> client message names
export const S2C = {
  state: "state",
  lobby: "lobby", // pre-game: how many have joined, and whether you're the host
  showdownStart: "showdown:start",
  showdownGo: "showdown:go",
  showdownResult: "showdown:result",
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
  | "DECLARE_BANKRUPT"
  | "BUILD_HOUSE"
  | "DECLINE_BUILD"
  | "SELL_TILE"
  | "AUTO_SELL"
  | "SELECT_WORLD_CUP_TILE"
  | "SELECT_AIRPORT_TILE";

export interface ClientAction {
  readonly type: ClientActionType;
  // BUILD_HOUSE / SELECT_WORLD_CUP_TILE / SELECT_AIRPORT_TILE carry which square
  // they target; the rest ignore it. The server validates it against the state.
  readonly squareId?: number;
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

// who a client says it is. Both creating and joining carry it; the server
// sanitizes the name and falls back to "Player N" if it's empty or missing.
export interface PlayerIdentity {
  readonly name?: string;
  readonly avatar?: string; // mascot id, for the lobby roster
}

// options the room creator passes to set up the match
export interface CreateRoomOptions extends PlayerIdentity {
  // wall-clock game length in seconds; the server ends on net worth at zero
  readonly durationSec: number;
  // how many players the room seats (2..10); the game starts when it fills, or
  // when the host starts it early
  readonly maxPlayers: number;
}

// one seated player in the pre-game lobby
export interface LobbySeat {
  readonly id: PlayerId;
  readonly name: string;
  readonly avatar: string;
}

// pre-game lobby status, sent to each client as players join
export interface LobbyMessage {
  readonly joined: number;
  readonly capacity: number;
  readonly host: boolean; // is THIS client the host (can start early)?
  readonly you: PlayerId; // which seat this recipient holds
  readonly hostId: PlayerId; // whose seat may start the game early
  readonly players: readonly LobbySeat[]; // everyone in the room, seat order
}

// State is generic so this package needn't depend on the engine (which depends
// on this package). Both server and client pin TState to the engine's GameState.
export interface StateMessage<TState> {
  readonly state: TState;
  // which player this recipient controls
  readonly you: PlayerId;
  // epoch ms when the countdown hits zero (richest wins); absent = no timer yet
  readonly endsAt?: number;
}

// red — get ready. carries the flat rent so the client can show the stakes, and
// the two duellists so everyone else knows to watch rather than tap (only these
// two may send a tap; the rest of the table spectates).
export interface ShowdownStartMessage {
  readonly baseRent: number;
  readonly payerId: PlayerId;
  readonly ownerId: PlayerId;
}

// green now; start measuring reaction from the moment this arrives.
export type ShowdownGoMessage = Record<string, never>;

// sent once the server has adjudicated, before the resolved state arrives, so a
// client can show both players' reaction times and the margin. reaction times
// are the *sanitized* values (a sub-floor tap is reported as a false start), so
// what the client shows always agrees with the outcome. index order is the
// participants' [payer, owner]; the recipient maps to "you" via its own PlayerId.
export interface ShowdownResultMessage {
  readonly payerId: PlayerId;
  readonly ownerId: PlayerId;
  readonly payerReactionMs: number | null;
  readonly ownerReactionMs: number | null;
  readonly payerFalseStart: boolean;
  readonly ownerFalseStart: boolean;
  readonly outcome: MinigameOutcome;
  readonly aborted: boolean;
}

export interface ErrorMessage {
  readonly message: string;
}
