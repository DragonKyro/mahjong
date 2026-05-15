# Mahjong — Cantonese Edition

A browser-based Hong Kong-style (廣東) mahjong game. Hosted on GitHub Pages. Three modes:

- **Solo vs AI** — single player against three computer opponents.
- **Multiplayer** — 2–4 humans connecting peer-to-peer over WebRTC (room codes, no server).
- **Training** — drill the discard decision. The game shows a hand, you pick the tile to throw, and the trainer reveals the probability-optimal answer with an explanation of the common shape (兩面 / 嵌張 / 邊張 etc.).

## Decisions on file

| Decision | Choice | Why |
|---|---|---|
| Scoring system | **Hong Kong Old Style**, 3-faan (番) minimum | Most recognizable Cantonese ruleset, smallest rules surface to ship first. Configurable later. |
| Multiplayer transport | **WebRTC P2P** via PeerJS + free public signaling | GitHub Pages is static-only; P2P needs no backend and no accounts. |
| Tech stack | **TypeScript (strict) + Vite + React + Zustand + Tailwind** | Vite gives fast iteration and trivial GH Pages deploys. React for UI, Zustand as a thin bridge — the **game engine itself is pure OOP TypeScript with zero React dependency**. |
| Testing | **Vitest** + React Testing Library | Native Vite integration, fast. |
| Tile graphics | **SVG** in `public/tiles/` | Sharp at any size, easy to swap art. |

## Architecture — OOP at the core

The game engine lives in [src/core/](src/core/) as plain TypeScript classes. React never imports an engine class directly — it talks to a [Zustand store](src/store/) that owns one `Game` instance and surfaces snapshots + commands. This keeps the rules engine portable (testable in isolation, reusable for the AI's lookahead, reusable on both peers in multiplayer).

```
src/
  core/                  pure OOP engine — no React, no DOM
    tiles/               Tile, SuitTile, HonorTile, BonusTile, Wall
    melds/               Meld, Chi, Pong, Kong, Pair
    players/             Player (abstract), HumanPlayer, AIPlayer
    game/                Game, Round, Hand, TurnManager
    scoring/             FaanCalculator, HandPatterns, ScoreTable
    ai/                  Shanten, EfficiencyAI, DefensiveAI
  ui/                    React components, hooks, pages
  store/                 Zustand adapter (engine ↔ UI)
  multiplayer/           PeerJS room/lobby/sync layer
  training/              quiz engine + curated shape library
  utils/
tests/                   Vitest unit + integration
public/tiles/            SVG tile assets
```

Key OOP classes (sketch):

- `Tile` — abstract base with `suit`, `rank`, `equals()`, `compareTo()`. Subclassed by `SuitTile` (萬筒索), `HonorTile` (風 東南西北 + 元 中發白), `BonusTile` (花/季).
- `Wall` — owns the 144-tile shuffled wall, deals, tracks dead wall and replacement draws after kong/flower.
- `Hand` — a player's concealed tiles + exposed melds. Knows how to enumerate winning decompositions.
- `Meld` (abstract) → `Chi`, `Pong`, `Kong`, `Pair`. Knows whether it's concealed or exposed, and its faan contributions.
- `Player` (abstract) → `HumanPlayer`, `AIPlayer`. AIs differ only by their decision policy injection.
- `Game` — top-level coordinator. Owns the wall, the four `Player`s, the wind/round state, and the turn/claim resolution machine.
- `FaanCalculator` — pure function over a winning `Hand`: returns matched patterns and total faan.

## Phases

Each phase ships a working slice. Tests land with the phase that introduces the behavior.

### Phase 0 — Bootstrap
- Initialize Vite + React + TypeScript (strict) project.
- ESLint flat config, Prettier, Vitest.
- Tailwind set up.
- GitHub Pages deploy workflow (`.github/workflows/deploy.yml`) building from `main`.
- This README, [CLAUDE.md](CLAUDE.md), and [.gitignore](.gitignore) are kept in sync as the project evolves.

### Phase 1 — Core domain model
- Tile hierarchy (`SuitTile`, `HonorTile`, `BonusTile`) with full equality, ordering, and stringification (e.g. `"3m"`, `"E"`, `"中"`).
- `Wall` with deterministic shuffle (seedable — needed by both training and multiplayer).
- `Hand`, `Meld` hierarchy.
- `Player` abstract + `HumanPlayer` skeleton.
- Unit tests pin every class.

### Phase 2 — Game flow engine
- `Game` orchestrates a hand: deal → turn loop (draw, discard, claim resolution) → end conditions.
- Claim priority: Win > Pong/Kong > Chi (left-of-discarder only).
- Concealed kong, exposed kong, robbing-the-kong, replacement draws after kong/flower.
- Wind rotation (東→南→西→北), dealer (莊) retention rules.
- All flow exercised by scripted integration tests with a deterministic wall seed.

### Phase 3 — Win detection & scoring (HK Old Style)
- Hand pattern recognizer: standard 4-set-1-pair decomposition, plus special hands (十三么, 七對, 九蓮寶燈).
- Faan list: 平和, 對對和, 混一色, 清一色, 小三元, 大三元, 小四喜, 大四喜, 字一色, plus situational faan (自摸, 海底撈月, 搶槓, 嶺上開花, 門前清).
- 3-faan minimum to win; configurable rule object so liberal/new-style scoring drops in later.
- `ScoreTable` resolves payouts (放炮 vs 自摸 splits).

### Phase 4 — Single-player UI
- Board layout: own hand, three opponents (top/left/right), discard pool centered, wall counter.
- Tile rendering from SVG sprites.
- Click-to-discard, modal prompts for pong/kong/chi/win claims with countdown timer.
- Score panel showing faan breakdown after each hand.

### Phase 5 — AI opponents
- `Shanten` calculator — how many tiles away from a winning hand. Drives both AI and training.
- `EfficiencyAI` — maximises tile-acceptance count when discarding.
- `DefensiveAI` — tracks opponents' likely waits from their discard streams, avoids feeding.
- Three difficulty tiers: random / efficiency-only / efficiency + defense.

### Phase 6 — Training mode
- Curated shape library: each entry describes a common wait shape (兩面/嵌張/邊張/單騎/對對聽) with the tiles that complete it.
- Probability engine: given a hand + visible discards + opponents' melds, compute P(reaching tenpai or winning) for each candidate discard.
- Quiz flow: present hand → user picks discard → reveal optimal answer + reasoning. Track streaks in `localStorage`.

### Phase 7 — Multiplayer (P2P)
- PeerJS over the free public signaling server. Room code = peer ID.
- Host-authoritative model: one peer runs the canonical `Game`, others mirror and send intents.
- Deterministic shuffle from a host-broadcast seed so any peer can audit the wall after a hand.
- Reconnect grace window; graceful fallback if a peer drops.

### Phase 8 — Polish & deploy
- Tile-move animations, sound effects (toggle-able).
- Keyboard navigation + screen-reader labels for accessibility.
- GH Pages production deploy under a project subpath.
- README screenshots and a short gameplay GIF.

## Running locally

```bash
npm install
npm run dev          # Vite dev server (http://localhost:5173)
npm test             # Vitest run once
npm run test:watch   # Vitest watch mode
npm run typecheck    # tsc -b --noEmit across both projects
npm run lint         # ESLint flat config
npm run format       # Prettier write
npm run build        # production bundle for GH Pages (dist/)
npm run preview      # serve the built bundle locally
```

The Vite base path is hardcoded to `/mahjong/` for GH Pages. Set `VITE_BASE=/` when previewing locally if you want clean URLs (`VITE_BASE=/ npm run preview`).

## Deployment

Pushing to `main` triggers [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which runs lint + typecheck + tests + build, then publishes `dist/` to GitHub Pages. The site will be live at https://dragonkyro.github.io/mahjong/ once Pages is enabled in repo settings (Settings → Pages → Source: GitHub Actions).

## Status

**Phase 0 — Bootstrap: ✅ complete.** Vite + React + TS scaffold, Tailwind, Vitest, ESLint flat config, Prettier, and the GH Pages workflow.

**Phase 1 — Core domain model: ✅ complete.** Pure-OOP engine in [src/core/](src/core/):
- `Tile` abstract + `SuitTile` (萬筒索), `HonorTile` (東南西北 + 中發白), `BonusTile` (花/季) with equality, canonical sort order, unicode glyphs.
- `Wall` (144 tiles, seedable shuffle, live wall + 14-tile dead wall for kong/bonus replacements).
- `Meld` abstract + `Chi`, `Pong`, `Kong` (concealed/exposed/added), `Pair` with full validation.
- `Hand` (sorted concealed pool + exposed melds + bonus pile) and `Player` abstract + `HumanPlayer` skeleton.
- Seedable `mulberry32` RNG in [src/utils/rng.ts](src/utils/rng.ts) — the engine never calls `Math.random()`.

**Phase 2 — Game flow engine: ✅ complete.** The turn loop runs end-to-end through injected policies:
- `PlayerPolicy` interface (`chooseAction`, `chooseClaim`) + `ScriptedPolicy` test helper. Policy is now a required constructor argument on `Player`.
- `Round` ([src/core/game/Round.ts](src/core/game/Round.ts)) — single deal: deal 13 → turn loop → claim resolution → end.
- `Game` ([src/core/game/Game.ts](src/core/game/Game.ts)) — multi-round controller with dealer rotation (連莊 on dealer-win, otherwise East→South→West→North) and prevailing-wind advancement.
- Claim priority **Win > Pong/Kong > Chi**, with Chi restricted to 下家 of the discarder.
- Concealed kong, added kong, and exposed-kong-from-discard all trigger replacement draws from the dead wall. Bonus tiles drawn at any point auto-route to the bonus pile and trigger replacements.
- Wall exhaust → 流局 (draw).
- Phase 2 trusts policies on `win` (no validation yet); Phase 3 will plug in `WinValidator`.

**Next:** Phase 3 — Win detection and HK Old Style faan scoring.
