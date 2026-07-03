import { useEffect, useRef, useState } from "react";
import { ISLAND_IDS as ENGINE_ISLAND_IDS, type GameState, type Square } from "@party-monopoly/engine";
import { groupColor, playerColor, playerTag } from "../theme.js";
import {
  BUILD_HEIGHT,
  cornerFace,
  FOOT,
  project,
  radialShift,
  ringToGrid,
  tileCorners,
  TILE_DEPTH,
  TILE_DIN,
  TILE_DOUT,
  TILE_H,
  TILE_W,
  type Point,
} from "../iso/projection.js";
import { Dice } from "./Dice.js";

const SPECIAL_LABEL: Record<string, string> = {
  GO: "LARGADA",
  JAIL: "CADEIA",
  FREE_PARKING: "COPA",
  GO_TO_JAIL: "AEROPORTO",
  TAX: "IMPOSTO",
  CHANCE: "SORTE",
  COMMUNITY: "COFRE",
};

// the island lots (now buyable properties in the "Ilhas" group) — sandy-tinted
// with a palm, but they show a price + resort and can be owned like any city
const ISLAND_IDS = new Set<number>(ENGINE_ISLAND_IDS);

// A single key light sits at the upper-left of the whole board: left-facing
// faces are lit, right-facing faces are shaded, and every cast shadow falls
// toward the lower-right. Tile side-walls read that light through the
// tileWallL/tileWallR gradients (in <defs>), which start light at the top edge
// and deepen toward the ground so each slab reads as real volume, not a border.

interface Placed {
  square: Square;
  c: Point;
  z: number;
}

// mix a hex toward black (amt<0) or white (amt>0), 0..1
function shade(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const n = parseInt(full, 16);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (c: number): number => Math.round(c + (t - c) * p);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// big centre scoreboard counting down to the game deadline; reds out under 30s
function ClockBadge({ endsAt }: { endsAt: number }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const remain = Math.max(0, Math.round((endsAt - now) / 1000));
  const mm = Math.floor(remain / 60);
  const ss = remain % 60;
  const low = remain <= 30;
  return (
    <div
      style={{
        background: low ? "#7a1122" : "#0e2033",
        color: "#fff",
        padding: "6px 22px",
        borderRadius: 12,
        fontFamily: "var(--font-display)",
        fontSize: 34,
        fontWeight: 800,
        letterSpacing: 1,
        fontVariantNumeric: "tabular-nums",
        border: "2px solid rgba(255,255,255,0.25)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
      }}
    >
      {mm}:{String(ss).padStart(2, "0")}
    </div>
  );
}

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

export function IsoBoard({
  state,
  pickTiles,
  onPickTile,
  endsAt,
}: {
  state: GameState;
  // when set, the board is a tile picker: ids in the set stay lit + clickable,
  // everything else greys out (used for choosing an Aeroporto destination)
  pickTiles?: ReadonlySet<number>;
  onPickTile?: (id: number) => void;
  // epoch-ms game deadline: shows a live countdown scoreboard in the centre
  endsAt?: number;
}): JSX.Element {
  const active = state.players[state.activePlayerIndex];
  const activePos = active?.position ?? -1;
  const prevBuildings = usePrevious(state.buildings);

  // no monotonic roll counter lives in state, so derive one: the engine hands us a
  // fresh `lastRoll` array on every roll (even when the values repeat), so bumping
  // on reference change gives the Dice a key that changes each roll and replays it.
  const rollSeq = useRef(0);
  const prevRoll = usePrevious(state.lastRoll);
  if (state.lastRoll && state.lastRoll !== prevRoll) rollSeq.current += 1;

  const tiles: Placed[] = state.board
    .map((square) => {
      const g = ringToGrid(square.id);
      return { square, c: project(g.gx, g.gy), z: g.gx + g.gy };
    })
    .sort((a, b) => a.z - b.z);

  const tallest = BUILD_HEIGHT[BUILD_HEIGHT.length - 1]!;

  // The ground platform is a big diamond the whole board rests on. Extending it a
  // few grid units past the road ring gives the outer tiles ground to cast onto
  // and frames the board as an object in space rather than a floating panel.
  const GROUND_INSET = 2.4;
  const SHADOW_DX = 8;
  const SHADOW_DY = 22;
  // the grey road ring runs from the tiles' inner edge (TILE_DIN) inward to
  // ROAD_INNER; the green infield fills whatever's inside that.
  const ROAD_INNER = 2.0;
  const groundPts = [
    project(1 - GROUND_INSET, 1 - GROUND_INSET),
    project(11 + GROUND_INSET, 1 - GROUND_INSET),
    project(11 + GROUND_INSET, 11 + GROUND_INSET),
    project(1 - GROUND_INSET, 11 + GROUND_INSET),
  ];
  const groundStr = (dx: number, dy: number): string =>
    groundPts.map((p) => `${p.x + dx},${p.y + dy}`).join(" ");

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.c.x - TILE_W / 2);
    maxX = Math.max(maxX, t.c.x + TILE_W / 2);
    minY = Math.min(minY, t.c.y - TILE_H / 2 - tallest - 24);
    maxY = Math.max(maxY, t.c.y + TILE_H / 2 + TILE_DEPTH);
  }
  // keep the platform and its dropped shadow inside the viewBox
  for (const p of groundPts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + SHADOW_DX);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y + SHADOW_DY);
  }
  const pad = 16;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  // a concentric diamond at "inset" i (bigger i = closer to the centre); used for
  // the road ring, its dashed centre line, and the green field
  const ring = (i: number): string =>
    [project(1 + i, 1 + i), project(11 - i, 1 + i), project(11 - i, 11 - i), project(1 + i, 11 - i)]
      .map((p) => `${p.x},${p.y}`)
      .join(" ");

  // a scatter of faint lighter dashes across the infield, evoking mown-grass
  // rows — cheap drawn ellipses, no per-tile filters. Grid points kept well
  // inside 1.55..10.45 so none stray under the tile walls.
  const specks = [
    [3.3, 4.2], [5.0, 3.3], [6.7, 4.6], [8.2, 3.8], [4.1, 6.0],
    [6.0, 5.7], [7.8, 6.4], [3.6, 7.7], [5.4, 8.3], [7.1, 7.9],
    [8.6, 5.1], [4.7, 4.9], [6.4, 8.8], [9.0, 7.0],
  ].map(([gx, gy]) => project(gx!, gy!));

  return (
    <div style={{ position: "relative", width: "min(99vw, 2080px)", margin: "0 auto" }}>
      <svg viewBox={viewBox} width="100%" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="tileTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#eef1f7" />
          </linearGradient>
          {/* the central grass infield: a soft golf-green, lit toward the centre
              and cooling to a darker mown rim where it meets the tile walls */}
          <radialGradient id="fieldGrass" cx="0.5" cy="0.44" r="0.62">
            <stop offset="0" stopColor="var(--field-green-light)" />
            <stop offset="0.62" stopColor="var(--field-green)" />
            <stop offset="1" stopColor="var(--field-green-dark)" />
          </radialGradient>
          {/* recess shadow: transparent centre deepening at the rim so the field
              reads as sitting DOWN inside the raised tile frame */}
          <radialGradient id="fieldRecess" cx="0.5" cy="0.47" r="0.66">
            <stop offset="0.5" stopColor="#0c3a17" stopOpacity="0" />
            <stop offset="1" stopColor="#0c3a17" stopOpacity="0.34" />
          </radialGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* ground platform: light near the centre, cooling toward the rim */}
          <radialGradient id="ground" cx="0.5" cy="0.42" r="0.72">
            <stop offset="0" stopColor="#eaf1fa" />
            <stop offset="0.55" stopColor="#c6d3e7" />
            <stop offset="1" stopColor="#9aabc5" />
          </radialGradient>
          {/* soft vignette that only bites at the very edge of the platform */}
          <radialGradient id="vignette" cx="0.5" cy="0.46" r="0.7">
            <stop offset="0.68" stopColor="#0b1626" stopOpacity="0" />
            <stop offset="1" stopColor="#0b1626" stopOpacity="0.3" />
          </radialGradient>
          {/* the grey street the tiles sit against */}
          <linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#bcc3cf" />
            <stop offset="1" stopColor="#98a0ad" />
          </linearGradient>
          {/* lit vs. shaded tile side-walls — cream shades of the tile face so each
              lot reads as one solid cream piece, just lit for depth */}
          <linearGradient id="tileWallL" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#efe9db" />
            <stop offset="1" stopColor="#d8d0bd" />
          </linearGradient>
          <linearGradient id="tileWallR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#cec5b0" />
            <stop offset="1" stopColor="#b0a790" />
          </linearGradient>
        </defs>

        {/* the ground the board rests on: a soft cast shadow beneath, the lit
            platform itself, then a vignette that deepens toward the rim */}
        <polygon points={groundStr(SHADOW_DX, SHADOW_DY)} fill="rgba(11,20,34,0.28)" />
        <polygon points={groundStr(0, 0)} fill="url(#ground)" stroke="#8ea0ba" strokeWidth={2} strokeLinejoin="round" />
        <polygon points={groundStr(0, 0)} fill="url(#vignette)" pointerEvents="none" />

        {/* solid opaque board surface the tile ring sits on — a diamond out to the
            tiles' outer edge. The road + field cover its centre, leaving the annulus
            under the tiles solid so no ground shows through any tile seam. */}
        <polygon points={ring(-TILE_DOUT)} fill="#d8d0bd" stroke="#b0a790" strokeWidth={2} strokeLinejoin="round" />

        {/* the grey street ring: fills the interior up to the tiles' inner edges
            (ring at TILE_DIN), with a dashed lane line down its middle. The green
            infield is drawn on top, inset by ROAD_INNER, so a band of road shows
            between the tiles and the grass — the racetrack look. */}
        <polygon points={ring(TILE_DIN)} fill="url(#roadGrad)" />
        <polygon
          points={ring((TILE_DIN + ROAD_INNER) / 2)}
          fill="none"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={2.2}
          strokeDasharray="11 13"
          strokeLinejoin="round"
        />
        {/* green grass infield, sunk below the raised frame by a recess vignette */}
        <polygon points={ring(ROAD_INNER)} fill="url(#fieldGrass)" />
        {specks.map((p, i) => (
          <ellipse key={i} cx={p.x} cy={p.y} rx={17} ry={5} fill="var(--field-green-light)" opacity={0.28} pointerEvents="none" />
        ))}
        <polygon points={ring(ROAD_INNER)} fill="url(#fieldRecess)" pointerEvents="none" />
        <polygon points={ring(ROAD_INNER)} fill="none" stroke="rgba(14,64,26,0.5)" strokeWidth={2.5} strokeLinejoin="round" />
        <polygon points={ring(TILE_DIN)} fill="none" stroke="rgba(30,40,58,0.35)" strokeWidth={1.6} strokeLinejoin="round" />

        {tiles.map((t) => (
          <IsoTile
            key={t.square.id}
            placed={t}
            state={state}
            activePos={activePos}
            popped={(t.square.type === "PROPERTY") && (state.buildings[t.square.id] ?? 0) > (prevBuildings?.[t.square.id] ?? 0)}
            picking={!!pickTiles}
            selectable={pickTiles?.has(t.square.id) ?? false}
            {...(onPickTile ? { onSelect: () => onPickTile(t.square.id) } : {})}
          />
        ))}

        {/* pawns live in one layer above the tiles: a stable key per player means a
            move re-positions the same node (CSS-transitioned) instead of unmounting
            from tile A and remounting in tile B, which killed the motion */}
        {state.players.map((p, idx) => {
          if (p.bankrupt) return null;
          const g = ringToGrid(p.position);
          const base = radialShift(g.gx, g.gy, -0.52);
          const share = state.players.filter((q) => !q.bankrupt && q.position === p.position);
          const i = share.indexOf(p);
          const px = base.x + (i - (share.length - 1) / 2) * 24;
          const py = base.y - 4;
          return (
            <g key={p.id} className="iso-pawn" style={{ transform: `translate(${px}px, ${py}px)` }}>
              <ellipse cx={3} cy={20} rx={13} ry={4.5} fill="rgba(10,16,28,0.35)" />
              <circle cx={0} cy={0} r={19} fill={playerColor(idx)} stroke="#fff" strokeWidth={2.5} />
              <text x={0} y={1} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={900} fill="#0c0e13">
                {p.isAI ? "AI" : playerTag(idx)}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          pointerEvents: "none",
        }}
      >
        {endsAt !== undefined && <ClockBadge endsAt={endsAt} />}
        <div
          style={{
            background: "#17293c",
            color: "#fff",
            padding: "5px 16px",
            borderRadius: 10,
            fontFamily: "var(--font-display)",
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: 0.5,
            textTransform: "capitalize",
            boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
          }}
        >
          Round {state.round} · {state.phase.toLowerCase().replace(/_/g, " ")}
        </div>
        {state.lastRoll && <Dice key={rollSeq.current} values={state.lastRoll} size={40} />}
      </div>
    </div>
  );
}

function IsoTile({
  placed,
  state,
  activePos,
  popped,
  picking = false,
  selectable = false,
  onSelect,
}: {
  placed: Placed;
  state: GameState;
  activePos: number;
  popped: boolean;
  picking?: boolean;
  selectable?: boolean;
  onSelect?: () => void;
}): JSX.Element {
  const { square, c } = placed;
  const g = ringToGrid(square.id);
  const ownerId = state.ownership[square.id];
  const ownerIdx = ownerId ? state.players.findIndex((p) => p.id === ownerId) : -1;
  const district = groupColor(square.property?.group);
  const level = state.buildings[square.id] ?? 0;
  const boost = state.rentBoosts[square.id] ?? 1; // Copa: >1 means doubled rent
  const isActive = square.id === activePos;
  const special = square.type === "PROPERTY" ? undefined : SPECIAL_LABEL[square.type];

  const isCorner = square.id % 10 === 0;
  const isIsland = ISLAND_IDS.has(square.id);

  // corners are big square landmark tiles; everything else is a long radial lot
  // corners are square landmark tiles built from the same din/dout as the edge
  // lots so they sit flush with the ring; cc is the corner centre for icon/label
  const corner = isCorner ? cornerFace(g.gx, g.gy) : null;
  const pts = corner ? corner.pts : tileCorners(g.gx, g.gy);
  const cc = corner ? corner.center : c;
  const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");

  // property faces are near-white (--tile-face); the district colour now lives on
  // the building roof, not the tile. Corners/islands/specials keep their tints.
  const isProperty = square.type === "PROPERTY";
  const topFill = isCorner
    ? CORNER_FILL[square.id] ?? "#e7ecf5"
    : isIsland
      ? "#efd9a6"
      : isProperty
        ? "var(--tile-face)"
        : "#fbfaf5";
  // a thin neutral frame on every lot; ownership reads from the inner road-edge
  // bar (below) and the roof flag, not from a thick coloured outline.
  const edge = isCorner ? "#9aa6ba" : isIsland ? "#cbab6a" : isProperty ? "#d0cfc3" : district ? shade(district, -0.15) : "#a8b2c4";

  // text slants to the iso edge; content is anchored along the lot: price at the
  // inner (road) end, name in the middle, building at the outer (edge) end.
  // three anchors spread along the lot so they never stack: price at the inner
  // (road) end on the colour strip, name in the middle, building at the outer end.
  const rot = g.gy === 1 || g.gy === 11 ? 26.565 : -26.565;
  // price sits centred ON the district colour tag at the inner (board-facing) end
  const pricePt = radialShift(g.gx, g.gy, -0.26);
  const namePt = radialShift(g.gx, g.gy, 0.26);
  const buildPt = radialShift(g.gx, g.gy, 0.82);

  // district colour strip along the INNER (board-facing) edge — the neighbourhood
  // colour-coding, sitting under the price. pts are [outer, outer, inner, inner];
  // the strip fills the inner ~30% of the face from that road-facing edge.
  const bandStr =
    isProperty && district
      ? (() => {
          const f = 0.32; // a tag deep enough to seat the price on it
          const [o0, o1, i1, i0] = pts;
          const a = { x: i0!.x + (o0!.x - i0!.x) * f, y: i0!.y + (o0!.y - i0!.y) * f };
          const b = { x: i1!.x + (o1!.x - i1!.x) * f, y: i1!.y + (o1!.y - i1!.y) * f };
          return `${i0!.x},${i0!.y} ${i1!.x},${i1!.y} ${b.x},${b.y} ${a.x},${a.y}`;
        })()
      : null;

  // in pick mode: selectable tiles stay lit + clickable, the rest grey out
  const dimmed = picking && !selectable;
  const clickable = picking && selectable;

  return (
    <g
      transform={isActive ? "translate(0 -6)" : undefined}
      opacity={dimmed ? 0.25 : 1}
      style={{ cursor: clickable ? "pointer" : undefined, pointerEvents: dimmed ? "none" : undefined }}
      onClick={clickable ? onSelect : undefined}
    >
      {clickable && (
        <polygon points={ptsStr} fill="none" stroke="var(--accent-2)" strokeWidth={5} strokeLinejoin="round" filter="url(#glow)" />
      )}
      {isActive && (
        <polygon className="tile-pulse" points={ptsStr} fill="none" stroke="var(--accent)" strokeWidth={3.5} filter="url(#glow)" />
      )}
      {/* solid extruded side walls, drawn only for the FRONT-facing edges (those
          below the tile's centre) so the slab reads as one solid block — no faint
          back-edge overdraw. Darker tan than the cream top so the sides sit in
          shadow, with a crisp warm bottom seam. */}
      {(() => {
        const cy = (pts[0]!.y + pts[1]!.y + pts[2]!.y + pts[3]!.y) / 4;
        return pts.map((p, i) => {
          const q = pts[(i + 1) % pts.length]!;
          if ((p.y + q.y) / 2 < cy - 0.5) return null; // back edge: wall is hidden anyway
          const rightFacing = q.x > p.x;
          return (
            <g key={i}>
              <polygon
                points={`${p.x},${p.y} ${q.x},${q.y} ${q.x},${q.y + TILE_DEPTH} ${p.x},${p.y + TILE_DEPTH}`}
                fill={rightFacing ? "#a89a7c" : "#cabfa5"}
              />
              <line x1={p.x} y1={p.y + TILE_DEPTH} x2={q.x} y2={q.y + TILE_DEPTH} stroke="rgba(46,34,18,0.4)" strokeWidth={1.3} strokeLinecap="round" />
            </g>
          );
        });
      })()}
      <polygon points={ptsStr} fill={topFill} stroke={edge} strokeWidth={isProperty ? 1.5 : 2} strokeLinejoin="round" />
      {/* district colour strip — the neighbourhood colour-coding, on every lot */}
      {bandStr && (
        <polygon points={bandStr} fill={district!} stroke={shade(district!, -0.2)} strokeWidth={0.8} strokeLinejoin="round" />
      )}
      {/* thin owner-coloured bar along the OUTER edge — the subtle ownership cue.
          (the inner edge now carries the district colour strip.) */}
      {ownerIdx >= 0 && isProperty && (
        <line
          x1={pts[0]!.x}
          y1={pts[0]!.y}
          x2={pts[1]!.x}
          y2={pts[1]!.y}
          stroke={playerColor(ownerIdx)}
          strokeWidth={4}
          strokeLinecap="round"
        />
      )}

      {/* a building appears when the lot is bought and grows as it's improved;
          unowned lots stay empty slabs */}
      {isProperty && ownerIdx >= 0 && (
        <g className={popped ? "build-pop" : undefined}>
          <Building
            c={buildPt}
            level={level}
            district={district ?? "#c9cdd6"}
            ownerColor={ownerIdx >= 0 ? playerColor(ownerIdx) : undefined}
            owned={ownerIdx >= 0}
            squareId={square.id}
            maxLevel={state.tunables.maxBuildLevel}
          />
        </g>
      )}

      {/* Copa boost marker: this lot's rent is multiplied — show a ⚽ ×N pill so
          the doubled rent is visible on the board */}
      {isProperty && boost > 1 && (
        <g transform={`translate(${buildPt.x} ${buildPt.y - 52})`}>
          <ellipse cx={0} cy={0} rx={21} ry={13} fill="#e0398f" stroke="#fff" strokeWidth={2} />
          <text x={0} y={1} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={900} fill="#fff">
            ⚽×{boost}
          </text>
        </g>
      )}

      <title>{square.name}</title>
      {isCorner ? (
        <>
          <g transform={`translate(${cc.x} ${cc.y}) scale(1.95) translate(${-cc.x} ${-cc.y})`}>
            <CornerIcon id={square.id} x={cc.x} y={cc.y - 4} />
          </g>
          <text x={cc.x} y={cc.y + 30} textAnchor="middle" dominantBaseline="middle" fontSize={17} fontWeight={800} fill="#2b3a4d" stroke="#ffffff" strokeWidth={2.6} paintOrder="stroke" strokeLinejoin="round">
            {special ?? square.name}
          </text>
        </>
      ) : special ? (
        <g transform={`rotate(${rot} ${c.x} ${c.y})`}>
          <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle" fontSize={23} fontWeight={800} fill="#1b2a3a" stroke="#ffffff" strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">
            {special}
          </text>
        </g>
      ) : (
        <>
          {/* an unowned island shows a palm where its resort would stand */}
          {isIsland && ownerIdx < 0 && (
            <g transform={`translate(${buildPt.x} ${buildPt.y}) scale(1.5) translate(${-buildPt.x} ${-buildPt.y})`}>
              <Palm x={buildPt.x} y={buildPt.y} />
            </g>
          )}
          <g transform={`rotate(${rot} ${namePt.x} ${namePt.y})`}>
            <NameLabel name={square.name} x={namePt.x} y={namePt.y} />
          </g>
          {square.property && (
            <g transform={`rotate(${rot} ${pricePt.x} ${pricePt.y})`}>
              <text
                x={pricePt.x}
                y={pricePt.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="iso-num"
                fontSize={31}
                fontWeight={800}
                fill={boost > 1 ? "#c01f6f" : "#0f1e30"}
                stroke="#ffffff"
                strokeWidth={4.5}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {/* values are ×1000-scaled; a Copa boost multiplies the shown value */}
                {Math.round((square.property.price * boost) / 1000)}
                <tspan fontSize={21} dx={1}>K</tspan>
              </text>
            </g>
          )}
        </>
      )}
    </g>
  );
}

// corner tile background tints, by square id
const CORNER_FILL: Record<number, string> = {
  0: "#c9f7d8", // Largada (start) — green
  10: "#d6dbe4", // Cadeia (jail) — grey
  20: "#ffe9a8", // Copa (World Cup) — gold
  30: "#cdeafb", // Aeroporto (airport) — blue
};

// the landmark drawn on each corner
function CornerIcon({ id, x, y }: { id: number; x: number; y: number }): JSX.Element {
  if (id === 10) return <JailIcon x={x} y={y} />;
  if (id === 20) return <TrophyIcon x={x} y={y} />;
  if (id === 30) return <PlaneIcon x={x} y={y} />;
  return <FlagIcon x={x} y={y} />;
}

function FlagIcon({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <line x1={x - 7} y1={y + 7} x2={x - 7} y2={y - 13} stroke="#3a4658" strokeWidth={2} strokeLinecap="round" />
      <polygon points={`${x - 7},${y - 13} ${x + 9},${y - 9.5} ${x - 7},${y - 6}`} fill="#2bd96b" stroke="#1f9e52" strokeWidth={0.5} />
    </g>
  );
}

function JailIcon({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <rect x={x - 10} y={y - 12} width={20} height={17} rx={2} fill="#9aa6ba" stroke="#5a6a86" strokeWidth={1.2} />
      {[-5, 0, 5].map((b) => (
        <line key={b} x1={x + b} y1={y - 9} x2={x + b} y2={y + 2} stroke="#3a4658" strokeWidth={1.6} />
      ))}
      <rect x={x - 10} y={y - 12} width={20} height={4} rx={2} fill="#5a6a86" />
    </g>
  );
}

function TrophyIcon({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g stroke="#b9791a" strokeWidth={0.6}>
      <path d={`M ${x - 7},${y - 13} L ${x + 7},${y - 13} L ${x + 5},${y - 4} Q ${x},${y} ${x - 5},${y - 4} Z`} fill="#f0a81e" />
      <path d={`M ${x - 7},${y - 12} Q ${x - 12},${y - 9} ${x - 7},${y - 6}`} fill="none" />
      <path d={`M ${x + 7},${y - 12} Q ${x + 12},${y - 9} ${x + 7},${y - 6}`} fill="none" />
      <rect x={x - 1.5} y={y - 1} width={3} height={4} fill="#f0a81e" />
      <rect x={x - 5} y={y + 3} width={10} height={3} rx={1} fill="#d99017" />
    </g>
  );
}

function PlaneIcon({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g fill="#2e86ff" stroke="#1b5fbf" strokeWidth={0.5}>
      <polygon points={`${x - 10},${y} ${x + 7},${y - 2.5} ${x + 10},${y} ${x + 7},${y + 2.5}`} />
      <polygon points={`${x - 1},${y - 1.5} ${x - 6},${y - 9} ${x + 3},${y - 1.5}`} />
      <polygon points={`${x - 1},${y + 1.5} ${x - 6},${y + 9} ${x + 3},${y + 1.5}`} />
      <polygon points={`${x - 9},${y - 0.5} ${x - 12},${y - 4.5} ${x - 8},${y - 0.5}`} />
    </g>
  );
}

// split a long, spaced city name near its middle so it wraps to two lines
function splitName(raw: string): string[] {
  const name = raw.toUpperCase();
  if (name.length <= 8 || !name.includes(" ")) return [name];
  const mid = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? [name] : [name.slice(0, best), name.slice(best + 1)];
}

// the small uppercase city name with a white halo, wrapping to two lines if long
function NameLabel({ name, x, y }: { name: string; x: number; y: number }): JSX.Element {
  const lines = splitName(name);
  const baseY = y - (lines.length - 1) * 7;
  return (
    <text
      x={x}
      y={baseY}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={15}
      fontWeight={800}
      letterSpacing={0.6}
      fill="#2b3a52"
      stroke="#ffffff"
      strokeWidth={3.2}
      paintOrder="stroke"
      strokeLinejoin="round"
    >
      {lines.map((ln, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 15}>
          {ln}
        </tspan>
      ))}
    </text>
  );
}

// a little palm tree, marking the island tiles
function Palm({ x, y }: { x: number; y: number }): JSX.Element {
  return (
    <g>
      <ellipse cx={x} cy={y + 2} rx={11} ry={4} fill="rgba(120,90,40,0.25)" />
      <path d={`M ${x - 1.5} ${y} q -1 -9 1 -15 q 2 6 1.5 15 z`} fill="#8a5a2b" />
      <ellipse cx={x - 7} cy={y - 15} rx={8} ry={3.5} fill="#2b9d5a" />
      <ellipse cx={x + 7} cy={y - 15} rx={8} ry={3.5} fill="#2b9d5a" />
      <ellipse cx={x} cy={y - 18} rx={7} ry={3.5} fill="#33b869" />
      <circle cx={x} cy={y - 15} r={2} fill="#7a4f26" />
    </g>
  );
}

// Business-Tour-style building: cream house walls with a DISTRICT-coloured roof,
// present on EVERY property lot so the board reads as 8 neighbourhoods from turn
// one. The silhouette grows with build level — starter house (0), house (1),
// two-storey (2), flat-roof mid-rise (3), stepped tower (4/hotel). Ownership adds
// an owner-coloured roof pennant; unowned lots read lighter/"available".
function Building({
  c,
  level,
  district,
  ownerColor,
  owned,
  squareId,
  maxLevel,
}: {
  c: Point;
  level: number;
  district: string;
  ownerColor: string | undefined;
  owned: boolean;
  squareId: number;
  maxLevel: number;
}): JSX.Element {
  const fw = FOOT;
  const fh = fw / 2;
  const h = BUILD_HEIGHT[Math.min(level, BUILD_HEIGHT.length - 1)] ?? 0;
  const isTower = level >= maxLevel; // L4 / hotel
  const isMidRise = level === 3 && !isTower; // flat-roof mid-rise

  // neutral cream walls; unowned lots sit a touch lighter to read as "available"
  const wallL = owned ? "#f4efe3" : "#fbf8f1"; // lit (upper-left) face
  const wallR = owned ? "#d6cebb" : "#e7e0cf"; // shaded (right) face
  // the roof carries the district colour — brighter on the lit (left) slope/slab
  const roofLit = shade(district, 0.14);
  const roofDark = shade(district, -0.2);
  const winU = "#33455f";
  const winL = "#9fd0f5";

  const up = (p: Point, dh: number): Point => ({ x: p.x, y: p.y - dh });
  const vec = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
  const pts = (ps: Point[]): string => ps.map((p) => `${p.x},${p.y}`).join(" ");
  // footprint corners at half-width hw around c
  const foot = (hw: number): { back: Point; front: Point; right: Point; left: Point } => ({
    back: { x: c.x, y: c.y - hw / 2 },
    front: { x: c.x, y: c.y + hw / 2 },
    right: { x: c.x + hw, y: c.y },
    left: { x: c.x - hw, y: c.y },
  });

  // contact shadow, offset toward the lower-right and lengthened with height so
  // taller structures sit heavier on the tile
  const shadow = (
    <ellipse cx={c.x + 4 + h * 0.06} cy={c.y + fh * 0.55 + 2} rx={fw * 1.15} ry={fh * 0.85} fill="rgba(10,16,28,0.3)" />
  );
  const flag = owned && ownerColor;

  // --- flat-roof structures: mid-rise (L3) and stepped tower (L4) ---
  if (isMidRise || isTower) {
    const f = foot(fw);
    if (isTower) {
      // a wider base with a narrower upper block set back on top
      const lowerH = Math.round(h * 0.6);
      const upperH = h - lowerH;
      const u = foot(fw * 0.62);
      const uo = (p: Point): Point => up(p, lowerH); // upper block sits on the base
      return (
        <g>
          {shadow}
          <Wall o={f.right} u={vec(f.front, f.right)} h={lowerH} fill={wallR} rows={2} seed={squareId} unlit={winU} lit={winL} />
          <Wall o={f.front} u={vec(f.left, f.front)} h={lowerH} fill={wallL} rows={2} seed={squareId + 7} unlit={winU} lit={winL} door />
          {/* setback ledge: the base's flat roof, district-coloured */}
          <polygon points={pts([up(f.back, lowerH), up(f.right, lowerH), up(f.front, lowerH), up(f.left, lowerH)])} fill={roofDark} stroke="rgba(0,0,0,0.28)" strokeWidth={0.5} />
          <Wall o={uo(u.right)} u={vec(u.front, u.right)} h={upperH} fill={wallR} rows={2} seed={squareId + 3} unlit={winU} lit={winL} />
          <Wall o={uo(u.front)} u={vec(u.left, u.front)} h={upperH} fill={wallL} rows={2} seed={squareId + 11} unlit={winU} lit={winL} />
          {/* crown: the tower's flat district roof */}
          <polygon points={pts([up(u.back, h), up(u.right, h), up(u.front, h), up(u.left, h)])} fill={roofLit} stroke="rgba(0,0,0,0.28)" strokeWidth={0.5} />
          <polyline points={pts([up(u.front, h), up(u.left, h), up(u.back, h)])} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
          {flag && <Flag x={c.x} baseY={c.y - h} color={ownerColor!} />}
        </g>
      );
    }
    // mid-rise: single tall block, flat district roof + a small AC box
    const ac = foot(fw * 0.34);
    return (
      <g>
        {shadow}
        <Wall o={f.right} u={vec(f.front, f.right)} h={h} fill={wallR} rows={3} seed={squareId} unlit={winU} lit={winL} />
        <Wall o={f.front} u={vec(f.left, f.front)} h={h} fill={wallL} rows={3} seed={squareId + 7} unlit={winU} lit={winL} door />
        <polygon points={pts([up(f.back, h), up(f.right, h), up(f.front, h), up(f.left, h)])} fill={roofLit} stroke="rgba(0,0,0,0.28)" strokeWidth={0.5} />
        <polyline points={pts([up(f.front, h), up(f.left, h), up(f.back, h)])} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
        {/* small rooftop AC/utility box */}
        <polygon points={pts([up(ac.back, h + 9), up(ac.right, h + 9), up(ac.front, h + 9), up(ac.left, h + 9)])} fill="#b8bcc6" stroke="rgba(0,0,0,0.25)" strokeWidth={0.4} />
        <polygon points={pts([up(ac.right, h + 9), up(ac.front, h + 9), up(ac.front, h), up(ac.right, h)])} fill="#8b909c" />
        <polygon points={pts([up(ac.front, h + 9), up(ac.left, h + 9), up(ac.left, h), up(ac.front, h)])} fill="#a2a7b2" />
        {flag && <Flag x={c.x} baseY={c.y - h} color={ownerColor!} />}
      </g>
    );
  }

  // --- houses (L0..L2): body + peaked gable roof, growing with level ---
  const f = foot(fw);
  const rise = fh + level * 4; // steeper ridge as the house grows
  const ridgeBack = up(f.back, h + rise);
  const ridgeFront = up(f.front, h + rise);
  const eaveLeft = up(f.left, h);
  const eaveRight = up(f.right, h);
  const rows = level === 0 ? 1 : 2;
  return (
    <g>
      {shadow}
      <Wall o={f.right} u={vec(f.front, f.right)} h={h} fill={wallR} rows={rows} seed={squareId} unlit={winU} lit={winL} />
      <Wall o={f.front} u={vec(f.left, f.front)} h={h} fill={wallL} rows={rows} seed={squareId + 7} unlit={winU} lit={winL} door />
      {/* two triangular slopes meeting at a raised back→front ridge: right slope
          shaded (away from the light), left slope lit */}
      <polygon points={pts([ridgeBack, eaveRight, ridgeFront])} fill={roofDark} stroke="rgba(0,0,0,0.28)" strokeWidth={0.5} />
      <polygon points={pts([ridgeBack, eaveLeft, ridgeFront])} fill={roofLit} stroke="rgba(0,0,0,0.28)" strokeWidth={0.5} />
      {/* bright rim tracing the lit upper-left roof edges */}
      <polyline points={pts([ridgeFront, eaveLeft, ridgeBack])} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
      {flag && <Flag x={c.x} baseY={c.y - (h + rise)} color={ownerColor!} />}
    </g>
  );
}

// a small owner-coloured pennant planted on a building's roof — the sole marker
// that a lot has been bought (the roof itself always shows the district colour)
function Flag({ x, baseY, color }: { x: number; baseY: number; color: string }): JSX.Element {
  return (
    <g>
      <line x1={x} y1={baseY} x2={x} y2={baseY - 16} stroke="#e9ecf4" strokeWidth={1.5} />
      <polygon points={`${x},${baseY - 16} ${x + 13},${baseY - 12} ${x},${baseY - 8}`} fill={color} stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
    </g>
  );
}

// one wall, drawn as a unit square skewed into the iso parallelogram so windows
// can be placed in simple [0..1] coordinates.
function Wall({
  o,
  u,
  h,
  fill,
  rows,
  seed,
  unlit,
  lit,
  door = false,
}: {
  o: Point;
  u: Point; // vector along the wall's bottom edge
  h: number;
  fill: string;
  rows: number;
  seed: number;
  unlit: string;
  lit: string;
  door?: boolean;
}): JSX.Element {
  const cols = 2;
  const m = `matrix(${u.x}, ${u.y}, 0, ${-h}, ${o.x}, ${o.y})`;
  const mx = 0.2;
  const my = 0.14;
  const cellW = (1 - 2 * mx) / cols;
  const cellH = (1 - 2 * my) / rows;
  const windows: JSX.Element[] = [];
  for (let r = 0; r < rows; r++) {
    for (let cN = 0; cN < cols; cN++) {
      const on = (seed + r * 3 + cN * 2) % 3 !== 0;
      windows.push(
        <rect
          key={`${r}-${cN}`}
          x={mx + cN * cellW + cellW * 0.2}
          y={my + r * cellH + cellH * 0.2}
          width={cellW * 0.6}
          height={cellH * 0.56}
          rx={0.015}
          fill={on ? lit : unlit}
        />,
      );
    }
  }
  return (
    <g transform={m}>
      <rect x={0} y={0} width={1} height={1} fill={fill} />
      {windows}
      {door && <rect x={0.4} y={0} width={0.2} height={0.36} rx={0.02} fill="#7a5230" />}
    </g>
  );
}
