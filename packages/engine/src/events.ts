import type { MinigameRequest, PlayerId } from "@party-monopoly/types";

// Events are reducer output describing what happened — the UI uses them for the
// log and animations. On MINIGAME_REQUESTED the host runs the minigame and
// feeds back a SUBMIT_MINIGAME_RESULT action.
export type GameEvent =
  | { readonly type: "DICE_ROLLED"; readonly playerId: PlayerId; readonly dice: readonly number[] }
  | { readonly type: "PLAYER_MOVED"; readonly playerId: PlayerId; readonly to: number; readonly passedGo: boolean }
  | { readonly type: "PROPERTY_BOUGHT"; readonly playerId: PlayerId; readonly propertyId: number; readonly price: number }
  | { readonly type: "HOUSE_BUILT"; readonly playerId: PlayerId; readonly squareId: number; readonly level: number; readonly cost: number }
  | { readonly type: "TILE_SOLD"; readonly playerId: PlayerId; readonly squareId: number; readonly refund: number; readonly wasHouse: boolean }
  | { readonly type: "DEBT_PAID"; readonly playerId: PlayerId; readonly amount: number }
  | { readonly type: "WORLD_CUP_BOOST"; readonly playerId: PlayerId; readonly squareId: number; readonly multiplier: number }
  | { readonly type: "AIRPORT_TRAVEL"; readonly playerId: PlayerId; readonly to: number }
  | { readonly type: "MINIGAME_REQUESTED"; readonly request: MinigameRequest }
  | { readonly type: "RENT_PAID"; readonly from: PlayerId; readonly to: PlayerId; readonly amount: number; readonly multiplier: number }
  | { readonly type: "SENT_TO_JAIL"; readonly playerId: PlayerId }
  | { readonly type: "PLAYER_BANKRUPT"; readonly playerId: PlayerId; readonly releasedProperties: readonly number[] }
  | { readonly type: "TURN_ENDED"; readonly nextPlayerId: PlayerId }
  | { readonly type: "GAME_OVER"; readonly winnerId: PlayerId };

export interface ReducerResult<S> {
  readonly state: S;
  readonly events: readonly GameEvent[];
}
