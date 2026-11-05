// The mahjong table. The board is a square size-container; everything on it is
// sized in cqmin (1% of the board), so the layout scales as one piece and the
// zones can't collide at any window size.
//
// Each seat's side — its discard pond, its wall, its melds and its hand — is
// drawn once in "bottom" orientation and the whole layer is rotated to that
// seat's edge (0°, −90°, 180°, 90°), the way the table looks from your chair:
// the player across sees their tiles upright, so you see them upside down.
// Text (name badges, the compass center, buttons) is laid out in screen space.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { suggestDiscard, waitInfo } from '@/core/ai';
import {
  claimOptions,
  liveLeft,
  pendingSeats,
  seatWind,
  turnOptions,
  wallStacks,
  type Claim,
  type MatchState,
  type Meld,
} from '@/core/engine';
import { WIND_EN, WIND_ZH, kindOf, type Kind, type TileId } from '@/core/tiles';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { Tile, TileRow, tileLabel } from './Tile';
import { HandResultCard, MatchOverCard, SidePanel } from './TablePanels';

export function Table() {
  const match = useGame((s) => s.match);
  if (!match) return null;
  return <TableView s={match} />;
}

const relOf = (seat: number, view: number) => (seat - view + 4) % 4;

function TableView({ s }: { s: MatchState }) {
  const mySeat = useGame((x) => x.mySeat);
  const view = mySeat ?? 0;
  const [showResult, setShowResult] = useState(true);
  const handKey = `${s.handNo}`;
  useEffect(() => setShowResult(true), [handKey, s.hand.phase]);
  const ended = s.hand.phase === 'end';

  return (
    <div className="game">
      <div className="board-wrap">
        <div className="board" data-phase={s.hand.phase}>
          <div className="felt" />
          {[0, 1, 2, 3].map((seat) => (
            <Side key={seat} s={s} seat={seat} rel={relOf(seat, view)} mine={seat === mySeat} reveal={ended} />
          ))}
          <Compass s={s} view={view} />
          {[0, 1, 2, 3].map((seat) => (
            <Badge key={seat} s={s} seat={seat} rel={relOf(seat, view)} />
          ))}
          {mySeat !== null && !ended && <ActionBar s={s} seat={mySeat} />}
          <Callouts s={s} view={view} />
          {ended && !s.over && showResult && <HandResultCard s={s} onHide={() => setShowResult(false)} />}
          {ended && !s.over && !showResult && (
            <button type="button" className="btn show-result" onClick={() => setShowResult(true)}>
              Show hand result
            </button>
          )}
          {s.over && <MatchOverCard s={s} />}
        </div>
      </div>
      <SidePanel s={s} />
    </div>
  );
}

// ------------------------------------------------------------ a seat's side

function Side({ s, seat, rel, mine, reveal }: { s: MatchState; seat: number; rel: number; mine: boolean; reveal: boolean }) {
  const p = s.hand.players[seat]!;
  const last = s.hand.lastDiscard;
  const claimTile = s.hand.phase === 'claim' && s.hand.claim?.kind === 'discard' ? s.hand.claim.tile : null;
  return (
    <div className={`side r${rel}`}>
      <div className="pond">
        {p.discards.map((t) => (
          <Tile key={t} kind={kindOf(t)} className={`${last?.tile === t ? 'last' : ''} ${claimTile === t ? 'claimable' : ''}`} />
        ))}
      </div>
      <div className="wall-row">
        {wallStacks(s, seat).map((n, i) => (
          <span key={i} className={`stack s${n}`}>
            {n > 0 && <Tile kind={null} />}
          </span>
        ))}
      </div>
      <div className="meld-row">
        {p.bonus.length > 0 && (
          <span className="bonus">
            {p.bonus.map((t) => (
              <Tile key={t} kind={kindOf(t)} />
            ))}
          </span>
        )}
        {p.melds.map((m) => (
          <MeldView key={m.order} m={m} />
        ))}
      </div>
      {mine && rel === 0 ? <MyHand s={s} seat={seat} /> : <OtherHand s={s} seat={seat} reveal={reveal} />}
    </div>
  );
}

function MeldView({ m }: { m: Meld }) {
  return (
    <span className={`meld ${m.type}`}>
      {m.tiles.map((t, i) => {
        // A concealed kong shows its two middle tiles; the ends stay face down.
        const down = m.concealed && (i === 0 || i === 3);
        return <Tile key={t} kind={down ? null : kindOf(t)} className={m.claimed === t ? 'claimed' : ''} />;
      })}
    </span>
  );
}

function OtherHand({ s, seat, reveal }: { s: MatchState; seat: number; reveal: boolean }) {
  const p = s.hand.players[seat]!;
  const drawing = s.hand.phase === 'act' && s.hand.turn === seat && s.hand.drawn !== null;
  const tiles = drawing ? [...p.hand.filter((t) => t !== s.hand.drawn), s.hand.drawn!] : p.hand;
  return (
    <div className={`hand-row other ${reveal ? 'open' : ''}`}>
      {tiles.map((t, i) => (
        <Tile key={t} kind={reveal ? kindOf(t) : null} className={`${reveal ? '' : 'stand'} ${drawing && i === tiles.length - 1 ? 'drawn' : ''}`} />
      ))}
    </div>
  );
}

function MyHand({ s, seat }: { s: MatchState; seat: number }) {
  const act = useGame((x) => x.act);
  const hints = useHints();
  const p = s.hand.players[seat]!;
  const h = s.hand;
  const myTurn = h.phase === 'act' && h.turn === seat;
  const [selected, setSelected] = useState<TileId | null>(null);
  const touch = useRef(false);
  useEffect(() => setSelected(null), [s.seq]);
  const drawn = myTurn ? h.drawn : null;
  const tiles = drawn !== null ? [...p.hand.filter((t) => t !== drawn), drawn] : p.hand;
  const hint = myTurn && hints ? suggestDiscard(s, seat) : null;
  const hintTile = hint === null ? null : tiles.find((t) => kindOf(t) === hint);

  const discard = (t: TileId) => {
    if (!myTurn) return;
    // Touch: the first tap lifts the tile, the second throws it.
    if (touch.current && selected !== t) {
      setSelected(t);
      return;
    }
    act({ type: 'discard', seat, tile: t });
  };

  // Keyboard: ← → pick a tile, Enter / ↑ discards it.
  useEffect(() => {
    if (!myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const i = selected === null ? tiles.length - 1 : tiles.indexOf(selected);
      if (e.key === 'ArrowLeft') setSelected(tiles[Math.max(0, i - 1)] ?? null);
      else if (e.key === 'ArrowRight') setSelected(tiles[Math.min(tiles.length - 1, i + 1)] ?? null);
      else if ((e.key === 'Enter' || e.key === 'ArrowUp') && selected !== null) act({ type: 'discard', seat, tile: selected });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`hand-row mine ${myTurn ? 'turn' : ''}`}>
      {tiles.map((t, i) => (
        <Tile
          key={t}
          kind={kindOf(t)}
          interactive
          disabled={!myTurn}
          className={`${drawn === t && i === tiles.length - 1 ? 'drawn' : ''} ${selected === t ? 'selected' : ''} ${hintTile === t ? 'hint' : ''}`}
          onPointerDown={(e: ReactPointerEvent<HTMLElement>) => (touch.current = e.pointerType === 'touch')}
          onClick={() => discard(t)}
          title={myTurn ? `Discard ${tileLabel(kindOf(t))}` : tileLabel(kindOf(t))}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------ center

function Compass({ s, view }: { s: MatchState; view: number }) {
  const waiting = new Set(pendingSeats(s));
  const active = s.hand.phase === 'act' ? s.hand.turn : null;
  return (
    <div className="compass" aria-label="Round information">
      {[0, 1, 2, 3].map((seat) => {
        const rel = relOf(seat, view);
        const w = seatWind(s, seat);
        return (
          <div key={seat} className={`edge e${rel} ${active === seat ? 'active' : ''} ${s.hand.phase === 'claim' && waiting.has(seat) ? 'deciding' : ''}`}>
            <span className={`wind ${w === 0 ? 'dealer' : ''}`}>{WIND_ZH[w]}</span>
          </div>
        );
      })}
      <div className="core">
        <div className="round cjk">
          {WIND_ZH[s.prevailing]}
          <small>圈</small>
        </div>
        <div className="left">
          <b>{liveLeft(s)}</b> tiles
        </div>
        <div className="hand-no">
          Hand {s.handNo}
          {s.streak > 0 ? ` · 連${s.streak}` : ''}
        </div>
      </div>
    </div>
  );
}

function Badge({ s, seat, rel }: { s: MatchState; seat: number; rel: number }) {
  const cfg = s.config.seats[seat]!;
  const people = useNet((x) => x.people);
  const mode = useGame((x) => x.mode);
  const w = seatWind(s, seat);
  const thinking = pendingSeats(s).includes(seat) && s.hand.phase !== 'end';
  const offline = mode === 'online' && !cfg.ai && !!cfg.uuid && !people.some((p) => p.uuid === cfg.uuid);
  const last = s.hand.result?.deltas[seat] ?? null;
  return (
    <div className={`badge b${rel} ${thinking ? 'thinking' : ''}`}>
      <span className={`wind cjk ${w === 0 ? 'dealer' : ''}`} title={`${WIND_EN[w]} seat${w === 0 ? ' (dealer)' : ''}`}>
        {WIND_ZH[w]}
      </span>
      <span className="who">
        <span className="name">{cfg.name}</span>
        <span className="meta">
          {w === 0 && <span className="tag dealer">莊 Dealer</span>}
          {cfg.ai && <span className="tag">AI · {cfg.level}</span>}
          {offline && <span className="tag warn">offline</span>}
        </span>
        <span className="score">
          {s.scores[seat]}
          {last !== null && last !== 0 && <em className={last > 0 ? 'up' : 'down'}>{last > 0 ? `+${last}` : last}</em>}
        </span>
      </span>
    </div>
  );
}

// ------------------------------------------------------------ actions

const useHints = () => useGame((x) => x.hints);

function claimLabel(c: Claim, tile: Kind): { zh: string; en: string; kinds: Kind[] } {
  switch (c.type) {
    case 'win':
      return { zh: '食糊', en: 'Win', kinds: [tile] };
    case 'pong':
      return { zh: '碰', en: 'Pong', kinds: [tile, tile, tile] };
    case 'kong':
      return { zh: '槓', en: 'Kong', kinds: [tile, tile, tile, tile] };
    case 'chi':
      return { zh: '上', en: 'Chow', kinds: [c.low, c.low + 1, c.low + 2] };
    default:
      return { zh: '過', en: 'Pass', kinds: [] };
  }
}

function ActionBar({ s, seat }: { s: MatchState; seat: number }) {
  const act = useGame((x) => x.act);
  const hints = useHints();
  const h = s.hand;
  const opts = turnOptions(s, seat);
  const claims = claimOptions(s, seat);
  const names = s.config.seats.map((c) => c.name);

  // Keyboard: Space passes, W wins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (claims.length > 0 && (k === ' ' || k === 'p')) act({ type: 'claim', seat, claim: { type: 'pass' } });
      else if (k === 'w' && claims.some((c) => c.type === 'win')) act({ type: 'claim', seat, claim: { type: 'win' } });
      else if (k === 'w' && opts.win) act({ type: 'win', seat });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (claims.length > 0 && h.claim) {
    const tile = kindOf(h.claim.tile);
    const robbing = h.claim.kind === 'robKong';
    return (
      <div className="action-bar claim">
        <span className="prompt">
          {names[h.claim.from]} {robbing ? 'adds a kong of' : 'discards'} <Tile kind={tile} className="inline" />
        </span>
        <span className="buttons">
          {claims.map((c, i) => {
            const l = claimLabel(c, tile);
            const faan = c.type === 'win' ? waitInfo(s, seat).find((w) => w.kind === tile)?.ron : null;
            return (
              <button key={i} type="button" className={`btn claim-btn ${c.type}`} onClick={() => act({ type: 'claim', seat, claim: c })}>
                <span className="cjk">{robbing && c.type === 'win' ? '搶槓' : l.zh}</span>
                <span className="en">
                  {l.en}
                  {faan ? ` · ${faan} faan` : ''}
                </span>
                {c.type === 'chi' && <TileRow kinds={l.kinds} className="mini" />}
              </button>
            );
          })}
          <button type="button" className="btn claim-btn pass" onClick={() => act({ type: 'claim', seat, claim: { type: 'pass' } })}>
            <span className="cjk">過</span>
            <span className="en">Pass</span>
          </button>
        </span>
      </div>
    );
  }

  if (h.phase === 'act' && h.turn === seat) {
    return (
      <div className="action-bar turn">
        <span className="prompt">
          <b>Your turn.</b> {h.drawKind === 'claim' ? 'Discard a tile.' : 'Click a tile to discard it.'}
        </span>
        <span className="buttons">
          {opts.win && (
            <button type="button" className="btn claim-btn win" onClick={() => act({ type: 'win', seat })}>
              <span className="cjk">自摸</span>
              <span className="en">Win · {opts.win.value} faan</span>
            </button>
          )}
          {opts.kongs.map((k) => (
            <button key={k} type="button" className="btn claim-btn kong" onClick={() => act({ type: 'kong', seat, kind: k })}>
              <span className="cjk">槓</span>
              <span className="en">Kong</span>
              <TileRow kinds={[k]} className="mini" />
            </button>
          ))}
        </span>
      </div>
    );
  }

  const waitingOn = pendingSeats(s).filter((x) => x !== seat);
  const waits = hints ? waitInfo(s, seat) : [];
  return (
    <div className="action-bar idle">
      <span className="prompt">
        {h.phase === 'claim' ? 'Waiting for claims…' : waitingOn.length > 0 ? `${names[waitingOn[0]!]} is thinking…` : ''}
      </span>
      {waits.length > 0 && (
        <span className="waits" title="Tiles that complete your hand (green: enough faan to win on a discard)">
          <span className="label">Waiting on</span>
          {waits.map((w) => (
            <span key={w.kind} className={`wait ${w.ron !== null ? 'ok' : w.tsumo !== null ? 'tsumo' : 'dead'}`}>
              <Tile kind={w.kind} className="inline" />
              <small>{w.left} left</small>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------ callouts

const CALL_TEXT: Record<string, string> = { chi: '上', pong: '碰', kong: '槓', win: '食糊', tsumo: '自摸', bonus: '花', exhausted: '流局' };

function Callouts({ s, view }: { s: MatchState; view: number }) {
  const [call, setCall] = useState<{ key: string; rel: number; text: string } | null>(null);
  const seen = useRef<string>('');
  const log = s.hand.log;
  useEffect(() => {
    const key = `${s.handNo}:${log.length}`;
    if (seen.current === key) return;
    const first = seen.current === '';
    seen.current = key;
    const e = log[log.length - 1];
    if (first || !e || e.t === 'discard') return;
    if (e.t === 'bonus' && s.hand.phase !== 'act') return;
    let text = CALL_TEXT[e.t] ?? '';
    let seat = 'seat' in e ? e.seat : view;
    if (e.t === 'win' && e.from === null) text = CALL_TEXT.tsumo!;
    if (e.t === 'exhausted') seat = view;
    setCall({ key, rel: e.t === 'exhausted' ? -1 : relOf(seat, view), text });
    const t = setTimeout(() => setCall(null), 1400);
    return () => clearTimeout(t);
  }, [log, s.handNo, s.hand.phase, view]);
  if (!call || !call.text) return null;
  return (
    <div key={call.key} className={`callout c${call.rel}`} aria-live="polite">
      <span className="cjk">{call.text}</span>
    </div>
  );
}
