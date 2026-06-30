// Neon Night Market currency and player coding, shared across the UI. Player
// colors are distinct hues backed by a P1/P2 tag so they never rely on hue alone.
export const CURRENCY = "₸";

const PLAYER_COLORS = ["#4cc9f0", "#ff6b6b", "#ffd23f", "#2bd96b"];

export function playerColor(idx: number): string {
  return PLAYER_COLORS[idx] ?? "#aaa";
}

export function playerTag(idx: number): string {
  return `P${idx + 1}`;
}
