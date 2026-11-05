// Everything around the board: the hand-result card, the match-over card and
// the side panel (round info, scores, history, settings, chat).

import { useEffect, useRef, useState } from 'react';
import { isFinalHand, liveLeft, seatWind, type HandResult, type MatchState, type WinRecord } from '@/core/engine';
import { WIND_EN, WIND_ZH, kindOf } from '@/core/tiles';
import { tablePoints } from '@/core/variants/hk';
import { useGame, type Speed } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { Tile } from './Tile';

const names = (s: MatchState) => s.config.seats.map((c) => c.name);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function winHow(s: MatchState, w: WinRecord): string {
  const n = names(s);
  if (w.flowerWin === 'eight') return '八仙過海 · all eight flowers';
  if (w.flowerWin === 'sevenRobOne') return `七搶一 · robs ${n[w.from!]}'s eighth flower`;
  if (w.robbingKong) return `搶槓 · robs ${n[w.from!]}'s kong`;
  if (w.selfDraw) return '自摸 · self-drawn';
  return `食糊 · off ${n[w.from!]}'s discard`;
}

/** Show repeated entries (two seat flowers, three dragon pongs…) as one row. */
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
  return (
    <div className="win">
      <div className="win-head">
        <span className="cjk wind">{WIND_ZH[seatWind(s, w.seat)]}</span>
        <div>
          <h3>{names(s)[w.seat]} wins</h3>
          <div className="how">{winHow(s, w)}</div>
        </div>
      </div>
      <div className="win-hand">
        {w.hand.map((t) => (
          <Tile key={t} kind={kindOf(t)} className={t === w.tile ? 'winning' : ''} />
        ))}
        {w.melds.map((m) => (
          <span key={m.order} className="meld">
            {m.tiles.map((t, i) => (
              <Tile key={t} kind={m.concealed && (i === 0 || i === 3) ? null : kindOf(t)} />
            ))}
          </span>
        ))}
        {w.bonus.length > 0 && (
          <span className="bonus">
            {w.bonus.map((t) => (
              <Tile key={t} kind={kindOf(t)} />
            ))}
          </span>
        )}
      </div>
      <table className="faan">
        <tbody>
          {mergeItems(w.score.items).map((i) => (
            <tr key={i.id}>
              <td className="cjk">{i.zh}</td>
              <td>{i.en}</td>
              <td className="num">{i.value}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              {w.score.value} faan{w.score.raw > w.score.value ? ` (capped from ${w.score.raw})` : ''}
              {w.score.limit ? ' · 爆棚 limit' : ''}
            </td>
            <td className="num">{st.points} pts</td>
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
          <span className="num total">{s.scores[seat]}</span>
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
              <span className="cjk">流局</span> Draw
            </h3>
            <p>The wall ran out with no winner.</p>
          </div>
        ) : (
          r.wins.map((w) => <WinDetail key={w.seat} s={s} w={w} />)
        )}
        <Payments s={s} r={r} />
        <p className="dealer-note">
          {final
            ? 'That was the last hand of the match.'
            : r.dealerStays
              ? `${n[s.dealer]} keeps the deal (連莊).`
              : `The deal passes to ${n[nextDealer]}.`}
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
  const start = s.config.rules.startingScore;
  return (
    <div className="overlay">
      <div className="card result final" role="dialog" aria-label="Match results">
        <h2>Match over</h2>
        <ol className="standings">
          {order.map((seat, i) => (
            <li key={seat} className={i === 0 ? 'first' : ''}>
              <span className="place">{i + 1}</span>
              <span className="name">{s.config.seats[seat]!.name}</span>
              <span className="num">{s.scores[seat]}</span>
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
  if (h.wins.length === 0) return '流局 draw';
  return h.wins.map((w) => `${n[w.seat]} ${w.selfDraw ? '自摸' : '食糊'} ${w.score.value}番`).join(', ');
}

export function SidePanel({ s }: { s: MatchState }) {
  const mode = useGame((x) => x.mode);
  const speed = useGame((x) => x.speed);
  const setSpeed = useGame((x) => x.setSpeed);
  const leaveSolo = useGame((x) => x.leave);
  const notice = useGame((x) => x.notice);
  const setNotice = useGame((x) => x.setNotice);
  const leaveRoom = useNet((x) => x.leaveRoom);
  const connected = useNet((x) => x.connected);
  const hints = useGame((x) => x.hints);
  const setHints = useGame((x) => x.setHints);
  const turnSeat = s.hand.phase === 'act' ? s.hand.turn : null;
  const r = s.config.rules;
  const history = [...s.history].reverse();

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  return (
    <aside className="side-panel">
      {mode === 'online' && !connected && <div className="banner warn">Reconnecting…</div>}
      {notice && <div className="banner">{notice}</div>}
      <section>
        <h4>
          {s.over ? (
            <>Match over · {plural(s.history.length, 'hand')}</>
          ) : (
            <>
              <span className="cjk">{WIND_ZH[s.prevailing]}圈</span> {WIND_EN[s.prevailing]} round · hand {s.handNo}
            </>
          )}
        </h4>
        <div className="facts">
          <span>{liveLeft(s)} tiles left</span>
          <span>
            {r.minFaan}–{r.maxFaan} faan
          </span>
          <span>{r.payment === 'halfGun' ? '半銃' : '全銃'}</span>
        </div>
        <ul className="scores">
          {[0, 1, 2, 3].map((seat) => (
            <li key={seat} className={turnSeat === seat ? 'turn' : ''}>
              <span className={`cjk wind ${seatWind(s, seat) === 0 ? 'dealer' : ''}`}>{WIND_ZH[seatWind(s, seat)]}</span>
              <span className="name">{s.config.seats[seat]!.name}</span>
              <span className="num">{s.scores[seat]}</span>
            </li>
          ))}
        </ul>
      </section>
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
          <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} /> Show waits &amp; discard hint
        </label>
        <label className="row">
          Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
            <option value="relaxed">Relaxed</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
        </label>
        <details>
          <summary>Payout table</summary>
          <PayoutTable s={s} />
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

function PayoutTable({ s }: { s: MatchState }) {
  const r = s.config.rules;
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
