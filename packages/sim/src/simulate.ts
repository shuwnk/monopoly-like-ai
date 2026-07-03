import { aiReflexInput, decideAction } from "@party-monopoly/ai";
import {
  createInitialState,
  createRng,
  ISLAND_IDS,
  netWorth,
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
// GOAL = someone hit the net-worth goal before the cap; CAP = the round cap
// force-ended it on net worth; TIMEOUT = hit the step guard without resolving.
export type EndReason = "ELIMINATION" | "ISLAND" | "GOAL" | "CAP" | "TIMEOUT";

export interface GameResult {
  readonly seed: number;
  readonly finished: boolean;
  readonly endReason: EndReason;
  readonly turns: number;
  readonly rounds: number;
  readonly steps: number;
  readonly showdowns: number;
  readonly builds: number; // total house/hotel levels built across the game
  readonly hotels: number; // builds that reached the top level
  readonly winnerId: PlayerId | null;
  readonly survivors: number;
  readonly winnerNetWorth: number; // the winner's net worth at game end
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

  const maxLevel = state.tunables.maxBuildLevel;
  let steps = 0;
  let turns = 0;
  let showdowns = 0;
  let builds = 0;
  let hotels = 0;

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
    for (const e of next.events) {
      if (e.type === "TURN_ENDED" || e.type === "GAME_OVER") turns++;
      else if (e.type === "HOUSE_BUILT") {
        builds++;
        if (e.level >= maxLevel) hotels++;
      }
    }
  }

  const finished = state.phase === "GAME_OVER";
  const survivors = state.players.filter((p) => !p.bankrupt).length;
  // survivors>1 finish is either the wealth goal (before the cap) or the cap itself
  const cappedOut = state.tunables.roundCap > 0 && state.round > state.tunables.roundCap;
  const winner = state.players.find((p) => p.id === state.winnerId);
  const wonByIslands = !!winner && ISLAND_IDS.every((id) => state.ownership[id] === winner.id);
  const endReason: EndReason = !finished
    ? "TIMEOUT"
    : survivors <= 1
      ? "ELIMINATION"
      : cappedOut
        ? "CAP"
        : wonByIslands
          ? "ISLAND"
          : "GOAL";

  return {
    seed: config.seed,
    finished,
    endReason,
    turns,
    rounds: state.round,
    steps,
    showdowns,
    builds,
    hotels,
    winnerId: state.winnerId,
    survivors,
    winnerNetWorth: winner ? netWorth(state, winner) : 0,
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
  readonly goalRate: number;
  readonly capRate: number;
  readonly timeoutRate: number;
  readonly turns: { readonly min: number; readonly median: number; readonly mean: number; readonly max: number };
  // winner net worth at game end (percentiles), to size the wealth goal
  readonly winnerNetWorth: { readonly p50: number; readonly p75: number; readonly p90: number; readonly max: number };
  readonly avgShowdowns: number;
  readonly avgBuilds: number;
  readonly avgHotels: number;
  readonly results: readonly GameResult[];
}

function pctile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
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

  const byReason: Record<EndReason, number> = { ELIMINATION: 0, ISLAND: 0, GOAL: 0, CAP: 0, TIMEOUT: 0 };
  for (const r of results) byReason[r.endReason]++;

  const finishedResults = results.filter((r) => r.finished);
  const turns = finishedResults.map((r) => r.turns).sort((a, b) => a - b);
  const worth = finishedResults.map((r) => r.winnerNetWorth).sort((a, b) => a - b);
  const totalShowdowns = results.reduce((sum, r) => sum + r.showdowns, 0);
  const totalBuilds = results.reduce((sum, r) => sum + r.builds, 0);
  const totalHotels = results.reduce((sum, r) => sum + r.hotels, 0);

  return {
    games,
    finished: finishedResults.length,
    byReason,
    eliminationRate: byReason.ELIMINATION / games,
    goalRate: byReason.GOAL / games,
    capRate: byReason.CAP / games,
    timeoutRate: byReason.TIMEOUT / games,
    turns: {
      min: turns[0] ?? 0,
      median: median(turns),
      mean: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : 0,
      max: turns[turns.length - 1] ?? 0,
    },
    winnerNetWorth: { p50: pctile(worth, 0.5), p75: pctile(worth, 0.75), p90: pctile(worth, 0.9), max: worth[worth.length - 1] ?? 0 },
    avgShowdowns: totalShowdowns / games,
    avgBuilds: totalBuilds / games,
    avgHotels: totalHotels / games,
    results,
  };
}
