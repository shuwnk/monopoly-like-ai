import type { MinigameResult, PlayerId } from "@party-monopoly/types";

// Actions are the only way to mutate game state. They're serializable, so an
// action log replays identically and travels over the wire unchanged later.
export type GameAction =
  | { readonly type: "ROLL_DICE" }
  | { readonly type: "BUY_PROPERTY" }
  | { readonly type: "DECLINE_BUY" }
  | { readonly type: "PAY_JAIL_FINE" }
  // build one level on a stall you own (needs the whole district); raises its rent
  | { readonly type: "BUILD_HOUSE"; readonly squareId: number }
  | { readonly type: "DECLINE_BUILD" }
  // sell a stall's top house level, or the stall itself if bare, for cash
  | { readonly type: "SELL_TILE"; readonly squareId: number }
  // auto-liquidate cheapest assets until a pending debt is covered (or bankrupt)
  | { readonly type: "AUTO_SELL" }
  // Copa: pick one of your properties to permanently boost its rent
  | { readonly type: "SELECT_WORLD_CUP_TILE"; readonly squareId: number }
  // Aeroporto: pick any square to fly to, then resolve landing there
  | { readonly type: "SELECT_AIRPORT_TILE"; readonly squareId: number }
  // minigame harness produces the result; engine maps it to a rent multiplier
  | { readonly type: "SUBMIT_MINIGAME_RESULT"; readonly result: MinigameResult }
  // host-driven (server/hotseat timer): the countdown hit zero, end on net worth
  | { readonly type: "END_ON_TIME" }
  | { readonly type: "END_TURN" }
  | { readonly type: "DECLARE_BANKRUPT"; readonly playerId: PlayerId }
  // host-driven: a player left the game; remove them without stalling the turn
  | { readonly type: "FORFEIT"; readonly playerId: PlayerId };

export type GameActionType = GameAction["type"];
