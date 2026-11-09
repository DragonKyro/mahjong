// Everything around the board: the hand-result card, the match-over card and
// the side panel (round info, scores, history, settings, the American card,
// chat).

import { useEffect, useRef, useState } from 'react';
import { nearestHands } from '@/core/ai';
import { isFinalHand, liveLeft, seatWind, variantOf, type HandResult, type MatchState, type WinRecord } from '@/core/engine';
import { WIND_EN, WIND_ZH } from '@/core/tiles';
import { HOUSE_CARD } from '@/core/variants/american';
import { tablePoints, type HkRules } from '@/core/variants/hk';
import { basePoints, payments, type RiichiRules } from '@/core/variants/riichi';
import type { TaiwanRules } from '@/core/variants/taiwan';
import { useGame, type Speed } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { rulesSummary } from './RulesForms';
import { Tile, useFace } from './Tile';

const names = (s: MatchState) => s.config.seats.map((c) => c.name);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const num = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n));

/** An American card line: suits shown in the card's colours. */
export function CardLine({ text }: { text: string }) {
  return (
    <span className="card-line">
      {text.split(/\s+/).map((tok, i) => {
        const suit = /[abc]$/.exec(tok)?.[0] ?? 'h';
        return (
          <span key={i} className={`tok s-${suit}`}>
            {tok.replace(/[abc]$/, '')}
          </span>
        );
      })}
    </span>
  );
}

function winHow(s: MatchState, w: WinRecord): string {
  const n = names(s);
  const t = variantOf(s).terms;
  if (w.flowerWin === 'eight') return '八仙過海 · all eight flowers';
  if (w.flowerWin === 'sevenRobOne') return `七搶一 · robs ${n[w.from!]}'s eighth flower`;
  if (w.robbingKong) return `搶槓 · robs ${n[w.from!]}'s kong`;
  if (w.selfDraw) return `${t.tsumo} · self-drawn`;
  return `${t.ron} · off ${n[w.from!]}'s discard`;
}

/** Show repeated entries (two seat flowers…) as one row. */
function mergeItems(items: WinRecord['score']['items']) {
  const out: { id: string; zh: string; en: string; value: number; n: number }[] = [];
  for (const i of items) {
    const prev = out.find((o) => o.id === i.id);
    if (prev) {
      prev.value += i.value;
      prev.n++;
      prev.en = `${i.en} ×${prev.n}`;
    } else out.push({ ...i, n: 1 });
  }
  return out;
}

function WinDetail({ s, w }: { s: MatchState; w: WinRecord }) {
  const st = w.settlement;
  const mySeat = useGame((x) => x.mySeat);
  const gained = st.deltas[w.seat]!;
  const face = useFace(s);
  const v = variantOf(s);
  const american = v.features.american;
  return (
    <div className="win">
      <div className="win-head">
        <span className="cjk wind">{WIND_ZH[seatWind(s, w.seat)]}</span>
        <div>
          <h3>{w.seat === mySeat ? 'You win!' : `${names(s)[w.seat]} wins`}</h3>
          <div className="how">{winHow(s, w)}</div>
        </div>
      </div>
      <div className="win-hand">
        {w.hand.map((t) => (
          <Tile key={t} {...face(t)} className={t === w.tile ? 'winning' : ''} />
        ))}
        {w.melds.map((m) => (
          <span key={m.order} className="meld">
            {m.tiles.map((t, i) => (m.concealed && (i === 0 || i === 3) ? <Tile key={t} kind={null} /> : <Tile key={t} {...face(t)} />))}
          </span>
        ))}
        {w.bonus.length > 0 && (
          <span className="bonus">
            {w.bonus.map((t) => (
              <Tile key={t} {...face(t)} />
            ))}
          </span>
        )}
      </div>
      {w.indicators && (
        <div className="indicators">
          <span className="muted">Dora indicator</span>
          {w.indicators.map((t) => (
            <Tile key={t} {...face(t)} />
          ))}
          {w.uraIndicators && (
            <>
              <span className="muted">ura</span>
              {w.uraIndicators.map((t) => (
                <Tile key={t} {...face(t)} />
              ))}
            </>
          )}
        </div>
      )}
      <table className="faan">
        <tbody>
          {mergeItems(w.score.items).map((i) => (
            <tr key={i.id}>
              <td className="cjk">{i.zh}</td>
              <td>{american && i.id !== 'jokerless' ? <CardLine text={i.en} /> : i.en}</td>
              <td className="num">{i.value}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>{w.score.summary}</td>
            <td className="num" title="What the winner collects">
              +{num(gained)}
            </td>
          </tr>
        </tfoot>
      </table>
      {st.liable !== null && (
        <p className="liable">
          <b className="cjk">{st.liabilityRule}</b> — {names(s)[st.liable]} pays for everyone.
        </p>
      )}
    </div>
  );
}

function Payments({ s, r }: { s: MatchState; r: HandResult }) {
  return (
    <div className="payments">
      {r.deltas.map((d, seat) => (
        <div key={seat} className={`pay ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
          <span className="cjk">{WIND_ZH[seatWind(s, seat)]}</span>
          <span className="name">{names(s)[seat]}</span>
          <span className="num">{signed(d)}</span>
        </div>
      ))}
    </div>
  );
}

export function HandResultCard({ s, onHide }: { s: MatchState; onHide: () => void }) {
  const act = useGame((x) => x.act);
  const mySeat = useGame((x) => x.mySeat);
  const r = s.hand.result!;
  const n = names(s);
  const final = isFinalHand(s);
  const waiting = s.hand.ready.map((ok, i) => (!ok && !s.config.seats[i]!.ai ? n[i] : null)).filter(Boolean);
  const nextDealer = r.dealerStays ? s.dealer : (s.dealer + 1) % 4;
  return (
    <div className="overlay">
      <div className="card result" role="dialog" aria-label="Hand result">
        {r.wins.length === 0 ? (
          <div className="draw">
            <h3>
              <span className="cjk">流局</span> {r.end === 'abortive' ? 'Abortive draw' : 'Draw'}
            </h3>
            <p>{r.end === 'abortive' ? `The hand was called off: ${r.abort}.` : 'The wall ran out with no winner.'}</p>
            {r.tenpai && (
              <p className="muted">
                Ready (聴牌): {r.tenpai.map((t, i) => (t ? n[i] : null)).filter(Boolean).join(', ') || 'nobody'}
              </p>
            )}
          </div>
        ) : (
          r.wins.map((w) => <WinDetail key={w.seat} s={s} w={w} />)
        )}
        {r.notes.length > 0 && <p className="muted">{r.notes.join(' · ')}</p>}
        <Payments s={s} r={r} />
        <p className="dealer-note">
          {final ? 'That was the last hand of the match.' : r.dealerStays ? `${n[s.dealer]} keeps the deal (連莊).` : `The deal passes to ${n[nextDealer]}.`}
        </p>
        <div className="card-actions">
          <button type="button" className="btn ghost" onClick={onHide}>
            View table
          </button>
          {mySeat !== null && !s.hand.ready[mySeat] && (
            <button type="button" className="btn primary" autoFocus onClick={() => act({ type: 'ready', seat: mySeat })}>
              {final ? 'Final results' : 'Next hand'}
            </button>
          )}
          {mySeat !== null && s.hand.ready[mySeat] && waiting.length > 0 && <span className="muted">Waiting for {waiting.join(', ')}…</span>}
        </div>
      </div>
    </div>
  );
}

export function MatchOverCard({ s }: { s: MatchState }) {
  const mode = useGame((x) => x.mode);
  const startSolo = useGame((x) => x.startSolo);
  const setup = useGame((x) => x.soloSetup);
  const leaveSolo = useGame((x) => x.leave);
  const net = useNet();
  const isHost = net.lobby?.hostUuid === net.uuid;
  const order = [0, 1, 2, 3].sort((a, b) => s.scores[b]! - s.scores[a]!);
  const start = variantOf(s).startingScore(s.config.rules);
  return (
    <div className="overlay">
      <div className="card result final" role="dialog" aria-label="Match results">
        <h2>Match over</h2>
        <ol className="standings">
          {order.map((seat, i) => (
            <li key={seat} className={i === 0 ? 'first' : ''}>
              <span className="place">{i + 1}</span>
              <span className="name">{s.config.seats[seat]!.name}</span>
              <span className="num">{num(s.scores[seat]!)}</span>
              <span className={`num ${s.scores[seat]! >= start ? 'up' : 'down'}`}>{signed(s.scores[seat]! - start)}</span>
            </li>
          ))}
        </ol>
        <p className="muted">
          {plural(s.history.length, 'hand')} · {plural(s.history.filter((h) => h.wins.length === 0).length, 'draw')}
        </p>
        <div className="card-actions">
          {mode === 'solo' && (
            <>
              <button type="button" className="btn ghost" onClick={leaveSolo}>
                Main menu
              </button>
              <button type="button" className="btn primary" onClick={() => startSolo(setup)}>
                Play again
              </button>
            </>
          )}
          {mode === 'online' && isHost && (
            <>
              <button type="button" className="btn ghost" onClick={() => void net.backToLobby()}>
                Back to lobby
              </button>
              <button type="button" className="btn primary" onClick={() => void net.startMatch()}>
                Play again
              </button>
            </>
          )}
          {mode === 'online' && !isHost && <span className="muted">Waiting for the host to start another match…</span>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ side panel

function historyLine(s: MatchState, h: HandResult): string {
  const n = names(s);
  const unit = variantOf(s).unit.zh;
  if (h.wins.length === 0) return h.end === 'abortive' ? `流局 ${h.abort ?? ''}` : '流局 draw';
  return h.wins.map((w) => `${n[w.seat]} ${w.selfDraw ? variantOf(s).terms.tsumo : variantOf(s).terms.ron} ${w.score.value}${unit}`).join(', ');
}

function StakesTable({ s }: { s: MatchState }) {
  const v = s.config.variant;
  if (v === 'hk') {
    const r = s.config.rules as HkRules;
    const rows: number[] = [];
    for (let f = r.minFaan; f <= r.maxFaan; f++) rows.push(f);
    const half = r.payment === 'halfGun';
    return (
      <table className="payout">
        <thead>
          <tr>
            <th>番</th>
            <th>Discarder</th>
            {half && <th>Others</th>}
            <th>自摸 each</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const T = tablePoints(f, r);
            return (
              <tr key={f}>
                <td>{f}</td>
                <td className="num">{half ? T / 2 : T}</td>
                {half && <td className="num">{T / 4}</td>}
                <td className="num">{T / 2}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  if (v === 'taiwan') {
    const r = s.config.rules as TaiwanRules;
    return (
      <p className="small">
        Each payer gives 底 {r.base} + 台 {r.perTai} × tai. On a discard only the discarder pays; self-drawn, all three do. Payments with the dealer add 莊家 1 + 2 per 連莊.
      </p>
    );
  }
  if (v === 'riichi') {
    const r = s.config.rules as RiichiRules;
    const fus = [30, 40];
    return (
      <table className="payout">
        <thead>
          <tr>
            <th>翻</th>
            {fus.map((f) => (
              <th key={f}>{f} fu</th>
            ))}
            <th>Dealer</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 8, 11, 13].map((han) => (
            <tr key={han}>
              <td>{han}</td>
              {fus.map((f) => (
                <td key={f} className="num">
                  {num(payments(basePoints(han, f, 0, r).base, false, false).ron)}
                </td>
              ))}
              <td className="num">{num(payments(basePoints(han, 30, 0, r).base, true, false).ron)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <p className="small">Discarder pays double the hand's value, the others single; self-drawn, everyone pays double.</p>;
}

function AmericanCard({ s, seat }: { s: MatchState; seat: number | null }) {
  const near = seat === null ? [] : nearestHands(s, seat, 40);
  const by = new Map(near.map((n) => [n.form.hand.id, n.distance]));
  const hands = [...HOUSE_CARD.hands].sort((a, b) => (by.get(a.id) ?? 99) - (by.get(b.id) ?? 99));
  return (
    <section className="american-card">
      <h4>{HOUSE_CARD.name}</h4>
      <p className="muted small">
        Suits: <span className="tok s-a">a</span> <span className="tok s-b">b</span> <span className="tok s-c">c</span> are three different suits · F flower · 0 white dragon · D the suit's dragon · X exposed ok, C concealed
      </p>
      <ol className="card-list">
        {hands.map((h) => (
          <li key={h.id} className={by.get(h.id) === 0 ? 'done' : ''}>
            <CardLine text={h.text} />
            <span className="meta">
              {h.concealed ? 'C' : 'X'} {h.value}
              {by.has(h.id) && <em>{by.get(h.id)} away</em>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function SidePanel({ s }: { s: MatchState }) {
  const mode = useGame((x) => x.mode);
  const mySeat = useGame((x) => x.mySeat);
  const speed = useGame((x) => x.speed);
  const setSpeed = useGame((x) => x.setSpeed);
  const leaveSolo = useGame((x) => x.leave);
  const notice = useGame((x) => x.notice);
  const aiStatus = useGame((x) => x.aiStatus);
  const setNotice = useGame((x) => x.setNotice);
  const hints = useGame((x) => x.hints);
  const setHints = useGame((x) => x.setHints);
  const leaveRoom = useNet((x) => x.leaveRoom);
  const connected = useNet((x) => x.connected);
  const [open, setOpen] = useState(false);
  const v = variantOf(s);
  const turnSeat = s.hand.phase === 'act' ? s.hand.turn : null;
  const history = [...s.history].reverse();

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  return (
    <aside className="side-panel">
      {mode === 'online' && !connected && <div className="banner warn">Reconnecting…</div>}
      {aiStatus === 'loading' && <div className="banner">Loading the computer players…</div>}
      {aiStatus === 'failed' && <div className="banner warn">Couldn't load the computer players — retrying…</div>}
      {notice && <div className="banner">{notice}</div>}
      <section>
        <h4>
          {s.over ? (
            <>Match over · {plural(s.history.length, 'hand')}</>
          ) : (
            <>
              <span className="cjk">{v.zh}</span> · <span className="cjk">{WIND_ZH[s.prevailing]}</span> {WIND_EN[s.prevailing]} · hand {s.handNo}
            </>
          )}
        </h4>
        <div className="facts">
          <span>{liveLeft(s)} tiles left</span>
          {rulesSummary(s.config.variant, s.config.rules)
            .slice(0, 3)
            .map((b) => (
              <span key={b}>{b}</span>
            ))}
        </div>
        <ul className="scores">
          {[0, 1, 2, 3].map((seat) => (
            <li key={seat} className={turnSeat === seat ? 'turn' : ''}>
              <span className={`cjk wind ${seatWind(s, seat) === 0 ? 'dealer' : ''}`}>{WIND_ZH[seatWind(s, seat)]}</span>
              <span className="name">{s.config.seats[seat]!.name}</span>
              <span className="num">{num(s.scores[seat]!)}</span>
            </li>
          ))}
        </ul>
      </section>
      {v.features.american && <AmericanCard s={s} seat={mySeat} />}
      {history.length > 0 && (
        <section>
          <h4>Past hands</h4>
          <ol className="history" reversed>
            {history.slice(0, 12).map((h) => (
              <li key={h.handNo}>{historyLine(s, h)}</li>
            ))}
          </ol>
        </section>
      )}
      <section className="settings">
        <h4>Table</h4>
        <label className="row">
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} /> {v.features.american ? 'Show the closest card hands' : 'Show waits & discard hint'}
        </label>
        <label className="row">
          Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
            <option value="relaxed">Relaxed</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
        </label>
        <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Payouts</summary>
          <StakesTable s={s} />
        </details>
        <details>
          <summary>Keyboard</summary>
          <p className="muted small">← → choose a tile · Enter discard · W win · Space pass</p>
        </details>
      </section>
      {mode === 'online' && <Chat />}
      <button type="button" className="btn ghost leave" onClick={() => (mode === 'online' ? leaveRoom() : leaveSolo())}>
        {mode === 'online' ? 'Leave room' : 'Quit match'}
      </button>
    </aside>
  );
}

export function Chat() {
  const chat = useNet((x) => x.chat);
  const send = useNet((x) => x.sendChat);
  const uuid = useNet((x) => x.uuid);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A block body: scrollIntoView returns a Promise in current browsers, which an effect must not return.
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [chat.length]);
  return (
    <section className="chat">
      <h4>Chat</h4>
      <div className="lines">
        {chat.slice(-60).map((m) => (
          <div key={m.id} className={`line ${m.kind} ${m.byUuid === uuid ? 'me' : ''}`}>
            {m.kind === 'user' && <b>{m.name}: </b>}
            {m.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={300} aria-label="Chat message" />
      </form>
    </section>
  );
}

