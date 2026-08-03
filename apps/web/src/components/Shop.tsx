import { useEffect, useRef } from "react";
import { AVATARS, drawAvatar, type Avatar } from "../game/avatars.js";
import { SHOP, useProfile, type ShopItem } from "../store/profile.js";

// a mascot rendered to a small canvas for the picker
function AvatarThumb({ av, size = 56 }: { av: Avatar; size?: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    drawAvatar(ctx, av, size / 2, size / 2 - size * 0.06, size * 0.34, -Math.PI / 2);
  }, [av, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} />;
}

// Shop + loadout screen: spend coins earned from the minigames to unlock weapons
// and brawlers, and equip which one you take into a match.

export function Shop({ onLeave }: { onLeave: () => void }): JSX.Element {
  const { coins, owned, weapon, brawler, avatar, buy, equip, setAvatar } = useProfile();

  const row = (item: ShopItem): JSX.Element => {
    const isOwned = owned.includes(item.id);
    const equipped = isOwned && (item.kind === "weapon" ? weapon : brawler) === item.key;
    return (
      <div
        key={item.id}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 10,
          background: "var(--panel-2)",
          border: `1px solid ${equipped ? "var(--accent)" : "var(--border)"}`,
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{item.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{item.desc}</div>
        </div>
        {!isOwned ? (
          <button className="primary" disabled={coins < item.cost} onClick={() => buy(item)} style={{ whiteSpace: "nowrap" }}>
            🪙 {item.cost}
          </button>
        ) : equipped ? (
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--accent)" }}>Equipped</span>
        ) : (
          <button onClick={() => equip(item)}>Equip</button>
        )}
      </div>
    );
  };

  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Shop &amp; Loadout</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>🪙 {coins}</div>
          <button onClick={onLeave}>Back</button>
        </div>
      </header>

      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>Earn coins by playing the minigames (kills and placement pay out). Pick your character — it's your look across every game and your kit in Brawl: Showdown.</p>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>🧑 Your character</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {AVATARS.map((av) => (
            <button
              key={av.id}
              onClick={() => setAvatar(av.id)}
              title={av.name}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                padding: 6,
                borderRadius: 10,
                background: "var(--panel-2)",
                border: `2px solid ${avatar === av.id ? "var(--accent)" : "transparent"}`,
                cursor: "pointer",
              }}
            >
              <AvatarThumb av={av} />
              <span style={{ fontSize: 11, fontWeight: 700 }}>{av.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>🎒 Gear</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{SHOP.map(row)}</div>
      </section>
    </main>
  );
}
