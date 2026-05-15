# CLAUDE.md

Working notes for future Claude sessions on this repo. Keep this file current — update it whenever a convention, command, or invariant changes.

## What this project is

A browser-based Cantonese (Hong Kong Old Style) mahjong game deployed to GitHub Pages. Three modes: solo vs AI, P2P multiplayer (WebRTC via PeerJS), and a training mode that drills the optimal discard. See [README.md](README.md) for the user-facing description and phased plan.

## Tech stack (locked)

- **TypeScript**, `strict: true`. No `any` without a `// reason` comment.
- **Vite** for dev + build.
- **React** for UI only — no rules logic in components.
- **Zustand** as the engine ↔ UI bridge. The store owns one `Game` and exposes snapshots + intent dispatchers.
- **Tailwind** for styling.
- **Vitest** + React Testing Library for tests.
- **PeerJS** for WebRTC multiplayer.

If a phase needs something outside this list, justify the addition here before installing.

## Architectural invariants

1. **The game engine in [src/core/](src/core/) is pure OOP TypeScript.** No React, no DOM, no `window`, no Zustand imports. It must be runnable under Node for tests and (later) reusable on both peers in a multiplayer match.
2. **React never imports from `src/core/` directly.** It reads from and dispatches to the Zustand store in [src/store/](src/store/), which is the only module that touches both worlds.
3. **The wall shuffle is seedable.** Training mode replays scenarios; multiplayer audits the wall after a hand. Never call `Math.random()` inside the engine — go through the injected RNG.
4. **Claim resolution priority is Win > Pong/Kong > Chi**, and Chi may only be claimed from the left-hand (上家) player. This is non-negotiable HK Old Style behavior.
5. **The scoring system is configurable** but defaults to HK Old Style with a 3-faan minimum. Don't hardcode `3` — read it from the rules config.

## OOP conventions

- One class per file. Filename matches the class name (PascalCase).
- Abstract bases live alongside their concrete subclasses (e.g. `Tile.ts`, `SuitTile.ts`, `HonorTile.ts` in `src/core/tiles/`).
- Prefer composition for behavior variants where the variation is a *policy* (e.g. `AIPlayer` takes a `DecisionPolicy`) rather than inheritance.
- Domain enums (`Suit`, `Wind`, `Dragon`, `MeldType`) live next to the classes that use them, not in a global `types.ts`.

## Cantonese mahjong terminology — quick reference

When writing code, use the English term in identifiers and the Chinese term in user-facing strings.

| English | 中文 | Notes |
|---|---|---|
| Suit tiles | 萬子 / 筒子 / 索子 | `Suit.Character` / `Suit.Circle` / `Suit.Bamboo` |
| Wind tiles | 東南西北 | `Wind.East/South/West/North` |
| Dragon tiles | 中發白 | `Dragon.Red/Green/White` |
| Bonus tiles | 花 / 季 | Flowers and seasons; replacement-drawn |
| Chi (sequence) | 上 / 吃 | 3 consecutive in a suit; from left player only |
| Pong (triplet) | 碰 | 3 identical |
| Kong (quad) | 槓 | 4 identical; concealed (暗槓) or exposed (明槓) |
| Self-drawn win | 自摸 | +1 faan |
| Discard win | 食糊 / 食胡 | Ron-equivalent |
| Robbing the kong | 搶槓 | +1 faan situational |
| Last-tile win | 海底撈月 | +1 faan situational |
| Replacement-tile win | 嶺上開花 | +1 faan situational |
| Faan (scoring unit) | 番 | Plural: faan |

## Memory locations to keep in sync

These three files are the project's public contract — update together whenever any of them drifts:

- [README.md](README.md) — user-facing plan and current phase.
- [CLAUDE.md](CLAUDE.md) — this file, for future-Claude.
- [.gitignore](.gitignore) — keep aligned with whatever tooling is actually installed.

## Commands

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm test             # vitest run (single pass)
npm run test:watch   # vitest watch
npm run typecheck    # tsc -b --noEmit (app + node projects)
npm run lint         # eslint . (flat config in eslint.config.js)
npm run format       # prettier --write .
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve the production build
```

The Vite `base` is hardcoded to `/mahjong/` so GH Pages serves the site from `dragonkyro.github.io/mahjong/`. Override with `VITE_BASE=/` for clean local URLs.

## Path aliases

Configured in both `tsconfig.app.json` and `vite.config.ts`. Use these instead of relative `../../` chains:

- `@core/*` → `src/core/*`
- `@ui/*` → `src/ui/*`
- `@store/*` → `src/store/*`
- `@multiplayer/*` → `src/multiplayer/*`
- `@training/*` → `src/training/*`
- `@utils/*` → `src/utils/*`

## CI

`.github/workflows/deploy.yml` runs on push to `main`: install → lint → typecheck → test → build → deploy to GH Pages. Don't merge anything that breaks any of those four checks locally.

## Current phase

**Phase 0 — Bootstrap: ✅ complete** (2026-05-15).

**Phase 1 — Core domain model: ✅ complete** (2026-05-15). Pure-OOP engine in `src/core/`. Shipped: `Tile`/`SuitTile`/`HonorTile`/`BonusTile`, `Wall` with seedable RNG, `Meld`+`Chi`/`Pong`/`Kong`/`Pair`, `Hand`, `Player` (abstract) + `HumanPlayer`.

**Phase 2 — Game flow engine: ✅ complete** (2026-05-15). 78 passing tests across 11 files.
- `PlayerPolicy` interface (`chooseAction(view, drawn)`, `chooseClaim(view, discard, from, options)`) is the **only** way the engine asks a seat for a decision. Tests use `ScriptedPolicy`; Phase 4 UI and Phase 5 AI will provide their own implementations.
- `Player` now requires a policy in its constructor — `new HumanPlayer(name, seatWind, policy)`. The Phase 1 `new HumanPlayer(name, seatWind)` calls are dead.
- `Round` orchestrates one deal end-to-end; `Game` controls multi-round dealer rotation.
- Engine value types (`TurnAction`, `Claim`, `PlayerView`, `RoundOutcome`) live in `src/core/game/types.ts`. They are **kept serializable from day one** because Phase 7 will send the same shapes over WebRTC.
- `Wall.fromOrder(tiles)` is a test-only static factory for rigging specific scenarios — never call this from production code.

**Phase 2 engine conventions worth carrying into Phase 3:**
- **`win` is currently un-validated.** The engine offers `{ kind: 'win' }` as a claim option on every non-bonus discard and accepts `{ kind: 'win' }` self-draw actions from any policy — there's no `WinValidator` yet. Phase 3 adds hand-pattern recognition that filters these options correctly.
- **No `Math.random()` anywhere in `src/core/`** — every shuffle and probabilistic decision goes through an injected `RNG`. Multiplayer (Phase 7) will exploit this for deterministic replay; the trainer (Phase 6) will too.
- **Chi may only be claimed from 下家 of the discarder** (the player who plays next). This is enforced in `Round.possibleClaims`. Don't loosen it.
- **Claim priority resolution** is in `Round.resolveClaims`: `Win > Pong/Kong > Chi`, with closer-to-discarder breaking ties via `turnDistance`.

**Phase 3 — Win detection & scoring (HK Old Style)** is next.
- `HandPatterns` recognizer: standard 4-set-1-pair decomposition, plus special hands (十三么, 七對, 九蓮寶燈).
- `FaanCalculator`: 平和, 對對和, 混一色, 清一色, 小/大三元, 小/大四喜, 字一色, plus situational faan (自摸 / 海底撈月 / 搶槓 / 嶺上開花 / 門前清). 3-faan minimum to win; read from a configurable rules object — don't hardcode `3`.
- `ScoreTable`: 放炮 vs 自摸 payouts.
- Wire `WinValidator` into `Round.possibleClaims` so `win` is only offered when the hand actually completes.
- Hook robbing-the-kong (搶槓) into the add-kong replacement draw path.

See README.md for the full phase list.
