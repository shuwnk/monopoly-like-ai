import type { GameAction, GameState } from "@party-monopoly/engine";
import type { PlayerId } from "@party-monopoly/types";

// buy when the price is at most this fraction of the bot's current cash, which
// leaves a buffer for rent/tax instead of going all-in on the first property
const BUY_CASH_FRACTION = 0.6;

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

    case "AWAITING_BUY_DECISION": {
      const square = state.board[active.position];
      const price = square?.property?.price;
      if (price !== undefined && price <= active.money * BUY_CASH_FRACTION) {
        return { type: "BUY_PROPERTY" };
      }
      return { type: "DECLINE_BUY" };
    }

    case "TURN_END":
      return { type: "END_TURN" };

    // RENT_SHOWDOWN is run by the minigame host; MOVING/RESOLVING_SQUARE are
    // transient and GAME_OVER is terminal — nothing to decide.
    default:
      return null;
  }
}
