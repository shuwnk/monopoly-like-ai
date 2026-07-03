// 2:1 isometric projection for the board. The engine keeps the board as a ring
// of 40 squares; here we map each square to an 11x11 grid cell, then to screen
// space. Everything the iso board draws (tiles, buildings, labels, pawns) lives
// in this one coordinate system so a single <svg viewBox> scales it all at once.

// Tile size is driven by the text that must sit INSIDE each face: a wrapped
// uppercase name stacked over a big 28-unit value. Two extents govern the fit:
//   • neighbour spacing  L = sqrt((W/2)^2 + (H/2)^2)  — centres one grid step apart
//   • along-travel-axis reach to the shared edge = L/2  (the value's WIDTH runs here)
//   • perpendicular reach  P = (W*H/4)/L               (the name→value STACK runs here)
// The perpendicular axis is the tight one, so we drop the aspect ratio from 2:1 to
// ~1.7:1 (more H) AND scale up, keeping the value a chunky 28 units.
//   W=180,H=106  -> L = sqrt(90^2+53^2) = sqrt(10909) = 104.4
//     along-axis half-reach  L/2 = 52.2  (x0.9 shrink = 47.0)
//     perpendicular half-reach P = (180*106/4)/104.4 = 4770/104.4 = 45.7 (x0.9 = 41.1)
//   value width (3 digits) ~ 3*0.6*28 = 50.4 -> half 25.2 < 47.0  (margin 21.8),
//   and the neighbour's own value edge sits at 104.4-25.2 = 79.2, so a 54-unit gap.
//   stack fits +/-41.1: name top ~ -28, value bottom ~ +18.
export const TILE_W = 208; // iso tile width (x span of the diamond)
export const TILE_H = 122; // iso tile height (y span) — ~1.7:1 for vertical room
export const TILE_DEPTH = 26; // extruded thickness under each tile — a solid slab
export const FOOT = 30; // building footprint half-width on the tile top

// how far a lot reaches inward (toward the field/road) and outward (toward the
// board edge) from its ring cell, in grid units. The corner tiles and the green
// field are built from the same numbers so the ring stays flush. din MUST stay
// <= 0.5 (the frontage half-step): any more and lots on perpendicular sides cross
// into each other near the corners. Length lives on the outward side (dout).
export const TILE_DIN = 0.5;
export const TILE_DOUT = 1.1;

// how tall each build level stands, in screen units (index = build level 0..4).
// L0 is a small starter house (non-zero so every lot always shows a structure),
// growing through houses to a flat-roof mid-rise (L3) and a stepped tower (L4).
export const BUILD_HEIGHT = [22, 40, 64, 92, 138];

export interface Grid {
  readonly gx: number; // column 1..11
  readonly gy: number; // row 1..11
}

// board index (0..39) -> 11x11 ring cell. GO at bottom-right, counter-clockwise,
// matching the flat board's layout so positions read the same.
export function ringToGrid(i: number): Grid {
  if (i <= 10) return { gx: 11 - i, gy: 11 };
  if (i <= 20) return { gx: 1, gy: 21 - i };
  if (i <= 30) return { gx: i - 19, gy: 1 };
  return { gx: 11, gy: i - 29 };
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

// grid cell center -> screen point
export function project(gx: number, gy: number): Point {
  return { x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) };
}

// the four corners of a tile's top face
export function diamondPts(c: Point, w = TILE_W, h = TILE_H): Point[] {
  return [
    { x: c.x, y: c.y - h / 2 }, // back (top)
    { x: c.x + w / 2, y: c.y }, // right
    { x: c.x, y: c.y + h / 2 }, // front (bottom)
    { x: c.x - w / 2, y: c.y }, // left
  ];
}

export function diamond(c: Point, w = TILE_W, h = TILE_H): string {
  return diamondPts(c, w, h)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

// which grid axis runs along the ring (tangential) at this cell
function isRowEdge(gy: number): boolean {
  return gy === 1 || gy === 11;
}

// shift a ring cell radially by `o` grid units (positive = outward, toward the
// board edge; negative = inward, toward the road/centre). used to anchor the
// price (inner), the name and the building (outer) at different ends of a tile.
export function radialShift(gx: number, gy: number, o: number): Point {
  if (isRowEdge(gy)) return project(gx, gy + (gy === 11 ? o : -o));
  return project(gx + (gx === 11 ? o : -o), gy);
}

// A Monopoly-style lot: narrow along the ring (frontage `fr`), reaching `din`
// inward (toward the road — the price end) and `dout` outward (toward the board
// edge — the name + building end). Frontage is a full half-step (0.5) so adjacent
// lots butt edge-to-edge into one continuous board ring rather than floating with
// gaps between them. din+dout make the lot long enough to stack a chunky name over
// the price without them crowding. (The green field must inset to match `din`.)
// Returns the 4 top-face corners.
export function tileCorners(gx: number, gy: number, fr = 0.5, din = TILE_DIN, dout = TILE_DOUT): Point[] {
  if (isRowEdge(gy)) {
    const outer = gy === 11 ? gy + dout : gy - dout;
    const inner = gy === 11 ? gy - din : gy + din;
    return [project(gx - fr, outer), project(gx + fr, outer), project(gx + fr, inner), project(gx - fr, inner)];
  }
  const outer = gx === 11 ? gx + dout : gx - dout;
  const inner = gx === 11 ? gx - din : gx + din;
  return [project(outer, gy - fr), project(outer, gy + fr), project(inner, gy + fr), project(inner, gy - fr)];
}

// a corner landmark tile: a square reaching `dout` outward (to the board edge)
// and only the frontage half-step `fr` inward — so its inner edges meet the
// adjacent edge lots exactly at their boundary instead of overlapping and
// clipping them (which made neighbouring tiles look smaller). Returns the four
// top-face corners and the tile's centre (for placing the landmark icon/label).
export function cornerFace(gx: number, gy: number, fr = 0.5, dout = TILE_DOUT): { pts: Point[]; center: Point } {
  const bounds = (v: number): [number, number] => (v === 1 ? [v - dout, v + fr] : [v - fr, v + dout]);
  const [xLo, xHi] = bounds(gx);
  const [yLo, yHi] = bounds(gy);
  const pts = [project(xLo, yLo), project(xHi, yLo), project(xHi, yHi), project(xLo, yHi)];
  return { pts, center: project((xLo + xHi) / 2, (yLo + yHi) / 2) };
}

export interface BoxFaces {
  readonly top: string;
  readonly left: string;
  readonly right: string;
}

// an upright extruded box standing on the tile top at center `c`, rising `h`
// units. Returns the three visible faces (top, front-left, front-right).
export function boxFaces(c: Point, h: number, fw = FOOT): BoxFaces {
  const fh = fw / 2;
  const back = { x: c.x, y: c.y - fh };
  const right = { x: c.x + fw, y: c.y };
  const front = { x: c.x, y: c.y + fh };
  const left = { x: c.x - fw, y: c.y };
  const up = (p: Point): Point => ({ x: p.x, y: p.y - h });

  const pts = (ps: Point[]): string => ps.map((p) => `${p.x},${p.y}`).join(" ");
  return {
    top: pts([up(back), up(right), up(front), up(left)]),
    right: pts([right, front, up(front), up(right)]),
    left: pts([front, left, up(left), up(front)]),
  };
}
