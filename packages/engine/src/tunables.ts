import type { MinigameOutcome } from "@party-monopoly/types";

// Balance knobs, kept as a typed config rather than scattered through the
// reducer. Defaults get stamped into GameState at init, so balance is part of a
// game's serialized, replayable state.

export interface RentMultiplierTable {
  readonly ownerWin: number;
  // the landing player (the one who'd pay) wins
  readonly payerWin: number;
  readonly draw: number;
  // minigame aborted; flat-rent fallback
  readonly aborted: number;
}

export interface JailTunables {
  readonly jailSquareId: number;
  readonly fine: number;
  readonly maxTurns: number;
  readonly releaseOnDoubles: boolean;
}

export type TiebreakMetric = "NET_WORTH" | "CASH";

export interface GameTunables {
  readonly startingMoney: number;
  readonly passGoSalary: number;
  readonly taxAmount: number;
  readonly boardSize: number;
  readonly diceCount: number;
  readonly diceSides: number;
  readonly jail: JailTunables;
  // indexed from the owner's perspective; the rent resolver maps a raw P0/P1
  // outcome to owner/payer since it knows which participant is the owner
  readonly rentMultipliers: RentMultiplierTable;
  // baseRent = max(rentFloor, floor(price * rentFraction))
  readonly rentFraction: number;
  readonly rentFloor: number;
  // rent scales with how many properties the owner holds, standing in for the
  // missing houses/hotels: factor = min(rentEscalationCap, 1 + step*(owned-1)),
  // so a lone property never escalates. step 0 disables it (factor stays 1).
  readonly rentEscalationStep: number;
  readonly rentEscalationCap: number;
  // force the game to end after this many rounds (laps); 0 disables the cap
  readonly roundCap: number;
  readonly tiebreakMetric: TiebreakMetric;
}

export const DEFAULT_TUNABLES: GameTunables = {
  // houses are cut, so rent does the heavy lifting: bigger flat rent (20% of
  // price) plus a low GO salary keeps wealth from only ever rising, and the
  // round cap guarantees a finish. escalation is held for a playtest pass.
  startingMoney: 1200,
  passGoSalary: 75,
  taxAmount: 120,
  boardSize: 40,
  diceCount: 2,
  diceSides: 6,
  jail: {
    jailSquareId: 10,
    fine: 50,
    maxTurns: 3,
    releaseOnDoubles: true,
  },
  rentMultipliers: {
    ownerWin: 1.5,
    payerWin: 0.5,
    draw: 1.0,
    aborted: 1.0,
  },
  rentFraction: 0.2,
  rentFloor: 8,
  // escalation off by default; left for a playtest pass to decide its value
  rentEscalationStep: 0,
  rentEscalationCap: 4,
  roundCap: 30,
  tiebreakMetric: "NET_WORTH",
};

// rent multiplier from the owner's holdings: 1 property is flat, each extra
// adds `step`, capped at `cap`. step <= 0 leaves rent unescalated.
export function rentEscalationFactor(ownedCount: number, step: number, cap: number): number {
  if (step <= 0 || ownedCount <= 1) return 1;
  return Math.min(cap, 1 + step * (ownedCount - 1));
}

// the minigame says who won; this decides what that win is worth
export function resolveRentMultiplier(
  outcome: MinigameOutcome,
  ownerParticipantIndex: 0 | 1,
  table: RentMultiplierTable,
): number {
  if (outcome === "DRAW") return table.draw;
  const ownerWon =
    (outcome === "P0_WIN" && ownerParticipantIndex === 0) ||
    (outcome === "P1_WIN" && ownerParticipantIndex === 1);
  return ownerWon ? table.ownerWin : table.payerWin;
}
