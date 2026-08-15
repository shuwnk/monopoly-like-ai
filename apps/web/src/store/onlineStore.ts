import type { GameState } from "@party-monopoly/engine";
import type {
  ClientActionType,
  FDOver,
  FDRosterEntry,
  FDSnapshot,
  FDStart,
  LobbyMessage,
  PlayerId,
  ShowdownResultMessage,
  ShowdownStartMessage,
} from "@party-monopoly/types";
import { create } from "zustand";
import { OnlineClient } from "../net/onlineClient.js";
import { useProfile } from "./profile.js";

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
  // the two duellists; every other player at the table only watches
  payerId: PlayerId;
  ownerId: PlayerId;
  // present only in the "result" phase: both reaction times + the outcome
  result?: ShowdownResultMessage;
}

// an active party round: your fighter id + the roster. Snapshots stream at 20Hz into
// `partySnap.current` (a stable ref, NOT reactive — the renderer reads it each frame).
export interface PartyInfo {
  you: number;
  roster: readonly FDRosterEntry[];
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
  party: PartyInfo | null; // set while a party round is live (renders the FFA minigame)
  partyOver: FDOver | null; // final placements once the round ends
  partySnap: { current: FDSnapshot | null }; // stable ref, mutated per tick (non-reactive)

  createRoom: (durationSec: number, maxPlayers: number) => Promise<void>;
  joinRoom: (id: string) => Promise<void>;
  restoreSession: () => Promise<boolean>; // resume after a page reload; false if nothing to resume
  startGame: () => void;
  sendAction: (type: ClientActionType, squareId?: number) => void;
  sendTap: (reactionMs: number | null, falseStart: boolean) => void;
  sendPartyInput: (dx: number, dy: number) => void;
  dismissShowdown: () => void;
  disconnect: () => void;
}

let client: OnlineClient | null = null;
// set when the player leaves on purpose, so a real drop isn't confused for it
let leaving = false;

export const useOnlineStore = create<OnlineStore>((set, get) => {
  // stable snapshot ref: party snapshots (20Hz) are written here, not into reactive state,
  // so they don't re-render React — the party renderer reads .current each frame
  const partySnap: { current: FDSnapshot | null } = { current: null };

  function handlers() {
    return {
      onState: (state: GameState, you: PlayerId, endsAt?: number) => {
        // the resolved state arrives right after showdown:result; keep the reveal
        // up (the duel view dismisses it after a beat) but otherwise clear it. A board
        // state also arrives when a party round resolves → clear the party view.
        if (state.phase === "GAME_OVER") OnlineClient.clearStoredSession(); // nothing to resume into
        const playing = get().status === "left" ? "left" : "playing";
        const showdown = get().showdown?.phase === "result" ? get().showdown : null;
        set({ state, you, status: playing, showdown, lobby: null, party: null, partyOver: null, ...(endsAt !== undefined ? { endsAt } : {}) });
      },
      onPartyStart: (msg: FDStart) => {
        partySnap.current = null;
        set({ party: { you: msg.you, roster: msg.players }, partyOver: null });
      },
      onPartySnap: (snap: FDSnapshot) => {
        partySnap.current = snap; // non-reactive: read by the renderer's rAF loop
      },
      onPartyOver: (over: FDOver) => set({ partyOver: over }),
      onLobby: (lobby: LobbyMessage) => set({ lobby, status: "waiting" }),
      onShowdownStart: (m: ShowdownStartMessage) =>
        set((s) => ({
          showdown: {
            phase: "start",
            baseRent: m.baseRent,
            payerId: m.payerId,
            ownerId: m.ownerId,
            seq: (s.showdown?.seq ?? 0) + 1,
            id: (s.showdown?.id ?? 0) + 1,
          },
        })),
      onShowdownGo: () => set((s) => ({ showdown: s.showdown ? { ...s.showdown, phase: "go", seq: s.showdown.seq + 1 } : null })),
      onShowdownResult: (result: ShowdownResultMessage) =>
        set((s) => ({
          showdown: s.showdown ? { ...s.showdown, phase: "result", seq: s.showdown.seq + 1, result } : null,
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
    party: null,
    partyOver: null,
    partySnap,

    createRoom: async (durationSec: number, maxPlayers: number) => {
      leaving = false;
      set({ status: "connecting", error: null, endsAt: null, lobby: null });
      client = new OnlineClient();
      try {
        const roomId = await client.create(handlers(), durationSec, maxPlayers, me());
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
        await client.join(id, handlers(), me());
        set({ roomId: id, status: "waiting" });
      } catch (e) {
        set({ status: "error", error: errText(e) });
      }
    },

    restoreSession: async () => {
      if (!OnlineClient.hasStoredSession()) return false;
      leaving = false;
      set({ status: "connecting", error: null });
      client = new OnlineClient();
      try {
        await client.restore(handlers()); // onState will flip status to "playing"
        return true;
      } catch {
        OnlineClient.clearStoredSession(); // stale/expired token — give up cleanly
        client = null;
        set({ status: "idle" });
        return false;
      }
    },

    sendAction: (type, squareId) => client?.sendAction(type, squareId),
    sendTap: (reactionMs, falseStart) => client?.sendTap(reactionMs, falseStart),
    sendPartyInput: (dx, dy) => client?.sendPartyInput(dx, dy),
    dismissShowdown: () => set({ showdown: null }),

    disconnect: () => {
      leaving = true;
      client?.leave();
      client = null;
      partySnap.current = null;
      set({ status: "idle", roomId: null, state: null, you: null, error: null, showdown: null, endsAt: null, lobby: null, party: null, partyOver: null });
    },
  };
});

function errText(e: unknown): string {
  return e instanceof Error ? e.message : "connection failed";
}

// the identity we introduce ourselves with: the persisted profile name + mascot
function me(): { name: string; avatar: string } {
  const p = useProfile.getState();
  return { name: p.name.trim(), avatar: p.avatar };
}
