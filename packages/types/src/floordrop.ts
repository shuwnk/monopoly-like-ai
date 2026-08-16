import type { PlayerLook } from "./look.js";

// Wire protocol for the real-time PvP "Floor Drop" minigame. The server owns the
// simulation and ticks it at ~20Hz; clients send only their movement input and
// render the snapshots the server broadcasts.

export const FD_GRID = 15;

// client -> server
export const FDClient = {
  input: "fd:input", // movement intent changed
  begin: "fd:begin", // host asks to start before the room is full
} as const;

// server -> client
export const FDServer = {
  lobby: "fd:lobby", // pre-game roster count
  start: "fd:start", // game starting: your id + the roster
  snap: "fd:snap", // per-tick world snapshot
  over: "fd:over", // match finished
} as const;

export interface FDInput {
  readonly dx: number; // -1 | 0 | 1
  readonly dy: number; // -1 | 0 | 1
}

export interface FDLobby {
  readonly joined: number;
  readonly capacity: number;
  readonly host: boolean;
}

export interface FDRosterEntry {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly bot: boolean;
  // what this fighter looks like. Server-assigned so every client renders the
  // same character for the same player (bots get one picked for them).
  readonly look: PlayerLook;
}

export interface FDStart {
  readonly you: number; // your fighter id
  readonly players: readonly FDRosterEntry[];
}

// one fighter in a snapshot: id + position + state (0 alive · 1 falling · 2 gone)
export interface FDPlayerSnap {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly s: 0 | 1 | 2;
}

export interface FDSnapshot {
  readonly tiles: string; // FD_GRID*FD_GRID chars, each '0' solid | '1' warning | '2' hole
  readonly players: readonly FDPlayerSnap[];
  readonly time: number; // seconds elapsed
  readonly alive: number;
}

export interface FDOver {
  readonly winner: string; // name, or "" if nobody
  readonly places: ReadonlyArray<readonly [number, number]>; // [fighterId, place]
}
