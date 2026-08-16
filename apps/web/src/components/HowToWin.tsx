import type { ReactNode } from "react";
import { useT } from "../i18n/index.js";
import { DEFAULT_TUNABLES, type GameTunables } from "@party-monopoly/engine";
import { CURRENCY } from "../theme.js";

// The one screen a first-time player needs: how a game ends and where money comes
// from. Shown from the menu and once in an online lobby, so nobody starts a match
// with friends without knowing what they're racing for.
export function HowToWin({ tunables = DEFAULT_TUNABLES, onClose }: { tunables?: GameTunables; onClose: () => void }): JSX.Element {
  const t = useT();
  const goal = `${CURRENCY}${Math.round(tunables.netWorthGoal / 1000)}K`;
  const start = `${CURRENCY}${Math.round(tunables.startingMoney / 1000)}K`;

  return (
    <div
      role="dialog"
      aria-label="How to win"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(6,8,12,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          padding: 22,
          borderRadius: "var(--radius)",
          background: "linear-gradient(165deg, var(--panel-2) 0%, var(--panel) 100%)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 900 }}>{t("How to win")}</h2>
        <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: 13 }}>
          {t("Everyone starts with {start}. A game ends three ways — whichever comes first.", { start })}
        </p>

        <Way n={1} title={t("Get rich")}>
          {t("First player to {goal} net worth (cash plus what your properties and houses are worth) wins on the spot.", { goal })}
        </Way>
        <Way n={2} title={t("Last one standing")}>
          {t("Bankrupt everyone else. Run out of money with rent to pay and you're out.")}
        </Way>
        <Way n={3} title={t("Beat the clock")}>
          {t("When the host's timer hits zero, the richest player takes it.")}
        </Way>

        <h3 style={{ margin: "18px 0 8px", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--muted)" }}>
          {t("Where the money comes from")}
        </h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.65 }}>
          <li>
            <strong>{t("Rent.")}</strong> {t("Own a stall, charge whoever lands on it.")}
          </li>
          <li>
            <strong>{t("Build.")}</strong>{" "}
            {t("Land on your own stall and add a house — up to a hotel, worth {mult}× the bare rent.", {
              mult: String(tunables.houseRentMultipliers[tunables.maxBuildLevel]),
            })}
          </li>
          <li>
            <strong>{t("Rent showdowns.")}</strong>{" "}
            {t("Every rent payment is a reflex duel: tap first as the payer and you pay half, tap first as the owner and you collect {mult}×.", {
              mult: String(tunables.rentMultipliers.ownerWin),
            })}
          </li>
          <li>
            <strong>{t("Party rounds.")}</strong>{" "}
            {t("Every {laps} laps everyone drops into a minigame; placement pays out, so skill can drag you back into the race.", {
              laps: tunables.partyRoundEveryLaps,
            })}
          </li>
          <li>
            <strong>{t("Copa & Aeroporto.")}</strong>{" "}
            {t("Copa doubles one of your stalls' rent for good; Aeroporto flies you anywhere on the board.")}
          </li>
        </ul>

        <button className="primary" style={{ width: "100%", marginTop: 20 }} onClick={onClose}>
          {t("Got it")}
        </button>
      </div>
    </div>
  );
}

function Way({ n, title, children }: { n: number; title: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
      <div
        style={{
          flex: "0 0 26px",
          height: 26,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: "var(--accent)",
          color: "#0b0d12",
          fontWeight: 900,
          fontSize: 14,
        }}
      >
        {n}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        <strong>{title}.</strong> {children}
      </div>
    </div>
  );
}
