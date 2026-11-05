// Rules reference for Hong Kong Old Style, generated from the same data the
// engine scores with (FAAN_TABLE, DEFAULT_HK_RULES), plus the planned variants.

import { VARIANTS } from '@/core/variants';
import { DEFAULT_HK_RULES, FAAN_TABLE, tablePoints, type FaanGroup } from '@/core/variants/hk';
import { parseKinds } from '@/core/tiles';
import { TileRow } from './Tile';

const GROUPS: { id: FaanGroup; title: string; note?: string }[] = [
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

export function RulesPage({ back }: { back: () => void }) {
  const r = DEFAULT_HK_RULES;
  const rows: number[] = [];
  for (let f = r.minFaan; f <= 13; f++) rows.push(f);
  return (
    <div className="rules-page">
      <button type="button" className="btn ghost" onClick={back}>
        ← Back
      </button>
      <section className="panel">
        <h2>
          <span className="cjk">香港舊章</span> Hong Kong Old Style
        </h2>
        <h3>The game</h3>
        <ul>
          <li>
            144 tiles: three suits (萬 characters, 筒 circles, 索 bamboo) 1–9, four winds, three dragons, four of each — plus eight flowers and
            seasons, which are set aside when drawn and replaced from the back of the wall.
          </li>
          <li>Everyone holds 13 tiles. On your turn draw one, then discard one. The dealer is always East and starts with 14.</li>
          <li>
            Win with four sets and a pair. A set is a chow (上, three in a row of one suit) or a pong (碰, three alike); four alike is a kong (槓),
            which earns a replacement tile. Special hands: 十三么 thirteen orphans, and 七對子 seven pairs as a house rule.
          </li>
          <li>
            Claim a discard to complete a set: pong or kong from anyone, chow only from the player on your left (上家). Priority is win &gt; pong /
            kong &gt; chow. If two players win on the same tile, the next in turn takes it (截糊) unless 一炮多響 is on.
          </li>
          <li>Adding your fourth tile to an exposed pong can be robbed (搶槓) by anyone who wins on that tile.</li>
          <li>
            You need at least <b>{r.minFaan} faan</b> to win (三番起糊). The dealer keeps the deal after winning or a drawn hand; otherwise it passes
            to the right, and after all four have dealt the round wind moves on.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h3>Faan (番)</h3>
        {GROUPS.map((g) => (
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
        <p>
          Faan become points on a doubling table. 半辣 half-spicy (the default) doubles every faan up to 4, then every two faan; 全辣 full-spicy
          doubles every faan.
        </p>
        <ul>
          <li>
            <b>Self-drawn (自摸):</b> each of the other three pays half the table value.
          </li>
          <li>
            <b>On a discard, 半銃 (default):</b> the discarder pays half, the other two a quarter each. <b>全銃:</b> the discarder pays it all.
          </li>
          <li>
            <b>包 liability</b> (半銃 only): the discarder pays for everyone when it feeds the last dragon pong of 大三元 or wind pong of 大四喜,
            discards into an all-one-suit hand showing three melds of that suit (九張包), fed the fourth such meld before a self-drawn pure hand
            (十二張包自摸), or throws a tile nobody has seen with five or fewer tiles left (五子包生).
          </li>
          <li>There is no dealer bonus in Hong Kong rules.</li>
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

      <section className="panel">
        <h3>Other variants</h3>
        <p className="muted">The engine is built to host more rule sets; these are registered and described, but not playable yet.</p>
        {VARIANTS.filter((v) => v.status === 'planned').map((v) => (
          <div key={v.id} className="planned-row">
            <h4>
              <span className="cjk">{v.zh}</span> {v.name}
            </h4>
            <p>{v.blurb}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
