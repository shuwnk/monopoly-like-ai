import { useSyncExternalStore } from "react";
import { PT_BR } from "./pt-BR.js";

// Tiny i18n. No library — the whole thing is a lookup plus `{name}` substitution,
// and the bundle is already too big.
//
// The KEY IS THE ENGLISH STRING. That buys three things:
//  - a missing translation renders readable English, never a bare key
//  - a partial translation is perfectly usable, so contributors can start small
//  - a translator reads sentences, not identifiers
// The cost is that editing English copy orphans that entry; `npm run i18n` lists
// orphans so they can be re-translated rather than silently reverting.

export type Catalog = Readonly<Record<string, string>>;

export interface Language {
  code: string;
  /** name in the language itself, so speakers can find it in the list */
  label: string;
  catalog: Catalog;
  /** true for languages a user imported rather than ones we ship */
  custom?: boolean;
}

// English is the source: it has no catalog because the keys are already English.
export const BUILT_IN: Language[] = [
  { code: "en", label: "English", catalog: {} },
  { code: "pt-BR", label: "Português (Brasil)", catalog: PT_BR },
];

const LOCALE_KEY = "pm-locale";
const CUSTOM_KEY = "pm-locales-custom";

function loadCustom(): Language[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((l) => {
      const o = l as Partial<Language>;
      if (typeof o.code !== "string" || typeof o.label !== "string" || typeof o.catalog !== "object" || !o.catalog) return [];
      // keep only string→string pairs; a bad entry shouldn't poison the catalog
      const catalog: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.catalog)) if (typeof v === "string") catalog[k] = v;
      return [{ code: o.code, label: o.label, catalog, custom: true }];
    });
  } catch {
    return [];
  }
}

let custom: Language[] = loadCustom();
let locale: string = (() => {
  try {
    return localStorage.getItem(LOCALE_KEY) ?? detect();
  } catch {
    return "en";
  }
})();

// first visit: meet people in their own language if we speak it
function detect(): string {
  const langs = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])];
  for (const l of langs) {
    const exact = BUILT_IN.find((b) => b.code.toLowerCase() === l?.toLowerCase());
    if (exact) return exact.code;
    const base = BUILT_IN.find((b) => b.code.split("-")[0] === l?.split("-")[0]);
    if (base) return base.code;
  }
  return "en";
}

export function languages(): Language[] {
  return [...BUILT_IN, ...custom];
}
export function getLocale(): string {
  return locale;
}
function activeCatalog(): Catalog {
  return languages().find((l) => l.code === locale)?.catalog ?? {};
}

// --- subscription, so a language switch re-renders the app ---
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setLocale(code: string): void {
  locale = code;
  try {
    localStorage.setItem(LOCALE_KEY, code);
  } catch {
    /* private mode — the choice just won't persist */
  }
  if (typeof document !== "undefined") document.documentElement.lang = code;
  emit();
}

export function addCustomLanguage(lang: { code: string; label: string; catalog: Record<string, string> }): void {
  custom = [...custom.filter((l) => l.code !== lang.code), { ...lang, custom: true }];
  persistCustom();
  emit();
}
export function removeCustomLanguage(code: string): void {
  custom = custom.filter((l) => l.code !== code);
  persistCustom();
  if (locale === code) setLocale("en");
  else emit();
}
function persistCustom(): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  } catch {
    /* ignore */
  }
}

/**
 * Translate. `en` is both the key and the fallback.
 * Interpolates `{name}` placeholders: t("Waiting for {who}…", { who: name })
 */
export function t(en: string, vars?: Record<string, string | number>): string {
  const s = activeCatalog()[en] ?? en;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Mark a string for translation without translating it here. For text declared
 * far from where it's rendered (a labels table, say) — the extractor sees it,
 * and the render site still calls t() on the value.
 */
export function msg(s: string): string {
  return s;
}

/** Subscribe a component to language changes; returns the same `t`. */
export function useT(): typeof t {
  useSyncExternalStore(
    subscribe,
    () => locale,
    () => locale,
  );
  return t;
}

/** How much of the source text a catalog covers — shown in the language picker. */
export function coverage(catalog: Catalog, allStrings: readonly string[]): number {
  if (!allStrings.length) return 1;
  const done = allStrings.filter((s) => typeof catalog[s] === "string" && catalog[s]!.length > 0).length;
  return done / allStrings.length;
}

if (typeof document !== "undefined") document.documentElement.lang = locale;
