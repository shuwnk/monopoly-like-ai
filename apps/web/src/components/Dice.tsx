// A single die face drawn as pips on a rounded white tile — reads far better
// than "[3, 5]" and gives the board a tactile, Business-Tour-ish feel.

// which of the 9 grid cells are filled for each face value (1..6)
const PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Die({
  value,
  size = 34,
  face = "linear-gradient(155deg, #ff5fa2 0%, #e0398f 100%)",
  pipColor = "#ffffff",
}: {
  value: number;
  size?: number;
  face?: string;
  pipColor?: string;
}): JSX.Element {
  const on = new Set(PIPS[value] ?? []);
  const pip = Math.max(3, Math.round(size * 0.16));
  return (
    <div
      aria-label={`die showing ${value}`}
      className="die-anim"
      style={{
        width: size,
        height: size,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gridTemplateRows: "repeat(3, 1fr)",
        placeItems: "center",
        padding: size * 0.12,
        borderRadius: Math.round(size * 0.22),
        background: face,
        boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.22), 0 3px 8px rgba(0,0,0,0.45)",
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          style={{
            width: pip,
            height: pip,
            borderRadius: "50%",
            background: on.has(i) ? pipColor : "transparent",
          }}
        />
      ))}
    </div>
  );
}

export function Dice({
  values,
  size = 34,
  face,
  pipColor,
}: {
  values: readonly number[];
  size?: number;
  face?: string;
  pipColor?: string;
}): JSX.Element {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {values.map((v, i) => (
        <Die key={i} value={v} size={size} {...(face ? { face } : {})} {...(pipColor ? { pipColor } : {})} />
      ))}
    </div>
  );
}
