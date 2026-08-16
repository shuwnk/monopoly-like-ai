import { useEffect, useState } from "react";
import { useT } from "../i18n/index.js";
import { BIND_ACTIONS, BIND_LABELS, DEFAULT_BINDS, keyLabel, resolveBinds, type BindAction } from "../game/keybinds.js";
import { useProfile } from "../store/profile.js";

// Remap the movement keys. One binding set is shared by every minigame, so a
// change here applies to Floor Drop, Bomber, Barn Brawl, the party rounds — all
// of it — and takes effect immediately, no restart.
export function Controls({ onLeave }: { onLeave: () => void }): JSX.Element {
  const saved = useProfile((s) => s.binds);
  const setBind = useProfile((s) => s.setBind);
  const resetBinds = useProfile((s) => s.resetBindsToDefault);
  const binds = resolveBinds(saved);
  const t = useT();

  // which slot is listening for a keypress: `${action}:${index}`
  const [listening, setListening] = useState<string | null>(null);
  const [clash, setClash] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const [action, slotStr] = listening.split(":");
    const slot = Number(slotStr);

    function onKey(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(null);
        return;
      }
      const key = e.key.toLowerCase();
      // taking a key from another action would leave that one unreachable
      const owner = BIND_ACTIONS.find((a) => a !== action && binds[a].includes(key));
      if (owner) {
        setClash(t("{key} is already used for “{action}”", { key: keyLabel(key), action: t(BIND_LABELS[owner]) }));
        setListening(null);
        return;
      }
      const next = [...binds[action as BindAction]];
      next[slot] = key;
      setBind(action as BindAction, next.filter(Boolean));
      setClash(null);
      setListening(null);
    }
    // capture, so the key never reaches a game listener while rebinding
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening, binds, setBind]);

  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 560, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{t("Controls")}</h1>
        <button onClick={onLeave}>{t("Back")}</button>
      </header>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
        {t("Used by every minigame. Click a key to change it, then press the new one — Esc cancels.")}
      </p>

      {clash && (
        <div style={{ margin: "10px 0", padding: 10, borderRadius: 8, background: "#3a2f1d", border: "1px solid #a83", fontSize: 13 }}>{clash}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {BIND_ACTIONS.map((action) => (
          <div
            key={action}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 10,
              background: "var(--panel-2)",
              border: "1px solid var(--border)",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t(BIND_LABELS[action])}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 1].map((slot) => {
                const key = binds[action][slot];
                const id = `${action}:${slot}`;
                const live = listening === id;
                if (!key && slot === 1 && binds[action].length <= 1 && !live) {
                  return (
                    <button key={slot} onClick={() => setListening(id)} style={keyStyle(false)} title={t("Add a second key")}>
                      +
                    </button>
                  );
                }
                return (
                  <button key={slot} onClick={() => setListening(id)} style={keyStyle(live)}>
                    {live ? t("press a key…") : keyLabel(key ?? "")}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
        <button onClick={resetBinds}>{t("Reset to defaults")}</button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {t("Default: {keys} to move, Space to jump", { keys: DEFAULT_BINDS.up.map(keyLabel).join(" / ") })}
        </span>
      </div>
    </main>
  );
}

function keyStyle(live: boolean): React.CSSProperties {
  return {
    minWidth: 78,
    padding: "6px 10px",
    borderRadius: 8,
    fontFamily: "monospace",
    fontWeight: 800,
    fontSize: 13,
    cursor: "pointer",
    background: live ? "var(--accent)" : "var(--panel)",
    color: live ? "#0b0d12" : "inherit",
    border: `2px solid ${live ? "var(--accent)" : "var(--border)"}`,
  };
}
