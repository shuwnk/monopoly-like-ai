import type { MinigameId, MinigameRequest, MinigameResult } from "@party-monopoly/types";

// A renderer-agnostic match runner. The engine hands it a request and awaits a
// result; how it runs (DOM, AI sim, network) is the implementation's business.
// No DOM/React imports here so the contract can be shared with the server.
export interface Minigame {
  readonly id: MinigameId;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  // must always resolve; use status "ABORTED" on failure
  play(request: MinigameRequest): Promise<MinigameResult>;
}
