# Party Monopoly

Monopoly-style board with party minigames. Read `README.md` for the package layout and
`DEPLOY.md` for hosting (Colyseus server on Railway, web app on Vercel).

## Commands

```bash
npm install
npm run dev          # apps/web on :5173
npm run typecheck    # every workspace
npm test             # vitest in every workspace that has tests
npm run lint         # eslint, includes the engine purity rules
```

## Rules of the code

- `packages/engine` is pure TypeScript: no React, no DOM, no wall clock, no `Math.random`
  (the seeded RNG lives in game state). ESLint enforces this.
- Minigame tuning ported from Pummel Party cites the extracted numbers in a code comment
  (see `~/Projects/rea-work/pummel-party/FINDINGS.md`). Reuse tuning and structure only;
  never ship meshes, textures, audio or code from the reference.

## Workflow: issues and PRs

Base branch: `main`. Every fix, improvement or feature goes through an issue and a PR.

1. **Issue first.** Search `gh issue list --search "<keywords>"` and reuse a match, otherwise
   create one with the matching form (fix / improvement / feature) and labels, with a
   **Scope** and a **Done when** checklist. One issue per independently deployable change.
2. **Branch** `<type>/<issue>-<slug>` from `main`, e.g. `fix/41-double-charge`.
3. **Commit** in Conventional Commits style (`feat(barn-brawl): ...`); the body ends with
   `Refs #N`.
4. **PR** against `main`. The body starts with `Closes #N` (or `Refs #N` / `Part of #N`),
   then **What changed**, **Deploy notes** and a **Test plan** with real results. The
   "PR references an issue" check fails PRs without a reference.
5. **Stay in scope.** Unrelated findings become new issues.
6. **Don't merge** PRs, close issues by hand, or push to `main` unless asked.
