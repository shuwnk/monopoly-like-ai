// Neon Night Market currency and player coding, shared across the UI. Player
// colors are distinct hues backed by a P1/P2 tag so they never rely on hue alone.
export const CURRENCY = "R$";

const PLAYER_COLORS = ["#4cc9f0", "#ff6b6b", "#ffd23f", "#2bd96b"];

export function playerColor(idx: number): string {
  return PLAYER_COLORS[idx] ?? "#aaa";
}

export function playerTag(idx: number): string {
  return `P${idx + 1}`;
}

// the eight Neon Night Market districts, in board order. Shared by the board
// tiles and the per-player owned-property chips so a district reads the same
// everywhere.
export const GROUP_COLORS: Record<string, string> = {
  Norte: "#f5a623",
  Nordeste: "#e0533d",
  Litoral: "#2ec4b6",
  "Centro-Oeste": "#8b5cf6",
  Sul: "#ff5fa2",
  Bahia: "#3a86ff",
  Sudeste: "#2bd96b",
  "Metrópole": "#ffd23f",
  Ilhas: "#12b3a6", // islands — teal
};

export function groupColor(group: string | undefined): string | undefined {
  return group ? GROUP_COLORS[group] : undefined;
}
