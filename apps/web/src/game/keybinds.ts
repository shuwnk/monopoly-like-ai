import { msg } from "../i18n/index.js";

// Player-remappable controls, shared by every minigame so one rebind applies
// everywhere. Keys are stored the way the games already read them:
// `e.key.toLowerCase()` — so "ArrowUp" is "arrowup" and Space is " ".

export type BindAction = "up" | "down" | "left" | "right" | "action";
export const BIND_ACTIONS: BindAction[] = ["up", "down", "left", "right", "action"];

// wrapped in msg() so the extractor finds them; the Controls screen calls t() on
// the value it reads out of here
export const BIND_LABELS: Record<BindAction, string> = {
  up: msg("Move up"),
  down: msg("Move down"),
  left: msg("Move left"),
  right: msg("Move right"),
  action: msg("Jump / place bomb"),
};

// Two bindings per action by default so WASD and the arrow keys both work out of
// the box; a player rebinding one doesn't lose the other.
export const DEFAULT_BINDS: Record<BindAction, string[]> = {
  up: ["w", "arrowup"],
  down: ["s", "arrowdown"],
  left: ["a", "arrowleft"],
  right: ["d", "arrowright"],
  action: [" "],
};

export type Binds = Record<BindAction, string[]>;

// Stored bindings are merged over the defaults, so a profile saved before a new
// action existed still gets a working key for it.
export function resolveBinds(saved: Partial<Record<string, string[]>> | undefined): Binds {
  const out = {} as Binds;
  for (const a of BIND_ACTIONS) {
    const v = saved?.[a];
    out[a] = Array.isArray(v) && v.length ? v.filter((k) => typeof k === "string") : DEFAULT_BINDS[a];
  }
  return out;
}

// The bindings currently in force. Kept here rather than passed down through
// every game so a call site reads exactly like the hardcoded version it replaced,
// and so a rebind takes effect immediately without remounting anything. The
// profile store owns the value and pushes it in.
let active: Binds = { ...DEFAULT_BINDS };
export function setActiveBinds(b: Binds): void {
  active = b;
}
export function activeBinds(): Binds {
  return active;
}

/** is this key (already lowercased) bound to the action? */
export function bound(action: BindAction, key: string): boolean {
  return active[action].includes(key);
}

/** does this key drive anything? used to preventDefault only on keys we consume */
export function isGameKey(key: string): boolean {
  return BIND_ACTIONS.some((a) => active[a].includes(key));
}

/** the -1/0/1 movement vector for a set of currently-held keys */
export function moveVector(held: Set<string>): { dx: number; dy: number } {
  const on = (a: BindAction): number => (active[a].some((k) => held.has(k)) ? 1 : 0);
  return { dx: on("right") - on("left"), dy: on("down") - on("up") };
}

/** how a key reads on screen: "arrowup" → "↑", " " → "Space" */
export function keyLabel(key: string): string {
  const map: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    " ": "Space",
    escape: "Esc",
    enter: "Enter",
    shift: "Shift",
    control: "Ctrl",
    alt: "Alt",
    tab: "Tab",
  };
  return map[key] ?? key.toUpperCase();
}

/** one-line summary of the movement keys, for on-screen hints */
export function moveHint(binds: Binds): string {
  const first = (a: BindAction): string => keyLabel(binds[a][0] ?? "");
  return `${first("up")}${first("left")}${first("down")}${first("right")}`;
}
