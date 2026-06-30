import type { MinigameResult, PlayerId } from "@party-monopoly/types";

// Actions are the only way to mutate game state. They're serializable, so an
// action log replays identically and travels over the wire unchanged later.
export type GameAction =
  | { readonly type: "ROLL_DICE" }
  | { readonly type: "BUY_PROPERTY" }
  | { readonly type: "DECLINE_BUY" }
  | { readonly type: "PAY_JAIL_FINE" }
  // minigame harness produces the result; engine maps it to a rent multiplier
  | { readonly type: "SUBMIT_MINIGAME_RESULT"; readonly result: MinigameResult }
  | { readonly type: "END_TURN" }
  | { readonly type: "DECLARE_BANKRUPT"; readonly playerId: PlayerId };

export type GameActionType = GameAction["type"];
