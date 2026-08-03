import { Room, type Client } from "colyseus";
import { FDClient, FDServer, type FDInput, type FDLobby, type FDOver, type FDStart } from "@party-monopoly/types";
import { FloorDropSim } from "./FloorDropSim.js";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const BOT_FILL_TARGET = 4; // fill with bots up to this many fighters if humans are few
const TICK_MS = 50; // 20 Hz authoritative simulation

// Real-time PvP Floor Drop room. The server owns the simulation; clients send
// movement input and render the snapshots broadcast each tick.
export class FloorDropRoom extends Room {
  private seats = new Map<string, number>(); // sessionId -> fighter id
  private sim: FloorDropSim | null = null;
  private started = false;
  private ended = false;

  override onCreate(options: { maxPlayers?: number } | undefined): void {
    const p = Number(options?.maxPlayers);
    this.maxClients = Number.isFinite(p) ? Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(p))) : BOT_FILL_TARGET;
    this.onMessage(FDClient.input, (client, msg: FDInput) => {
      const id = this.seats.get(client.sessionId);
      if (id !== undefined) this.sim?.setInput(id, msg.dx, msg.dy);
    });
    this.onMessage(FDClient.begin, (client) => {
      if (!this.started && this.seats.get(client.sessionId) === 0 && this.seats.size >= 1) this.startGame();
    });
  }

  override onJoin(client: Client): void {
    const seat = this.nextSeat();
    if (this.started || seat === null) {
      client.leave();
      return;
    }
    this.seats.set(client.sessionId, seat);
    if (this.seats.size >= this.maxClients) this.startGame();
    else this.broadcastLobby();
  }

  override onLeave(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    if (seat === undefined) return;
    if (!this.started) {
      this.seats.delete(client.sessionId);
      if (this.seats.size === 0) this.disconnect();
      else this.broadcastLobby();
      return;
    }
    // mid-game: hand the fighter to the AI so the arena stays full
    this.sim?.makeBot(seat);
  }

  private nextSeat(): number | null {
    const used = new Set(this.seats.values());
    for (let i = 0; i < this.maxClients; i++) if (!used.has(i)) return i;
    return null;
  }

  private broadcastLobby(): void {
    for (const c of this.clients) {
      const seat = this.seats.get(c.sessionId);
      if (seat !== undefined) c.send(FDServer.lobby, { joined: this.seats.size, capacity: this.maxClients, host: seat === 0 } satisfies FDLobby);
    }
  }

  private startGame(): void {
    if (this.started) return;
    this.started = true;
    void this.lock();

    // re-index seats to a contiguous 0..N-1 in join order
    const ordered = [...this.seats.entries()].sort((a, b) => a[1] - b[1]);
    this.seats.clear();
    const humans = ordered.map(([sid], i) => {
      this.seats.set(sid, i);
      return { id: i, name: `Player ${i + 1}` };
    });

    this.sim = new FloorDropSim(humans, BOT_FILL_TARGET);
    const roster = this.sim.fighters.map((f) => ({ id: f.id, name: f.name, color: f.color, bot: f.isBot }));
    for (const c of this.clients) {
      const you = this.seats.get(c.sessionId);
      if (you !== undefined) c.send(FDServer.start, { you, players: roster } satisfies FDStart);
    }

    this.setSimulationInterval((dtMs) => this.tick(dtMs), TICK_MS);
  }

  private tick(dtMs: number): void {
    if (!this.sim || this.ended) return;
    this.sim.update(Math.min(0.05, dtMs / 1000));
    this.broadcast(FDServer.snap, this.sim.snapshot());
    if (this.sim.over) {
      this.ended = true;
      this.broadcast(FDServer.over, {
        winner: this.sim.winner?.name ?? "",
        places: this.sim.fighters.map((f) => [f.id, f.place === 0 ? 1 : f.place] as const),
      } satisfies FDOver);
    }
  }
}
