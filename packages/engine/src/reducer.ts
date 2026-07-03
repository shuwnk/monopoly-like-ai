import { asMinigameId, type MinigameRequest, type MinigameResult, type PlayerId } from "@party-monopoly/types";
import type { GameAction } from "./actions.js";
import { ISLAND_IDS } from "./board.js";
import type { GameEvent, ReducerResult } from "./events.js";
import { rollDie } from "./rng.js";
import type { GameState, PlayerState } from "./state.js";
import { houseRentFactor, resolveRentMultiplier } from "./tunables.js";

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

    case "BUILD_HOUSE":
      return buildHouse(state, action.squareId);

    case "DECLINE_BUILD":
      return declineBuild(state);

    case "SELL_TILE":
      return sellTile(state, action.squareId);

    case "AUTO_SELL":
      return autoSell(state);

    case "SELECT_WORLD_CUP_TILE":
      return selectWorldCup(state, action.squareId);

    case "SELECT_AIRPORT_TILE":
      return selectAirport(state, action.squareId);

    case "SUBMIT_MINIGAME_RESULT":
      return resolveRentShowdown(state, action.result);

    case "END_TURN":
      return endTurn(state);

    case "END_ON_TIME":
      return endOnTime(state);

    case "DECLARE_BANKRUPT": {
      const idx = state.players.findIndex((p) => p.id === action.playerId);
      if (idx < 0) return done(state);
      // if giving up on a debt, hand what's left to that creditor
      const creditorIdx = state.phase === "AWAITING_DEBT_PAYMENT" && state.pendingDebt ? state.pendingDebt.creditorIdx : null;
      const broke = bankrupt({ ...state, pendingDebt: null }, idx, creditorIdx);
      return endTurn(broke.state, broke.events);
    }

    case "FORFEIT":
      return forfeit(state, action.playerId);

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
    case "JAIL":
    case "CHANCE":
    case "COMMUNITY":
      return postLanding(state, events);

    // Copa (World Cup): pause for the pick only if you own a stall that isn't
    // already boosted — each tile takes one boost, so with nothing new to boost
    // there's no choice to make (and pausing would strand the turn).
    case "FREE_PARKING":
      return ownsBoostableProperty(state, player.id)
        ? { state: { ...state, phase: "AWAITING_WORLD_CUP" }, events }
        : postLanding(state, events);

    // Aeroporto: pause and let the player choose where to fly
    case "GO_TO_JAIL":
      return { state: { ...state, phase: "AWAITING_AIRPORT" }, events };

    case "TAX": {
      const amount = state.tunables.taxAmount;
      if (player.money < amount) {
        // can't pay in cash: sell to cover it, or bankrupt to the bank
        return enterDebt(state, amount, null, events);
      }
      return postLanding(setPlayer(state, idx, { money: player.money - amount }), events);
    }

    case "PROPERTY": {
      const owner = state.ownership[square.id];
      if (owner === undefined) {
        return { state: { ...state, phase: "AWAITING_BUY_DECISION" }, events };
      }
      // landing on your own stall is the only chance to improve it: pause for a
      // one-level build if it's legal and affordable, otherwise carry on
      if (owner === player.id) {
        return canBuildOnLanding(state, idx)
          ? { state: { ...state, phase: "AWAITING_BUILD_DECISION" }, events }
          : postLanding(state, events);
      }
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

// does `playerId` own every stall in `group`? building requires it when the
// requireMonopolyToBuild tunable is set.
export function ownsWholeGroup(state: GameState, playerId: PlayerId, group: string): boolean {
  for (const square of state.board) {
    if (square.property?.group === group && state.ownership[square.id] !== playerId) return false;
  }
  return true;
}

// how high `playerId` may build on stalls in `group`. With requireMonopolyToBuild
// the whole district must be owned to build at all. Otherwise the gate is
// graduated: the ceiling is one level per stall owned in the district, and
// completing it unlocks the top level (hotel). Every extra stall you pick up in a
// district raises the build ceiling on all of them — so buying and building are
// the same decision, and the full monopoly stays the payoff (the only path to a hotel).
export function maxBuildLevelForGroup(state: GameState, playerId: PlayerId, group: string): number {
  let owned = 0;
  let size = 0;
  for (const square of state.board) {
    if (square.property?.group !== group) continue;
    size++;
    if (state.ownership[square.id] === playerId) owned++;
  }
  if (size === 0 || owned === 0) return 0;
  if (owned === size) return state.tunables.maxBuildLevel;
  if (state.tunables.requireMonopolyToBuild) return 0;
  // incomplete district: one level per stall owned, but the top level (hotel) is
  // reserved for completing the district — otherwise the 6-stall Metrópole would
  // reach a hotel at 4/6 owned, undercutting the monopoly payoff.
  return Math.min(owned, state.tunables.maxBuildLevel - 1);
}

// can the active player build one more level on the stall they're standing on?
// this is the only gate for building — you improve a stall by landing on it.
function canBuildOnLanding(state: GameState, idx: number): boolean {
  const player = state.players[idx]!;
  const square = state.board[player.position];
  const group = square?.property?.group;
  if (!square || square.type !== "PROPERTY" || !square.property || !group) return false;
  if (state.ownership[square.id] !== player.id) return false;
  const level = state.buildings[square.id] ?? 0;
  if (level >= maxBuildLevelForGroup(state, player.id, group)) return false;
  const cost = Math.round(square.property.price * state.tunables.buildCostFraction);
  return player.money >= cost;
}

// build one level on the stall the player just landed on. one improvement per
// landing: after it, the turn advances, so climbing to a hotel means landing on
// the stall again on a later turn.
function buildHouse(state: GameState, squareId: number): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_BUILD_DECISION") return done(state);
  const idx = state.activePlayerIndex;
  const player = state.players[idx]!;
  // you can only build on the stall you're standing on
  if (squareId !== player.position || !canBuildOnLanding(state, idx)) return done(state);

  const square = state.board[squareId]!;
  const level = state.buildings[squareId] ?? 0;
  const cost = Math.round(square.property!.price * state.tunables.buildCostFraction);

  const paid = setPlayer(state, idx, { money: player.money - cost });
  const nextLevel = level + 1;
  return postLanding(
    { ...paid, buildings: { ...paid.buildings, [squareId]: nextLevel } },
    [{ type: "HOUSE_BUILT", playerId: player.id, squareId, level: nextLevel, cost }],
  );
}

// skip the offered improvement and carry on
function declineBuild(state: GameState): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_BUILD_DECISION") return done(state);
  return postLanding(state, []);
}

// --- selling & debt ---

// perform one sale on `squareId`: the top house level if built, else the bare
// property itself. Returns the new state + refund, or null if it isn't sellable.
// Does NOT touch the phase / debt — callers handle that.
function sellOne(
  state: GameState,
  idx: number,
  squareId: number,
): { state: GameState; refund: number; wasHouse: boolean } | null {
  const player = state.players[idx]!;
  const square = state.board[squareId];
  if (!square?.property || state.ownership[squareId] !== player.id) return null;

  const sf = state.tunables.sellFraction;
  const level = state.buildings[squareId] ?? 0;
  if (level >= 1) {
    const refund = Math.round(square.property.price * state.tunables.buildCostFraction * sf);
    const buildings: Record<number, number> = {};
    for (const [sq, lv] of Object.entries(state.buildings)) if (Number(sq) !== squareId) buildings[Number(sq)] = lv;
    if (level - 1 >= 1) buildings[squareId] = level - 1;
    const paid = setPlayer(state, idx, { money: player.money + refund });
    return { state: { ...paid, buildings }, refund, wasHouse: true };
  }
  // bare lot: sell the land, releasing ownership and any Copa boost
  const refund = Math.round(square.property.price * sf);
  const ownership: Record<number, PlayerId> = {};
  for (const [sq, owner] of Object.entries(state.ownership)) if (Number(sq) !== squareId) ownership[Number(sq)] = owner;
  const rentBoosts: Record<number, number> = {};
  for (const [sq, m] of Object.entries(state.rentBoosts)) if (Number(sq) !== squareId) rentBoosts[Number(sq)] = m;
  const paid = setPlayer(state, idx, { money: player.money + refund });
  return { state: { ...paid, ownership, rentBoosts }, refund, wasHouse: false };
}

// total cash a player could raise by selling everything they own
function liquidatable(state: GameState, idx: number): number {
  const player = state.players[idx]!;
  const sf = state.tunables.sellFraction;
  let total = 0;
  for (const [sq, owner] of Object.entries(state.ownership)) {
    if (owner !== player.id) continue;
    const price = state.board[Number(sq)]!.property?.price ?? 0;
    const level = state.buildings[Number(sq)] ?? 0;
    total += Math.round(price * sf) + level * Math.round(price * state.tunables.buildCostFraction * sf);
  }
  return total;
}

// the owned asset whose next sale raises the least — sold first by auto-sell so
// it liquidates gradually rather than dumping the priciest holding
function cheapestSale(state: GameState, idx: number): number | null {
  const player = state.players[idx]!;
  const sf = state.tunables.sellFraction;
  let best: number | null = null;
  let bestRefund = Infinity;
  for (const [sq, owner] of Object.entries(state.ownership)) {
    if (owner !== player.id) continue;
    const id = Number(sq);
    const price = state.board[id]!.property?.price ?? 0;
    const level = state.buildings[id] ?? 0;
    const refund = level >= 1 ? Math.round(price * state.tunables.buildCostFraction * sf) : Math.round(price * sf);
    if (refund < bestRefund) {
      bestRefund = refund;
      best = id;
    }
  }
  return best;
}

// player owes `amount` they can't cover in cash: pause to sell if their holdings
// can raise it, otherwise go straight to bankruptcy (creditorIdx null = the bank)
function enterDebt(
  state: GameState,
  amount: number,
  creditorIdx: number | null,
  events: readonly GameEvent[],
): ReducerResult<GameState> {
  const idx = state.activePlayerIndex;
  if (state.players[idx]!.money + liquidatable(state, idx) < amount) {
    const broke = bankrupt(state, idx, creditorIdx, [...events]);
    return endTurn(broke.state, broke.events);
  }
  return { state: { ...state, phase: "AWAITING_DEBT_PAYMENT", pendingDebt: { amount, creditorIdx } }, events: [...events] };
}

// enough cash raised: pay the debt to its creditor, clear it, end the turn
function settleDebt(state: GameState, events: readonly GameEvent[]): ReducerResult<GameState> {
  const debt = state.pendingDebt!;
  const idx = state.activePlayerIndex;
  const debtor = state.players[idx]!;
  let next = setPlayer(state, idx, { money: debtor.money - debt.amount });
  if (debt.creditorIdx !== null) {
    next = setPlayer(next, debt.creditorIdx, { money: next.players[debt.creditorIdx]!.money + debt.amount });
  }
  return endTurn({ ...next, pendingDebt: null }, [...events, { type: "DEBT_PAID", playerId: debtor.id, amount: debt.amount }]);
}

// SELL_TILE: sell one asset. Voluntary on your own turn, or to service a debt —
// in which case paying it off as soon as you can afford it ends the turn.
function sellTile(state: GameState, squareId: number): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_ROLL" && state.phase !== "AWAITING_DEBT_PAYMENT") return done(state);
  const idx = state.activePlayerIndex;
  const sold = sellOne(state, idx, squareId);
  if (!sold) return done(state);
  const events: GameEvent[] = [
    { type: "TILE_SOLD", playerId: state.players[idx]!.id, squareId, refund: sold.refund, wasHouse: sold.wasHouse },
  ];
  if (sold.state.phase === "AWAITING_DEBT_PAYMENT" && sold.state.pendingDebt && sold.state.players[idx]!.money >= sold.state.pendingDebt.amount) {
    return settleDebt(sold.state, events);
  }
  return { state: sold.state, events };
}

// AUTO_SELL: liquidate cheapest-first until the debt is covered, then pay it —
// or bankrupt to the creditor if selling everything still falls short
function autoSell(state: GameState): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_DEBT_PAYMENT" || !state.pendingDebt) return done(state);
  const idx = state.activePlayerIndex;
  const creditorIdx = state.pendingDebt.creditorIdx;
  const amount = state.pendingDebt.amount;
  let s = state;
  const events: GameEvent[] = [];
  let guard = 0;
  while (s.players[idx]!.money < amount && guard++ < 400) {
    const sq = cheapestSale(s, idx);
    if (sq === null) break;
    const sold = sellOne(s, idx, sq)!;
    events.push({ type: "TILE_SOLD", playerId: s.players[idx]!.id, squareId: sq, refund: sold.refund, wasHouse: sold.wasHouse });
    s = sold.state;
  }
  if (s.players[idx]!.money >= amount) return settleDebt(s, events);
  const broke = bankrupt({ ...s, pendingDebt: null }, idx, creditorIdx, events);
  return endTurn(broke.state, broke.events);
}

// owns a stall whose rent isn't already Copa-boosted (a fresh boost target)
// owns a city that Copa can boost — islands are exempt, so they don't count
function ownsBoostableProperty(state: GameState, playerId: PlayerId): boolean {
  for (const [sq, owner] of Object.entries(state.ownership)) {
    if (owner === playerId && !ISLAND_IDS.includes(Number(sq))) return true;
  }
  return false;
}

// Copa: multiply one of your own properties' rent for the rest of the game. Boosts
// STACK — re-picking the same lot multiplies again (×2, ×4, ×8, …). Islands can't
// be boosted.
function selectWorldCup(state: GameState, squareId: number): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_WORLD_CUP") return done(state);
  const player = state.players[state.activePlayerIndex]!;
  if (state.ownership[squareId] !== player.id || ISLAND_IDS.includes(squareId)) return done(state);

  const boosted = (state.rentBoosts[squareId] ?? 1) * state.tunables.worldCupMultiplier;
  const next: GameState = { ...state, rentBoosts: { ...state.rentBoosts, [squareId]: boosted } };
  return postLanding(next, [{ type: "WORLD_CUP_BOOST", playerId: player.id, squareId, multiplier: boosted }]);
}

// Aeroporto: fly the active player to any square, then resolve landing there
function selectAirport(state: GameState, squareId: number): ReducerResult<GameState> {
  if (state.phase !== "AWAITING_AIRPORT") return done(state);
  const idx = state.activePlayerIndex;
  const player = state.players[idx]!;
  const target = state.board[squareId];
  if (!target) return done(state);
  // can't fly to the airport square itself: landing there just re-opens this
  // prompt, so a client that kept picking it would loop. reject and wait.
  if (target.type === "GO_TO_JAIL") return done(state);

  const moved = setPlayer(state, idx, { position: squareId });
  const events: GameEvent[] = [{ type: "AIRPORT_TRAVEL", playerId: player.id, to: squareId }];
  return resolveLanding(moved, events);
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
  // rent scales with how built-up the stall is; the duel multiplier swings it
  const houseFactor = houseRentFactor(
    state.buildings[stakeData.propertyId] ?? 0,
    state.tunables.houseRentMultipliers,
    state.tunables.maxBuildLevel,
  );
  // Copa boost stacks on top of houses and the duel multiplier
  const boost = state.rentBoosts[stakeData.propertyId] ?? 1;
  const amount = Math.round(stakeData.baseRent * multiplier * houseFactor * boost);

  const cleared: GameState = { ...state, pendingMinigame: null };

  if (payer.money >= amount) {
    const paid = setPlayer(cleared, payerIdx, { money: payer.money - amount });
    const credited = setPlayer(paid, ownerIdx, { money: paid.players[ownerIdx]!.money + amount });
    const events: GameEvent[] = [{ type: "RENT_PAID", from: payer.id, to: ownerP!.playerId, amount, multiplier }];
    return postLanding(credited, events);
  }

  // can't cover it in cash: sell assets to raise it (or bankrupt to the owner)
  return enterDebt(cleared, amount, ownerIdx, []);
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

  // island monopoly: owning all four islands wins the game outright
  const islandKing = solvent.find((p) => ownsAllIslands(state, p.id));
  if (islandKing) return gameOver(state, islandKing.id, events);

  // wealth goal: the first player to reach it wins outright, before the clock
  if (state.tunables.netWorthGoal > 0) {
    const leader = richest(state, solvent);
    if (netWorth(state, leader) >= state.tunables.netWorthGoal) return gameOver(state, leader.id, events);
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

// the host's countdown reached zero: end now, richest solvent player wins. Not a
// client action — only the authoritative host (server / hotseat timer) sends it.
function endOnTime(state: GameState): ReducerResult<GameState> {
  if (state.phase === "GAME_OVER") return done(state);
  const solvent = state.players.filter((p) => !p.bankrupt);
  if (solvent.length === 0) return done({ ...state, phase: "GAME_OVER" });
  return gameOver(state, richest(state, solvent).id, []);
}

// a player left the game: bankrupt them (assets to the bank) and keep play going.
// If it was their turn — or if this leaves one player standing — advance the turn
// so the room never stalls waiting on someone who's gone.
function forfeit(state: GameState, playerId: PlayerId): ReducerResult<GameState> {
  const idx = state.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || state.players[idx]!.bankrupt) return done(state);
  const broke = bankrupt({ ...state, pendingDebt: null, pendingMinigame: null }, idx, null);
  const solvent = broke.state.players.filter((p) => !p.bankrupt);
  if (idx === state.activePlayerIndex || solvent.length <= 1) {
    return endTurn({ ...broke.state, phase: "TURN_END" }, broke.events);
  }
  return broke;
}

function gameOver(state: GameState, winnerId: PlayerId, events: readonly GameEvent[]): ReducerResult<GameState> {
  return {
    state: { ...state, phase: "GAME_OVER", winnerId },
    events: [...events, { type: "GAME_OVER", winnerId }],
  };
}

// the score the round cap ranks players by (see tiebreakMetric). Exported so the
// HUD shows the exact number that decides a points game, never a drifting copy.
export function netWorth(state: GameState, player: PlayerState): number {
  let worth = player.money;
  if (state.tunables.tiebreakMetric === "CASH") return worth;
  for (const [sq, owner] of Object.entries(state.ownership)) {
    if (owner !== player.id) continue;
    const id = Number(sq);
    const price = state.board[id]!.property?.price ?? 0;
    worth += price;
    // building spend is part of net worth too, otherwise a points-decided game
    // penalises the very mechanic it's supposed to reward.
    const level = state.buildings[id] ?? 0;
    if (level > 0) worth += level * Math.round(price * state.tunables.buildCostFraction);
  }
  return worth;
}

// does this player own every island? owning the full set is an instant win
function ownsAllIslands(state: GameState, playerId: PlayerId): boolean {
  return ISLAND_IDS.every((id) => state.ownership[id] === playerId);
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
    // out of time: pay the fine, then move
    if (player.money < jail.fine) {
      // can't pay: leave jail and sell to cover the fine (or bankrupt). the turn
      // ends once the debt is settled — no move this turn.
      const freed = setPlayer(state, idx, { inJail: false, jailTurns: 0 });
      return enterDebt(freed, jail.fine, null, events);
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

  // freed stalls also lose their buildings and Copa boosts (back to bare/unowned)
  const buildings: Record<number, number> = {};
  for (const [sq, level] of Object.entries(state.buildings)) {
    if (state.ownership[Number(sq)] !== debtor.id) buildings[Number(sq)] = level;
  }
  const rentBoosts: Record<number, number> = {};
  for (const [sq, mult] of Object.entries(state.rentBoosts)) {
    if (state.ownership[Number(sq)] !== debtor.id) rentBoosts[Number(sq)] = mult;
  }

  return {
    state: { ...next, ownership, buildings, rentBoosts },
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
