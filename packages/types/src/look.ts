// How a player wants to be seen. Purely cosmetic — nothing here reaches the
// engine, which stays deterministic and rendering-agnostic; the server just
// carries each player's choice so EVERY client draws them the same way.
//
// Without this each client was picking avatars for the other players out of its
// own local profile, so two people in the same match saw different characters.
export interface PlayerLook {
  /** mascot id ("blaze", "tusk", …) */
  readonly av: string;
  /** body colour override as #rrggbb; empty means the mascot's own colour */
  readonly color: string;
  /** accessory id ("cap", "helmet", …); empty means bare-headed. Cosmetic only —
   *  a helmet never stops a bullet. */
  readonly hat: string;
}

export const EMPTY_LOOK: PlayerLook = { av: "blaze", color: "", hat: "" };

// Trust nothing off the wire: keep the shape, cap the lengths, and only accept a
// colour that really is a hex triplet (it gets fed straight to a renderer).
export function sanitizeLook(raw: unknown): PlayerLook {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof PlayerLook, unknown>>;
  const id = (v: unknown): string => (typeof v === "string" ? v.slice(0, 24).replace(/[^a-z0-9_-]/gi, "") : "");
  const color = typeof o.color === "string" && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "";
  return { av: id(o.av) || EMPTY_LOOK.av, color, hat: id(o.hat) };
}
