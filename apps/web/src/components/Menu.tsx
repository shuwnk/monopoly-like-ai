import { useState, type ReactNode } from "react";

// game-length options (minutes) and player-count options for an online room
const LENGTHS = [5, 10, 15, 20, 30];
const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

export function Menu({
  onHotseat,
  onVsAI,
  onDuelPractice,
  onAirportPractice,
  onCopaPractice,
  onWinTest,
  onCreate,
  onJoin,
}: {
  onHotseat: () => void;
  onVsAI: () => void;
  onDuelPractice: () => void;
  onAirportPractice: () => void;
  onCopaPractice: () => void;
  onWinTest: () => void;
  onCreate: (durationSec: number, maxPlayers: number) => void;
  onJoin: (roomId: string) => void;
}): JSX.Element {
  const [code, setCode] = useState("");
  const [lengthMin, setLengthMin] = useState(15);
  const [players, setPlayers] = useState(4);

  return (
    <main style={{ minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ width: "100%", maxWidth: 460, marginTop: "6vh" }}>
        <h1
          style={{
            margin: 0,
            fontSize: 42,
            fontWeight: 900,
            letterSpacing: 0.5,
            background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Party Monopoly
        </h1>
        <p style={{ marginTop: 4, color: "var(--muted)", letterSpacing: 2, textTransform: "uppercase", fontSize: 12 }}>
          Tour Brasil
        </p>

        <section style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
          <Card title="Local">
            <div style={{ display: "flex", gap: 10 }}>
              <button className="primary" style={{ flex: 1 }} onClick={onHotseat}>
                Hotseat
              </button>
              <button style={{ flex: 1 }} onClick={onVsAI}>
                Play vs AI
              </button>
            </div>
          </Card>

          <Card title="Practice">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button style={{ width: "100%" }} onClick={onDuelPractice}>
                Duel Practice — reflex fairness gate
              </button>
              <button style={{ width: "100%" }} onClick={onAirportPractice}>
                Airport Practice — test the fly-to picker
              </button>
              <button style={{ width: "100%" }} onClick={onCopaPractice}>
                Copa Practice — test the boost picker
              </button>
              <button style={{ width: "100%" }} onClick={onWinTest}>
                Win Conditions — trigger &amp; verify each win
              </button>
            </div>
          </Card>

          <Card title="Online">
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, color: "var(--muted)" }}>
              Players
              <select value={players} onChange={(e) => setPlayers(Number(e.target.value))} style={{ flex: 1, padding: 6 }}>
                {PLAYER_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n} players
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, color: "var(--muted)" }}>
              Game length
              <select value={lengthMin} onChange={(e) => setLengthMin(Number(e.target.value))} style={{ flex: 1, padding: 6 }}>
                {LENGTHS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" style={{ width: "100%", marginBottom: 12 }} onClick={() => onCreate(lengthMin * 60, players)}>
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
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="room code" style={{ flex: 1 }} />
              <button type="submit" disabled={!code.trim()}>
                Join
              </button>
            </form>
          </Card>
        </section>
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: "var(--radius)",
        background: "linear-gradient(165deg, var(--panel-2) 0%, var(--panel) 100%)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--muted)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}
