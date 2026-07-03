import type { GameState } from "@party-monopoly/engine";
import type { ClientActionType, LobbyMessage, PlayerId, ShowdownResultMessage } from "@party-monopoly/types";
import { create } from "zustand";
import { OnlineClient } from "../net/onlineClient.js";

export type ConnStatus =
  | "idle"
  | "connecting"
  | "waiting" // in a room, opponent not here yet
  | "playing"
  | "reconnecting" // dropped, trying to rejoin within the server's window
  | "error"
  | "left"; // opponent left / disconnected

// one showdown signal the duel view reacts to. seq bumps each phase change so a
// re-mount or effect can tell "go" apart from a stale "start"; id stays constant
// across a single showdown's phases so the view isn't remounted mid-duel.
export interface ShowdownSignal {
  phase: "start" | "go" | "result";
  baseRent: number;
  seq: number;
  id: number;
  // present only in the "result" phase: both reaction times + the outcome
  result?: ShowdownResultMessage;
}

interface OnlineStore {
  status: ConnStatus;
  roomId: string | null;
  state: GameState | null;
  you: PlayerId | null;
  error: string | null;
  showdown: ShowdownSignal | null;
  endsAt: number | null; // epoch ms the countdown hits zero
  lobby: LobbyMessage | null; // pre-game: who's joined and whether you host

  createRoom: (durationSec: number, maxPlayers: number) => Promise<void>;
  joinRoom: (id: string) => Promise<void>;
  startGame: () => void;
  sendAction: (type: ClientActionType, squareId?: number) => void;
  sendTap: (reactionMs: number | null, falseStart: boolean) => void;
  dismissShowdown: () => void;
  disconnect: () => void;
}

let client: OnlineClient | null = null;
// set when the player leaves on purpose, so a real drop isn't confused for it
let leaving = false;

export const useOnlineStore = create<OnlineStore>((set, get) => {
  function handlers() {
    return {
      onState: (state: GameState, you: PlayerId, endsAt?: number) => {
        // the resolved state arrives right after showdown:result; keep the reveal
        // up (the duel view dismisses it after a beat) but otherwise clear it
        const playing = get().status === "left" ? "left" : "playing";
        const showdown = get().showdown?.phase === "result" ? get().showdown : null;
        set({ state, you, status: playing, showdown, lobby: null, ...(endsAt !== undefined ? { endsAt } : {}) });
      },
      onLobby: (lobby: LobbyMessage) => set({ lobby, status: "waiting" }),
      onShowdownStart: (baseRent: number) =>
        set((s) => ({ showdown: { phase: "start", baseRent, seq: (s.showdown?.seq ?? 0) + 1, id: (s.showdown?.id ?? 0) + 1 } })),
      onShowdownGo: () =>
        set((s) => ({
          showdown: { phase: "go", baseRent: s.showdown?.baseRent ?? 0, seq: (s.showdown?.seq ?? 0) + 1, id: s.showdown?.id ?? 0 },
        })),
      onShowdownResult: (result: ShowdownResultMessage) =>
        set((s) => ({
          showdown: { phase: "result", baseRent: s.showdown?.baseRent ?? 0, seq: (s.showdown?.seq ?? 0) + 1, id: s.showdown?.id ?? 0, result },
        })),
      onError: (message: string) => set({ error: message, status: "error" }),
      onLeave: () => {
        if (leaving || !client) return;
        if (!client.canReconnect) {
          set({ status: "left" });
          return;
        }
        set({ status: "reconnecting" });
        client.reconnect(handlers()).catch(() => set({ status: "left" }));
      },
    };
  }

  return {
    status: "idle",
    roomId: null,
    state: null,
    you: null,
    error: null,
    showdown: null,
    endsAt: null,
    lobby: null,

    createRoom: async (durationSec: number, maxPlayers: number) => {
      leaving = false;
      set({ status: "connecting", error: null, endsAt: null, lobby: null });
      client = new OnlineClient();
      try {
        const roomId = await client.create(handlers(), durationSec, maxPlayers);
        set({ roomId, status: "waiting" });
      } catch (e) {
        set({ status: "error", error: errText(e) });
      }
    },

    startGame: () => client?.sendStart(),

    joinRoom: async (id) => {
      leaving = false;
      set({ status: "connecting", error: null });
      client = new OnlineClient();
      try {
        await client.join(id, handlers());
        set({ roomId: id, status: "waiting" });
      } catch (e) {
        set({ status: "error", error: errText(e) });
      }
    },

    sendAction: (type, squareId) => client?.sendAction(type, squareId),
    sendTap: (reactionMs, falseStart) => client?.sendTap(reactionMs, falseStart),
    dismissShowdown: () => set({ showdown: null }),

    disconnect: () => {
      leaving = true;
      client?.leave();
      client = null;
      set({ status: "idle", roomId: null, state: null, you: null, error: null, showdown: null, endsAt: null, lobby: null });
    },
  };
});

function errText(e: unknown): string {
  return e instanceof Error ? e.message : "connection failed";
}
