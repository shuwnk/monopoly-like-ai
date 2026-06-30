import type { GameTunables } from "@party-monopoly/engine";
import { runBatch, type BatchConfig } from "./simulate.js";

// Headless balance runner. Examples:
//   npm run sim --workspace @party-monopoly/sim
//   npm run sim --workspace @party-monopoly/sim -- --games 500 --escalation 0.5
//   npm run sim --workspace @party-monopoly/sim -- --players 2 --rentFraction 0.24

interface Args {
  readonly games: number;
  readonly players: number;
  readonly skill: number;
  readonly seedStart: number;
  readonly maxSteps?: number;
  readonly tunables: Partial<GameTunables>;
}

// each flag maps a CLI value onto either a top-level arg or a tunable override
function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        flags.set(key, value);
        i++;
      } else {
        flags.set(key, "true");
      }
    }
  }

  const num = (key: string, fallback: number): number => {
    const v = flags.get(key);
    return v === undefined ? fallback : Number(v);
  };

  const tunables: { -readonly [K in keyof GameTunables]?: GameTunables[K] } = {};
  if (flags.has("escalation")) tunables.rentEscalationStep = Number(flags.get("escalation"));
  if (flags.has("escalationCap")) tunables.rentEscalationCap = Number(flags.get("escalationCap"));
  if (flags.has("rentFraction")) tunables.rentFraction = Number(flags.get("rentFraction"));
  if (flags.has("rentFloor")) tunables.rentFloor = Number(flags.get("rentFloor"));
  if (flags.has("passGo")) tunables.passGoSalary = Number(flags.get("passGo"));
  if (flags.has("startMoney")) tunables.startingMoney = Number(flags.get("startMoney"));
  if (flags.has("tax")) tunables.taxAmount = Number(flags.get("tax"));
  if (flags.has("roundCap")) tunables.roundCap = Number(flags.get("roundCap"));

  return {
    games: num("games", 200),
    players: num("players", 4),
    skill: num("skill", 0.6),
    seedStart: num("seed", 0),
    ...(flags.has("maxSteps") ? { maxSteps: Number(flags.get("maxSteps")) } : {}),
    tunables,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const one = (x: number): string => x.toFixed(1);

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const batch: BatchConfig = {
    games: args.games,
    players: args.players,
    skill: args.skill,
    seedStart: args.seedStart,
    ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
    ...(Object.keys(args.tunables).length ? { tunables: args.tunables } : {}),
  };

  const overrides = Object.entries(args.tunables);
  console.log(`\nParty Monopoly — balance simulation`);
  console.log(
    `${args.games} games · ${args.players} bots · skill ${args.skill} · seeds ${args.seedStart}..${args.seedStart + args.games - 1}`,
  );
  console.log(`tunables: ${overrides.length ? overrides.map(([k, v]) => `${k}=${v}`).join(", ") : "defaults"}`);

  const stats = runBatch(batch);

  console.log(`\nendings`);
  console.log(`  elimination  ${pct(stats.eliminationRate).padStart(6)}  (${stats.byReason.ELIMINATION})`);
  console.log(`  round cap    ${pct(stats.capRate).padStart(6)}  (${stats.byReason.CAP})`);
  console.log(`  timeout      ${pct(stats.timeoutRate).padStart(6)}  (${stats.byReason.TIMEOUT})`);
  console.log(`  finished     ${pct(stats.finished / stats.games).padStart(6)}  (${stats.finished}/${stats.games})`);

  console.log(`\nturns to finish (finished games)`);
  console.log(`  min ${stats.turns.min}  ·  median ${one(stats.turns.median)}  ·  mean ${one(stats.turns.mean)}  ·  max ${stats.turns.max}`);
  console.log(`\navg showdowns/game  ${one(stats.avgShowdowns)}\n`);
}

main();
