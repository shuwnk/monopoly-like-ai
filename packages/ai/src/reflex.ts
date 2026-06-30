import type { ReflexInput } from "@party-monopoly/minigame-harness";

// reaction band, ms: a skill-1 bot averages near FAST, a skill-0 bot near SLOW
const FAST_MS = 250;
const SLOW_MS = 600;
// +/- jitter around the skill-based mean so the bot isn't robotically identical
const JITTER_MS = 60;
// chance of jumping the gun, scaled down with skill
const FALSE_START_MAX = 0.12;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

// Sample a plausible reflex round for an AI of the given skill (0..1). Higher
// skill = faster mean reaction and fewer false starts. rng is injectable so
// tests can be deterministic; defaults to Math.random.
export function aiReflexInput(skill: number, rng: () => number = Math.random): ReflexInput {
  const s = clamp01(skill);

  if (rng() < FALSE_START_MAX * (1 - s)) {
    return { reactionMs: null, falseStart: true };
  }

  const mean = SLOW_MS - (SLOW_MS - FAST_MS) * s;
  const jitter = (rng() * 2 - 1) * JITTER_MS;
  return { reactionMs: Math.round(Math.max(FAST_MS, mean + jitter)), falseStart: false };
}
