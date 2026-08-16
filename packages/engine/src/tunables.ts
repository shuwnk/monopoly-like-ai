import type { MinigameOutcome, PartyGame } from "@party-monopoly/types";

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
  // houses & hotels: building on a stall raises its rent. a stall's level runs
  // 0 (bare) .. maxBuildLevel (hotel); houseRentMultipliers is the rent factor
  // per level (index 0..maxBuildLevel) and must have maxBuildLevel+1 entries.
  // build cost per level = round(price * buildCostFraction). building requires
  // owning the whole district when requireMonopolyToBuild is set.
  readonly maxBuildLevel: number;
  readonly houseRentMultipliers: readonly number[];
  readonly buildCostFraction: number;
  readonly requireMonopolyToBuild: boolean;
  // selling a property/house returns this fraction of what was paid (1 = full)
  readonly sellFraction: number;
  // Copa (World Cup): landing lets you multiply one of your properties' rent by this
  readonly worldCupMultiplier: number;
  // first player to reach this net worth wins instantly; 0 disables the goal
  readonly netWorthGoal: number;
  // force the game to end after this many rounds (laps); 0 disables the cap. In
  // real play the host's countdown timer ends the game; the cap is a deterministic
  // backstop (and the length the sim measures).
  readonly roundCap: number;
  readonly tiebreakMetric: TiebreakMetric;
  // party rounds: every N completed laps, all solvent players play an FFA minigame and
  // are paid by placement (a skill-based comeback lever). 0 disables party rounds.
  readonly partyRoundEveryLaps: number;
  // bank-funded prize for finishing 1st; each lower place gets a linear share, last gets 0
  readonly partyRoundTopPrize: number;
  // which games a party round may pick from — the host declares what it can actually run
  // (hotseat runs all three; the server can only sim floordrop). Empty falls back to all.
  readonly partyGames: readonly PartyGame[];
}

export const DEFAULT_TUNABLES: GameTunables = {
  // houses (graduated gate below) are the rent-scaling engine; base rent is 20%
  // of price, and the round cap guarantees a finish. tuned "gentle": ~30% of
  // games end by knockout, the rest on net worth at the cap (sim, 4p).
  startingMoney: 100000,
  passGoSalary: 15000,
  taxAmount: 12000,
  boardSize: 40,
  diceCount: 2,
  diceSides: 6,
  jail: {
    jailSquareId: 10,
    fine: 5000,
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
  rentFloor: 800,
  // 1-3 houses then a hotel; rent factor climbs 1x -> 5.5x
  maxBuildLevel: 4,
  houseRentMultipliers: [1, 2, 3, 4, 5.5],
  // a house costs half the stall price. Building only happens when you land on a
  // stall you own (one level per landing), so builds are naturally scarce; a
  // lower cost keeps each one worth taking. Gentle: ~19% of games end by knockout,
  // the rest on net worth at the cap (sim, 4p). Raise it to make building rarer.
  buildCostFraction: 0.5,
  // graduated gate (false): build one level per stall owned in a district, and
  // completing it unlocks the hotel. A hard monopoly gate (true) never opened —
  // districts of 3-6 stalls almost never complete without trading — so building
  // sat unused. Graduated makes every buy also a build decision.
  requireMonopolyToBuild: false,
  sellFraction: 1.0, // full price back on a sale
  worldCupMultiplier: 2,
  // Reach this net worth to win outright; 0 disables the wealth win.
  // Raised 160k → 190k when the GO salary doubled to 15k. The salary is the only
  // large faucet and nothing else scales with it, so leaving the goal alone made
  // games 29% shorter and — the part that matters for a party game — cut rent
  // showdowns by 36% and builds by 30%, because neither has time to happen.
  // 190k restores the original pacing exactly (sim, 250 games, 4p):
  //   7.5k salary / 160k goal → median 62 turns, 25.2 showdowns, 3.7 builds
  //    15k salary / 190k goal → median 62 turns, 27.4 showdowns, 4.8 builds
  // Same length, slightly MORE of the fun, and players feel richer throughout.
  netWorthGoal: 190000,
  roundCap: 30,
  tiebreakMetric: "NET_WORTH",
  // a party round every 2 laps; 1st place earns ~1/3 of a lap salary, scaling down to nothing
  // for last. Skill lets a trailing player claw back cash the wealth race won't give them.
  // NOTE: bank-funded payouts inject cash, which speeds net-worth wins. Sim (60 games, 4p):
  // party-off = 45 GOAL/15 CAP @24 rounds; this (2500) = 58/2 @21 rounds. Higher prizes
  // compress harder (5000 → 60/0 @17). Tune the prize to taste against the elim/points split.
  partyRoundEveryLaps: 2,
  partyRoundTopPrize: 2500,
  partyGames: ["floordrop", "bomberman", "barnbrawl"], // hotseat can run all three
};

// rent factor from a stall's build level, clamped into the multiplier table
export function houseRentFactor(level: number, multipliers: readonly number[], maxLevel: number): number {
  const l = Math.min(Math.max(level, 0), maxLevel);
  return multipliers[l] ?? 1;
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
