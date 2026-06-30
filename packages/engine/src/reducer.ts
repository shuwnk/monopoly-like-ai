import { asMinigameId, type MinigameRequest, type MinigameResult, type PlayerId } from "@party-monopoly/types";
import type { GameAction } from "./actions.js";
import type { GameEvent, ReducerResult } from "./events.js";
import { rollDie } from "./rng.js";
import type { GameState, PlayerState } from "./state.js";
import { rentEscalationFactor, resolveRentMultiplier } from "./tunables.js";

// Pure reducer. Randomness comes from state.rng, never Math.random, so a game
// replays identically from its seed.
export function reduce(state: GameState, action: GameAction): ReducerResult<GameState> {
  switch (action.type) {
    case "ROLL_DICE":
      return rollDice(state);

    case "BUY_PROPERTY":
      return buyProperty(state);

    case "DECLINE_BUY":
      return state.phase === "AWAITING_BUY_DECISION" ? postLanding(state, []) : done(state);

    case "PAY_JAIL_FINE":
      return payJailFine(state);

    case "SUBMIT_MINIGAME_RESULT":
      return resolveRentShowdown(state, action.result);

    case "END_TURN":
      return endTurn(state);

    case "DECLARE_BANKRUPT": {
      const idx = state.players.findIndex((p) => p.id === action.playerId);
      if (idx < 0) return done(state);
      const broke = bankrupt(state, idx, null);
      return endTurn(broke.state, broke.events);
    }

    default: {
      const _never: never = action;
      return done(state);
    }
  }
}

function rollDice(state: GameState): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_ROLL") return done(state);

  const player = state.players[state.activePlayerIndex];
  if (!player) return done(state);

  const dice: number[] = [];
  let rng = state.rng;
  for (let i = 0; i < state.tunables.diceCount; i++) {
    const r = rollDie(rng, state.tunables.diceSides);
    dice.push(r.value);
    rng = r.next;
  }
  const sum = dice.reduce((a, b) => a + b, 0);
  const isDoubles = dice.every((d) => d === dice[0]);

  const rolled: GameState = { ...state, rng, lastRoll: dice };
  const events: GameEvent[] = [{ type: "DICE_ROLLED", playerId: player.id, dice }];

  if (player.inJail) return jailRoll(rolled, sum, isDoubles, events);

  if (isDoubles) {
    const count = state.doublesCount + 1;
    if (count === 3) {
      // three doubles in a row goes straight to jail, no move
      return endTurn(sendToJail(rolled, state.activePlayerIndex, events).state, events);
    }
    return move({ ...rolled, doublesCount: count }, sum, events);
  }
  return move(rolled, sum, events);
}

// move the active pawn `steps` squares, credit salary if it passes GO, then
// resolve the square it lands on
function move(state: GameState, steps: number, events: GameEvent[]): ReducerResult<GameState> {
  const idx = state.activePlayerIndex;
  const player = state.players[idx]!;
  const newPos = (player.position + steps) % state.tunables.boardSize;
  const passedGo = player.position + steps >= state.tunables.boardSize || newPos === 0;

  let moved = setPlayer(state, idx, { position: newPos });
  if (passedGo) {
    moved = setPlayer(moved, idx, { money: moved.players[idx]!.money + state.tunables.passGoSalary });
  }
  events.push({ type: "PLAYER_MOVED", playerId: player.id, to: newPos, passedGo });

  return resolveLanding(moved, events);
}

function resolveLanding(state: GameState, events: GameEvent[]): ReducerResult<GameState> {
  const idx = state.activePlayerIndex;
  const player = state.players[idx]!;
  const square = state.board[player.position]!;

  switch (square.type) {
    case "GO":
    case "FREE_PARKING":
    case "JAIL":
    case "CHANCE":
    case "COMMUNITY":
      return postLanding(state, events);

    case "GO_TO_JAIL":
      return endTurn(sendToJail(state, idx, events).state, events);

    case "TAX": {
      const amount = state.tunables.taxAmount;
      if (player.money < amount) {
        const broke = bankrupt(state, idx, null, events);
        return postLanding(broke.state, broke.events);
      }
      return postLanding(setPlayer(state, idx, { money: player.money - amount }), events);
    }

    case "PROPERTY": {
      const owner = state.ownership[square.id];
      if (owner === undefined) {
        return { state: { ...state, phase: "AWAITING_BUY_DECISION" }, events };
      }
      if (owner === player.id) return postLanding(state, events);
      return beginRentShowdown(state, rentRequest(state, square.id, owner, player.id), events);
    }
  }
}

function buyProperty(state: GameState): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_BUY_DECISION") return done(state);
  const idx = state.activePlayerIndex;
  const player = state.players[idx]!;
  const square = state.board[player.position]!;
  const price = square.property?.price ?? 0;

  if (player.money < price) return postLanding(state, []); // can't afford, treat as decline

  const bought = setPlayer(state, idx, { money: player.money - price });
  const events: GameEvent[] = [{ type: "PROPERTY_BOUGHT", playerId: player.id, propertyId: square.id, price }];
  return postLanding({ ...bought, ownership: { ...bought.ownership, [square.id]: player.id } }, events);
}

function rentRequest(state: GameState, propertyId: number, ownerId: PlayerId, payerId: PlayerId): MinigameRequest {
  const payer = state.players.find((p) => p.id === payerId)!;
  const owner = state.players.find((p) => p.id === ownerId)!;
  const baseRent = state.board[propertyId]!.property!.baseRent;
  return {
    minigameId: asMinigameId("reflex-tap-duel"),
    // index 0 = lander/payer, index 1 = owner
    participants: [
      { playerId: payer.id, isAI: payer.isAI },
      { playerId: owner.id, isAI: owner.isAI },
    ],
    context: { reason: "RENT_SHOWDOWN", stakeData: { baseRent, propertyId } },
    config: {},
  };
}

// Parks the engine until a result comes back. The host (hotseat, AI, or server)
// runs the minigame and replies with SUBMIT_MINIGAME_RESULT.
export function beginRentShowdown(
  state: GameState,
  request: MinigameRequest,
  events: GameEvent[] = [],
): ReducerResult<GameState> {
  return {
    state: { ...state, phase: "RENT_SHOWDOWN", pendingMinigame: request },
    events: [...events, { type: "MINIGAME_REQUESTED", request }],
  };
}

function resolveRentShowdown(state: GameState, result: MinigameResult): ReducerResult<GameState> {
  if (state.phase !== "RENT_SHOWDOWN" || !state.pendingMinigame) return done(state);

  const { stakeData } = state.pendingMinigame.context;
  const [payerP, ownerP] = state.pendingMinigame.participants;
  const payerIdx = state.players.findIndex((p) => p.id === payerP!.playerId);
  const ownerIdx = state.players.findIndex((p) => p.id === ownerP!.playerId);
  const payer = state.players[payerIdx]!;

  // owner is participant index 1; aborted falls back to flat rent
  const multiplier =
    result.status === "ABORTED"
      ? state.tunables.rentMultipliers.aborted
      : resolveRentMultiplier(result.outcome, 1, state.tunables.rentMultipliers);
  // rent climbs with the owner's holdings, standing in for houses/hotels
  const escalation = rentEscalationFactor(
    ownerPropertyCount(state, ownerP!.playerId),
    state.tunables.rentEscalationStep,
    state.tunables.rentEscalationCap,
  );
  const amount = Math.round(stakeData.baseRent * multiplier * escalation);

  const cleared: GameState = { ...state, pendingMinigame: null };

  if (payer.money >= amount) {
    const paid = setPlayer(cleared, payerIdx, { money: payer.money - amount });
    const credited = setPlayer(paid, ownerIdx, { money: paid.players[ownerIdx]!.money + amount });
    const events: GameEvent[] = [{ type: "RENT_PAID", from: payer.id, to: ownerP!.playerId, amount, multiplier }];
    return postLanding(credited, events);
  }

  // can't cover it: hand over everything and go bankrupt to the owner
  const actuallyPaid = payer.money;
  const events: GameEvent[] = [{ type: "RENT_PAID", from: payer.id, to: ownerP!.playerId, amount: actuallyPaid, multiplier }];
  const broke = bankrupt(cleared, payerIdx, ownerIdx, events);
  return postLanding(broke.state, broke.events);
}

// Shared tail of a landing: re-roll on doubles, otherwise end the turn. A jail
// escape keeps doublesCount at 0, so it never earns the bonus re-roll here even
// though the roll itself was doubles.
function postLanding(state: GameState, events: readonly GameEvent[]): ReducerResult<GameState> {
  const player = state.players[state.activePlayerIndex];
  const wasDoubles = !!state.lastRoll && state.lastRoll.every((d) => d === state.lastRoll![0]);

  if (wasDoubles && state.doublesCount >= 1 && state.doublesCount < 3 && player && !player.inJail && !player.bankrupt) {
    return { state: { ...state, phase: "AWAITING_ROLL" }, events };
  }
  return endTurn({ ...state, phase: "TURN_END" }, events);
}

function endTurn(state: GameState, events: readonly GameEvent[] = []): ReducerResult<GameState> {
  const solvent = state.players.filter((p) => !p.bankrupt);
  if (solvent.length <= 1) {
    const winner = solvent[0];
    if (!winner) return done({ ...state, phase: "GAME_OVER" });
    return gameOver(state, winner.id, events);
  }

  const next = nextActiveIndex(state);
  // a lap completes when the turn pointer wraps back to the first solvent player
  const firstSolvent = state.players.findIndex((p) => !p.bankrupt);
  const round = next === firstSolvent ? state.round + 1 : state.round;

  if (state.tunables.roundCap > 0 && round > state.tunables.roundCap) {
    return gameOver({ ...state, round }, richest(state, solvent).id, events);
  }

  const nextPlayer = state.players[next]!;
  return {
    state: { ...state, round, activePlayerIndex: next, doublesCount: 0, phase: "AWAITING_ROLL" },
    events: [...events, { type: "TURN_ENDED", nextPlayerId: nextPlayer.id }],
  };
}

function gameOver(state: GameState, winnerId: PlayerId, events: readonly GameEvent[]): ReducerResult<GameState> {
  return {
    state: { ...state, phase: "GAME_OVER", winnerId },
    events: [...events, { type: "GAME_OVER", winnerId }],
  };
}

function netWorth(state: GameState, player: PlayerState): number {
  let worth = player.money;
  if (state.tunables.tiebreakMetric === "CASH") return worth;
  for (const [sq, owner] of Object.entries(state.ownership)) {
    if (owner === player.id) worth += state.board[Number(sq)]!.property?.price ?? 0;
  }
  return worth;
}

function ownerPropertyCount(state: GameState, ownerId: PlayerId): number {
  let count = 0;
  for (const owner of Object.values(state.ownership)) {
    if (owner === ownerId) count++;
  }
  return count;
}

function richest(state: GameState, players: readonly PlayerState[]): PlayerState {
  return players.reduce((best, p) => (netWorth(state, p) > netWorth(state, best) ? p : best));
}

function nextActiveIndex(state: GameState): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.activePlayerIndex + i) % n;
    if (!state.players[idx]!.bankrupt) return idx;
  }
  return state.activePlayerIndex;
}

function payJailFine(state: GameState): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_ROLL") return done(state);
  const idx = state.activePlayerIndex;
  const player = state.players[idx]!;
  if (!player.inJail || player.money < state.tunables.jail.fine) return done(state);
  return done(setPlayer(state, idx, { money: player.money - state.tunables.jail.fine, inJail: false }));
}

// Rolling while jailed: doubles escape (no bonus re-roll), max turns forces the
// fine, otherwise stay put for another turn.
function jailRoll(state: GameState, sum: number, isDoubles: boolean, events: GameEvent[]): ReducerResult<GameState> {
  const idx = state.activePlayerIndex;
  const jail = state.tunables.jail;
  const player = state.players[idx]!;

  if (isDoubles && jail.releaseOnDoubles) {
    // doublesCount stays 0 so escaping doesn't grant a bonus re-roll
    const freed = setPlayer(state, idx, { inJail: false, jailTurns: 0 });
    return move(freed, sum, events);
  }

  const turns = player.jailTurns + 1;
  if (turns >= jail.maxTurns) {
    // out of time: pay the fine (or bankrupt to the bank) then move
    if (player.money < jail.fine) {
      const broke = bankrupt(state, idx, null, events);
      return endTurn(broke.state, broke.events);
    }
    const freed = setPlayer(state, idx, { money: player.money - jail.fine, inJail: false, jailTurns: 0 });
    return move(freed, sum, events);
  }

  return endTurn(setPlayer(state, idx, { jailTurns: turns }), events);
}

function sendToJail(state: GameState, idx: number, events: GameEvent[]): ReducerResult<GameState> {
  const player = state.players[idx]!;
  const jailed = setPlayer(state, idx, {
    position: state.tunables.jail.jailSquareId,
    inJail: true,
    jailTurns: 0,
  });
  events.push({ type: "SENT_TO_JAIL", playerId: player.id });
  return done({ ...jailed, doublesCount: 0 });
}

// Hand all the debtor's money to the creditor (bank just absorbs it), release
// their properties back to unowned, and mark them out.
function bankrupt(
  state: GameState,
  debtorIdx: number,
  creditorIdx: number | null,
  events: GameEvent[] = [],
): ReducerResult<GameState> {
  const debtor = state.players[debtorIdx]!;

  let next = state;
  if (creditorIdx !== null) {
    next = setPlayer(next, creditorIdx, { money: next.players[creditorIdx]!.money + debtor.money });
  }
  next = setPlayer(next, debtorIdx, { money: 0, bankrupt: true });

  const released: number[] = [];
  const ownership: Record<number, PlayerId> = {};
  for (const [sq, owner] of Object.entries(state.ownership)) {
    if (owner === debtor.id) released.push(Number(sq));
    else ownership[Number(sq)] = owner;
  }

  return {
    state: { ...next, ownership },
    events: [...events, { type: "PLAYER_BANKRUPT", playerId: debtor.id, releasedProperties: released }],
  };
}

function setPlayer(state: GameState, idx: number, patch: Partial<PlayerState>): GameState {
  const players = state.players.map((p, i) => (i === idx ? { ...p, ...patch } : p));
  return { ...state, players };
}

function done(state: GameState): ReducerResult<GameState> {
  return { state, events: [] };
}

export const minigameId = asMinigameId;
