# @party-monopoly/server

Authoritative Colyseus server. It holds the canonical `GameState`, applies validated client actions through the same pure `reduce()` used in hotseat, and arbitrates the reflex showdown. It never reimplements game rules.

2-player rooms, in-memory, no auth or persistence. The room state is sent as plain JSON room messages; we don't use `@colyseus/schema`.

## Run

```
npm install
npm run dev -w @party-monopoly/server
```

Listens on `PORT` (default `2567`). `dev` runs the TypeScript entry directly via tsx with watch; `build` compiles to `dist/`.

## Protocol

Message names live in `@party-monopoly/types` (`C2S` / `S2C`).

client -> server
- `action` `{ action: { type } }` — a player intent (`ROLL_DICE`, `BUY_PROPERTY`, `DECLINE_BUY`, `PAY_JAIL_FINE`, `END_TURN`, `DECLARE_BANKRUPT`). `SUBMIT_MINIGAME_RESULT` is server-only.
- `tap` `{ reactionMs, falseStart }` — during a showdown. `reactionMs` is measured from receipt of `showdown:go`.

server -> client
- `state` `{ state, you }` — full GameState snapshot plus which player the recipient controls.
- `showdown:start` `{ baseRent }` — red, get ready.
- `showdown:go` `{}` — green; start measuring reaction now.
- `error` `{ message }` — rejected action.

## Showdown flow

When `reduce()` lands the game in `RENT_SHOWDOWN`, the server broadcasts `showdown:start`, waits a random delay (harness `DEFAULT_REFLEX_TAP_DUEL_CONFIG` bounds), broadcasts `showdown:go`, then collects both `tap`s. Once both arrive (or a timeout fills the rest as misses) it runs `adjudicateReflexDuel`, submits `SUBMIT_MINIGAME_RESULT` itself, and broadcasts the new state. A double false-start aborts to flat rent — no re-arm online.
