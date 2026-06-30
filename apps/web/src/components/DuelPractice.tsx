import { useState } from "react";
import { asMinigameId, asPlayerId, type MinigameRequest } from "@party-monopoly/types";
import { aggregate, toRecord, type DuelRecord } from "../telemetry/duel.js";
import { ReflexTapDuel } from "./ReflexTapDuel.js";

// Phase 0 fairness gate: runs the reflex duel back-to-back with no board, so
// testers can judge the core mechanic in isolation. Two humans hotseat (Payer A,
// Owner L). After each duel we record telemetry and arm the next one.

const PAYER = asPlayerId("practice-p0");
const OWNER = asPlayerId("practice-p1");

const REQUEST: MinigameRequest = {
  minigameId: asMinigameId("reflex-tap-duel"),
  participants: [
    { playerId: PAYER, isAI: false },
    { playerId: OWNER, isAI: false },
  ],
  context: { reason: "RENT_SHOWDOWN", stakeData: { baseRent: 0, propertyId: 0 } },
  config: {},
};

export function DuelPractice({ onLeave }: { onLeave: () => void }): JSX.Element {
  const [records, setRecords] = useState<readonly DuelRecord[]>([]);
  // bumped each duel; doubles as the remount key and a "between rounds" flag
  const [round, setRound] = useState(0);
  const [armed, setArmed] = useState(true);

  const stats = aggregate(records);

  function next(): void {
    setRound((r) => r + 1);
    setArmed(true);
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", color: "#eee", background: "#111", minHeight: "100vh", padding: 24 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Party Monopoly — Duel Practice</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              setRecords([]);
              next();
            }}
          >
            Reset
          </button>
          <button onClick={onLeave}>Leave</button>
        </div>
      </header>

      <Scoreboard stats={stats} />

      {armed ? (
        <ReflexTapDuel
          key={round}
          request={REQUEST}
          onResult={() => {
            // adjudication already captured via onMetrics; just pause for "next"
            setArmed(false);
          }}
          onMetrics={(result, inputs) => setRecords((rs) => [...rs, toRecord(result, inputs)])}
        />
      ) : (
        <section style={{ margin: "16px 0", padding: 24, textAlign: "center", border: "1px solid #444", borderRadius: 4 }}>
          <button style={{ padding: "12px 24px", fontSize: 18 }} onClick={next}>
            Next duel
          </button>
        </section>
      )}
    </main>
  );
}

function Scoreboard({ stats }: { stats: ReturnType<typeof aggregate> }): JSX.Element {
  const cell = { padding: 8, border: "1px solid #444" } as const;
  return (
    <section style={{ margin: "16px 0" }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Duels played: {stats.played}</strong>
      </div>
      <table style={{ borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            <th style={cell}></th>
            <th style={cell}>P0 (Payer / A)</th>
            <th style={cell}>P1 (Owner / L)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}>wins</td>
            <td style={cell}>{stats.p0Wins}</td>
            <td style={cell}>{stats.p1Wins}</td>
          </tr>
          <tr>
            <td style={cell}>win rate</td>
            <td style={cell}>{pct(stats.p0WinRate)}</td>
            <td style={cell}>{pct(stats.p1WinRate)}</td>
          </tr>
          <tr>
            <td style={cell}>avg reaction</td>
            <td style={cell}>{ms(stats.p0AvgReactionMs)}</td>
            <td style={cell}>{ms(stats.p1AvgReactionMs)}</td>
          </tr>
          <tr>
            <td style={cell}>false starts</td>
            <td style={cell}>{stats.p0FalseStarts}</td>
            <td style={cell}>{stats.p1FalseStarts}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 8, opacity: 0.7 }}>draws: {stats.draws}</div>
    </section>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function ms(n: number | null): string {
  return n === null ? "—" : `${Math.round(n)} ms`;
}
