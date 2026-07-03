import type { Square, SquareType } from "./state.js";

// Tour Brasil: 40 squares, 28 buyable cities grouped into 8 regions with rising
// prices (Norte cheapest, the Rio/SP metropolis priciest). Corners and tax/card
// squares sit at fixed indices the engine relies on. Card squares are inert.

function plain(id: number, name: string, type: SquareType): Square {
  return { id, name, type };
}

// the 28 cities in board order, cheapest region first. price drives rent.
const STALLS: ReadonlyArray<{ id: number; name: string; price: number; group: string }> = [
  { id: 1, name: "Rio Branco", price: 60, group: "Norte" },
  { id: 3, name: "Boa Vista", price: 70, group: "Norte" },
  { id: 5, name: "São Luís", price: 100, group: "Nordeste" },
  { id: 6, name: "Teresina", price: 110, group: "Nordeste" },
  { id: 8, name: "Natal", price: 120, group: "Nordeste" },
  { id: 9, name: "Maceió", price: 140, group: "Litoral" },
  { id: 11, name: "Aracaju", price: 150, group: "Litoral" },
  { id: 12, name: "João Pessoa", price: 160, group: "Litoral" },
  { id: 13, name: "Recife", price: 170, group: "Litoral" },
  { id: 14, name: "Cuiabá", price: 190, group: "Centro-Oeste" },
  { id: 15, name: "Campo Grande", price: 200, group: "Centro-Oeste" },
  { id: 16, name: "Goiânia", price: 210, group: "Centro-Oeste" },
  { id: 18, name: "Florianópolis", price: 230, group: "Sul" },
  { id: 19, name: "Curitiba", price: 240, group: "Sul" },
  { id: 21, name: "Porto Alegre", price: 250, group: "Sul" },
  { id: 23, name: "Porto Seguro", price: 280, group: "Bahia" },
  { id: 24, name: "Ilhéus", price: 290, group: "Bahia" },
  { id: 25, name: "Salvador", price: 300, group: "Bahia" },
  { id: 26, name: "Vitória", price: 320, group: "Sudeste" },
  { id: 27, name: "Belo Horizonte", price: 340, group: "Sudeste" },
  { id: 28, name: "Ouro Preto", price: 360, group: "Sudeste" },
  { id: 29, name: "Campinas", price: 380, group: "Sudeste" },
  { id: 31, name: "Santos", price: 400, group: "Metrópole" },
  { id: 32, name: "Niterói", price: 410, group: "Metrópole" },
  { id: 34, name: "Guarulhos", price: 420, group: "Metrópole" },
  { id: 35, name: "Rio de Janeiro", price: 430, group: "Metrópole" },
  { id: 37, name: "Copacabana", price: 435, group: "Metrópole" },
  { id: 39, name: "São Paulo", price: 440, group: "Metrópole" },
];

const SPECIALS: Record<number, { name: string; type: SquareType }> = {
  0: { name: "Largada", type: "GO" },
  4: { name: "Imposto", type: "TAX" },
  10: { name: "Cadeia — Só Visitando", type: "JAIL" },
  20: { name: "Copa do Mundo", type: "FREE_PARKING" },
  30: { name: "Aeroporto", type: "GO_TO_JAIL" },
  38: { name: "Taxa de Renda", type: "TAX" },
  2: { name: "Cofre", type: "COMMUNITY" },
  36: { name: "Sorte", type: "CHANCE" },
};

// The four islands (the old Sorte/Cofre corners of the ring): buyable properties
// in their own "Ilhas" group. You build a resort on them like any lot, but owning
// ALL FOUR wins the game outright — an alternate victory to the wealth race.
export const ISLAND_GROUP = "Ilhas";
const ISLANDS: ReadonlyArray<{ id: number; name: string; price: number }> = [
  { id: 7, name: "Fernando de Noronha", price: 500 },
  { id: 17, name: "Ilha do Mel", price: 500 },
  { id: 22, name: "Ilhabela", price: 500 }, // the Sorte near Porto Alegre
  { id: 33, name: "Ilha Grande", price: 500 },
];

// STALLS list relative prices (60..440); the real economy runs ~100x larger so
// values read like money (R$6,000..R$44,000) against a 100,000 starting bank.
const PRICE_SCALE = 100;

// square id of every island — the win check and the UI both read this
export const ISLAND_IDS: readonly number[] = ISLANDS.map((i) => i.id);

export function createDefaultBoard(rentFraction: number, rentFloor: number): Square[] {
  // both cities and islands are buyable lots, keyed by square id
  const lots = new Map<number, { name: string; price: number; group: string }>();
  for (const s of STALLS) lots.set(s.id, { name: s.name, price: s.price, group: s.group });
  for (const s of ISLANDS) lots.set(s.id, { name: s.name, price: s.price, group: ISLAND_GROUP });

  const board: Square[] = [];
  for (let i = 0; i < 40; i++) {
    const special = SPECIALS[i];
    if (special) {
      board.push(plain(i, special.name, special.type));
      continue;
    }
    const lot = lots.get(i)!;
    const price = lot.price * PRICE_SCALE;
    const baseRent = Math.max(rentFloor, Math.floor(price * rentFraction));
    board.push({ id: i, name: lot.name, type: "PROPERTY", property: { price, baseRent, group: lot.group } });
  }
  return board;
}
