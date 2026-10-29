// Barn Brawl's arsenal. Pummel Party's Barn Brawl is a one-shell shotgun scramble; this
// build keeps that shotgun (numbers from the BarnBrawlPlayer prefab: 3–5 pellets, ±10°,
// 30-unit range, one pellet kills) and adds three guns of our own around it: a pistol
// sidearm everyone carries, a 30-round SMG and a scoped one-shot sniper. Every number a
// gun needs lives here so the component only decides when to shoot.

export type Gun = "pistol" | "shotgun" | "smg" | "sniper";

export interface GunDef {
  name: string;
  /** rounds a pickup holds; Infinity for the sidearm */
  ammo: number;
  /** rays per shot, inclusive range (`minProjectiles`..`maxProjectiles`) */
  pellets: readonly [number, number];
  /** cone half-angle per axis, degrees, when aimed (scoped for the sniper) */
  spreadDeg: number;
  /** the same from the hip; only the sniper is worse unscoped */
  hipSpreadDeg: number;
  /** ray length (`num4 = 30f` for the shotgun) */
  range: number;
  /** of MAX_HEALTH; 100 kills outright like the reference's 1 damage to 1 health */
  damage: number;
  /** seconds between shots */
  cooldown: number;
  /** keeps firing while the button is held */
  auto: boolean;
  /** right mouse narrows the FOV and shows the scope */
  scope: boolean;
  /** far clamp of the aim point past the character (`num3`, 20 for the reference) */
  aimMax: number;
  /** CameraShake trauma per shot (`AddShake(0.5f)` for the shotgun) */
  shake: number;
  /** transient pitch kick per shot, radians */
  recoil: number;
  /** bots engage inside this (canSee's 11f for the shotgun) */
  botRange: number;
  /** the bots' shoot-chance timer range (`shootChanceTimer` 0.8–1.2 s for the shotgun) */
  botCadence: readonly [number, number];
  /** rounds a bot fires per passed shoot-chance roll, inclusive range */
  botBurst: readonly [number, number];
  /** tracer, pickup ring and muzzle tint */
  color: number;
}

export const MAX_HEALTH = 100;
/** the gun everyone spawns, respawns and falls back to */
export const SIDEARM: Gun = "pistol";

export const GUNS: Readonly<Record<Gun, GunDef>> = {
  pistol: { name: "Pistol", ammo: Infinity, pellets: [1, 1], spreadDeg: 1, hipSpreadDeg: 1, range: 40, damage: 25, cooldown: 0.3, auto: false, scope: false, aimMax: 20, shake: 0.15, recoil: 0.02, botRange: 16, botCadence: [0.35, 0.55], botBurst: [1, 1], color: 0xffe08a },
  shotgun: { name: "Shotgun", ammo: 1, pellets: [3, 5], spreadDeg: 10, hipSpreadDeg: 10, range: 30, damage: 100, cooldown: 0.5, auto: false, scope: false, aimMax: 20, shake: 0.5, recoil: 0.05, botRange: 11, botCadence: [0.8, 1.2], botBurst: [1, 1], color: 0xfff0c0 },
  smg: { name: "SMG", ammo: 30, pellets: [1, 1], spreadDeg: 2.5, hipSpreadDeg: 2.5, range: 40, damage: 13, cooldown: 0.09, auto: true, scope: false, aimMax: 20, shake: 0.1, recoil: 0.01, botRange: 16, botCadence: [0.6, 1], botBurst: [4, 8], color: 0x8ad0ff },
  sniper: { name: "Sniper", ammo: 1, pellets: [1, 1], spreadDeg: 0, hipSpreadDeg: 4, range: 80, damage: 100, cooldown: 0.5, auto: false, scope: true, aimMax: 60, shake: 0.45, recoil: 0.06, botRange: 28, botCadence: [1, 1.5], botBurst: [1, 1], color: 0xa6ff5c },
};

/** what a pickup turns out to be: shotguns most often, then SMGs, then snipers */
export const PICKUP_WEIGHTS: ReadonlyArray<readonly [Gun, number]> = [
  ["shotgun", 0.45],
  ["smg", 0.35],
  ["sniper", 0.2],
];

/** `rand` in [0, 1) → the pickup's gun */
export function rollPickup(rand: number): Gun {
  let acc = 0;
  for (const [gun, w] of PICKUP_WEIGHTS) {
    acc += w;
    if (rand < acc) return gun;
  }
  return PICKUP_WEIGHTS[PICKUP_WEIGHTS.length - 1]![0];
}

/** only a fighter on the sidearm goes for (and can take) a pickup */
export function wantsPickup(gun: Gun): boolean {
  return gun === SIDEARM;
}

export function hitsToKill(gun: Gun): number {
  return Math.ceil(MAX_HEALTH / GUNS[gun].damage);
}

/** `rand` in [0, 1) → how many rays this shot fires */
export function pelletCount(gun: Gun, rand: number): number {
  const [lo, hi] = GUNS[gun].pellets;
  return lo + Math.floor(rand * (hi - lo + 1));
}

export function spreadFor(gun: Gun, scoped: boolean): number {
  const g = GUNS[gun];
  return scoped || !g.scope ? g.spreadDeg : g.hipSpreadDeg;
}

export interface AfterShot {
  gun: Gun;
  ammo: number;
  /** the emptied gun leaves the hands (`shotgunRigidbody` let go) */
  thrown: boolean;
}

/** one round spent: the sidearm never runs dry; anything else is thrown away on its last */
export function afterShot(gun: Gun, ammo: number): AfterShot {
  if (gun === SIDEARM) return { gun, ammo: Infinity, thrown: false };
  const left = ammo - 1;
  if (left > 0) return { gun, ammo: left, thrown: false };
  return { gun: SIDEARM, ammo: Infinity, thrown: true };
}

/** the sniper scope: the FOV eases from the minigame camera's 70° down to 24° */
export const SCOPE = { fov: 24, baseFov: 70, time: 0.15 } as const;

/** `t` 0 hip … 1 scoped → vertical FOV in degrees */
export function scopeFov(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return SCOPE.baseFov + (SCOPE.fov - SCOPE.baseFov) * k;
}

/** mouse sensitivity multiplier while scoping: the view turns as many pixels per degree */
export function scopeSensitivity(t: number): number {
  return scopeFov(t) / SCOPE.baseFov;
}

/** the aimer grows from ×1 at `far` units to ×`near` at `min` (BarnBrawlPlayer's crosshair) */
export function crosshairScale(dist: number, min: number, far: number, near = 2.25): number {
  if (dist <= min) return near;
  if (dist >= far) return 1;
  return near - (near - 1) * ((dist - min) / (far - min));
}
