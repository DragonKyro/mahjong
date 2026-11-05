# 麻雀 Mahjong

Mahjong in the browser, hosted on GitHub Pages: **https://dragonkyro.github.io/mahjong/**

- **Play the computer** — three AI opponents (easy / normal / hard), each seat set separately.
- **Play with friends** — online rooms with a 4-letter code or an invite link. Empty seats can be filled with computer players. Rooms live in a Firebase Realtime Database; no accounts.
- **Train** — a discard trainer: pick the tile that keeps a 14-tile hand closest to winning, then see every discard ranked by shanten and useful tiles.

The table looks and plays like a real one: a pinwheel wall of 18 stacks a side that shrinks as tiles are drawn, each player's discards in rows of six in front of them, opponents' hands and melds facing their own seats, a compass with the round wind, seat winds and the dealer, and claim callouts (碰 / 上 / 槓 / 食糊).

## Variants

The engine is a framework for several rule sets ([src/core/variants/](src/core/variants/)). A variant supplies its tile set, hand size, reserved tiles, claim rules, scoring and settlement; the shared engine runs the wall, deal, draw / discard / claim loop, kongs, bonus tiles, robbing a kong and dealer rotation.

| Variant | Status |
|---|---|
| 香港舊章 Hong Kong Old Style | **Playable** — full rules, below |
| 台灣十六張 Taiwanese 16-tile | Planned — needs the tai table, dealer-streak bonus, Taiwan-only hands |
| 日本麻雀 Japanese Riichi | Planned — needs riichi / furiten, dora and the dead wall, yaku + fu scoring |
| 美式麻將 American | Planned — needs the Charleston, jokers, and a hand-card pattern matcher (the yearly NMJL card is a published product, so the app would ship its own card or load one) |

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

## Running locally

```bash
npm install          # then `npm run fix-lock` if the lockfile changed (see below)
npm run dev          # http://localhost:5173/mahjong/
npm test             # Vitest, single run
npm run typecheck
npm run build        # → dist/
```

`VITE_BASE=/ npm run dev` serves from `/` instead of `/mahjong/`. In dev, `?demo=40`, `?demo=claim`, `?demo=end`, `?demo=over` and `?demo=lobby` jump to a given moment of a match (and `?page=train` / `?page=rules` work in any build).

**Lockfile.** The lockfile must point at `registry.npmjs.org` or the GitHub Actions build can't install. If your npm is configured with a private mirror, run `npm run fix-lock` after any install that changes `package-lock.json`; it rewrites the mirror URLs (the tarballs and integrity hashes are identical). npm still installs through your mirror locally.

## Online play

Rooms are stored under the `mahjong` key of the shared Firebase project `github-games-e7c7d` (web app "Mahjong"); each device signs in anonymously and invisibly. Every device runs the same engine from the room's start record (seed + rules + seats) and applies the match's write-once action log, so all devices hold the same state; the host's device (or a stand-in if it drops) plays the computer seats. Rejoining replays the log, and `?room=CODE` in the URL rejoins after a reload. Stale rooms are swept a week after their day ends.

The database rules live in [database.rules.json](database.rules.json) and cover only the `mahjong` key. Deploy them with `npm run deploy:rules`: it runs [scripts/merge-db-rules.mjs](scripts/merge-db-rules.mjs) first, which merges our key into the live rules so the other apps sharing the database keep theirs.

## Deployment

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml): `npm ci` → typecheck → test → build → GitHub Pages.

## Credits

Suit, wind and 發 / 中 tile faces are from [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles) (CC0, public domain). 白板 and the flowers and seasons are drawn in [src/ui/Tile.tsx](src/ui/Tile.tsx). Tile bodies and backs are CSS.

## Roadmap

- [x] Engine, HK Old Style rules and scoring, AI, trainer
- [x] Real-table UI (desktop, tablet, phone)
- [x] Online rooms on Firebase (lobby, chat, rejoin, AI seats, spectators)
- [x] Variant framework
- [ ] Taiwanese 16-tile
- [ ] Japanese Riichi
- [ ] American
- [ ] Optional: tile-move animations, sound, curated training shapes (兩面 / 嵌張 / 邊張)
