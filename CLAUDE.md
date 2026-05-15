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

**Phase 2 — Game flow engine: ✅ complete** (2026-05-15).
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

**Phase 3 — Win detection & scoring: ✅ complete** (2026-05-15). 118 passing tests across 16 files.

- Scoring stack lives in `src/core/scoring/`. `HandPatterns` (decomposer), `FaanCalculator`, `ScoreTable`, `WinValidator` interface + `HKOldStyleWinValidator` and `PermissiveWinValidator`, plus `RulesConfig` with `DEFAULT_RULES` (minFaan=3, limitFaan=13, baseUnit=1).
- `Round` constructor now accepts `{ winValidator?, faanCalculator? }`. With no validator, behavior matches Phase 2 (every `win` accepted) — `Round.test.ts` still works unchanged.
- `Game` defaults to `HKOldStyleWinValidator(DEFAULT_RULES)` and applies `ScoreTable` deltas to `player.score` after each winning round. **Phase 2-style Game tests that scripted artificial wins now pass `winValidator: new PermissiveWinValidator()`** — that pattern is preserved in `Game.test.ts` and worth following for any future "skip the rules" test.

**Phase 3 conventions worth carrying into Phase 4:**
- **`FaanResult` is attached to `RoundOutcome` only when a `faanCalculator` is configured.** Treat `outcome.faan` as optional.
- **HandPatterns picks one of multiple decompositions**; `FaanCalculator.calculate` re-scores all of them and returns the highest. Don't assume only one valid decomposition exists for a hand.
- **`WinContext` is the canonical shape for situational scoring inputs.** When adding faan rules that depend on game-state context (e.g. 搶槓), add the field to `WinContext` first and populate it in `Round.finalize*Win`, then read it in `FaanCalculator.scoreSituational`.
- **Known gaps deferred from Phase 3:** 搶槓 (robbing the kong) is not yet implemented — the engine plumbing has the hook point at `Round.applyOwnKong` but no inter-turn win interception is wired. 九蓮寶燈 (Nine Gates) is not recognized.

**Phase 4 — Single-player UI** is next.
- Board layout (own hand bottom, 3 opponents at top/left/right, discard pool centered).
- Tile rendering — see README, the asset source is a Phase-4-open question with the user.
- Zustand store as the engine↔React bridge; one `Game` instance per session.
- Click-to-discard; modal prompts for pong/kong/chi/win claims with countdown.
- Per-round score panel showing the FaanResult breakdown.

See README.md for the full phase list.
