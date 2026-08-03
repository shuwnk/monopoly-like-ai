import type { MinigameRequest, MinigameResult, PlayerId } from "@party-monopoly/types";
import { buildPartySeats } from "../game/partyRound.js";
import { FloorDropPractice } from "./FloorDropPractice.js";
import { BombermanPractice } from "./BombermanPractice.js";
import { BarnBrawlPractice } from "./BarnBrawlPractice.js";

// Hosts a board party round: picks the game the engine chose, seats the board players
// (the keyboard human first), and hands the finishing ranking back to the engine, which
// pays out by placement. Leaving mid-round submits an ABORTED result so the board resumes.
export function PartyRound({
  request,
  onResult,
  nameOf,
}: {
  request: MinigameRequest;
  onResult: (result: MinigameResult) => void;
  nameOf: (id: PlayerId) => string;
}): JSX.Element {
  const seats = buildPartySeats(request, nameOf);
  const party = { minigameId: request.minigameId, seats, onResult };
  const abort = (): void => onResult({ minigameId: request.minigameId, status: "ABORTED", outcome: "DRAW", ranking: [] });
  const common = { onLeave: abort, party };
  const game = request.context.party?.game ?? "floordrop";

  return (
    <div>
      <div style={{ textAlign: "center", padding: "10px 16px 0", fontWeight: 800, letterSpacing: 1, color: "var(--accent)" }}>
        🎉 PARTY ROUND — finish high to win R$ (1st takes the biggest cut, last gets nothing)
      </div>
      {game === "bomberman" ? (
        <BombermanPractice {...common} />
      ) : game === "barnbrawl" ? (
        <BarnBrawlPractice {...common} />
      ) : (
        <FloorDropPractice {...common} />
      )}
    </div>
  );
}
