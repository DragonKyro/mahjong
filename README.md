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
| Tile graphics | **SVG** in `public/tiles/` (vendored from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles), CC0) | Sharp at any size, easy to swap art. See [CREDITS.md](CREDITS.md). |

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

**Phase 2 — Game flow engine: ✅ complete.** Turn loop, claim resolution, kong & bonus replacement, dealer rotation. Trusted policies on `win`.

**Phase 3 — Win detection & HK Old Style scoring: ✅ complete.**
- [HandPatterns](src/core/scoring/HandPatterns.ts) — multiset-based decomposer enumerates every winning split into 4 sets + 1 pair, plus 七對 (Seven Pairs) and 十三么 (Thirteen Orphans). Exposes `canWin()` and `findWinningDecompositions()`.
- [FaanCalculator](src/core/scoring/FaanCalculator.ts) — scores the highest-faan decomposition. Implements 平和, 對對和, 混一色, 清一色, 字一色, 大/小三元, 大/小四喜, 七對, 十三么, dragon/wind pong faan, 門前清, 自摸, 嶺上開花, 河底/海底, plus matching-seat bonus tiles.
- [WinValidator](src/core/scoring/WinValidator.ts) interface, [HKOldStyleWinValidator](src/core/scoring/HKOldStyleWinValidator.ts) (3-faan minimum via [RulesConfig](src/core/scoring/RulesConfig.ts)), and [PermissiveWinValidator](src/core/scoring/PermissiveWinValidator.ts) for tests.
- [ScoreTable](src/core/scoring/ScoreTable.ts) — base unit doubles per faan from `minFaan`, caps at `limitFaan`. 自摸 = each loser pays; 放炮 = discarder pays alone.
- `Round` ([src/core/game/Round.ts](src/core/game/Round.ts)) now filters the `win` claim option through the validator and attaches a `FaanResult` to winning outcomes. `Game` ([src/core/game/Game.ts](src/core/game/Game.ts)) applies score deltas after each round.

**Phase 4 — Single-player UI: ✅ MVP complete.**
- **Async engine refactor:** `Round.play()` and `Game.playRound()` are now `async`, and `PlayerPolicy.chooseAction`/`chooseClaim` accept `T | Promise<T>` returns. AI/test policies stay synchronous; the new UI policy returns a Promise that resolves when the user clicks.
- **Tile artwork** vendored from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) (CC0). 36 SVGs in [public/tiles/](public/tiles/); flowers/seasons use a unicode-glyph fallback for now. See [CREDITS.md](CREDITS.md).
- **State bridge:** [src/store/UIPolicy.ts](src/store/UIPolicy.ts) plus [src/store/gameStore.ts](src/store/gameStore.ts) (Zustand). The store owns one `Game`, parks the engine on each pending decision, and exposes `resolveAction` / `resolveClaim` for the UI.
- **Board layout:** human at bottom (East), opponents around the sides, center area shows prevailing wind / dealer / wall / last discard. See [src/ui/components/Board.tsx](src/ui/components/Board.tsx).
- **Interactions:** click-to-discard, claim panel (pass/pong/kong/chi/win) appears when the engine requests a claim, action panel offers concealed-kong + self-draw-win buttons when legal. Round outcome banner shows winner / loser / full faan breakdown.

**Known Phase 4 limitations** (slated for follow-up):
- Three opponents use a passive `ScriptedPolicy` that discards whatever they draw and never claims — actual AI lands in Phase 5.
- Between human turns the AI runs synchronously, so the human sees state jump from "before my turn" → "after my turn" without intermediate AI actions visible. A simple per-turn delay hook will fix this.
- Opponent hands and melds render as text fallbacks in the side bars rather than full tile images.
- Robbing the kong (搶槓), 九蓮寶燈, and multi-winner discards remain deferred from Phase 3.

**Phase 5 — AI opponents: ✅ complete.**
- [Shanten](src/core/ai/Shanten.ts) — recursive decomposer that scores a hand against the standard 4-set+pair target plus 七對 and 十三么 special hands. Exposes `count`, `bestDiscard`, and `waits`. Also feeds the Phase 6 trainer.
- [RandomAI](src/core/ai/RandomAI.ts) — beginner tier; uniformly random discards, never claims.
- [EfficiencyAI](src/core/ai/EfficiencyAI.ts) — intermediate tier; picks the shanten-minimising discard, declares 自摸 / concealed kong when legal, claims pong/kong when it preserves shanten.
- **Difficulty selector** on the start screen (Beginner / Intermediate); `gameStore.setDifficulty` rebuilds the table with the chosen AI when the next round starts.
- **`onTurnEnd` hook on `Round`** — UI store injects a ~350 ms pause between turns so AI actions render visibly instead of jumping all at once.

**Phase 6 — Training mode: ✅ complete.** The project's namesake learning tool.
- [Ukeire](src/training/Ukeire.ts) — for each candidate discard from a 14-tile hand, computes the resulting shanten plus the "acceptance count": how many unseen tiles would advance the hand toward tenpai/win.
- [PuzzleGenerator](src/training/PuzzleGenerator.ts) — shuffles random walls until it lands on an interesting (tenpai or 1-shanten) hand; falls back to the best of N attempts.
- **Quiz UI** ([TrainingPage.tsx](src/ui/components/TrainingPage.tsx)) — click a tile to "discard". Reveal compares your pick to the optimal, lists every discard ranked by shanten then acceptance, and tracks streak/accuracy in `localStorage`.
- Top-level tab switcher between **Play** and **Training** in [App.tsx](src/ui/App.tsx).

**Next:** Phase 7 — WebRTC multiplayer (host-authoritative P2P via PeerJS).
