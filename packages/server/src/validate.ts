import type { GameState } from "@party-monopoly/engine";
import type { ClientActionType, PlayerId } from "@party-monopoly/types";

// Pure gatekeeper: is this player allowed to send this action right now? The
// reducer is the source of truth for what an action *does*, but it silently
// no-ops illegal input. Online we want to reject instead, so we mirror the
// reducer's phase/turn guards here and unit-test them without a live room.
export function isLegalAction(state: GameState, playerId: PlayerId, action: ClientActionType): boolean {
  if (state.phase === "GAME_OVER" || state.phase === "RENT_SHOWDOWN") return false;

  const active = state.players[state.activePlayerIndex];
  // every player action below is taken on your own turn
  if (!active || active.id !== playerId || active.bankrupt) return false;

  switch (action) {
    case "ROLL_DICE":
    case "PAY_JAIL_FINE":
    case "DECLARE_BANKRUPT":
      return state.phase === "AWAITING_ROLL";
    case "BUY_PROPERTY":
    case "DECLINE_BUY":
      return state.phase === "AWAITING_BUY_DECISION";
    case "END_TURN":
      return state.phase === "TURN_END";
  }
}
