import { AVATARS, BODY_COLORS, HATS, resolveLook } from "../game/avatars.js";
import { useT } from "../i18n/index.js";
import { SHOP, useProfile, type ShopItem } from "../store/profile.js";
import { AvatarThumb } from "./AvatarThumb.js";

// Shop + loadout screen: spend coins earned from the minigames to unlock weapons
// and brawlers, and equip which one you take into a match.

export function Shop({ onLeave }: { onLeave: () => void }): JSX.Element {
  const { coins, owned, weapon, brawler, avatar, color, hat, buy, equip, setAvatar, setColor, setHat } = useProfile();
  // what everyone else will actually see: mascot + colour + accessory together
  const me = resolveLook({ av: avatar, color, hat });
  const t = useT();

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
        <h1 style={{ margin: 0, fontSize: 24 }}>{t("Shop & Loadout")}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>🪙 {coins}</div>
          <button onClick={onLeave}>{t("Back")}</button>
        </div>
      </header>

      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>Earn coins by playing the minigames (kills and placement pay out). Pick your character — it's your look across every game and your kit in Brawl: Showdown.</p>

      <section style={{ marginTop: 18, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        {/* live preview of the exact look other players will see */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: 16,
            borderRadius: 12,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            minWidth: 150,
          }}
        >
          <AvatarThumb av={me} size={104} />
          <span style={{ fontSize: 12, fontWeight: 800 }}>{me.name}</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("this is what others see")}</span>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>🧑 {t("Character")}</h2>
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
                <AvatarThumb av={resolveLook({ av: av.id, color, hat })} />
                <span style={{ fontSize: 11, fontWeight: 700 }}>{av.name}</span>
              </button>
            ))}
          </div>

          <h2 style={{ fontSize: 16, margin: "18px 0 8px" }}>🎨 {t("Colour")}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Swatch label={t("Default")} swatch="" active={color === ""} onPick={() => setColor("")} />
            {BODY_COLORS.map((c) => (
              <Swatch key={c} label={c} swatch={c} active={color === c} onPick={() => setColor(c)} />
            ))}
          </div>

          <h2 style={{ fontSize: 16, margin: "18px 0 8px" }}>🎩 {t("Accessory")}</h2>
          <p style={{ margin: "-4px 0 8px", fontSize: 12, color: "var(--muted)" }}>
            {t("Looks only — a helmet won't save you from anything.")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <HatChip label={t("None")} active={hat === ""} onPick={() => setHat("")} />
            {HATS.map((h) => (
              <HatChip key={h.id} label={h.name} dot={h.color} active={hat === h.id} onPick={() => setHat(h.id)} />
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>🎒 {t("Gear")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{SHOP.map(row)}</div>
      </section>
    </main>
  );
}

// one body-colour choice; the empty swatch means "keep the mascot's own palette"
function Swatch({ label, swatch, active, onPick }: { label: string; swatch: string; active: boolean; onPick: () => void }): JSX.Element {
  return (
    <button
      onClick={onPick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        padding: 0,
        cursor: "pointer",
        background: swatch || "linear-gradient(135deg, #ff7043 50%, #4fc3f7 50%)",
        border: `3px solid ${active ? "var(--accent)" : "rgba(255,255,255,0.18)"}`,
        boxShadow: active ? "0 0 0 2px rgba(0,0,0,0.35)" : "none",
      }}
    />
  );
}

function HatChip({ label, dot, active, onPick }: { label: string; dot?: string; active: boolean; onPick: () => void }): JSX.Element {
  return (
    <button
      onClick={onPick}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        background: "var(--panel-2)",
        border: `2px solid ${active ? "var(--accent)" : "transparent"}`,
      }}
    >
      {dot && <span style={{ width: 10, height: 10, borderRadius: "50%", background: dot }} />}
      {label}
    </button>
  );
}
