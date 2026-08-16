import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../i18n/index.js";
import { MAX_NAME_LEN, useProfile } from "../store/profile.js";
import { resolveLook } from "../game/avatars.js";
import { AvatarThumb } from "./AvatarThumb.js";
import { DEV } from "../devMode.js";
import { HowToWin } from "./HowToWin.js";

// game-length options (minutes) and player-count options for an online room
const LENGTHS = [5, 10, 15, 20, 30];
const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

export function Menu({
  invite,
  onHotseat,
  onVsAI,
  onDuelPractice,
  onAirportPractice,
  onCopaPractice,
  onWinTest,
  onFloorBrawl,
  onFloorDrop,
  onFloorDropOnline,
  onBrawl,
  onBomber,
  onBarn,
  onShop,
  onControls,
  onLanguage,
  onCreate,
  onJoin,
}: {
  // room code from an invite link: prefills the join box and asks for a name first
  invite: string;
  onHotseat: () => void;
  onVsAI: () => void;
  onDuelPractice: () => void;
  onAirportPractice: () => void;
  onCopaPractice: () => void;
  onWinTest: () => void;
  onFloorBrawl: () => void;
  onFloorDrop: () => void;
  onFloorDropOnline: () => void;
  onBrawl: () => void;
  onBomber: () => void;
  onBarn: () => void;
  onShop: () => void;
  onControls: () => void;
  onLanguage: () => void;
  onCreate: (durationSec: number, maxPlayers: number) => void;
  onJoin: (roomId: string) => void;
}): JSX.Element {
  const [code, setCode] = useState(invite);
  const [lengthMin, setLengthMin] = useState(15);
  const [players, setPlayers] = useState(4);
  const [rules, setRules] = useState(false);
  const t = useT();
  const name = useProfile((s) => s.name);
  const setName = useProfile((s) => s.setName);
  const avatar = useProfile((s) => s.avatar);
  const color = useProfile((s) => s.color);
  const hat = useProfile((s) => s.hat);

  // the invite code lands a tick after mount (it's read once the session restore
  // settles), so fill the join box when it shows up
  useEffect(() => {
    if (invite) setCode(invite);
  }, [invite]);

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
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <p style={{ marginTop: 4, color: "var(--muted)", letterSpacing: 2, textTransform: "uppercase", fontSize: 12 }}>
            Tour Brasil
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ padding: "4px 10px", fontSize: 12 }} onClick={onLanguage} title={t("Language")}>
              🌐 {t("Language")}
            </button>
            <button style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setRules(true)}>
              {t("How to win")}
            </button>
          </div>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
          {/* Identity first: your name and character are what everyone else sees,
              so they belong at the top rather than buried under "Practice". */}
          <Card title={t("You")}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={onShop}
                title="Change your character"
                style={{ padding: 4, borderRadius: 12, background: "var(--panel-2)", border: "2px solid var(--border)", cursor: "pointer", lineHeight: 0 }}
              >
                <AvatarThumb av={resolveLook({ av: avatar, color, hat })} size={64} />
              </button>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={name}
                  maxLength={MAX_NAME_LEN}
                  autoFocus={!!invite && !name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("your name")}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={{ flex: 1 }} onClick={onShop}>
                    🎨 {t("Character")}
                  </button>
                  <button style={{ flex: 1 }} onClick={onControls}>
                    ⌨️ {t("Controls")}
                  </button>
                </div>
              </div>
            </div>
          </Card>

          <Card title={t("Local")}>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="primary" style={{ flex: 1 }} onClick={onHotseat}>
                {t("Hotseat")}
              </button>
              <button style={{ flex: 1 }} onClick={onVsAI}>
                {t("Play vs AI")}
              </button>
            </div>
          </Card>

          <Card title={t("Practice")}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* diagnostic harnesses — useful while building, noise for a player */}
              {DEV && (
                <>
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
                </>
              )}
              <button style={{ width: "100%" }} onClick={onFloorBrawl}>
                Floor Brawl — break-the-floor survival
              </button>
              <button style={{ width: "100%" }} onClick={onFloorDrop}>
                Floor Drop — dodge the collapsing floor
              </button>
              <button style={{ width: "100%" }} onClick={onFloorDropOnline}>
                🌐 Floor Drop ONLINE — real-time PvP vs friends (beta)
              </button>
              <button style={{ width: "100%" }} onClick={onBrawl}>
                Brawl: Showdown — 3D arena brawler with Supers
              </button>
              <button style={{ width: "100%" }} onClick={onBomber}>
                Bomber — Bomberman-style maze battle
              </button>
              <button style={{ width: "100%" }} onClick={onBarn}>
                Barn Brawl — 3D arena shooter, most kills
              </button>
            </div>
          </Card>

          <Card title={t("Online")}>
            {invite && (
              <div style={{ marginBottom: 10, padding: 10, borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--accent)", fontSize: 13 }}>
                🎟️ You were invited to room <strong style={{ fontFamily: "monospace" }}>{invite}</strong> — set your name above, then Join.
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, color: "var(--muted)" }}>
              {t("Players")}
              <select value={players} onChange={(e) => setPlayers(Number(e.target.value))} style={{ flex: 1, padding: 6 }}>
                {PLAYER_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {t("{n} players", { n })}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, color: "var(--muted)" }}>
              {t("Game length")}
              <select value={lengthMin} onChange={(e) => setLengthMin(Number(e.target.value))} style={{ flex: 1, padding: 6 }}>
                {LENGTHS.map((m) => (
                  <option key={m} value={m}>
                    {t("{m} minutes", { m })}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" style={{ width: "100%", marginBottom: 12 }} onClick={() => onCreate(lengthMin * 60, players)}>
              {t("Create room")}
            </button>
            <form
              style={{ display: "flex", gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                const id = code.trim();
                if (id) onJoin(id);
              }}
            >
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("room code")} style={{ flex: 1 }} />
              <button type="submit" disabled={!code.trim()}>
                {t("Join")}
              </button>
            </form>
          </Card>
        </section>
      </div>
      {rules && <HowToWin onClose={() => setRules(false)} />}
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
