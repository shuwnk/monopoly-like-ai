import type { MinigameRequest, PlayerId } from "@party-monopoly/types";
import type { RngState } from "./rng.js";
import type { GameTunables } from "./tunables.js";

// The engine parks on RENT_SHOWDOWN until a result is submitted; GAME_OVER is terminal.
export type TurnPhase =
  | "AWAITING_ROLL"
  | "MOVING"
  | "RESOLVING_SQUARE"
  | "AWAITING_BUY_DECISION"
  | "RENT_SHOWDOWN"
  | "TURN_END"
  | "GAME_OVER";

export type SquareType =
  | "GO"
  | "PROPERTY"
  | "JAIL" // "just visiting" / holding cell
  | "GO_TO_JAIL"
  | "FREE_PARKING"
  | "TAX"
  // Chance and Community Chest are inert for now — they resolve like Free Parking.
  | "CHANCE"
  | "COMMUNITY";

export interface PropertyData {
  readonly price: number;
  readonly baseRent: number;
  // color-group label for visual banding; no rules attached yet
  readonly group?: string;
}

export interface Square {
  readonly id: number;
  readonly name: string;
  readonly type: SquareType;
  readonly property?: PropertyData;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly isAI: boolean;
  readonly money: number;
  readonly position: number;
  readonly inJail: boolean;
  readonly jailTurns: number;
  readonly bankrupt: boolean;
}

export interface GameState {
  readonly seed: number;
  readonly rng: RngState;
  readonly tunables: GameTunables;
  readonly board: readonly Square[];
  readonly players: readonly PlayerState[];
  /** Index into `players` whose turn it is. */
  readonly activePlayerIndex: number;
  readonly phase: TurnPhase;
  // square index -> owner; missing means unowned and buyable
  readonly ownership: Readonly<Record<number, PlayerId>>;
  readonly lastRoll: readonly number[] | null;
  // doubles rolled in a row this turn; 3 sends to jail. reset at turn start
  readonly doublesCount: number;
  // laps completed; the round cap force-ends the game on net worth
  readonly round: number;
  readonly pendingMinigame: MinigameRequest | null;
  readonly winnerId: PlayerId | null;
}
