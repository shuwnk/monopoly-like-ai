import { create } from "zustand";

// Persistent minigame profile: coins earned from playing, unlocked items, and the
// equipped loadout. Saved to localStorage so it sticks between sessions.

export interface ShopItem {
  id: string;
  kind: "weapon" | "brawler";
  key: string; // the in-game key (WeaponKey / brawler Kind)
  name: string;
  cost: number;
  desc: string;
}

export const SHOP: ShopItem[] = [
  { id: "w-pistol", kind: "weapon", key: "pistol", name: "Pistol", cost: 0, desc: "Balanced 3-shot sidearm" },
  { id: "w-bat", kind: "weapon", key: "bat", name: "Baseball Bat", cost: 150, desc: "Melee — huge close-range hit" },
  { id: "w-sniper", kind: "weapon", key: "sniper", name: "Sniper Rifle", cost: 250, desc: "One-shot kill, slow, precise" },
  { id: "b-blaster", kind: "brawler", key: "blaster", name: "Blaster", cost: 0, desc: "Balanced brawler, medium range" },
  { id: "b-shotgun", kind: "brawler", key: "shotgun", name: "Bruiser", cost: 250, desc: "Short-range shotgun spread, tanky" },
  { id: "b-sniper", kind: "brawler", key: "sniper", name: "Marksman", cost: 300, desc: "Long range, high damage, fragile" },
];

const KEY = "pm-profile-v1";
const STARTER = ["w-pistol", "b-blaster"];

interface Saved {
  coins: number;
  owned: string[];
  weapon: string;
  brawler: string;
  avatar: string;
  name: string; // display name for online play; "" until the player types one
}
function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Saved>;
      return {
        coins: typeof p.coins === "number" ? p.coins : 250,
        owned: Array.isArray(p.owned) ? Array.from(new Set([...STARTER, ...p.owned])) : [...STARTER],
        weapon: typeof p.weapon === "string" ? p.weapon : "pistol",
        brawler: typeof p.brawler === "string" ? p.brawler : "blaster",
        avatar: typeof p.avatar === "string" ? p.avatar : "blaze",
        name: typeof p.name === "string" ? p.name : "",
      };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return { coins: 250, owned: [...STARTER], weapon: "pistol", brawler: "blaster", avatar: "blaze", name: "" };
}

interface ProfileState extends Saved {
  owns: (id: string) => boolean;
  buy: (item: ShopItem) => boolean;
  equip: (item: ShopItem) => void;
  setAvatar: (id: string) => void;
  setName: (name: string) => void;
  award: (n: number) => void;
}

// how long a display name may be — the server enforces the same cap
export const MAX_NAME_LEN = 14;

export const useProfile = create<ProfileState>((set, get) => {
  const persist = (): void => {
    const { coins, owned, weapon, brawler, avatar, name } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ coins, owned, weapon, brawler, avatar, name }));
    } catch {
      /* ignore */
    }
  };
  return {
    ...load(),
    owns: (id) => get().owned.includes(id),
    buy: (item) => {
      const s = get();
      if (s.owned.includes(item.id) || s.coins < item.cost) return false;
      set({ coins: s.coins - item.cost, owned: [...s.owned, item.id] });
      persist();
      return true;
    },
    equip: (item) => {
      if (!get().owned.includes(item.id)) return;
      set(item.kind === "weapon" ? { weapon: item.key } : { brawler: item.key });
      persist();
    },
    setAvatar: (id) => {
      set({ avatar: id });
      persist();
    },
    setName: (name) => {
      set({ name: name.slice(0, MAX_NAME_LEN) });
      persist();
    },
    award: (n) => {
      set({ coins: get().coins + Math.max(0, Math.round(n)) });
      persist();
    },
  };
});

// keys of owned items of a kind (for the games to build their available lists)
export function ownedKeys(owned: string[], kind: "weapon" | "brawler"): string[] {
  return SHOP.filter((i) => i.kind === kind && owned.includes(i.id)).map((i) => i.key);
}
