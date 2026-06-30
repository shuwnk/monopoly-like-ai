import type { GameState } from "@party-monopoly/engine";
import type { ClientActionType, PlayerId } from "@party-monopoly/types";
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
// re-mount or effect can tell "go" apart from a stale "start".
export interface ShowdownSignal {
  phase: "start" | "go";
  baseRent: number;
  seq: number;
}

interface OnlineStore {
  status: ConnStatus;
  roomId: string | null;
  state: GameState | null;
  you: PlayerId | null;
  error: string | null;
  showdown: ShowdownSignal | null;

  createRoom: () => Promise<void>;
  joinRoom: (id: string) => Promise<void>;
  sendAction: (type: ClientActionType) => void;
  sendTap: (reactionMs: number | null, falseStart: boolean) => void;
  disconnect: () => void;
}

let client: OnlineClient | null = null;
// set when the player leaves on purpose, so a real drop isn't confused for it
let leaving = false;

export const useOnlineStore = create<OnlineStore>((set, get) => {
  function handlers() {
    return {
      onState: (state: GameState, you: PlayerId) => {
        // a fresh snapshot always ends any showdown locally; the server resolved it
        const playing = get().status === "left" ? "left" : "playing";
        set({ state, you, status: playing, showdown: null });
      },
      onShowdownStart: (baseRent: number) =>
        set((s) => ({ showdown: { phase: "start", baseRent, seq: (s.showdown?.seq ?? 0) + 1 } })),
      onShowdownGo: () =>
        set((s) => ({
          showdown: { phase: "go", baseRent: s.showdown?.baseRent ?? 0, seq: (s.showdown?.seq ?? 0) + 1 },
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

    createRoom: async () => {
      leaving = false;
      set({ status: "connecting", error: null });
      client = new OnlineClient();
      try {
        const roomId = await client.create(handlers());
        set({ roomId, status: "waiting" });
      } catch (e) {
        set({ status: "error", error: errText(e) });
      }
    },

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

    sendAction: (type) => client?.sendAction(type),
    sendTap: (reactionMs, falseStart) => client?.sendTap(reactionMs, falseStart),

    disconnect: () => {
      leaving = true;
      client?.leave();
      client = null;
      set({ status: "idle", roomId: null, state: null, you: null, error: null, showdown: null });
    },
  };
});

function errText(e: unknown): string {
  return e instanceof Error ? e.message : "connection failed";
}
