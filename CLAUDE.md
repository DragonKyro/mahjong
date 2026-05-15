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

Will be filled in once Phase 0 lands:

```bash
npm run dev       # not yet wired up
npm test          # not yet wired up
npm run build     # not yet wired up
```

## Current phase

**Phase 0 — Bootstrap.** Planning is done; next session should scaffold Vite + React + TS, install Tailwind/Zustand/PeerJS, and add the GH Pages deploy workflow. See README.md for the full phase list.
