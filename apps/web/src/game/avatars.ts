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
}

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

// n avatars for a match: the player's pick first, then distinct others
export function avatarRoster(playerId: string, n: number): Avatar[] {
  const me = avatarById(playerId);
  const others = AVATARS.filter((a) => a.id !== me.id);
  const out: Avatar[] = [me];
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
  ctx.restore();
}
