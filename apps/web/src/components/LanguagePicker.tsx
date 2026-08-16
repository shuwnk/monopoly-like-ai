import { useRef, useState } from "react";
import {
  addCustomLanguage,
  coverage,
  getLocale,
  languages,
  removeCustomLanguage,
  setLocale,
  useT,
} from "../i18n/index.js";
import { STRINGS } from "../i18n/strings.js";

// Pick a language, or add one. Anyone can translate the game: download the
// template (every string in the app, with the English pre-filled), replace the
// values, load it back. It lives in this browser and is usable immediately —
// no build step, no pull request, no waiting on us.
export function LanguagePicker({ onLeave }: { onLeave: () => void }): JSX.Element {
  const t = useT();
  const [, force] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const langs = languages();
  const current = getLocale();

  function downloadTemplate(): void {
    // pre-fill with English so a translator overwrites rather than starts blank,
    // and a half-finished file still works
    const catalog = Object.fromEntries(STRINGS.map((s) => [s, s]));
    const body = { code: "xx", label: "My language", catalog };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "party-monopoly-translation.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function load(file: File): Promise<void> {
    setErr(null);
    setNote(null);
    try {
      const parsed = JSON.parse(await file.text()) as { code?: unknown; label?: unknown; catalog?: unknown };
      if (typeof parsed.code !== "string" || !parsed.code.trim()) throw new Error(t('The file needs a "code", like "fr" or "ja".'));
      if (typeof parsed.label !== "string" || !parsed.label.trim()) throw new Error(t('The file needs a "label" — the language\'s name.'));
      if (typeof parsed.catalog !== "object" || !parsed.catalog) throw new Error(t('The file needs a "catalog" of translations.'));
      const catalog: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.catalog as Record<string, unknown>)) if (typeof v === "string" && v) catalog[k] = v;
      addCustomLanguage({ code: parsed.code.trim(), label: parsed.label.trim(), catalog });
      setLocale(parsed.code.trim());
      const pct = Math.round(coverage(catalog, STRINGS) * 100);
      setNote(t("Added {label} — {pct}% translated.", { label: parsed.label, pct }));
      force((n) => n + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("That file could not be read."));
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: 24, maxWidth: 560, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{t("Language")}</h1>
        <button onClick={onLeave}>{t("Back")}</button>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {langs.map((l) => {
          const pct = l.code === "en" ? 100 : Math.round(coverage(l.catalog, STRINGS) * 100);
          return (
            <div
              key={l.code}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: 10,
                background: "var(--panel-2)",
                border: `2px solid ${current === l.code ? "var(--accent)" : "transparent"}`,
              }}
            >
              <button
                onClick={() => {
                  setLocale(l.code);
                  force((n) => n + 1);
                }}
                style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <div style={{ fontWeight: 800, fontSize: 15 }}>{l.label}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {l.code}
                  {pct < 100 && ` · ${pct}% ${t("translated")}`}
                  {l.custom && ` · ${t("yours")}`}
                </div>
              </button>
              {l.custom && (
                <button
                  onClick={() => {
                    removeCustomLanguage(l.code);
                    force((n) => n + 1);
                  }}
                  style={{ fontSize: 12 }}
                >
                  {t("Remove")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <section style={{ marginTop: 24, padding: 16, borderRadius: 10, background: "var(--panel-2)", border: "1px solid var(--border)" }}>
        <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>{t("Translate the game")}</h2>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }}>
          {t(
            "Download the file, replace the English on the right of each line with your language, then load it back. You don't have to finish — anything you skip stays in English.",
          )}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={downloadTemplate}>⬇ {t("Download template")}</button>
          <button onClick={() => fileRef.current?.click()}>⬆ {t("Load a translation")}</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = "";
            }}
          />
        </div>
        {note && <p style={{ fontSize: 13, color: "var(--accent)", marginBottom: 0 }}>{note}</p>}
        {err && <p style={{ fontSize: 13, color: "#ff8a8a", marginBottom: 0 }}>{err}</p>}
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, marginBottom: 0 }}>
          {t("{n} strings in total. Send us a finished file and we'll ship it with the game.", { n: STRINGS.length })}
        </p>
      </section>
    </main>
  );
}
