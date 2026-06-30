import { useState } from "react";

export function Menu({
  onHotseat,
  onVsAI,
  onDuelPractice,
  onCreate,
  onJoin,
}: {
  onHotseat: () => void;
  onVsAI: () => void;
  onDuelPractice: () => void;
  onCreate: () => void;
  onJoin: (roomId: string) => void;
}): JSX.Element {
  const [code, setCode] = useState("");

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", color: "#eee", background: "#111", minHeight: "100vh", padding: 24 }}>
      <h1>Party Monopoly</h1>
      <p style={{ marginTop: -8, opacity: 0.6 }}>Neon Night Market</p>

      <section style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 360 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Local</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ padding: "8px 16px" }} onClick={onHotseat}>
              Hotseat (same screen)
            </button>
            <button style={{ padding: "8px 16px" }} onClick={onVsAI}>
              Play vs AI
            </button>
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: 18 }}>Practice</h2>
          <button style={{ padding: "8px 16px" }} onClick={onDuelPractice}>
            Duel Practice
          </button>
        </div>

        <div>
          <h2 style={{ fontSize: 18 }}>Online</h2>
          <button style={{ padding: "8px 16px", marginBottom: 12 }} onClick={onCreate}>
            Create room
          </button>
          <form
            style={{ display: "flex", gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const id = code.trim();
              if (id) onJoin(id);
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="room code"
              style={{ flex: 1, padding: 8 }}
            />
            <button type="submit" disabled={!code.trim()}>
              Join
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
