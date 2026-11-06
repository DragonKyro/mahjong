# CLAUDE.md

Working notes for future Claude sessions. Keep this file, [README.md](README.md) and [.gitignore](.gitignore) in sync whenever a convention, command or invariant changes.

## What this is

Browser mahjong on GitHub Pages: solo vs AI, online rooms (Firebase Realtime Database), and a discard trainer. A multi-variant framework with four playable variants: **Hong Kong Old Style, Taiwanese 16-tile, Japanese Riichi, American**.

## Tech stack (locked)

TypeScript (`strict`, `noUncheckedIndexedAccess`), Vite, React 18, Zustand 4, Firebase JS SDK (Realtime Database + anonymous Auth, lazy-loaded), Vitest + React Testing Library, plain CSS (one stylesheet). No ESLint / Prettier / Tailwind — removed on purpose to keep the repo lean like the sibling catan / card-collecting projects. Justify any new dependency here before installing it.

## Layout

```
src/core/            pure TS, no React/DOM — runs under Node
  tiles.ts           tile kinds & ids, notation parser ("123m 55z"), names
  rng.ts             mulberry32 seeded RNG
  hand.ts            decomposition, shanten, waits, discard acceptance (variant-agnostic: `sets` param)
  engine.ts          the table engine: MatchState + applyAction reducer, legal-move queries, views
  ai.ts              chooseAction(state, seat) for every variant and level; waitInfo / suggestDiscard / nearestHands hints
  training.ts        discard puzzles
  variants/index.ts  Variant interface (features + hooks), registry, WinInput, doraFromIndicator
  variants/hk.ts     HK Old Style: HkRules, FAAN_TABLE, evaluateHk, settleHk, liability
  variants/taiwan.ts Taiwanese 16-tile: TaiwanRules, TAI_TABLE, evaluateTaiwan, settleTaiwan (dealer tai per payer)
  variants/riichi.ts Riichi: RiichiRules, YAKU, evaluateRiichi (yaku + fu over every reading), settleRiichi (honba, sticks, pao), exhaustedRiichi (noten, nagashi)
  variants/american.ts American: HOUSE_CARD, card notation to FORMS, matches / distance, claim / expose / joker-swap hooks, evaluate / settle
src/net/             room.ts (wire types, transport interface, identity, room codes/links),
                     firebaseRoom.ts (Firebase transport, lazy), sync.ts (MatchSync: log ↔ state)
src/store/           gameStore (match + AI driver), netStore (rooms), trainingStore
src/ui/              App, Home, RulesForms (per-variant editors), Table, TablePanels, Lobby, Training, RulesPage (tab per variant), Tile, flip.ts (move animation), styles.css, devDemo (dev only)
scripts/             fix-lockfile.mjs, merge-db-rules.mjs
```

Path alias: `@/` → `src/`.

## Architectural invariants

1. **`src/core/` is pure.** No React, DOM, `window`, storage, network or Zustand. No `Math.random()` — randomness comes from `state.rng` (the AI derives its noise from the state too), so a seed + action log always reproduces a match.
2. **The engine is a reducer over JSON.** `applyAction(state, action)` never mutates its input and throws `IllegalAction` for illegal moves (`tryApply` returns null). `MatchState`, `Action` and `MatchConfig` must stay JSON-serializable — the online log replays them on every device.
3. **UI changes state only through the store** (`useGame().act(action)`). UI may import pure read-only helpers and types from `@/core` (e.g. `turnOptions`, `kindOf`, `waitInfo`); it must not hold or mutate engine state itself.
4. **Claim priority is Win > Pong/Kong > Chow; chow only from the discarder's 下家** (`claims.chi: 'left'`). Ties between winners: next in turn (截糊) unless the variant's `multiWin` rule is on. Claim windows resolve early once no pending seat can outrank the best answer received.
5. **Scoring is data.** Never hardcode a faan value or the 3-faan minimum — read `HkRules` (`rules.faan[id]`, `rules.minFaan`, …). New house rules go in `HkRules` + `DEFAULT_HK_RULES` + `RulesEditor`; `normalizeHkRules` fills fields missing from older saved configs.
6. **Seats are physical (0–3), turn order 0→1→2→3.** Seat wind = `(seat − dealer + 4) % 4`; the dealer is always East and winds rotate with the deal. In the UI, `rel = (seat − mySeat + 4) % 4`: 0 bottom, 1 right (下家), 2 top, 3 left (上家).

## Variant framework

A variant is `Variant<R>` (variants/index.ts): info (tiles, handSize, unit, terms), `features` flags, and hooks — `evaluate` / `canWin` / `settle`, `exhausted?` (draw payments), `afterHand` (dealer stays + honba), `matchOver`, `multiWin` ('head' | 'all' | 'double'), `reserve`, `shape`, `minimum` (AI planning), `normalizeRules`. Feature flags switch engine mechanics on: `bonus` ('setAside' | 'tiles' | 'none'), `chi` ('left' | 'none'), `kongs` (with replacement draws), `robKong`, `riichi`, `american`. **Variant files import engine types only** (value imports would make an import cycle that can crash at load); the engine calls the American hooks directly.

Adding a variant: write `variants/<id>.ts` with its rules and `Variant` object, add it to `VariantId`, `AnyRules`, `BY_ID` and `VARIANTS`, a `RulesForms` editor and a `RulesPage` tab, and an AI `potential()` branch if its value model differs.

## Engine notes

- Tile ids encode kinds: `0–135` → `id >> 2`, `136–143` bonus (kind 34–41), `144–151` jokers (42). Kinds 0–8 m, 9–17 p, 18–26 s, 27–30 ESWN, 31–33 白發中 (tenhou `5z 6z 7z`), 34–37 梅蘭菊竹, 38–41 春夏秋冬.
- The wall is one array: live draws from `head`, replacements from `tail`. `liveLeft = tail − head − variant.reserve`. Bonus tiles are set aside automatically and replaced from the back; `takeBonus` detects 八仙過海 / 七搶一.
- Phases: `charleston` (American), `act` (turn player: discard / kong / self-draw win / riichi / abort / joker swap), `claim` (a discard or a `robKong` window; `responses[seat] === null` = still deciding), `end` (result shown until every seat sends `ready`, AI seats included — the AI answers `ready`).
- Riichi (features.riichi): `hand.riichi[seat]` (declared by a `discard` with `riichi: true`; the stick is paid in `discardPassed` once the declaration isn't ronned), ippatsu broken by any call or the player's next discard, `furiten` (temporary, cleared on own discard) / `lockedFuriten` (after riichi) / own `gone` discards via `isFuriten`, `forbidden` kinds after a call (kuikae), dora indicators at wall[L-6-2i] (ura under them), `kans` per seat, abortive draws in `discardPassed` (four winds, four riichi, four kongs) and on `abort` (九種九牌), triple ron with `multiWin: 'double'`. `s.honba` / `s.sticks` live on the match.
- American (features.american): `charleston` stages 0 R, 1 A, 2 L, 3 vote, 4 L, 5 A, 6 R, 7 courtesy (`pass` / `vote` actions, simultaneous; jokers never pass); claims come from `american.claimOptions` (exposures must fit a card hand that allows exposures; any tile for Mah Jongg; discarded jokers are dead); exposures are `Meld.type 'set'`; joker exchange via `swap`. The UI auto-passes exposure-only call windows after 6 s (they come up on most discards).
- Off the last tile only a win may be claimed; kongs need a live tile left.
- `WinInput` is the canonical scoring input. Situational context (`robbingKong`, `lastTile`, `kongReplacement` = kongs in a row, `heavenly`, `earthly`, `wallLeft`, `discardUnseen`) is built in `buildWinInput`; add new context there first, then read it in the variant.
- `createRiggedMatch(config, { dealer, front, back })` builds test hands: `front` = deal order (blocks of 4 from the dealer, then 1 each) + the dealer's 14th + draws; `back` = replacement draws in order. Test-only.
- `wallStacks(s, seat)` maps the wall array onto the 18 stacks in front of a seat (stacks run clockwise; the break follows the dealer's dice).

## Scoring notes per variant

- Taiwan: `score.value` includes the dealer tai only when the winner is the dealer; `settleTaiwan` adds dealer tai (1 + 2 x streak) to each payment the dealer makes or receives. 獨聽 = the pre-win hand waits on exactly one kind. 平胡 needs no flowers or honors, a discard win and no single wait.
- Riichi: `score.raw` = yaku han (dora excluded), and `canWin` needs at least 1; `score.value` = total han; the yakuman count = items flagged `yakuman`. Every decomposition x winning-tile placement is scored (a shanpon ron opens that pong) and the best by points wins. Red fives are tile ids 16 / 52 / 88. The first winner (nearest the discarder) gets honba and the table's sticks via `WinInput.honba` / `sticks`.
- American: a card hand expands to `FORMS` (suit permutations x run offsets); `matches` = naturals within `need`, at least the non-jokerable part natural, jokers exactly filling the rest, exposures mapped onto distinct 3+ groups of non-concealed hands. `distance` drives the AI and the card panel. The **house card is original** (the NMJL card is a copyrighted yearly product; don't copy it in).

## HK scoring notes (audited 2026-11-05)

Values follow Wikipedia "Hong Kong mahjong scoring rules": 清一色 7, 小三元 5 / 大三元 8 *including* the dragon pongs (shown as one entry), 小四喜 6 (+ wind faan), limit hands 10/13 capped at `maxFaan` (default 10) and scoring only limit + winning-condition faan. Payout: `tablePoints` (half-spicy by default); self-draw = everyone pays T/2; 半銃 discard = discarder T/2, others T/4; 全銃 = discarder T. **No dealer bonus** (the old build doubled dealer payments — that is not HK). Liability (`liabilityFor`, 半銃 only): 包大三元 / 包大四喜 (last pong fed by a discard), 十二張包自摸, 九張包, 五子包生. 坎坎糊 needs every pong concealed — on a discard win the set the winning tile completes counts as open (the evaluator tries every placement). 七對子 is a house rule, off by default.

## AI notes

Per variant: `potential()` has HK, Taiwan and Riichi value models (Riichi: a concealed hand counts on riichi, an open one needs yakuhai / tanyao / flush / toitoi; dora add). The Riichi AI declares riichi with the discard leaving the best winning acceptance, aborts 九種九牌 unless it holds 11+ orphans, folds against a declared riichi when far from ready, and wants a clear gain before opening a concealed hand. The American AI plays toward the nearest card hands (`closest` / `distance`), passes the least-wanted tiles in the Charleston, votes for the second Charleston when 4+ away, swaps for jokers when that doesn't hurt, and exposes only when it gets strictly closer. Measured over 12 AI matches each (2026-11-06): Taiwan about 98% of hands won, Riichi about 90% (riichi, ippatsu, ura, double ron and noten payments all occur), American about 65% (the rest wall games).


`chooseAction` always returns a legal action for whatever the engine is waiting on. Normal/hard value hands by `potential()` (expected faan) and, at tenpai, by the waits that legally win (`canWin` with the minimum) — a tenpai that can't reach the minimum is worth no more than a 1-shanten hand. Hard adds defence (`threats` / `danger`: genbutsu, suji, dead honors, one-suit melds) only for a far-off hand against an opponent showing three melds. Measured (seat-rotated, 120 matches): normal and hard beat easy by a wide margin; hard ≈ normal on score but deals in ~20% less. Broader defence lost to plain efficiency (HK hands are cheap; folding costs wins) — don't widen it without measuring.

## Online (Firebase)

- Project `github-games-e7c7d`, shared with catan, card-collecting, tractor, … **All data under `DB_ROOT = 'mahjong'`** (`src/net/firebaseRoom.ts`); `database.rules.json` defines only that key. Deploy rules with `npm run deploy:rules` (predeploy merges into the live rules; never deploy the file alone). From Git Bash use `MSYS_NO_PATHCONV=1` for database paths.
- Layout: `rooms/{CODE}/{meta, lobby, matches/m{N}/{start, actions/aNNNNNN}, chat, presence}` + `roomDays` / `roomIndex` for the stale-room sweep. Payloads are JSON strings. `PROTOCOL_VERSION` (1) is checked by the rules (`meta.v`) — bump both together.
- A match = the start record (`MatchConfig` incl. seed) + the action log. `MatchSync` applies the log in slot order, shows this device's pending moves optimistically, retries a lost slot race, and drops moves that became illegal (quietly for AI moves). The AI driver is the host while connected, else the first connected human seat.
- Identity: `localStorage` uuid (`mahjong.uuid`), `?fresh` for per-tab identity when testing two windows.

## Commands

```bash
npm run dev          # Vite on http://localhost:5173/mahjong/  (VITE_BASE=/ for /; in Git Bash prefix MSYS_NO_PATHCONV=1)
npm test             # vitest run
npm run typecheck    # tsc
npm run build        # tsc && vite build
npm run fix-lock     # rewrite mirror URLs in package-lock.json to registry.npmjs.org
npm run deploy:rules # merge + deploy database.rules.json
FIREBASE_LIVE=1 npx vitest run src/net/firebase.live.test.ts   # rooms + rules against the real database (prints the room code; remove it after)
```

**Lockfile:** Kyle's npm uses a corporate Artifactory mirror; registry.npmjs.org is blocked locally. After any install that changes the lockfile, run `npm run fix-lock` (the URLs must be public or CI's `npm ci` fails). Locally npm maps the public URLs back to the mirror.

**Dev views:** `?demo=40|claim|end|over|riichi|charleston|lobby[&variant=...][&seed=N]` (dev server only) jumps to a table state — useful for screenshots (headless Chrome is installed; desktop Chrome can't go below ~500px wide, so use DevTools device emulation for phone sizes).

## Conventions

- Fewer, cohesive files: one module per concern (the old one-class-per-file OOP tree was folded into `engine.ts` / `hand.ts` / `variants/*`). Tests sit next to code (`engine.test.ts`).
- English identifiers, Chinese terms in user-facing strings (`碰 Pong`).
- The board is a CSS size container: size everything on it in `cqmin`. Each seat's side is drawn as the bottom side and rotated (`.side.r1` −90°, `.r2` 180°, `.r3` 90°, with `data-rot` on the layer); text stays in screen space. `--hand-n` / `--wall-n` on the board scale the hand tiles (Taiwan's 17) and wall stacks (17 / 18 / 19 per side).
- Tiles carry `data-tid` (via `useFace(s)` / `tid`), which `flip.ts` uses to animate moves; keep the id on any new tile rendering.
- Effects must use block bodies when calling DOM APIs that may return values (`scrollIntoView` returns a Promise in current Chrome).

## Status

Done: engine + HK Old Style + trainer + real-table UI + Firebase rooms + variant framework (2026-11-05); Taiwanese 16-tile, Japanese Riichi, American (house card), tile-move animations, red-five and joker art (2026-11-06). Open: Riichi uma / oka and agari-yame, American blind passes and a loadable card, sound.
