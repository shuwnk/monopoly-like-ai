import type { PlayerId } from "@party-monopoly/types";
import { createDefaultBoard } from "./board.js";
import { createRng } from "./rng.js";
import type { GameState, PlayerState } from "./state.js";
import { DEFAULT_TUNABLES, type GameTunables } from "./tunables.js";

export interface NewPlayerSpec {
  readonly id: PlayerId;
  readonly name: string;
  readonly isAI: boolean;
}

export interface NewGameConfig {
  readonly seed: number;
  readonly players: readonly NewPlayerSpec[];
  // merged over the defaults, then stamped into GameState
  readonly tunables?: Partial<GameTunables>;
}

// seed and resolved tunables become part of the serialized state, which is what
// makes a game replayable from (seed + action log) alone
export function createInitialState(config: NewGameConfig): GameState {
  const tunables: GameTunables = { ...DEFAULT_TUNABLES, ...config.tunables };

  const players: PlayerState[] = config.players.map((p) => ({
    id: p.id,
    name: p.name,
    isAI: p.isAI,
    money: tunables.startingMoney,
    position: 0,
    inJail: false,
    jailTurns: 0,
    bankrupt: false,
  }));

  return {
    seed: config.seed,
    rng: createRng(config.seed),
    tunables,
    board: createDefaultBoard(tunables.rentFraction, tunables.rentFloor),
    players,
    activePlayerIndex: 0,
    phase: "AWAITING_ROLL",
    ownership: {},
    lastRoll: null,
    doublesCount: 0,
    round: 0,
    pendingMinigame: null,
    winnerId: null,
  };
}
