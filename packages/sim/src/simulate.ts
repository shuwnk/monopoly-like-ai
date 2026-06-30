import { aiReflexInput, decideAction } from "@party-monopoly/ai";
import {
  createInitialState,
  createRng,
  nextFloat,
  reduce,
  type GameState,
  type GameTunables,
  type RngState,
} from "@party-monopoly/engine";
import {
  adjudicateReflexDuel,
  DEFAULT_REFLEX_TAP_DUEL_CONFIG,
} from "@party-monopoly/minigame-harness";
import { asPlayerId, type PlayerId } from "@party-monopoly/types";

// How a game stopped. ELIMINATION = someone won by being last solvent player;
// CAP = the round cap force-ended it on net worth; TIMEOUT = hit the step guard
// without resolving (a balance smell, not an engine bug).
export type EndReason = "ELIMINATION" | "CAP" | "TIMEOUT";

export interface GameResult {
  readonly seed: number;
  readonly finished: boolean;
  readonly endReason: EndReason;
  readonly turns: number;
  readonly rounds: number;
  readonly steps: number;
  readonly showdowns: number;
  readonly winnerId: PlayerId | null;
  readonly survivors: number;
}

export interface SimConfig {
  readonly seed: number;
  readonly players?: number; // default 4
  readonly skill?: number; // shared bot reflex skill, 0..1; default 0.6
  readonly maxSteps?: number; // guard against a non-terminating economy
  readonly tunables?: Partial<GameTunables>;
}

const DEFAULT_PLAYERS = 4;
const DEFAULT_SKILL = 0.6;
const DEFAULT_MAX_STEPS = 20_000;

// A deterministic float source built on the engine's own RNG, so a sim run is
// fully reproducible from its seed — duel reflexes included.
function seededRandom(seed: number): () => number {
  let s: RngState = createRng(seed);
  return () => {
    const r = nextFloat(s);
    s = r.next;
    return r.value;
  };
}

// Run one bot-vs-bot game to completion (or the step guard) and report how it
// went. All players are AI; the duel is resolved with seeded reflex inputs.
export function simulateGame(config: SimConfig): GameResult {
  const playerCount = config.players ?? DEFAULT_PLAYERS;
  const skill = config.skill ?? DEFAULT_SKILL;
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;

  let state: GameState = createInitialState({
    seed: config.seed,
    players: Array.from({ length: playerCount }, (_, i) => ({
      id: asPlayerId(`p${i}`),
      name: `Bot ${i}`,
      isAI: true,
    })),
    ...(config.tunables ? { tunables: config.tunables } : {}),
  });

  // duel reflexes draw from a stream seeded off the game seed but offset, so the
  // duel randomness is independent of the engine's dice stream yet still pinned
  const reflexRandom = seededRandom(config.seed ^ 0x9e3779b9);
  const drawWindow = DEFAULT_REFLEX_TAP_DUEL_CONFIG.drawWindowMs;

  let steps = 0;
  let turns = 0;
  let showdowns = 0;

  while (state.phase !== "GAME_OVER" && steps < maxSteps) {
    steps++;

    if (state.phase === "RENT_SHOWDOWN" && state.pendingMinigame) {
      showdowns++;
      const [payer, owner] = state.pendingMinigame.participants;
      const result = adjudicateReflexDuel(
        aiReflexInput(skill, reflexRandom),
        aiReflexInput(skill, reflexRandom),
        payer!.playerId,
        owner!.playerId,
        drawWindow,
      );
      state = reduce(state, { type: "SUBMIT_MINIGAME_RESULT", result }).state;
      continue;
    }

    const active = state.players[state.activePlayerIndex];
    if (!active) break;
    const action = decideAction(state, active.id);
    if (!action) break; // no legal move outside a showdown means a stuck state
    const next = reduce(state, action);
    state = next.state;
    if (next.events.some((e) => e.type === "TURN_ENDED" || e.type === "GAME_OVER")) {
      turns++;
    }
  }

  const finished = state.phase === "GAME_OVER";
  const survivors = state.players.filter((p) => !p.bankrupt).length;
  const endReason: EndReason = !finished ? "TIMEOUT" : survivors <= 1 ? "ELIMINATION" : "CAP";

  return {
    seed: config.seed,
    finished,
    endReason,
    turns,
    rounds: state.round,
    steps,
    showdowns,
    winnerId: state.winnerId,
    survivors,
  };
}

export interface BatchConfig extends Omit<SimConfig, "seed"> {
  readonly games: number;
  readonly seedStart?: number; // default 0
}

export interface BatchStats {
  readonly games: number;
  readonly finished: number;
  readonly byReason: Record<EndReason, number>;
  readonly eliminationRate: number;
  readonly capRate: number;
  readonly timeoutRate: number;
  readonly turns: { readonly min: number; readonly median: number; readonly mean: number; readonly max: number };
  readonly avgShowdowns: number;
  readonly results: readonly GameResult[];
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// Run `games` seeds and aggregate the convergence picture: how games end, and
// how long they take. This is the number that tells us whether a tunable change
// moved the game toward bankruptcy elimination or left it ending on the cap.
export function runBatch(config: BatchConfig): BatchStats {
  const seedStart = config.seedStart ?? 0;
  const { games, ...rest } = config;

  const results: GameResult[] = [];
  for (let i = 0; i < games; i++) {
    results.push(simulateGame({ ...rest, seed: seedStart + i }));
  }

  const byReason: Record<EndReason, number> = { ELIMINATION: 0, CAP: 0, TIMEOUT: 0 };
  for (const r of results) byReason[r.endReason]++;

  const finishedResults = results.filter((r) => r.finished);
  const turns = finishedResults.map((r) => r.turns).sort((a, b) => a - b);
  const totalShowdowns = results.reduce((sum, r) => sum + r.showdowns, 0);

  return {
    games,
    finished: finishedResults.length,
    byReason,
    eliminationRate: byReason.ELIMINATION / games,
    capRate: byReason.CAP / games,
    timeoutRate: byReason.TIMEOUT / games,
    turns: {
      min: turns[0] ?? 0,
      median: median(turns),
      mean: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : 0,
      max: turns[turns.length - 1] ?? 0,
    },
    avgShowdowns: totalShowdowns / games,
    results,
  };
}
