# 麻雀 Mahjong

Mahjong in the browser, hosted on GitHub Pages: **https://dragonkyro.github.io/mahjong/**

- **Play the computer** — pick a game on the home screen, then set it up: three AI opponents (Easy / Medium / Hard), each seat set separately, and the house rules. **Hong Kong is played by neural networks** trained by self-play (three snapshots from one run, see below); the other variants each have a heuristic AI tuned to its rules: Taiwan plays for speed, Riichi plays yaku / riichi / push-fold, American plans toward the card.
- **Play with friends** — online rooms with a 4-letter code or an invite link. Empty seats can be filled with computer players. Rooms live in a Firebase Realtime Database; no accounts.
- **Train** — a discard trainer: pick the tile that keeps a 14-tile hand closest to winning, then see every discard ranked by shanten and useful tiles.

Four rule sets: **Hong Kong Old Style, Taiwanese 16-tile, Japanese Riichi and American**.

The table looks and plays like a real one: a pinwheel wall that shrinks as tiles are drawn (with the dora indicator face up in Riichi's dead wall), each player's discards in rows in front of them (a riichi tile lies sideways), opponents' hands and melds facing their own seats, a compass with the round wind, seat winds, the dealer and riichi sticks, claim callouts, and tiles that fly from the wall to the hand, into the pond and onto melds.

## Variants

The engine is a framework for several rule sets ([src/core/variants/](src/core/variants/)). A variant supplies its tile set, hand size, reserved tiles, feature flags, scoring, settlement, draw payments, dealer rotation and match end; the shared engine runs the wall, deal, draw / discard / claim loop, kongs, bonus tiles, robbing a kong, and the flagged mechanics (riichi / furiten / dora, the Charleston and jokers).

| Variant | Highlights |
|---|---|
| 香港舊章 Hong Kong Old Style | 13 tiles, flowers, 3-faan minimum, half-spicy payouts, 包 liability |
| 台灣十六張 Taiwanese 16-tile | 16 tiles (five sets + a pair), 底 + 台 payments, dealer and 連莊 tai, 16 tiles left in the wall, no minimum |
| 日本麻雀 Japanese Riichi | red fives and dora, yaku required, han + fu, riichi / ippatsu / furiten, honba, noten payments, abortive draws |
| 美式麻將 American | 8 jokers, the Charleston, hands from a card, joker exchange, jokerless doubling |

## Hong Kong Old Style rules

144 tiles with flowers and seasons; 13-tile hands, four sets and a pair (plus 十三么, and 七對子 as a house rule). Chow only from the player on your left; claim priority Win > Pong / Kong > Chow; the next player in turn wins a contested discard (截糊) unless 一炮多響 is on. Adding to an exposed pong can be robbed (搶槓); 十三么 may also rob a concealed kong.

**Scoring** follows the common HK Old Style table (the in-app Rules page is generated from the same data the engine uses):

- 3-faan minimum, limit hands paid at the 10-faan cap (8 / 13 selectable).
- Hands: 平糊 1, 對對糊 3, 混一色 3, 清一色 7, 花么九 1, 小三元 5, 大三元 8, 小四喜 6. Limits: 字一色, 坎坎糊, 清么九, 九子連環 (10); 大四喜, 十八羅漢, 十三么, 天糊, 地糊, 八仙過海 (13). Limit hands add only how-you-won faan.
- Honors: each dragon pong 1, seat wind 1, prevailing wind 1 (both for a double wind).
- Flowers: 無花 1, each seat flower / season 1, a full set of four 2; 八仙過海 and 七搶一 win outright.
- How you won: 自摸 1, 門前清 1 (concealed kongs don't break it), 搶槓 1, 海底撈月 1 (last tile or last discard), 槓上開花 1, 槓上槓 8.
- Points: half-spicy table (8, 16, 24, 32, 48, 64, 96, 128 for 3–10 faan) or full-spicy. Self-draw: everyone pays half the table value. Discard: 半銃 — discarder half, the others a quarter each — or 全銃, the discarder pays all.
- 包 liability (半銃): feeding the last dragon / wind pong of 大三元 / 大四喜, 九張包, 十二張包自摸, 五子包生.
- The dealer is always East and has no payout bonus; the deal stays after a dealer win or a draw. A match is one prevailing-wind round by default (two or four selectable).

Every value above is a house rule in `HkRules` and can be changed from the setup screen or the online lobby.

## Taiwanese 16-tile rules

16 tiles (the dealer 17), five sets and a pair; chow from the left only; the last 16 tiles stay in the wall. Any complete hand wins: every payment is 底 (base, default 30) + 台 (default 10) × tai; only the discarder pays on a discard, all three on a self-draw. Payments between the dealer and anyone add 莊家 1 tai + 2 per hand kept (連莊拉莊). Tai: 門清 1, 自摸 1, 門清自摸 3, 獨聽 1, 全求人 2, 平胡 2, seat flower 1, 花槓 2, dragon / seat / round wind pongs 1, 三/四/五暗刻 2/5/8, 碰碰胡 4, 混一色 4, 清一色 8, 字一色 16, 小三元 4, 大三元 8, 小四喜 8, 大四喜 16, 嚦咕嚦咕 8, 天胡 / 地胡 16, 人胡 8, 七搶一 / 八仙過海 8, plus 搶槓 / 槓上開花 / 海底 / 河底 1. House tables vary, so all of it is editable.

## Japanese Riichi rules

Modern standard rules (Tenhou / Mahjong Soul defaults): 136 tiles with three red fives, a 14-tile dead wall with dora (and kan dora, ura dora for riichi), every win needs a yaku (the full list, yakuman included), han + fu with mangan / haneman / baiman / sanbaiman / kazoe yakuman, riichi (1,000 on the table, then tsumogiri), ippatsu, double riichi, furiten (own discards, passed tiles, riichi), kuikae, chankan (kokushi may rob a concealed kong), double ron (triple = abortive), honba (+300), noten payments (3,000 split), nagashi mangan, pao for daisangen / daisuushii, abortive draws (九種九牌, 四風連打, 四家立直, 四槓散了), dealer repeats on a win or when ready at a draw, a bust ends the game. East game by default (East–South selectable).

## American rules

152 tiles with 8 jokers; the Charleston (right, across, left; a second one if everyone agrees; a courtesy trade across); no chows; a discard can be called only for an exposure that fits a card hand, or for Mah Jongg; jokers fill groups of three or more (never pairs or singles) and can be bought back from exposures; discarder pays double, the others single, self-drawn double from all; jokerless hands double; wall games pay nothing. The official card is a yearly National Mah Jongg League publication, so the app plays its own **House Card 2026** in the same notation — 34 hands across 2468, 13579, consecutive runs, like numbers, winds & dragons, 369, the year, quints, and singles & pairs. The card is plain data in [src/core/variants/american.ts](src/core/variants/american.ts).

## Running locally

```bash
npm install          # then `npm run fix-lock` if the lockfile changed (see below)
npm run dev          # http://localhost:5173/mahjong/
npm test             # Vitest, single run
npm run typecheck
npm run build        # → dist/
```

`VITE_BASE=/ npm run dev` serves from `/` instead of `/mahjong/`. In dev, `?demo=40|claim|end|over|riichi|charleston|lobby` (with `&variant=hk|taiwan|riichi|american`) jumps to a given moment of a match; `?page=train` / `?page=rules` work in any build.

## Neural HK agent

[training/](training/README.md) trains a neural Hong Kong player locally: Node workers play matches with the real engine and a PyTorch learner trains on the GPU.

- **Schedule:** 100 updates imitating the heuristic AI, then PPO self-play against itself and its own past snapshots.
- **No peeking:** it sees only its own seat's view, never the wall or other hands (tested).
- **In the game:** the three difficulty levels are snapshots of the run (training updates 200, 1000 and 5000), each a 1.85 MB int8 file in [public/policies/hk/](public/policies/hk). They load on demand in the browser (`npm run ship-policies` copies them from a run). Measured against each other and the old heuristic AI, with paired deals (points per match; ±8): hard beats the heuristic by about +89, medium by +81, easy by +50, and each level is 35–45 points behind the next.
- **Suggested discards** (the hint) come from the hard network.
- **Rules:** the networks were trained on the default HK rules; with house rules changed they stay legal but are playing outside what they learned.

```bash
conda activate train
python -m pytest training/hk -q            # parity and smoke tests
python training/hk/train.py --name hk1     # 5,000 updates, about 4 hours on an RTX A2000
```

**Lockfile.** The lockfile must point at `registry.npmjs.org` or the GitHub Actions build can't install. If your npm is configured with a private mirror, run `npm run fix-lock` after any install that changes `package-lock.json`; it rewrites the mirror URLs (the tarballs and integrity hashes are identical). npm still installs through your mirror locally.

## Online play

Rooms are stored under the `mahjong` key of the shared Firebase project `github-games-e7c7d` (web app "Mahjong"); each device signs in anonymously and invisibly. Every device runs the same engine from the room's start record (seed + rules + seats) and applies the match's write-once action log, so all devices hold the same state; the host's device (or a stand-in if it drops) plays the computer seats. Rejoining replays the log, and `?room=CODE` in the URL rejoins after a reload. Stale rooms are swept a week after their day ends.

The database rules live in [database.rules.json](database.rules.json) and cover only the `mahjong` key. Deploy them with `npm run deploy:rules`: it runs [scripts/merge-db-rules.mjs](scripts/merge-db-rules.mjs) first, which merges our key into the live rules so the other apps sharing the database keep theirs.

## Deployment

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): `npm ci` → typecheck → test → build → GitHub Pages.

## Credits

Suit, wind, 發 / 中 and red-five tile faces are from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) (CC0, public domain). 白板, the flowers and seasons and the joker are drawn in [src/ui/Tile.tsx](src/ui/Tile.tsx). Tile bodies and backs are CSS.

## Roadmap

- [x] Engine, HK Old Style rules and scoring, AI, trainer
- [x] Real-table UI (desktop, tablet, phone)
- [x] Online rooms on Firebase (lobby, chat, rejoin, AI seats, spectators)
- [x] Variant framework
- [x] Taiwanese 16-tile
- [x] Japanese Riichi
- [x] American (with an original house card)
- [x] Tile-move animations
- [x] Neural HK agent: encoding, action space, network, env bridge
- [x] Neural HK agent: trainer (imitation, then PPO self-play), compact int8 policy files
- [x] Neural HK agent: the 5,000-update run, shipped as the easy / normal / hard computer players (the HK heuristic AI is now only the training teacher)
- [ ] Neural HK agent: next run (house-rule randomisation, variance reduction, opponent league)
- [ ] Optional: sound, curated training shapes (兩面 / 嵌張 / 邊張), Riichi uma / oka, a loadable American card
