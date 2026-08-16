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
  PlayerLook,
} from "@party-monopoly/types";
import { create } from "zustand";
import { OnlineClient } from "../net/onlineClient.js";
import { myLook, useProfile } from "./profile.js";

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
  looks: Readonly<Record<string, PlayerLook>>; // every seated player's chosen avatar/colour/hat
  party: PartyInfo | null; // set while a party round is live (renders the FFA minigame)
  partyOver: FDOver | null; // final placements once the round ends
  partySnap: { current: FDSnapshot | null }; // stable ref, mutated per tick (non-reactive)

  createRoom: (durationSec: number, maxPlayers: number) => Promise<void>;
  joinRoom: (id: string) => Promise<void>;
  restoreSession: () => Promise<boolean>; // resume after a page reload; false if nothing to resume
  startGame: () => void;
  restartGame: () => void;
  sendAction: (type: ClientActionType, squareId?: number) => void;
  sendTap: (reactionMs: number | null, falseStart: boolean) => void;
  sendPartyInput: (dx: number, dy: number) => void;
  dismissShowdown: () => void;
  disconnect: () => void;
}

let client: OnlineClient | null = null;
// Safety net for the duel reveal. The duel view dismisses itself after a beat,
// but its timer dies with it — and OnlineGame unmounts the duel as soon as a
// party round starts. A reveal left standing hides every turn button, which
// stranded a player mid-game ("couldn't roll the dice on my turn"). The store
// therefore drops it on a timer of its own, which no view can cancel.
const REVEAL_MAX_MS = 4000;
// how long to keep retrying a dropped connection — the server holds a seat for
// 30s, so give up only once it really is gone
const RECONNECT_FOR_MS = 27000;
const RECONNECT_EVERY_MS = 2000;
let revealTimer: ReturnType<typeof setTimeout> | null = null;
function clearReveal(): void {
  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = null;
}
// set when the player leaves on purpose, so a real drop isn't confused for it
let leaving = false;

export const useOnlineStore = create<OnlineStore>((set, get) => {
  // stable snapshot ref: party snapshots (20Hz) are written here, not into reactive state,
  // so they don't re-render React — the party renderer reads .current each frame
  const partySnap: { current: FDSnapshot | null } = { current: null };

  function handlers() {
    return {
      onState: (state: GameState, you: PlayerId, endsAt?: number, looks?: Readonly<Record<string, PlayerLook>>) => {
        // the resolved state arrives right after showdown:result; keep the reveal
        // up (the duel view dismisses it after a beat) but otherwise clear it. A board
        // state also arrives when a party round resolves → clear the party view.
        if (state.phase === "GAME_OVER") OnlineClient.clearStoredSession(); // nothing to resume into
        const playing = get().status === "left" ? "left" : "playing";
        // Keep the duel signal alive while the board says the duel still is. A
        // bystander leaving mid-duel re-broadcasts state, and unconditionally
        // clearing here stripped the tap UI from both duellists — they timed out
        // and rent was charged flat with no reveal.
        const sig = get().showdown;
        const showdown = sig && (sig.phase === "result" || state.phase === "RENT_SHOWDOWN") ? sig : null;
        set({
          state,
          you,
          status: playing,
          showdown,
          lobby: null,
          party: null,
          partyOver: null,
          ...(looks ? { looks } : {}),
          ...(endsAt !== undefined ? { endsAt } : {}),
        });
      },
      onPartyStart: (msg: FDStart) => {
        partySnap.current = null;
        // a party round takes over the screen, so any duel reveal is over
        clearReveal();
        set({ party: { you: msg.you, roster: msg.players }, partyOver: null, showdown: null });
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
      onShowdownResult: (result: ShowdownResultMessage) => {
        set((s) => ({
          showdown: s.showdown ? { ...s.showdown, phase: "result", seq: s.showdown.seq + 1, result } : null,
        }));
        clearReveal();
        revealTimer = setTimeout(() => {
          revealTimer = null;
          if (get().showdown?.phase === "result") set({ showdown: null });
        }, REVEAL_MAX_MS);
      },
      onError: (message: string) => set({ error: message, status: "error" }),
      onLeave: () => {
        if (leaving || !client) return;
        if (!client.canReconnect) {
          set({ status: "left" });
          return;
        }
        set({ status: "reconnecting" });
        // Keep trying for as long as the server holds the seat. One immediate
        // attempt fails while the network is still down, so a brief wifi blip
        // used to read as "you're out" even though the seat was still there.
        const started = Date.now();
        const attempt = (): void => {
          if (leaving || !client) return;
          client.reconnect(handlers()).catch(() => {
            if (Date.now() - started > RECONNECT_FOR_MS) {
              set({ status: "left" });
              return;
            }
            setTimeout(attempt, RECONNECT_EVERY_MS);
          });
        };
        attempt();
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
    looks: {},
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
    restartGame: () => client?.sendRestart(),

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
      clearReveal();
      client?.leave();
      client = null;
      partySnap.current = null;
      set({ status: "idle", roomId: null, state: null, you: null, error: null, showdown: null, endsAt: null, looks: {}, lobby: null, party: null, partyOver: null });
    },
  };
});

function errText(e: unknown): string {
  return e instanceof Error ? e.message : "connection failed";
}

// the identity we introduce ourselves with: the persisted profile name + look
function me(): { name: string; look: ReturnType<typeof myLook> } {
  return { name: useProfile.getState().name.trim(), look: myLook() };
}
