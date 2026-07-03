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
      return state.phase === "AWAITING_ROLL";
    // give up either on your own turn or when facing a debt you can't/won't cover
    case "DECLARE_BANKRUPT":
      return state.phase === "AWAITING_ROLL" || state.phase === "AWAITING_DEBT_PAYMENT";
    case "BUY_PROPERTY":
    case "DECLINE_BUY":
      return state.phase === "AWAITING_BUY_DECISION";
    case "END_TURN":
      return state.phase === "TURN_END";
    // building is offered only when you land on a stall you can improve (the
    // reducer enforces ownership, cost, and the build-level gate on top of this)
    case "BUILD_HOUSE":
    case "DECLINE_BUILD":
      return state.phase === "AWAITING_BUILD_DECISION";
    // sell voluntarily on your turn, or to service a debt; auto-sell only in debt
    case "SELL_TILE":
      return state.phase === "AWAITING_ROLL" || state.phase === "AWAITING_DEBT_PAYMENT";
    case "AUTO_SELL":
      return state.phase === "AWAITING_DEBT_PAYMENT";
    case "SELECT_WORLD_CUP_TILE":
      return state.phase === "AWAITING_WORLD_CUP";
    case "SELECT_AIRPORT_TILE":
      return state.phase === "AWAITING_AIRPORT";
  }
}
