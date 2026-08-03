import type { MinigameId, MinigameRequest, MinigameResult, PlayerId } from "@party-monopoly/types";

// Shared glue for running a party minigame as a board round. A practice game opts into
// "party mode" by accepting a PartyProps; when absent it behaves exactly as the standalone
// menu game (so the menu path can never regress).

export interface PartySeat {
  readonly id: PlayerId;
  readonly name: string;
  // exactly one seat is the keyboard human (seat 0); the rest are bots standing in for the
  // other board players (one-keyboard limit, same as the rent duel's always-bot owner)
  readonly isHuman: boolean;
}

export interface PartyProps {
  readonly minigameId: MinigameId;
  // fighter index -> board seat; seats[0] is the human, the rest are bots
  readonly seats: readonly PartySeat[];
  readonly onResult: (result: MinigameResult) => void;
}

// Build the seats a party game should spawn: the keyboard human first (so they control
// fighter 0), then the other seated board players as bots. names come from the board.
export function buildPartySeats(request: MinigameRequest, nameOf: (id: PlayerId) => string): PartySeat[] {
  const parts = request.participants;
  const humanIdx = Math.max(0, parts.findIndex((p) => !p.isAI)); // first human, or seat 0 if all AI
  const human = parts[humanIdx]!;
  const rest = parts.filter((_, i) => i !== humanIdx);
  return [
    { id: human.playerId, name: nameOf(human.playerId), isHuman: true },
    ...rest.map((p) => ({ id: p.playerId, name: nameOf(p.playerId), isHuman: false })),
  ];
}

// Turn per-fighter finishing places (1 = winner, fighter i ↔ seats[i]) into the engine's
// best-to-worst ranking. Unfinished fighters sort last.
export function partyResult(minigameId: MinigameId, seats: readonly PartySeat[], places: readonly number[]): MinigameResult {
  const ranking = seats
    .map((s, i) => ({ id: s.id, place: places[i] || Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.place - b.place)
    .map((r) => r.id);
  return { minigameId, status: "COMPLETED", outcome: "P0_WIN", ranking };
}
