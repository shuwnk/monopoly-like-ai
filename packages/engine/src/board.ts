import type { Square, SquareType } from "./state.js";

// Neon Night Market: 40 squares, the 28 buyable stalls grouped into 8 themed
// districts with rising prices. Corners and tax/card squares sit at fixed
// indices the engine relies on. Card squares are inert for now (no-op).

function plain(id: number, name: string, type: SquareType): Square {
  return { id, name, type };
}

// the 28 stalls in board order, cheapest district first. price drives rent.
const STALLS: ReadonlyArray<{ id: number; name: string; price: number; group: string }> = [
  { id: 1, name: "Paper Lantern Stall", price: 60, group: "Lantern Lane" },
  { id: 3, name: "Dragon Lantern Stand", price: 70, group: "Lantern Lane" },
  { id: 5, name: "Charcoal Skewer Cart", price: 100, group: "Skewer Row" },
  { id: 6, name: "Spicy Skewer Grill", price: 110, group: "Skewer Row" },
  { id: 8, name: "Sizzle Pit BBQ", price: 120, group: "Skewer Row" },
  { id: 9, name: "Taro Tea Stand", price: 140, group: "Bubble Tea Block" },
  { id: 11, name: "Brown Sugar Boba Bar", price: 150, group: "Bubble Tea Block" },
  { id: 12, name: "Lychee Slush Counter", price: 160, group: "Bubble Tea Block" },
  { id: 13, name: "Matcha Foam Kiosk", price: 170, group: "Bubble Tea Block" },
  { id: 14, name: "Token Crane Booth", price: 190, group: "Arcade Alley" },
  { id: 15, name: "Pixel Fighter Cabinet", price: 200, group: "Arcade Alley" },
  { id: 16, name: "Skee-Ball Lanes", price: 210, group: "Arcade Alley" },
  { id: 18, name: "Echo Karaoke Box", price: 230, group: "Karaoke Quarter" },
  { id: 19, name: "Encore Stage Room", price: 240, group: "Karaoke Quarter" },
  { id: 21, name: "Velvet Mic Lounge", price: 250, group: "Karaoke Quarter" },
  { id: 23, name: "Fresh Lace Drop", price: 280, group: "Sneaker Strip" },
  { id: 24, name: "Hype Resell Window", price: 290, group: "Sneaker Strip" },
  { id: 25, name: "Midnight Heat Shop", price: 300, group: "Sneaker Strip" },
  { id: 26, name: "Spare Parts Bazaar", price: 320, group: "Gadget Gallery" },
  { id: 27, name: "Drone Repair Bay", price: 340, group: "Gadget Gallery" },
  { id: 28, name: "Holo Display Hall", price: 360, group: "Gadget Gallery" },
  { id: 29, name: "Circuit Black Market", price: 380, group: "Gadget Gallery" },
  { id: 31, name: "Jade Tea House", price: 400, group: "Golden Pagoda Plaza" },
  { id: 32, name: "Lucky Koi Pavilion", price: 410, group: "Golden Pagoda Plaza" },
  { id: 34, name: "Silk Lantern Terrace", price: 420, group: "Golden Pagoda Plaza" },
  { id: 35, name: "Imperial Rooftop", price: 430, group: "Golden Pagoda Plaza" },
  { id: 37, name: "Dragon Gate Pagoda", price: 435, group: "Golden Pagoda Plaza" },
  { id: 39, name: "Neon Crown Pagoda", price: 440, group: "Golden Pagoda Plaza" },
];

const SPECIALS: Record<number, { name: string; type: SquareType }> = {
  0: { name: "Market Gate", type: "GO" },
  4: { name: "Stall Fee", type: "TAX" },
  10: { name: "The Lockup — Just Browsing", type: "JAIL" },
  20: { name: "Food Court", type: "FREE_PARKING" },
  30: { name: "Bounced!", type: "GO_TO_JAIL" },
  38: { name: "Cleanup Fee", type: "TAX" },
  2: { name: "Market Rumor", type: "COMMUNITY" },
  17: { name: "Market Rumor", type: "COMMUNITY" },
  33: { name: "Market Rumor", type: "COMMUNITY" },
  7: { name: "Lucky Token", type: "CHANCE" },
  22: { name: "Lucky Token", type: "CHANCE" },
  36: { name: "Lucky Token", type: "CHANCE" },
};

export function createDefaultBoard(rentFraction: number, rentFloor: number): Square[] {
  const stalls = new Map(STALLS.map((s) => [s.id, s]));
  const board: Square[] = [];
  for (let i = 0; i < 40; i++) {
    const special = SPECIALS[i];
    if (special) {
      board.push(plain(i, special.name, special.type));
      continue;
    }
    const stall = stalls.get(i)!;
    const baseRent = Math.max(rentFloor, Math.floor(stall.price * rentFraction));
    board.push({
      id: i,
      name: stall.name,
      type: "PROPERTY",
      property: { price: stall.price, baseRent, group: stall.group },
    });
  }
  return board;
}
