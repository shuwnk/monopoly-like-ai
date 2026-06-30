# Party Monopoly

A Monopoly game with a party twist: a normal-looking board where key moments break
into minigames. The first version proves one of them — Rent Showdown: land on an
opponent's property and a quick two-player reflex duel decides the rent.

## Layout

```
packages/engine            Game engine. Pure TypeScript, no React or DOM, no wall
                           clock, no Math.random — the seeded RNG lives in game
                           state so games replay from their seed.
packages/types             Shared, serializable types (ids, actions, events).
packages/minigame-harness  Minigame interface, registry, and the Reflex Tap Duel id.
apps/web                   React + Vite client. Zustand mirrors engine state.
packages/server            Placeholder for the Phase 3 multiplayer server.
```

## Build order

1. Engine playable in hotseat (this scaffold).
2. Reflex Tap Duel wired into the Rent Showdown.
3. Online play by wrapping the engine in a Colyseus server.

The engine pauses on a `RENT_SHOWDOWN` phase and waits for a `SUBMIT_MINIGAME_RESULT`
action, so the same code drives hotseat, AI, and networked games. The minigame decides
who won; the engine decides what that's worth.

## Develop

```bash
pnpm install
pnpm dev          # apps/web
pnpm typecheck
pnpm test
pnpm lint
```
