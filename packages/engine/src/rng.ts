// Seeded, serializable RNG (mulberry32). The engine never calls Math.random;
// randomness flows from an RngState inside GameState so a game is reproducible
// from its seed + action log.

export interface RngState {
  readonly seed: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

// returns the next [0,1) float and the advanced state; caller stores `next` back
export function nextFloat(state: RngState): { value: number; next: RngState } {
  let t = (state.seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: { seed: t >>> 0 } };
}

// inclusive integer in [min, max]
export function nextInt(
  state: RngState,
  min: number,
  max: number,
): { value: number; next: RngState } {
  const { value, next } = nextFloat(state);
  return { value: min + Math.floor(value * (max - min + 1)), next };
}

// single die roll [1, sides]
export function rollDie(
  state: RngState,
  sides = 6,
): { value: number; next: RngState } {
  return nextInt(state, 1, sides);
}
