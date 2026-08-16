// Original chunky cartoon mascots (Pummel-Party spirit, not their art), drawn
// procedurally on a canvas so they scale crisply and need no image assets. One
// picked avatar follows the player across every minigame.

export type Feature = "flame" | "horns" | "antenna" | "ears" | "spikes" | "leaf" | "crest" | "robot";
export interface Avatar {
  id: string;
  name: string;
  body: string;
  belly: string;
  accent: string;
  feat: Feature;
  // cosmetic headgear, resolved from the player's look. Carried on the Avatar so
  // every renderer that already takes one (2D canvas and 3D rig) picks it up
  // without a signature change. Purely decorative — a helmet stops nothing.
  hat?: HatId;
}

export type HatId = "cap" | "helmet" | "crown" | "party" | "cans" | "band";
export interface Hat {
  id: HatId;
  name: string;
  /** default colour when the player hasn't picked one */
  color: string;
}
export const HATS: Hat[] = [
  { id: "cap", name: "Cap", color: "#e53935" },
  { id: "helmet", name: "Helmet", color: "#90a4ae" },
  { id: "crown", name: "Crown", color: "#ffca28" },
  { id: "party", name: "Party Hat", color: "#ab47bc" },
  { id: "cans", name: "Headphones", color: "#37474f" },
  { id: "band", name: "Bandana", color: "#43a047" },
];

// Body colours a player can pick. Chosen to stay distinguishable from each other
// at a distance and against the dark arenas — you have to tell players apart.
export const BODY_COLORS: string[] = [
  "#ff7043", "#ef5350", "#ec407a", "#ab47bc", "#7e57c2",
  "#5c6bc0", "#42a5f5", "#26c6da", "#26a69a", "#66bb6a",
  "#d4e157", "#ffca28", "#8d6e63", "#78909c", "#f5f5f5",
];

export const AVATARS: Avatar[] = [
  { id: "blaze", name: "Blaze", body: "#ff7043", belly: "#ffccbc", accent: "#ffca28", feat: "flame" },
  { id: "tusk", name: "Tusk", body: "#78909c", belly: "#cfd8dc", accent: "#eceff1", feat: "horns" },
  { id: "bolt", name: "Bolt", body: "#ffd54f", belly: "#fff59d", accent: "#ef5350", feat: "antenna" },
  { id: "coco", name: "Coco", body: "#8d6e63", belly: "#d7ccc8", accent: "#4e342e", feat: "ears" },
  { id: "frost", name: "Frost", body: "#4fc3f7", belly: "#e1f5fe", accent: "#b3e5fc", feat: "spikes" },
  { id: "sprout", name: "Sprout", body: "#66bb6a", belly: "#c8e6c9", accent: "#2e7d32", feat: "leaf" },
  { id: "rex", name: "Rex", body: "#ef5350", belly: "#ffcdd2", accent: "#b71c1c", feat: "crest" },
  { id: "pixel", name: "Pixel", body: "#7e57c2", belly: "#d1c4e9", accent: "#b39ddb", feat: "robot" },
];

export const DEFAULT_AVATAR = AVATARS[0]!.id;
export const avatarById = (id: string): Avatar => AVATARS.find((a) => a.id === id) ?? AVATARS[0]!;

// mix a hex colour toward white (t=1) — used to derive a belly shade from a
// custom body colour so a recoloured mascot still reads as the same design
function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * t));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// Turn a player's stored/wire look into something the renderers can draw. This is
// the ONLY place a look becomes an Avatar, so 2D and 3D can never disagree.
export function resolveLook(look: { av: string; color?: string; hat?: string } | null | undefined): Avatar {
  const base = avatarById(look?.av ?? DEFAULT_AVATAR);
  const hat = HATS.find((h) => h.id === look?.hat)?.id;
  // an empty colour means "keep the mascot's own palette"
  if (!look?.color) return hat ? { ...base, hat } : base;
  return {
    ...base,
    body: look.color,
    belly: lighten(look.color, 0.55),
    ...(hat ? { hat } : {}),
  };
}

// n avatars for a match: the player's own first, then distinct others. Accepts a
// resolved Avatar (so a custom colour/hat survives) or a plain mascot id.
export function avatarRoster(me: Avatar | string, n: number): Avatar[] {
  const mine = typeof me === "string" ? avatarById(me) : me;
  const others = AVATARS.filter((a) => a.id !== mine.id);
  const out: Avatar[] = [mine];
  for (let i = 0; i < n - 1; i++) out.push(others[i % others.length]!);
  return out;
}

function tri(ctx: CanvasRenderingContext2D, cx: number, baseY: number, halfW: number, h: number, tilt = 0): void {
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.moveTo(-halfW, 0);
  ctx.lineTo(halfW, 0);
  ctx.lineTo(0, -h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFeature(ctx: CanvasRenderingContext2D, av: Avatar, r: number): void {
  ctx.fillStyle = av.accent;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(1, r * 0.06);
  const top = -r;
  switch (av.feat) {
    case "flame":
      for (const [dx, h] of [[-0.28, 0.5], [0, 0.8], [0.28, 0.5]] as const) tri(ctx, dx * r, top + r * 0.15, r * 0.22, r * h);
      break;
    case "horns":
      tri(ctx, -r * 0.5, -r * 0.55, r * 0.16, r * 0.5, -0.5);
      tri(ctx, r * 0.5, -r * 0.55, r * 0.16, r * 0.5, 0.5);
      break;
    case "antenna":
      ctx.beginPath();
      ctx.moveTo(0, top + r * 0.1);
      ctx.lineTo(0, top - r * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, top - r * 0.55, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case "ears":
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.68, -r * 0.55, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case "spikes":
      for (let i = -2; i <= 2; i++) tri(ctx, i * r * 0.3, top + r * 0.15, r * 0.14, r * 0.34);
      break;
    case "leaf":
      ctx.beginPath();
      ctx.moveTo(0, top + r * 0.1);
      ctx.lineTo(0, top - r * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(r * 0.14, top - r * 0.45, r * 0.24, r * 0.12, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case "crest":
      for (let i = -2; i <= 2; i++) tri(ctx, i * r * 0.22, top + r * 0.15, r * 0.11, r * (0.42 - Math.abs(i) * 0.07));
      break;
    case "robot":
      ctx.fillRect(-r * 0.06, top - r * 0.35, r * 0.12, r * 0.4);
      ctx.strokeRect(-r * 0.06, top - r * 0.35, r * 0.12, r * 0.4);
      ctx.beginPath();
      ctx.arc(0, top - r * 0.4, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
  }
}

// draw a mascot centred at (x,y); `face` (radians) points the eyes where it moves
export function drawAvatar(ctx: CanvasRenderingContext2D, av: Avatar, x: number, y: number, r: number, face = 0): void {
  ctx.save();
  ctx.translate(x, y);
  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.9, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  drawFeature(ctx, av, r);
  // body
  ctx.fillStyle = av.body;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = Math.max(1.5, r * 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // belly
  ctx.fillStyle = av.belly;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.28, r * 0.5, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // eyes (pupils lean toward the facing direction)
  const ex = Math.cos(face) * r * 0.12;
  const ey = Math.sin(face) * r * 0.12;
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s * r * 0.32, -r * 0.2, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();
    ctx.fillStyle = "#141414";
    ctx.beginPath();
    ctx.arc(s * r * 0.32 + ex, -r * 0.2 + ey, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
  if (av.hat) drawHat(ctx, av.hat, r);
  ctx.restore();
}

// cosmetic headgear, drawn on top of the head. Origin is the mascot's centre and
// -r is the crown of the head, matching drawFeature.
function drawHat(ctx: CanvasRenderingContext2D, hat: HatId, r: number): void {
  const color = HATS.find((h) => h.id === hat)?.color ?? "#e53935";
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(1.2, r * 0.07);
  const top = -r;
  switch (hat) {
    case "cap": {
      ctx.beginPath(); // dome
      ctx.arc(0, top + r * 0.34, r * 0.62, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); // peak, out to the front
      ctx.ellipse(r * 0.34, top + r * 0.34, r * 0.5, r * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "helmet": {
      ctx.beginPath();
      ctx.arc(0, top + r * 0.4, r * 0.72, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)"; // visor band
      ctx.fillRect(-r * 0.72, top + r * 0.24, r * 1.44, r * 0.14);
      break;
    }
    case "crown": {
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, top + r * 0.3);
      for (let i = 0; i < 3; i++) {
        const x = -r * 0.55 + (i * r * 1.1) / 3;
        ctx.lineTo(x + r * 0.18, top - r * 0.25);
        ctx.lineTo(x + r * 0.37, top + r * 0.05);
      }
      ctx.lineTo(r * 0.55, top + r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "party": {
      tri(ctx, 0, top + r * 0.22, r * 0.34, r * 0.85);
      ctx.beginPath(); // pom-pom
      ctx.arc(0, top - r * 0.63, r * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = "#fff59d";
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "cans": {
      ctx.beginPath(); // headband
      ctx.arc(0, top + r * 0.45, r * 0.78, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = Math.max(1.2, r * 0.07);
      for (const s of [-1, 1]) {
        ctx.beginPath(); // ear cups
        ctx.ellipse(s * r * 0.78, top + r * 0.5, r * 0.16, r * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "band": {
      ctx.beginPath();
      ctx.rect(-r * 0.8, top + r * 0.2, r * 1.6, r * 0.24);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath(); // knot tail
      ctx.moveTo(r * 0.72, top + r * 0.32);
      ctx.lineTo(r * 1.05, top + r * 0.14);
      ctx.lineTo(r * 1.02, top + r * 0.52);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
}
