import { describe, expect, it } from "vitest";
import { afterShot, crosshairScale, GUNS, hitsToKill, PICKUP_WEIGHTS, pelletCount, rollPickup, SCOPE, scopeFov, scopeSensitivity, SIDEARM, spreadFor, wantsPickup } from "../barnBrawlWeapons.js";

describe("Barn Brawl weapons", () => {
  it("keeps the reference shotgun: 3–5 pellets, ±10°, 30 units, one pellet kills, one shell", () => {
    expect(GUNS.shotgun).toMatchObject({ ammo: 1, pellets: [3, 5], spreadDeg: 10, range: 30, damage: 100, shake: 0.5, botRange: 11, botCadence: [0.8, 1.2] });
    expect(pelletCount("shotgun", 0)).toBe(3);
    expect(pelletCount("shotgun", 0.5)).toBe(4);
    expect(pelletCount("shotgun", 0.999)).toBe(5);
    expect(pelletCount("smg", 0.999)).toBe(1);
  });

  it("hits to kill: the sidearm and SMG chip, the shotgun and sniper kill outright", () => {
    expect(hitsToKill("pistol")).toBe(4);
    expect(hitsToKill("smg")).toBe(8);
    expect(hitsToKill("shotgun")).toBe(1);
    expect(hitsToKill("sniper")).toBe(1);
    expect(GUNS.smg.ammo).toBe(30);
    expect(GUNS.sniper.ammo).toBe(1);
  });

  it("pickup rolls follow the weights and never produce the sidearm", () => {
    expect(PICKUP_WEIGHTS.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 9);
    expect(rollPickup(0)).toBe("shotgun");
    expect(rollPickup(0.449)).toBe("shotgun");
    expect(rollPickup(0.45)).toBe("smg");
    expect(rollPickup(0.799)).toBe("smg");
    expect(rollPickup(0.8)).toBe("sniper");
    expect(rollPickup(0.999999)).toBe("sniper");
    expect(rollPickup(1)).toBe("sniper"); // a rounding overshoot still lands on a gun
    for (const [g] of PICKUP_WEIGHTS) expect(wantsPickup(g)).toBe(false);
    expect(wantsPickup(SIDEARM)).toBe(true);
  });

  it("after a shot: the sidearm is endless, the one-shot guns are thrown, the SMG counts down", () => {
    expect(afterShot("pistol", Infinity)).toEqual({ gun: "pistol", ammo: Infinity, thrown: false });
    expect(afterShot("shotgun", 1)).toEqual({ gun: "pistol", ammo: Infinity, thrown: true });
    expect(afterShot("sniper", 1)).toEqual({ gun: "pistol", ammo: Infinity, thrown: true });
    expect(afterShot("smg", 30)).toEqual({ gun: "smg", ammo: 29, thrown: false });
    expect(afterShot("smg", 1)).toEqual({ gun: "pistol", ammo: Infinity, thrown: true });
  });

  it("the sniper is pinpoint scoped and loose from the hip; the scope flag is the only one", () => {
    expect(spreadFor("sniper", true)).toBe(0);
    expect(spreadFor("sniper", false)).toBe(4);
    expect(spreadFor("shotgun", false)).toBe(10);
    expect(spreadFor("shotgun", true)).toBe(10);
    expect(Object.entries(GUNS).filter(([, g]) => g.scope).map(([k]) => k)).toEqual(["sniper"]);
    expect(Object.entries(GUNS).filter(([, g]) => g.auto).map(([k]) => k)).toEqual(["smg"]);
  });

  it("scope: 70° down to 24°, and the mouse slows by the same ratio", () => {
    expect(scopeFov(0)).toBe(70);
    expect(scopeFov(1)).toBe(SCOPE.fov);
    expect(scopeFov(0.5)).toBe(47);
    expect(scopeFov(2)).toBe(SCOPE.fov); // clamped
    expect(scopeSensitivity(0)).toBe(1);
    expect(scopeSensitivity(1)).toBeCloseTo(24 / 70, 9);
  });

  it("crosshair grows from ×1 at 20 units to ×2.25 at 5", () => {
    expect(crosshairScale(Infinity, 5, 20)).toBe(1);
    expect(crosshairScale(20, 5, 20)).toBe(1);
    expect(crosshairScale(12.5, 5, 20)).toBeCloseTo(1.625, 9);
    expect(crosshairScale(5, 5, 20)).toBe(2.25);
    expect(crosshairScale(1, 5, 20)).toBe(2.25);
  });
});
