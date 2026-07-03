import { ISLAND_IDS, type GameAction, type GameState } from "@party-monopoly/engine";
import type { PlayerId } from "@party-monopoly/types";

// buy when the price is at most this fraction of the bot's current cash, which
// leaves a buffer for rent/tax instead of going all-in on the first property
const BUY_CASH_FRACTION = 0.6;
// stretch the cap when a stall extends a district we already own part of, so
// bots actually assemble monopolies (and thus have something to build on)
const BUY_GROUP_CASH_FRACTION = 0.9;
// build more conservatively than we buy: keep most cash liquid for rent duels
const BUILD_CASH_FRACTION = 0.4;

// Pure decision: given it's `playerId`'s turn, pick the one next action to take.
// Returns null when there's nothing for the bot to decide right now (other
// player's turn, a showdown the harness drives, or the game is over). No
// randomness — same inputs always yield the same action.
export function decideAction(state: GameState, playerId: PlayerId): GameAction | null {
  const active = state.players[state.activePlayerIndex];
  if (!active || active.id !== playerId || active.bankrupt) return null;

  switch (state.phase) {
    case "AWAITING_ROLL": {
      // pay our way out if jailed, can afford it, and we've already sat a turn;
      // otherwise just roll and hope for doubles
      if (active.inJail && active.jailTurns >= 1 && active.money >= state.tunables.jail.fine) {
        return { type: "PAY_JAIL_FINE" };
      }
      return { type: "ROLL_DICE" };
    }

    case "AWAITING_DEBT_PAYMENT":
      // owe more than we hold in cash: liquidate to cover it (auto-sell bankrupts
      // us if selling everything still can't). bots don't sell voluntarily.
      return { type: "AUTO_SELL" };

    case "AWAITING_BUILD_DECISION": {
      // we landed on our own stall and may improve it one level. build if we can
      // spare the cash beyond our rent-duel cushion; the engine already checked
      // the level gate and full-cost affordability before offering the choice.
      const square = state.board[active.position];
      const cost = Math.round((square?.property?.price ?? 0) * state.tunables.buildCostFraction);
      if (cost > 0 && active.money * BUILD_CASH_FRACTION >= cost) {
        return { type: "BUILD_HOUSE", squareId: active.position };
      }
      return { type: "DECLINE_BUILD" };
    }

    case "AWAITING_BUY_DECISION": {
      const square = state.board[active.position];
      const price = square?.property?.price;
      if (price === undefined) return { type: "DECLINE_BUY" };
      // stalls in a district we already have a foothold in are worth reaching
      // for — completing a monopoly is what unlocks building — so we stretch the
      // cash cap when this buy extends a group we've started.
      const group = square?.property?.group;
      const cap = group && ownsAnyInGroup(state, active.id, group) ? BUY_GROUP_CASH_FRACTION : BUY_CASH_FRACTION;
      return price <= active.money * cap ? { type: "BUY_PROPERTY" } : { type: "DECLINE_BUY" };
    }

    case "AWAITING_WORLD_CUP": {
      // Copa stacks, so pile it onto our most valuable stall — its rent snowballs
      // fastest there. (Weight by current rentBoost so we keep feeding the same one.)
      let best = -1;
      let bestValue = -1;
      for (const square of state.board) {
        if (square.type !== "PROPERTY" || state.ownership[square.id] !== playerId) continue;
        if (ISLAND_IDS.includes(square.id)) continue; // islands can't be Copa-boosted
        const value = (square.property?.price ?? 0) * (state.rentBoosts[square.id] ?? 1);
        if (value > bestValue) {
          bestValue = value;
          best = square.id;
        }
      }
      return best >= 0 ? { type: "SELECT_WORLD_CUP_TILE", squareId: best } : null;
    }

    case "AWAITING_AIRPORT": {
      // fly toward a stall that improves our position: first one that completes a
      // district, then one in a district we already hold the most of, cheapest as
      // the tiebreak. building unlocks by owned-in-group now, so completing groups
      // is the whole point. fall back to GO (0) if nothing affordable helps.
      let target = 0;
      let best: { completes: boolean; owned: number; price: number } | null = null;
      for (const square of state.board) {
        if (square.type !== "PROPERTY" || state.ownership[square.id] !== undefined) continue;
        const price = square.property?.price ?? 0;
        if (price > active.money) continue;
        const group = square.property?.group;
        if (!group) continue;
        const { owned, size } = groupHoldings(state, active.id, group);
        const cand = { completes: owned === size - 1, owned, price };
        if (!best || betterAirportTarget(cand, best)) {
          best = cand;
          target = square.id;
        }
      }
      return { type: "SELECT_AIRPORT_TILE", squareId: target };
    }

    case "TURN_END":
      return { type: "END_TURN" };

    // RENT_SHOWDOWN is run by the minigame host; MOVING/RESOLVING_SQUARE are
    // transient and GAME_OVER is terminal — nothing to decide.
    default:
      return null;
  }
}

// does the player already own at least one stall in this district?
function ownsAnyInGroup(state: GameState, playerId: PlayerId, group: string): boolean {
  for (const square of state.board) {
    if (square.property?.group === group && state.ownership[square.id] === playerId) return true;
  }
  return false;
}

// how many stalls of `group` the player owns, and how big the district is
function groupHoldings(state: GameState, playerId: PlayerId, group: string): { owned: number; size: number } {
  let owned = 0;
  let size = 0;
  for (const square of state.board) {
    if (square.property?.group !== group) continue;
    size++;
    if (state.ownership[square.id] === playerId) owned++;
  }
  return { owned, size };
}

// airport target ranking: completing a district beats extending one, more
// holdings beats fewer, cheaper breaks ties
function betterAirportTarget(a: { completes: boolean; owned: number; price: number }, b: typeof a): boolean {
  if (a.completes !== b.completes) return a.completes;
  if (a.owned !== b.owned) return a.owned > b.owned;
  return a.price < b.price;
}

