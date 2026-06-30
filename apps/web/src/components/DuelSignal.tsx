// the go cue never rests on hue alone: shape (square->circle), a glyph, and
// text all change with it, so it reads for colorblind players too.
export function DuelSignal({ lit, message }: { lit: boolean; message: string }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: 20,
        borderRadius: 4,
        background: lit ? "#0e3d12" : "#3d0e0e",
      }}
    >
      <div
        aria-label={lit ? "go" : "wait"}
        style={{
          width: 88,
          height: 88,
          background: lit ? "#27c93f" : "#ff4d4d",
          color: "#0a0a0a",
          borderRadius: lit ? "50%" : 10,
          border: "3px solid #fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 38,
          fontWeight: 800,
        }}
      >
        {lit ? "●" : "■"}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{message}</div>
    </div>
  );
}
