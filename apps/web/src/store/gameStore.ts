import {
  createInitialState,
  reduce,
  type GameAction,
  type GameEvent,
  type GameState,
  type PlayerState,
} from "@party-monopoly/engine";
import { asPlayerId, type PlayerId } from "@party-monopoly/types";
import { create } from "zustand";
import type { DuelRecord } from "../telemetry/duel.js";

// Zustand mirrors engine state, it doesn't replace it. The engine's GameState is
// the source of truth; this store keeps the latest snapshot and a dispatch that
// pipes actions through reduce(). Once networking lands, dispatch becomes
// "send to server, store the authoritative snapshot" without changing callers.

const AI_PLAYER = asPlayerId("p1");
const AI_SKILL = 0.6;

// shape for debugPatch: top-level fields plus a single-player patch addressed by
// id. anything not listed stays as-is.
export interface DebugPatch {
  player?: { id: PlayerId; money?: number; position?: number };
  phase?: GameState["phase"];
  // merged over the current maps (for previewing ownership / building levels)
  ownership?: Record<number, PlayerId>;
  buildings?: Record<number, number>;
}

interface GameStore {
  state: GameState;
  // events from the most recent reduction, for the UI log/animations
  lastEvents: readonly GameEvent[];
  // set when player 2 is a bot; null in pure two-human hotseat
  aiPlayerId: PlayerId | null;
  aiSkill: number;
  // running showdown count and per-duel telemetry for this game (debug tooling)
  showdowns: number;
  duelLog: readonly DuelRecord[];
  dispatch: (action: GameAction) => void;
  newGame: (seed: number) => void;
  newAIGame: (seed: number) => void;
  // dev-only: patch the local snapshot directly, bypassing the reducer. hotseat
  // /practice only — never wired to the engine action union or the net protocol.
  debugPatch: (patch: DebugPatch) => void;
  logDuel: (record: DuelRecord) => void;
}

function freshState(seed: number, vsAI: boolean): GameState {
  return createInitialState({
    seed,
    players: [
      { id: asPlayerId("p0"), name: "Player 1", isAI: false },
      { id: AI_PLAYER, name: vsAI ? "Bot" : "Player 2", isAI: vsAI },
    ],
  });
}

function countShowdowns(events: readonly GameEvent[]): number {
  return events.filter((e) => e.type === "MINIGAME_REQUESTED").length;
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: freshState(Date.now(), false),
  lastEvents: [],
  aiPlayerId: null,
  aiSkill: AI_SKILL,
  showdowns: 0,
  duelLog: [],
  dispatch: (action) => {
    const { state, showdowns } = get();
    const result = reduce(state, action);
    set({
      state: result.state,
      lastEvents: result.events,
      showdowns: showdowns + countShowdowns(result.events),
    });
  },
  newGame: (seed) => set({ state: freshState(seed, false), lastEvents: [], aiPlayerId: null, showdowns: 0, duelLog: [] }),
  newAIGame: (seed) =>
    set({ state: freshState(seed, true), lastEvents: [], aiPlayerId: AI_PLAYER, showdowns: 0, duelLog: [] }),
  debugPatch: (patch) => {
    const { state } = get();
    set({ state: applyDebugPatch(state, patch) });
  },
  logDuel: (record) => set((s) => ({ duelLog: [...s.duelLog, record] })),
}));

// Builds the next snapshot by hand. This deliberately skips reduce() so it can
// reach states the rules wouldn't normally allow (set money, teleport) — only
// safe because it's confined to the hotseat store, never the engine or wire.
function applyDebugPatch(state: GameState, patch: DebugPatch): GameState {
  let players = state.players;
  if (patch.player) {
    const { id, money, position } = patch.player;
    players = players.map((p): PlayerState => {
      if (p.id !== id) return p;
      return {
        ...p,
        ...(money !== undefined ? { money } : {}),
        ...(position !== undefined ? { position } : {}),
      };
    });
  }
  return {
    ...state,
    players,
    ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
    ...(patch.ownership ? { ownership: { ...state.ownership, ...patch.ownership } } : {}),
    ...(patch.buildings ? { buildings: { ...state.buildings, ...patch.buildings } } : {}),
  };
}
