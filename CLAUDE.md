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

**Phase 3 — Win detection & scoring: ✅ complete** (2026-05-15).

- Scoring stack lives in `src/core/scoring/`. `HandPatterns` (decomposer), `FaanCalculator`, `ScoreTable`, `WinValidator` interface + `HKOldStyleWinValidator` and `PermissiveWinValidator`, plus `RulesConfig` with `DEFAULT_RULES` (minFaan=3, limitFaan=13, baseUnit=1).
- `Round` constructor now accepts `{ winValidator?, faanCalculator? }`. With no validator, behavior matches Phase 2 (every `win` accepted) — `Round.test.ts` still works unchanged.
- `Game` defaults to `HKOldStyleWinValidator(DEFAULT_RULES)` and applies `ScoreTable` deltas to `player.score` after each winning round. **Phase 2-style Game tests that scripted artificial wins now pass `winValidator: new PermissiveWinValidator()`** — that pattern is preserved in `Game.test.ts` and worth following for any future "skip the rules" test.

**Phase 3 conventions worth carrying into Phase 4:**
- **`FaanResult` is attached to `RoundOutcome` only when a `faanCalculator` is configured.** Treat `outcome.faan` as optional.
- **HandPatterns picks one of multiple decompositions**; `FaanCalculator.calculate` re-scores all of them and returns the highest. Don't assume only one valid decomposition exists for a hand.
- **`WinContext` is the canonical shape for situational scoring inputs.** When adding faan rules that depend on game-state context (e.g. 搶槓), add the field to `WinContext` first and populate it in `Round.finalize*Win`, then read it in `FaanCalculator.scoreSituational`.
- **Known gaps deferred from Phase 3:** 搶槓 (robbing the kong) is not yet implemented — the engine plumbing has the hook point at `Round.applyOwnKong` but no inter-turn win interception is wired. 九蓮寶燈 (Nine Gates) is not recognized.

**Phase 4 — Single-player UI: ✅ MVP complete** (2026-05-15).

**Engine-API breaking change introduced this phase:** `PlayerPolicy.chooseAction` / `chooseClaim` now return `T | Promise<T>`, and `Round.play()` / `Game.playRound()` are `async`. AI / scripted-policy code can keep returning sync values; UI policy returns a Promise. All tests `await` round/game calls.

**Asset source: FluffyStuff CC0** — see [CREDITS.md](CREDITS.md). Tile naming convention used in [src/ui/tileAsset.ts](src/ui/tileAsset.ts):
- `Man{1..9}` (萬), `Pin{1..9}` (筒), `Sou{1..9}` (索)
- `Ton`/`Nan`/`Shaa`/`Pei` for 東南西北
- `Chun`/`Hatsu`/`Haku` for 中發白
- `Back` for face-down opponent tiles
- Bonus tiles (花/季) have no FluffyStuff asset; `TileImage` falls back to the Unicode glyph

**UI conventions worth carrying into Phase 5+:**
- React imports from `@store/*` and `@ui/*` only — **never** from `@core/*` directly. The store owns the bridge.
- `UIPolicy` resolves a stored `resolve` callback when the user clicks. Don't try to throw or cancel mid-decision — Phase 4 has no cancellation path.
- The store bumps a `tick` counter on each engine event; components that need to re-render on engine changes must subscribe to `tick`.
- The default AI is `ScriptedPolicy()` (passive, discards what it drew). Phase 5 swaps this for a real `EfficiencyAI` / `DefensiveAI`.

**Phase 4 known gaps** (deferred):
- AI turns are synchronous, so the human sees state jump between their own turns with no intermediate animation. Fix: add an `onTurnEnd` hook to `Round` and have the store inject a 200–300 ms pause.
- Opponent panels render melds and discards as text, not tile images. Cosmetic.
- No way to cancel or restart a round mid-play other than reloading the page.
- 搶槓, 九蓮寶燈, multi-winner discards still deferred from Phase 3.

**Phase 5 — AI opponents: ✅ complete** (2026-05-15).

**Shanten** (`src/core/ai/Shanten.ts`) — pure functions on tile-count vectors:
- `Shanten.count(concealed, exposedSetCount)` — returns -1 (winning), 0 (tenpai), n (n away). Tries standard, 七對, and 十三么 in parallel and returns the minimum.
- `Shanten.bestDiscard(concealed14, exposed)` — for a post-draw hand, returns the discard that minimises 13-tile shanten. Tie-breaks by highest sort-key tile (keeps simples for waits).
- `Shanten.waits(concealed13, exposed)` — enumerates the tiles that would complete a tenpai hand. Returns [] if not tenpai.
- Internal `tileToIndex` / `indexToTile` map tiles to a 34-slot vector (suits 0-26, honors 27-33). Reuse them in Phase 6.

**AI policies (`src/core/ai/`):**
- `RandomAI` — beginner. Uniformly random discard from non-bonus concealed tiles; always passes claims. Optional seeded RNG for tests.
- `EfficiencyAI` — intermediate. `Shanten.bestDiscard` for discards; declares 自摸 when `Shanten.count(hand, exposed) === -1`; declares 暗槓 on any four-of-a-kind in hand; claims pong/kong when the resulting shanten ≤ current shanten. No chi-claiming yet.
- `DefensiveAI` — advanced. Identical win / kong / claim rules as `EfficiencyAI`, but the discard search filters to minimum-shanten candidates first, then breaks ties by danger score: 0 if the tile is genbutsu (already in any opponent's discard pile), +1 if it's suji-safe (rank ± 3 of an opponent's same-suit discard), +3 otherwise — summed across all three opponents.

**Ukeire** (`src/core/ai/Ukeire.ts`) is the shared per-discard analyser used by `DefensiveAI` and the training mode. It enumerates each distinct discard from a 14-tile hand, returns `{ shanten, acceptance, waits[] }` for each, and exposes `optimalDiscard()` (min shanten → max acceptance → highest sort-key).

**Engine changes worth knowing about:**
- **`onTurnEnd` hook** added to `Round` and forwarded by `Game`. Called after each turn (post-discard, post-claim resolution). The gameStore uses it to bump `tick` and `await setTimeout(350)` so AI actions render between turns. Tests that don't supply the hook are unaffected.
- `gameStore.difficulty` (`'beginner' | 'intermediate'`) drives which AI policy fills the three AI seats. Changing difficulty drops the in-progress game; the next `startRound` rebuilds.
- The default difficulty is `'intermediate'` (EfficiencyAI).

**Phase 5 follow-ups landed:** `DefensiveAI` (opponent-discard-aware, advanced tier) shipped post-Phase-6. `Ukeire` moved from `src/training/` to `src/core/ai/` so engine code doesn't reach into training.

**Still open:**
- **Chi evaluation** — none of the AIs claim chi. Add when faan-aware scoring kicks in.
- **AI faan awareness** — current AI maximises shanten only. It will sometimes win on cheap hands when a delay-and-build approach would score more.
- **Robbing the kong** and **九蓮寶燈** — inherited from Phase 3 deferrals.

**Phase 6 — Training mode: ✅ complete** (2026-05-15).

**Training stack lives in `src/training/`:**
- `Ukeire` — wraps `Shanten` to enumerate every distinct discard from a 14-tile hand, computing resulting shanten + acceptance count (unseen tiles that would advance toward tenpai/win). Skips bonus tiles and dedupes by tile-type. `optimalDiscard()` picks min-shanten then max-acceptance.
- `PuzzleGenerator` — random wall + filtered draw. Targets shanten ≤ 1 by default; gives up after N attempts and returns the best seen. Puzzles are deterministic per seeded RNG. Each puzzle carries a stable `id` derived from the hand contents.
- `trainingStore` (in `src/store/`) — single live puzzle + guess state + reveal flag + persisted progress (`mahjong.training.progress.v1` in localStorage; gracefully degrades if storage is unavailable).
- `TrainingPage` — tab-switched UI. Click any tile to submit a guess; reveal panel shows your pick vs optimal with full discard table sorted by shanten then acceptance.

**App-level:** `App.tsx` now has a top-level tab switcher (`'game' | 'training'`) wrapping `Board` and `TrainingPage`. Local React state — no router needed yet.

**Phase 6 deferrals** (optional polish):
- **Curated puzzle library** with hand-picked shapes (兩面 / 嵌張 / 邊張 / 單騎 / 對對聽) demonstrating specific concepts. The reveal could name the shape category. Right now puzzles are purely random.
- **Difficulty selector** for puzzles (force a specific shanten range, or 七對-focused training).
- **Hint mode** (e.g., highlight wait tiles in the hand before guess).

**Phase 7 — Multiplayer (P2P over WebRTC): ✅ MVP complete** (2026-05-15). 166 passing tests across 23 files.

**Architecture: lockstep, host-relay.** Every peer runs an identical `Game` seeded from the host-broadcast seed. Each peer's own seat uses `UIPolicy`; the other three use `RemotePolicy`. Decisions made locally are resolved into the local engine AND broadcast over the network; remote peers receive the decision and resolve their corresponding `RemotePolicy`. Clients connect to the host only; the host relays decision messages to other clients (4-peer topology with 3 connections, not full mesh).

**`src/multiplayer/`:**
- `Protocol.ts` — wire-format types (`WireTurnAction`, `WireClaim`, `RoomMessage`) plus tile/action/claim (de)serializers. **Pure**, no DOM, no PeerJS — keep it that way.
- `Connection.ts` — `new Peer()` lifecycle, `peer.on('connection')` for host or `peer.connect(hostId)` for client. Low-level only; no game knowledge.
- `RemotePolicy.ts` — implements `PlayerPolicy` via stored resolve callbacks. `abort(reason)` rejects pending awaits on disconnect.

**`src/store/multiplayerStore.ts`** owns the connection + lobby + per-round Game. Patterns:
- Module-scoped runtime singletons (`connection`, `remotePolicies`, `uiPolicy`, `activeGame`) live outside Zustand state because PeerJS objects aren't snapshot-friendly.
- Host-mode message handler relays game-decision messages (`action-decision` / `claim-decision`) to all other clients before applying locally.
- `resolveAction` / `resolveClaim` both resolve the local UIPolicy AND broadcast — keep these two effects in lockstep, or peers will desync.
- Seat assignment: host = E, joiners get S/W/N in order.

**Shared rendering:** `GameTable` (in `src/ui/components/`) is now the stateless board renderer. `Board` (single-player) and `MultiplayerPage` both wrap it.

**Phase 7 MVP gaps** (deferred):
- **No reconnect**; if any peer drops, RemotePolicies abort and the round dies. Add a reconnect handshake using the same peer ID.
- **No version handshake**; peers on different code versions will desync silently. Add a `hello` payload that includes a version stamp and reject mismatched joins.
- **No graceful host-leaves**; `host-left` message exists but UI handling is minimal.
- **PeerJS public broker**; reliable but rate-limited. For higher load, run a private broker.

**Post-Phase-7 — Multi-round + full HK Old Style settlement: ✅ complete** (2026-05-15).

- **Multi-round play in both modes.** Single-player already worked. Multiplayer now does too: `multiplayerStore.ensureGame()` builds the `Game` + players exactly once per session, and `runRound(seed)` calls `activeGame.playRound(...)` each time. `startRound` (host action) broadcasts `start-round` for both the initial round and every subsequent one. Clients call `runRound` when they receive the broadcast. Scores, dealer state, and prevailing wind persist across rounds.
- **`RulesConfig.dealerDoubling: boolean`** (default `true`) enables the standard HK Old Style 2× dealer multiplier. **`ScoreTable.scoreWin` now takes `dealer: Wind`** and implements the full settlement: discarder pays `2V` + other losers pay `V` on a discard win; every loser pays `V` on self-draw; each individual payment doubles if the payer or receiver is the dealer (multipliers stack). See [ScoreTable.ts](src/core/scoring/ScoreTable.ts) + [ScoreTable.test.ts](src/core/scoring/ScoreTable.test.ts) for the schedule.
- **`RoundOutcome` carries `dealer: Wind`** (the dealer at scoring time, before `Game.advanceDealer` rotates). Both `win` and `draw` outcomes include it. The UI uses this to recompute the per-seat deltas in `OutcomeBanner` without depending on the live `game.dealer` (which may have already rotated).
- **Self-draw win button is gated by the validator.** `UIPolicy` now takes an optional `WinValidator` in its constructor; when present, it computes `canDeclareWin` (using a conservative `WinContext` — situational bonuses 嶺上開花/海底 default to false) and passes it through `ActionRequest`. The store threads this into `pending.canDeclareWin` and `GameTable` → `ActionPanel` hides the button when false. Trust mode (no validator) is preserved for tests. The engine's `throw` in `Round.finalizeSelfDrawWin` stays as a safety net.
- **Scoresheet in `OutcomeBanner`.** Banner takes `players` + `scoreTable` and re-runs `scoreTable.scoreWin(...)` to show per-seat round Δ + running bankroll for all four seats.
- **Round counter in `CenterArea`** via `game.history.length + 1`.

**Conventions worth carrying forward:**
- When a new field needs to flow from the engine to the UI, prefer adding it to the value objects (`RoundOutcome`, `PlayerView`) rather than reading live engine state — these are designed serializable (multiplayer-safe).
- `ScoreTable` is a pure value-computer. UI code can re-call `scoreWin` to derive presentations without touching engine state.
- `UIPolicy` is the canonical place to compute "what the UI is allowed to offer the user" — validator-driven gating belongs there, not in React components.

**Phase 8 — Polish & deploy** is next.
- Tile-move animations, optional sound.
- Keyboard navigation + screen-reader labels.
- Final QA pass.
- Verify the GitHub Pages workflow deploys cleanly.

See README.md for the full phase list.
