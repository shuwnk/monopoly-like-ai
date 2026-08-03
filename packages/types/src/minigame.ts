import type { MinigameId, PlayerId } from "./ids.js";

// The engine <-> minigame boundary, kept transport-independent: an
// implementation may resolve locally, via an AI bot, or over the wire. The
// minigame decides who won; the engine decides what that win is worth.

export type MinigameOutcome = "P0_WIN" | "P1_WIN" | "DRAW";
export type MinigameStatus = "COMPLETED" | "ABORTED";

export interface MinigameParticipant {
  readonly playerId: PlayerId;
  readonly isAI: boolean;
  // 0..1, only meaningful when isAI
  readonly aiSkill?: number;
}

// RENT_SHOWDOWN = a 1v1 rent duel; PARTY_ROUND = an all-players FFA at a lap boundary
export type MinigameReason = "RENT_SHOWDOWN" | "PARTY_ROUND";

// which party game the board picked for this round (chosen deterministically by the engine)
export type PartyGame = "floordrop" | "bomberman" | "barnbrawl";

export interface RentStakeData {
  // flat rent before the multiplier
  readonly baseRent: number;
  readonly propertyId: number;
}

export interface PartyStakeData {
  readonly game: PartyGame;
  // bank-funded prize for 1st place; lower placements get a linear share, last gets nothing
  readonly topPrize: number;
}

export interface MinigameContext {
  readonly reason: MinigameReason;
  // present when reason === "RENT_SHOWDOWN"
  readonly stakeData?: RentStakeData;
  // present when reason === "PARTY_ROUND"
  readonly party?: PartyStakeData;
}

export interface MinigameRequest {
  readonly minigameId: MinigameId;
  // index order here is the P0/P1 ordering used by `outcome`
  readonly participants: readonly MinigameParticipant[];
  readonly context: MinigameContext;
  // free-form per-minigame config
  readonly config: Readonly<Record<string, unknown>>;
}

export interface MinigameResult {
  readonly minigameId: MinigameId;
  readonly status: MinigameStatus;
  // meaningful only when status === "COMPLETED"
  readonly outcome: MinigameOutcome;
  // best-to-worst
  readonly ranking: readonly PlayerId[];
  readonly metrics?: Readonly<Record<string, number>>;
}
