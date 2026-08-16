import { FD_GRID, type FDSnapshot } from "@party-monopoly/types";

// Authoritative "Floor Drop" simulation. Runs on the server; humans feed it an
// input vector, bots think for themselves. Deterministic per tick given inputs +
// Math.random (server-side randomness is fine — this is not the pure game engine).

const GRID = FD_GRID;
const MOVE_SPEED = 4.7; // tiles / second
const WARN_TIME = 1.3;
const FALL_TIME = 0.6;
const CENTER = GRID / 2;

const COLORS = ["#ffd23f", "#ff5c5c", "#5cc8ff", "#a6ff5c", "#c77dff", "#ff9f45", "#4ade80", "#38bdf8"];
const SPAWNS: Array<[number, number]> = [
  [2.5, 2.5],
  [GRID - 2.5, 2.5],
  [2.5, GRID - 2.5],
  [GRID - 2.5, GRID - 2.5],
  [CENTER, 2.5],
  [CENTER, GRID - 2.5],
  [2.5, CENTER],
  [GRID - 2.5, CENTER],
];

const idx = (c: number, r: number): number => r * GRID + c;
const inGrid = (c: number, r: number): boolean => c >= 0 && r >= 0 && c < GRID && r < GRID;
const spawnInterval = (t: number): number => Math.max(0.28, 0.85 - t * 0.011);

export interface SimFighter {
  id: number;
  x: number;
  y: number;
  input: { dx: number; dy: number };
  isBot: boolean;
  name: string;
  color: string;
  state: 0 | 1 | 2; // alive | falling | gone
  fallT: number;
  place: number;
}

export class FloorDropSim {
  readonly fighters: SimFighter[] = [];
  private st: Array<0 | 1 | 2> = new Array(GRID * GRID).fill(0);
  private wt: number[] = new Array(GRID * GRID).fill(0);
  time = 0;
  private spawnTimer = 1.5;
  private nextPlace = 0;
  over = false;
  winner: SimFighter | null = null;

  // humans first (in seat order), then bots to fill up to `target` fighters
  constructor(humans: Array<{ id: number; name: string }>, target: number) {
    const total = Math.max(2, Math.min(SPAWNS.length, Math.max(humans.length, target)));
    for (let i = 0; i < total; i++) {
      const human = humans[i];
      this.fighters.push({
        id: i,
        x: SPAWNS[i]![0],
        y: SPAWNS[i]![1],
        input: { dx: 0, dy: 0 },
        isBot: !human,
        name: human ? human.name : `Bot ${i}`,
        color: COLORS[i % COLORS.length]!,
        state: 0,
        fallT: 0,
        place: 0,
      });
    }
    this.nextPlace = this.fighters.length;
  }

  setInput(id: number, dx: number, dy: number): void {
    const f = this.fighters.find((x) => x.id === id);
    if (f && !f.isBot) f.input = { dx: Math.sign(dx), dy: Math.sign(dy) };
  }

  // a leaving human hands control to the AI so the arena stays full
  makeBot(id: number): void {
    const f = this.fighters.find((x) => x.id === id);
    if (f) f.isBot = true;
  }

  // …and a returning human takes it back, so a reconnect mid-round means playing
  // again rather than watching a bot finish for you
  takeOver(id: number): void {
    const f = this.fighters.find((x) => x.id === id);
    if (f) {
      f.isBot = false;
      f.input = { dx: 0, dy: 0 };
    }
  }

  private aliveCount(): number {
    return this.fighters.filter((f) => f.state === 0).length;
  }

  private drop(f: SimFighter): void {
    if (f.state !== 0) return;
    f.state = 1;
    f.fallT = 0;
    f.place = this.nextPlace--;
  }

  private move(f: SimFighter, dx: number, dy: number, dt: number): void {
    const sp = MOVE_SPEED * dt;
    const rad = 0.34;
    const walkable = (x: number, y: number): boolean => {
      const c = Math.floor(x);
      const r = Math.floor(y);
      return inGrid(c, r) && (this.st[idx(c, r)] ?? 2) !== 2;
    };
    const nx = f.x + dx * sp;
    if (walkable(nx + Math.sign(dx) * rad, f.y)) f.x = nx;
    const ny = f.y + dy * sp;
    if (walkable(f.x, ny + Math.sign(dy) * rad)) f.y = ny;
  }

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;

    // spawn a warning wave: mostly a scatter of 1-3, sometimes a full row/column
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnInterval(this.time);
      const warnAt = (i: number): void => {
        if (this.st[i] === 0) {
          this.st[i] = 1;
          this.wt[i] = WARN_TIME;
        }
      };
      const rowChance = Math.min(0.34, 0.12 + this.time * 0.004);
      if (Math.random() < rowChance) {
        if (Math.random() < 0.5) {
          const r = Math.floor(Math.random() * GRID);
          for (let c = 0; c < GRID; c++) warnAt(idx(c, r));
        } else {
          const c = Math.floor(Math.random() * GRID);
          for (let r = 0; r < GRID; r++) warnAt(idx(c, r));
        }
      } else {
        const solid: number[] = [];
        for (let i = 0; i < this.st.length; i++) if (this.st[i] === 0) solid.push(i);
        const n = Math.min(1 + Math.floor(Math.random() * 3) + Math.floor(this.time / 25), solid.length);
        for (let k = 0; k < n; k++) warnAt(solid.splice(Math.floor(Math.random() * solid.length), 1)[0]!);
      }
    }

    // warnings mature into holes; anyone standing on one falls
    for (let i = 0; i < this.st.length; i++) {
      if (this.st[i] === 1) {
        this.wt[i]! -= dt;
        if (this.wt[i]! <= 0) {
          this.st[i] = 2;
          const c = i % GRID;
          const r = Math.floor(i / GRID);
          for (const f of this.fighters) if (f.state === 0 && Math.floor(f.x) === c && Math.floor(f.y) === r) this.drop(f);
        }
      }
    }

    for (const f of this.fighters) {
      if (f.state === 1) {
        f.fallT += dt;
        if (f.fallT >= FALL_TIME) f.state = 2;
        continue;
      }
      if (f.state === 2) continue;
      if ((this.st[idx(Math.floor(f.x), Math.floor(f.y))] ?? 2) === 2) {
        this.drop(f);
        continue;
      }
      if (f.isBot) this.botThink(f, dt);
      else this.move(f, f.input.dx, f.input.dy, dt);
    }

    if (this.aliveCount() <= 1) {
      this.over = true;
      this.winner = this.fighters.find((f) => f.state === 0) ?? null;
      if (this.winner) this.winner.place = 1;
    }
  }

  private botThink(b: SimFighter, dt: number): void {
    const bc = Math.floor(b.x);
    const br = Math.floor(b.y);
    const openness = (c: number, r: number): number => {
      let n = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (inGrid(c + dc, r + dr) && (this.st[idx(c + dc, r + dr)] ?? 2) !== 2) n++;
      return n;
    };
    const score = (c: number, r: number, isSelf: boolean): number => {
      if (!inGrid(c, r)) return -Infinity;
      const s = this.st[idx(c, r)] ?? 2;
      if (s === 2) return -Infinity;
      if (s === 1) {
        if (isSelf) return -50 + (this.wt[idx(c, r)] ?? 0) * 10;
        if ((this.wt[idx(c, r)] ?? 0) < 0.6) return -Infinity;
      }
      return -Math.hypot(c - CENTER, r - CENTER) + openness(c, r) * 0.8 + (s === 0 ? 3 : 0) + Math.random() * 0.6;
    };
    let best: [number, number] = [bc, br];
    let bestScore = score(bc, br, true);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const sc = score(bc + dc, br + dr, false);
      if (sc > bestScore) {
        bestScore = sc;
        best = [bc + dc, br + dr];
      }
    }
    const tx = best[0] === bc && best[1] === br ? CENTER : best[0] + 0.5;
    const ty = best[0] === bc && best[1] === br ? CENTER : best[1] + 0.5;
    this.move(b, Math.sign(tx - b.x), Math.sign(ty - b.y), dt);
  }

  snapshot(): FDSnapshot {
    return {
      tiles: this.st.join(""),
      players: this.fighters.filter((f) => f.state !== 2).map((f) => ({ id: f.id, x: Math.round(f.x * 100) / 100, y: Math.round(f.y * 100) / 100, s: f.state })),
      time: Math.round(this.time * 10) / 10,
      alive: this.aliveCount(),
    };
  }
}
