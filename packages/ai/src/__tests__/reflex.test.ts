import { describe, expect, it } from "vitest";
import { aiReflexInput } from "../reflex.js";

// deterministic rng that walks a fixed list, looping
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("aiReflexInput", () => {
  it("never false-starts at skill 1 (the false-start gate closes)", () => {
    // first draw 0 would trigger a false start only if 0 < FALSE_START_MAX*(1-skill)=0
    const input = aiReflexInput(1, seq([0, 0.5]));
    expect(input.falseStart).toBe(false);
    expect(input.reactionMs).not.toBeNull();
  });

  it("reacts faster on average at higher skill", () => {
    // skip the false-start branch (first draw high), centre jitter (second 0.5)
    const fast = aiReflexInput(1, seq([0.9, 0.5]));
    const slow = aiReflexInput(0, seq([0.9, 0.5]));
    expect(fast.reactionMs).not.toBeNull();
    expect(slow.reactionMs).not.toBeNull();
    expect(fast.reactionMs!).toBeLessThan(slow.reactionMs!);
  });

  it("keeps reaction times in a sane range", () => {
    for (const skill of [0, 0.5, 1]) {
      for (const r of [0, 0.5, 1]) {
        const input = aiReflexInput(skill, seq([0.99, r]));
        expect(input.reactionMs!).toBeGreaterThanOrEqual(200);
        expect(input.reactionMs!).toBeLessThanOrEqual(700);
      }
    }
  });

  it("can false-start at low skill when the roll is low", () => {
    const input = aiReflexInput(0, seq([0.0, 0.5]));
    expect(input.falseStart).toBe(true);
    expect(input.reactionMs).toBeNull();
  });
});
