// Rules reference, one tab per variant, generated from the same data the
// engine scores with (faan / tai / yaku tables, the house card).

import { useState } from 'react';
import { parseKinds } from '@/core/tiles';
import { VARIANTS, type VariantId } from '@/core/variants';
import { HOUSE_CARD } from '@/core/variants/american';
import { DEFAULT_HK_RULES, FAAN_TABLE, tablePoints, type FaanGroup } from '@/core/variants/hk';
import { DEFAULT_RIICHI_RULES, YAKU, basePoints, payments } from '@/core/variants/riichi';
import { DEFAULT_TAIWAN_RULES, TAI_TABLE } from '@/core/variants/taiwan';
import { CardLine } from './TablePanels';
import { TileRow } from './Tile';

const num = (n: number) => n.toLocaleString('en-US');

export function RulesPage({ initial = 'hk', back }: { initial?: VariantId; back: () => void }) {
  const [tab, setTab] = useState<VariantId>(initial);
  return (
    <div className="rules-page">
      <div className="rules-tabs">
        <button type="button" className="btn ghost" onClick={back}>
          ← Back
        </button>
        {VARIANTS.map((v) => (
          <button key={v.id} type="button" className={`tab ${tab === v.id ? 'on' : ''}`} onClick={() => setTab(v.id)}>
            <span className="cjk">{v.zh}</span> {v.name}
          </button>
        ))}
      </div>
      {tab === 'hk' && <HkRules />}
      {tab === 'taiwan' && <TaiwanRulesPage />}
      {tab === 'riichi' && <RiichiRulesPage />}
      {tab === 'american' && <AmericanRulesPage />}
    </div>
  );
}

// ------------------------------------------------------------ Hong Kong

const HK_GROUPS: { id: FaanGroup; title: string; note?: string }[] = [
  { id: 'hand', title: 'Hand patterns' },
  { id: 'honor', title: 'Winds and dragons' },
  { id: 'bonus', title: 'Flowers and seasons' },
  { id: 'condition', title: 'How you won' },
  { id: 'limit', title: 'Limit hands', note: 'A limit hand scores only its own value plus how-you-won faan; winds, dragons and flowers are not added. Everything is capped at the limit (default 10 faan).' },
];

const EXAMPLES: Partial<Record<string, string>> = {
  commonHand: '123m 456p 789s 234s 55m',
  allTriplets: '111m 555p 999s 222z 77z',
  mixedOneSuit: '123p 456p 789p 555z 11z',
  allOneSuit: '123s 345s 678s 999s 22s',
  smallDragons: '555z 666z 77z 123m 456m',
  greatDragons: '555z 666z 777z 234p 99s',
  smallWinds: '111z 222z 333z 44z 789m',
  thirteenOrphans: '19m 19p 19s 1234567z 1m',
  nineGates: '1112345678999m 5m',
};

function HkRules() {
  const r = DEFAULT_HK_RULES;
  const rows: number[] = [];
  for (let f = r.minFaan; f <= 13; f++) rows.push(f);
  return (
    <>
      <section className="panel">
        <h2>
          <span className="cjk">香港舊章</span> Hong Kong Old Style
        </h2>
        <ul>
          <li>144 tiles: three suits (萬 characters, 筒 circles, 索 bamboo) 1–9, four winds, three dragons, four of each — plus eight flowers and seasons, set aside when drawn and replaced from the back of the wall.</li>
          <li>Everyone holds 13 tiles; draw one, discard one. The dealer is always East and starts with 14.</li>
          <li>Win with four sets and a pair. A set is a chow (上, three in a row of one suit) or a pong (碰, three alike); four alike is a kong (槓), which earns a replacement tile. Special hands: 十三么, and 七對子 as a house rule.</li>
          <li>Pong or kong any discard; chow only from the player on your left (上家). Priority: win &gt; pong / kong &gt; chow; the next in turn wins a contested discard (截糊) unless 一炮多響 is on.</li>
          <li>Adding to an exposed pong can be robbed (搶槓).</li>
          <li>
            You need at least <b>{r.minFaan} faan</b> to win. The dealer keeps the deal after winning or a drawn hand; otherwise it passes right, and after all four have dealt the round wind moves on.
          </li>
        </ul>
      </section>
      <section className="panel">
        <h3>Faan (番)</h3>
        {HK_GROUPS.map((g) => (
          <div key={g.id} className="faan-group">
            <h4>{g.title}</h4>
            {g.note && <p className="muted small">{g.note}</p>}
            <table className="faan wide">
              <tbody>
                {FAAN_TABLE.filter((e) => e.group === g.id).map((e) => (
                  <tr key={e.id}>
                    <td className="cjk">{e.zh}</td>
                    <td>
                      <b>{e.en}</b>
                      <div className="muted small">{e.desc}</div>
                      {EXAMPLES[e.id] && <TileRow kinds={parseKinds(EXAMPLES[e.id]!)} className="mini example" />}
                    </td>
                    <td className="num">{e.faan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
      <section className="panel">
        <h3>Payouts</h3>
        <ul>
          <li>Faan become points on a doubling table: 半辣 half-spicy (default) doubles every faan up to 4, then every two faan; 全辣 full-spicy doubles every faan.</li>
          <li>
            <b>Self-drawn:</b> each of the other three pays half the table value. <b>On a discard, 半銃:</b> the discarder pays half, the other two a quarter each. <b>全銃:</b> the discarder pays it all.
          </li>
          <li>
            <b>包 liability</b> (半銃): feeding the last pong of 大三元 / 大四喜, 九張包, 十二張包自摸, 五子包生 — the feeder pays for everyone.
          </li>
          <li>No dealer bonus in Hong Kong rules.</li>
        </ul>
        <table className="payout">
          <thead>
            <tr>
              <th>番</th>
              <th>Table</th>
              <th>自摸 each</th>
              <th>Discarder (半銃)</th>
              <th>Others (半銃)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const T = tablePoints(f, { ...r, maxFaan: 13 });
              return (
                <tr key={f}>
                  <td>{f}</td>
                  <td className="num">{T}</td>
                  <td className="num">{T / 2}</td>
                  <td className="num">{T / 2}</td>
                  <td className="num">{T / 4}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ------------------------------------------------------------ Taiwan

function TaiwanRulesPage() {
  const r = DEFAULT_TAIWAN_RULES;
  const groups = [
    ['dealer', 'Dealer'],
    ['win', 'How you won'],
    ['bonus', 'Flowers'],
    ['honor', 'Winds and dragons'],
    ['hand', 'Hand patterns'],
    ['special', 'Special hands'],
  ] as const;
  return (
    <>
      <section className="panel">
        <h2>
          <span className="cjk">台灣十六張</span> Taiwanese 16-tile
        </h2>
        <ul>
          <li>144 tiles with flowers. Everyone holds 16 tiles (the dealer 17); win with five sets and a pair.</li>
          <li>Chow only from the player on your left; pong / kong anyone's discard. The last {r.reserve} tiles of the wall are never drawn.</li>
          <li>
            <b>Any complete hand wins</b> — there is no minimum. Every payment is the base (底 {r.base}) plus {r.perTai} per tai (台).
          </li>
          <li>On a discard only the discarder pays; self-drawn, all three pay. Payments between the dealer and anyone add 莊家 1 tai plus 2 per hand the dealer has kept the deal (連莊拉莊).</li>
          <li>The dealer keeps the deal on a win or a draw.</li>
        </ul>
      </section>
      <section className="panel">
        <h3>Tai (台)</h3>
        {groups.map(([id, title]) => (
          <div key={id} className="faan-group">
            <h4>{title}</h4>
            <table className="faan wide">
              <tbody>
                {TAI_TABLE.filter((e) => e.group === id).map((e) => (
                  <tr key={e.id}>
                    <td className="cjk">{e.zh}</td>
                    <td>
                      <b>{e.en}</b>
                      <div className="muted small">{e.desc}</div>
                    </td>
                    <td className="num">{e.tai}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="muted small">House tables vary (especially 天胡 / 地胡 / 人胡 and the cap); every value can be changed in the house rules.</p>
      </section>
    </>
  );
}

// ------------------------------------------------------------ Riichi

function RiichiRulesPage() {
  const r = DEFAULT_RIICHI_RULES;
  const normal = YAKU.filter((y) => !y.yakuman);
  const yakuman = YAKU.filter((y) => y.yakuman);
  return (
    <>
      <section className="panel">
        <h2>
          <span className="cjk">日本麻雀</span> Japanese Riichi
        </h2>
        <ul>
          <li>136 tiles, no flowers, three red fives (each one dora). The last 14 tiles are the dead wall: kong replacements and the dora indicators (the tile after an indicator is dora).</li>
          <li>
            Win with four sets and a pair (or seven pairs, or thirteen orphans) that has at least one <b>yaku</b>; dora alone don't count.
          </li>
          <li>With a concealed ready hand you may declare riichi (1,000 points on the table): one yaku, and from then on you throw what you draw.</li>
          <li>Furiten: you can't win off a discard if one of your waits is among your own discards, or for the rest of the go-around after passing a winning tile (for the rest of the hand after riichi).</li>
          <li>Chii only from the left; after a call you can't throw back the same tile (kuikae).</li>
          <li>Points: base = fu × 2^(han+2), capped at mangan (2,000) from 5 han; ron pays 4× (6× for the dealer), tsumo splits it. Each honba adds 300; riichi sticks go to the winner.</li>
          <li>Exhaustive draw: the ready players share 3,000 from the others. The dealer repeats on a win or when ready at a draw.</li>
          <li>
            Abortive draws: 九種九牌, 四風連打, 四家立直, 四槓散了{r.multiRon === 'double' ? ', 三家和' : ''}.
          </li>
        </ul>
      </section>
      <section className="panel">
        <h3>Yaku (役)</h3>
        <table className="faan wide">
          <thead>
            <tr>
              <th />
              <th />
              <th>Closed</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {normal.map((y) => (
              <tr key={y.id}>
                <td className="cjk">{y.zh}</td>
                <td>
                  <b>{y.en}</b>
                  <div className="muted small">{y.desc}</div>
                </td>
                <td className="num">{y.closed}</td>
                <td className="num">{y.open || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Yakuman (役満)</h4>
        <table className="faan wide">
          <tbody>
            {yakuman.map((y) => (
              <tr key={y.id}>
                <td className="cjk">{y.zh}</td>
                <td>
                  <b>{y.en}</b>
                  <div className="muted small">{y.desc}</div>
                </td>
                <td className="num">{y.open ? 'open ok' : 'closed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>Points on a ron (non-dealer / dealer)</h3>
        <table className="payout">
          <thead>
            <tr>
              <th>翻</th>
              {[20, 25, 30, 40, 50].map((f) => (
                <th key={f}>{f} fu</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4].map((han) => (
              <tr key={han}>
                <td>{han}</td>
                {[20, 25, 30, 40, 50].map((f) => (
                  <td key={f} className="num">
                    {(han === 1 && f < 30) || (f === 25 && han < 2) ? '—' : `${num(payments(basePoints(han, f, 0, r).base, false, false).ron)} / ${num(payments(basePoints(han, f, 0, r).base, true, false).ron)}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">Mangan 8,000 / 12,000 · haneman (6–7) 12,000 / 18,000 · baiman (8–10) 16,000 / 24,000 · sanbaiman (11–12) 24,000 / 36,000 · yakuman 32,000 / 48,000.</p>
      </section>
    </>
  );
}

// ------------------------------------------------------------ American

function AmericanRulesPage() {
  const cats = [...new Set(HOUSE_CARD.hands.map((h) => h.cat))];
  return (
    <>
      <section className="panel">
        <h2>
          <span className="cjk">美式麻將</span> American
        </h2>
        <ul>
          <li>152 tiles: the usual 136, 8 flowers (all alike here) and 8 jokers. Dragons go with suits: red with craks, green with bams, white ("soap", also used as 0) with dots.</li>
          <li>
            <b>The Charleston</b> before play: pass three tiles right, across, then left; then, if everyone agrees, left, across, right; then an optional courtesy trade of up to three across. Jokers are never passed.
          </li>
          <li>East starts with 14 and discards first. There are no chows. You may call a discard only to complete an exposure (pung, kong, quint…) that fits a hand on the card — or to declare Mah Jongg with any tile.</li>
          <li>Jokers stand in for any tile in a group of three or more alike, never in a pair or a single. On your turn you can buy back a joker from any exposure with the real tile.</li>
          <li>
            Only hands on the card win. Discarder pays double the hand's value, the other two single; a self-drawn Mah Jongg is double from everyone. A jokerless hand doubles. A wall game pays nothing; the deal passes every hand.
          </li>
          <li>The official card is published every year by the National Mah Jongg League; this app plays its own house card in the same notation.</li>
        </ul>
      </section>
      <section className="panel">
        <h3>{HOUSE_CARD.name}</h3>
        <p className="muted small">
          <span className="tok s-a">a</span> <span className="tok s-b">b</span> <span className="tok s-c">c</span> are three different suits (any suits) · F flower · N E W S winds · R G dragons · 0 white dragon · D the dragon of that suit · numbers on
          a consecutive hand can start anywhere · X exposed allowed, C concealed.
        </p>
        {cats.map((c) => (
          <div key={c} className="faan-group">
            <h4>{c}</h4>
            <table className="faan wide">
              <tbody>
                {HOUSE_CARD.hands
                  .filter((h) => h.cat === c)
                  .map((h) => (
                    <tr key={h.id}>
                      <td>
                        <CardLine text={h.text} />
                        {h.run && <div className="muted small">any consecutive numbers</div>}
                      </td>
                      <td className="num">{h.concealed ? 'C' : 'X'}</td>
                      <td className="num">{h.value}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </>
  );
}
