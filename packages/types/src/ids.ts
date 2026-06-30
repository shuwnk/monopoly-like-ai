// Branded id types: stops a PlayerId being passed where a PropertyId is wanted,
// while staying a plain string/number at runtime so state stays serializable.

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PlayerId = Brand<string, "PlayerId">;
export type SquareId = Brand<number, "SquareId">;
// the SquareId of an ownable square
export type PropertyId = Brand<number, "PropertyId">;
export type MinigameId = Brand<string, "MinigameId">;

export const asPlayerId = (v: string): PlayerId => v as PlayerId;
export const asSquareId = (v: number): SquareId => v as SquareId;
export const asPropertyId = (v: number): PropertyId => v as PropertyId;
export const asMinigameId = (v: string): MinigameId => v as MinigameId;
