import type { MinigameId, MinigameRequest, MinigameResult } from "@party-monopoly/types";
import type { Minigame } from "./minigame.js";

// Maps a MinigameId to its implementation. The host looks up the id from a
// request and runs it; this is the seam where hotseat/AI/online swap in.
export class MinigameRegistry {
  private readonly games = new Map<MinigameId, Minigame>();

  register(game: Minigame): void {
    if (this.games.has(game.id)) {
      throw new Error(`Minigame already registered: ${game.id}`);
    }
    this.games.set(game.id, game);
  }

  get(id: MinigameId): Minigame | undefined {
    return this.games.get(id);
  }

  // resolve a request end-to-end, or throw if the id is unknown
  async run(request: MinigameRequest): Promise<MinigameResult> {
    const game = this.games.get(request.minigameId);
    if (!game) throw new Error(`No minigame registered for id: ${request.minigameId}`);
    return game.play(request);
  }
}
