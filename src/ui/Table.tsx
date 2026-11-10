// The mahjong table. The board is a square size-container; everything on it is
// sized in cqmin (1% of the board), so the layout scales as one piece and the
// zones can't collide at any window size.
//
// Each seat's side — its discard pond, its wall, its melds and its hand — is
// drawn once in "bottom" orientation and the whole layer is rotated to that
// seat's edge (0°, −90°, 180°, 90°), the way the table looks from your chair:
// the player across sees their tiles upright, so you see them upside down.
// Text (name badges, the compass center, buttons) is laid out in screen space.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { nearestHands, suggestDiscard, waitInfo } from '@/core/ai';
import {
  charlestonAsk,
  claimOptions,
  isFuriten,
  levelLabel,
  liveLeft,
  pendingSeats,
  seatWind,
  turnOptions,
  variantOf,
  wallStacks,
  type Claim,
  type MatchState,
  type Meld,
} from '@/core/engine';
import { JOKER, WIND_EN, WIND_ZH, kindOf, type Kind, type TileId } from '@/core/tiles';
import { useGame } from '@/store/gameStore';
import { useNet } from '@/store/netStore';
import { useTileFlip } from './flip';
import { CardLine, HandResultCard, MatchOverCard, SidePanel } from './TablePanels';
import { Tile, TileRow, tileLabel, useFace } from './Tile';

export function Table() {
  const match = useGame((s) => s.match);
  if (!match) return null;
  return <TableView s={match} />;
}

const relOf = (seat: number, view: number) => (seat - view + 4) % 4;
const ROT = [0, -90, 180, 90];


/** What the player is picking with their tiles right now. */
type Mode = { kind: 'normal' } | { kind: 'riichi' } | { kind: 'charleston' };

function TableView({ s }: { s: MatchState }) {
  const mySeat = useGame((x) => x.mySeat);
  const view = mySeat ?? 0;
  const [showResult, setShowResult] = useState(true);
  const [mode, setMode] = useState<Mode>({ kind: 'normal' });
  const [picked, setPicked] = useState<TileId[]>([]);
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => setShowResult(true), [s.handNo, s.hand.phase]);
  useEffect(() => {
    setPicked([]);
    setMode(mySeat !== null && charlestonAsk(s, mySeat)?.kind === 'pass' ? { kind: 'charleston' } : { kind: 'normal' });
  }, [s.seq, s, mySeat]);
  useTileFlip(board, `${s.config.seed}:${s.handNo}`);
  const ended = s.hand.phase === 'end';
  const variant = variantOf(s);
  const style = {
    '--hand-n': variant.handSize + 1,
    '--wall-n': Math.ceil(s.hand.wall.length / 8),
  } as CSSProperties;

  return (
    <div className="game">
      <div className="board-wrap">
        <div className={`board v-${variant.id}`} data-phase={s.hand.phase} style={style} ref={board}>
          <div className="felt" />
          {[0, 1, 2, 3].map((seat) => (
            <Side key={seat} s={s} seat={seat} rel={relOf(seat, view)} mine={seat === mySeat} reveal={ended} mode={mode} picked={picked} setPicked={setPicked} />
          ))}
          <Compass s={s} view={view} />
          {[0, 1, 2, 3].map((seat) => (
            <Badge key={seat} s={s} seat={seat} rel={relOf(seat, view)} />
          ))}
          {mySeat !== null && !ended && <ActionBar s={s} seat={mySeat} mode={mode} setMode={setMode} picked={picked} />}
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

interface SideProps {
  s: MatchState;
  seat: number;
  rel: number;
  mine: boolean;
  reveal: boolean;
  mode: Mode;
  picked: TileId[];
  setPicked: (t: TileId[]) => void;
}

function Side({ s, seat, rel, mine, reveal, mode, picked, setPicked }: SideProps) {
  const p = s.hand.players[seat]!;
  const face = useFace(s);
  const last = s.hand.lastDiscard;
  const claimTile = s.hand.phase === 'claim' && s.hand.claim?.kind === 'discard' ? s.hand.claim.tile : null;
  const riichiTile = s.hand.riichi[seat]?.tile;
  const dense = p.discards.length > 28 ? 'dense2' : p.discards.length > 24 ? 'dense' : '';
  return (
    <div className={`side r${rel}`} data-rot={ROT[rel]}>
      <div className={`pond ${dense}`}>
        {p.discards.map((t) => (
          <Tile key={t} {...face(t)} sideways={t === riichiTile} className={`${last?.tile === t ? 'last' : ''} ${claimTile === t ? 'claimable' : ''}`} />
        ))}
      </div>
      <div className="wall-row">
        {wallStacks(s, seat).map((st, i) => {
          const top = st.ids[st.ids.length - 1];
          const up = top !== undefined && st.up.includes(top);
          return (
            <span key={i} className={`stack s${st.ids.length} ${up ? 'up' : ''}`}>
              {top !== undefined && (up ? <Tile {...face(top)} /> : <Tile kind={null} tid={top} />)}
            </span>
          );
        })}
      </div>
      <div className="meld-row">
        {p.bonus.length > 0 && (
          <span className="bonus">
            {p.bonus.map((t) => (
              <Tile key={t} {...face(t)} />
            ))}
          </span>
        )}
        {p.melds.map((m) => (
          <MeldView key={m.order} m={m} face={face} />
        ))}
      </div>
      {mine && rel === 0 ? <MyHand s={s} seat={seat} mode={mode} picked={picked} setPicked={setPicked} /> : <OtherHand s={s} seat={seat} reveal={reveal} />}
    </div>
  );
}

function MeldView({ m, face }: { m: Meld; face: (t: TileId) => { kind: Kind; red: boolean; tid: TileId } }) {
  return (
    <span className={`meld ${m.type}`}>
      {m.tiles.map((t, i) => {
        // A concealed kong shows its two middle tiles; the ends stay face down.
        const down = m.concealed && (i === 0 || i === 3);
        return down ? <Tile key={t} kind={null} tid={t} /> : <Tile key={t} {...face(t)} className={m.claimed === t ? 'claimed' : ''} />;
      })}
    </span>
  );
}

function OtherHand({ s, seat, reveal }: { s: MatchState; seat: number; reveal: boolean }) {
  const p = s.hand.players[seat]!;
  const face = useFace(s);
  const holding = s.hand.phase === 'act' && s.hand.turn === seat;
  const drawing = holding && s.hand.drawn !== null;
  const tiles = drawing ? [...p.hand.filter((t) => t !== s.hand.drawn), s.hand.drawn!] : p.hand;
  return (
    <div className={`hand-row other ${reveal ? 'open' : ''} ${holding && !drawing && !reveal ? 'extra' : ''}`}>
      {tiles.map((t, i) =>
        reveal ? (
          <Tile key={t} {...face(t)} />
        ) : (
          <Tile key={t} kind={null} tid={t} className={`stand ${drawing && i === tiles.length - 1 ? 'drawn' : ''}`} />
        ),
      )}
    </div>
  );
}

function MyHand({ s, seat, mode, picked, setPicked }: { s: MatchState; seat: number; mode: Mode; picked: TileId[]; setPicked: (t: TileId[]) => void }) {
  const act = useGame((x) => x.act);
  const hints = useGame((x) => x.hints);
  useGame((x) => x.policiesVersion); // the suggested discard comes from a network that loads in the background
  const face = useFace(s);
  const p = s.hand.players[seat]!;
  const h = s.hand;
  const opts = turnOptions(s, seat);
  const ask = charlestonAsk(s, seat);
  const myTurn = opts.canDiscard;
  const [selected, setSelected] = useState<TileId | null>(null);
  const touch = useRef(false);
  useEffect(() => setSelected(null), [s.seq]);
  const drawn = myTurn ? h.drawn : null;
  const tiles = drawn !== null ? [...p.hand.filter((t) => t !== drawn), drawn] : p.hand;
  // Holding the tile to discard, but none set apart (after a call, the dealer's first turn): see .hand-row.extra.
  const extra = h.phase === 'act' && h.turn === seat && drawn === null;
  const hint = myTurn && hints && mode.kind === 'normal' ? suggestDiscard(s, seat) : null;
  const hintTile = hint === null ? null : tiles.find((t) => kindOf(t) === hint && (!opts.allowed || opts.allowed.includes(t)));

  const canPick = (t: TileId) => {
    if (mode.kind === 'charleston') return ask?.kind === 'pass' && kindOf(t) !== JOKER;
    if (!myTurn) return false;
    if (mode.kind === 'riichi') return opts.riichi.includes(t);
    return !opts.allowed || opts.allowed.includes(t);
  };

  const click = (t: TileId) => {
    if (!canPick(t)) return;
    if (mode.kind === 'charleston') {
      const max = ask?.kind === 'pass' ? ask.max : 0;
      setPicked(picked.includes(t) ? picked.filter((x) => x !== t) : picked.length < max ? [...picked, t] : picked);
      return;
    }
    // Touch: the first tap lifts the tile, the second throws it.
    if (touch.current && selected !== t) {
      setSelected(t);
      return;
    }
    act({ type: 'discard', seat, tile: t, ...(mode.kind === 'riichi' ? { riichi: true } : {}) });
  };

  // Keyboard: ← → pick a tile, Enter / ↑ discards it.
  useEffect(() => {
    if (!myTurn || mode.kind === 'charleston') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const i = selected === null ? tiles.length - 1 : tiles.indexOf(selected);
      if (e.key === 'ArrowLeft') setSelected(tiles[Math.max(0, i - 1)] ?? null);
      else if (e.key === 'ArrowRight') setSelected(tiles[Math.min(tiles.length - 1, i + 1)] ?? null);
      else if ((e.key === 'Enter' || e.key === 'ArrowUp') && selected !== null) click(selected);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`hand-row mine ${myTurn || mode.kind === 'charleston' ? 'turn' : ''} ${mode.kind} ${extra ? 'extra' : ''}`}>
      {tiles.map((t, i) => {
        const ok = canPick(t);
        return (
          <Tile
            key={t}
            {...face(t)}
            interactive
            disabled={!ok}
            className={`${drawn === t && i === tiles.length - 1 ? 'drawn' : ''} ${selected === t || picked.includes(t) ? 'selected' : ''} ${hintTile === t ? 'hint' : ''} ${mode.kind === 'riichi' && ok ? 'riichi-ok' : ''} ${myTurn && !ok && mode.kind === 'normal' ? 'locked' : ''}`}
            onPointerDown={(e: ReactPointerEvent<HTMLElement>) => (touch.current = e.pointerType === 'touch')}
            onClick={() => click(t)}
            title={mode.kind === 'charleston' ? `Pass ${tileLabel(kindOf(t))}` : ok ? `Discard ${tileLabel(kindOf(t))}` : tileLabel(kindOf(t))}
          />
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ center

function Compass({ s, view }: { s: MatchState; view: number }) {
  const waiting = new Set(pendingSeats(s));
  const active = s.hand.phase === 'act' ? s.hand.turn : null;
  const riichi = variantOf(s).features.riichi;
  return (
    <div className="compass" aria-label="Round information">
      {[0, 1, 2, 3].map((seat) => {
        const rel = relOf(seat, view);
        const w = seatWind(s, seat);
        return (
          <div key={seat} className={`edge e${rel} ${active === seat ? 'active' : ''} ${s.hand.phase !== 'act' && waiting.has(seat) ? 'deciding' : ''}`}>
            <span className={`wind ${w === 0 ? 'dealer' : ''}`}>{WIND_ZH[w]}</span>
            {s.hand.riichi[seat]?.paid && <span className="stick" title="Riichi stick" />}
          </div>
        );
      })}
      <div className="core">
        <div className="round cjk">
          {WIND_ZH[s.prevailing]}
          <small>{riichi ? `${seatOrdinal(s)}局` : '圈'}</small>
        </div>
        <div className="left">
          <b>{liveLeft(s)}</b> tiles
        </div>
        <div className="hand-no">
          {riichi ? `${s.honba}本場 · 供託${s.sticks}` : `Hand ${s.handNo}${s.streak > 0 ? ` · 連${s.streak}` : ''}`}
        </div>
      </div>
    </div>
  );
}

/** Riichi round naming: East 1, East 2… by how many times the deal has passed this round. */
function seatOrdinal(s: MatchState): string {
  return String((s.passes % 4) + 1);
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
          {s.hand.riichi[seat] && <span className="tag riichi">リーチ</span>}
          {cfg.ai && <span className="tag">AI · {cfg.level ? levelLabel(cfg.level) : ''}</span>}
          {offline && <span className="tag warn">offline</span>}
        </span>
        <span className="score">
          {s.scores[seat]!.toLocaleString('en-US')}
          {last !== null && last !== 0 && <em className={last > 0 ? 'up' : 'down'}>{last > 0 ? `+${last.toLocaleString('en-US')}` : last.toLocaleString('en-US')}</em>}
        </span>
      </span>
    </div>
  );
}

// ------------------------------------------------------------ actions

const SET_NAMES = ['', '', 'Pair', 'Pung', 'Kong', 'Quint', 'Sextet'];

function claimLabel(s: MatchState, c: Claim, tile: Kind): { zh: string; en: string; kinds: Kind[] } {
  const t = variantOf(s).terms;
  switch (c.type) {
    case 'win':
      return { zh: t.ron, en: s.config.variant === 'riichi' ? 'Ron' : s.config.variant === 'american' ? 'Mah Jongg!' : 'Win', kinds: [tile] };
    case 'pong':
      return { zh: t.pong, en: 'Pong', kinds: [tile, tile, tile] };
    case 'kong':
      return { zh: t.kong, en: 'Kong', kinds: [tile, tile, tile, tile] };
    case 'chi':
      return { zh: t.chi, en: 'Chow', kinds: [c.low, c.low + 1, c.low + 2] };
    case 'expose':
      return { zh: SET_NAMES[c.size]!, en: c.jokers ? `${c.jokers} joker${c.jokers > 1 ? 's' : ''}` : 'call', kinds: [...new Array<Kind>(c.size - c.jokers).fill(tile), ...new Array<Kind>(c.jokers).fill(JOKER)] };
    default:
      return { zh: t.pass, en: 'Pass', kinds: [] };
  }
}

const AUTO_PASS_MS = 6000;

function ActionBar({ s, seat, mode, setMode, picked }: { s: MatchState; seat: number; mode: Mode; setMode: (m: Mode) => void; picked: TileId[] }) {
  const act = useGame((x) => x.act);
  const hints = useGame((x) => x.hints);
  const h = s.hand;
  const v = variantOf(s);
  const terms = v.terms;
  const opts = turnOptions(s, seat);
  const claims = claimOptions(s, seat);
  const ask = charlestonAsk(s, seat);
  const names = s.config.seats.map((c) => c.name);
  const callsOnly = v.features.american && claims.length > 0 && !claims.some((c) => c.type === 'win');
  const [left, setLeft] = useState(AUTO_PASS_MS);

  // American: nearly every discard can be called for some exposure, so an
  // exposure-only call window passes by itself after a few seconds.
  useEffect(() => {
    if (!callsOnly) return;
    const start = Date.now();
    setLeft(AUTO_PASS_MS);
    const t = setInterval(() => {
      const remaining = AUTO_PASS_MS - (Date.now() - start);
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(t);
        act({ type: 'claim', seat, claim: { type: 'pass' } });
      }
    }, 200);
    return () => clearInterval(t);
  }, [callsOnly, s.seq, seat, act]);

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

  if (ask) {
    if (ask.kind === 'vote') {
      return (
        <div className="action-bar charleston">
          <span className="prompt">
            <b>Second Charleston?</b> Everyone has to agree.
          </span>
          <span className="buttons">
            <button type="button" className="btn claim-btn chi" onClick={() => act({ type: 'vote', seat, yes: true })}>
              <span className="cjk">Yes</span>
              <span className="en">play it</span>
            </button>
            <button type="button" className="btn claim-btn pass" onClick={() => act({ type: 'vote', seat, yes: false })}>
              <span className="cjk">No</span>
              <span className="en">stop</span>
            </button>
          </span>
        </div>
      );
    }
    const dir = ['', 'right', 'across', 'left'][(ask.to - seat + 4) % 4];
    const courtesy = ask.min === 0;
    return (
      <div className="action-bar charleston">
        <span className="prompt">
          <b>Charleston:</b> {courtesy ? `pick 0–3 tiles to trade with the player across` : `pick 3 tiles to pass ${dir}`} ({picked.length} picked). Jokers can't be passed.
        </span>
        <span className="buttons">
          <button type="button" className="btn claim-btn pong" disabled={picked.length < ask.min} onClick={() => act({ type: 'pass', seat, tiles: picked })}>
            <span className="cjk">Pass</span>
            <span className="en">{courtesy ? `${picked.length} across` : dir}</span>
          </button>
        </span>
      </div>
    );
  }

  if (claims.length > 0 && h.claim) {
    const tile = kindOf(h.claim.tile);
    const robbing = h.claim.kind === 'robKong';
    return (
      <div className="action-bar claim">
        <span className="prompt">
          {names[h.claim.from]} {robbing ? 'adds a kong of' : 'discards'} <Tile kind={tile} className="inline" />
          {callsOnly && <span className="countdown"> · passing in {Math.ceil(Math.max(0, left) / 1000)}s</span>}
        </span>
        <span className="buttons">
          {claims.map((c, i) => {
            const l = claimLabel(s, c, tile);
            const value = c.type === 'win' ? waitInfo(s, seat).find((w) => w.kind === tile)?.ron : null;
            return (
              <button key={i} type="button" className={`btn claim-btn ${c.type === 'expose' ? 'pong' : c.type}`} onClick={() => act({ type: 'claim', seat, claim: c })}>
                <span className="cjk">{robbing && c.type === 'win' ? (s.config.variant === 'riichi' ? '搶槓' : '搶槓') : l.zh}</span>
                <span className="en">
                  {l.en}
                  {value ? ` · ${value} ${v.unit.en}` : ''}
                </span>
                {(c.type === 'chi' || c.type === 'expose') && <TileRow kinds={l.kinds} className="mini" />}
              </button>
            );
          })}
          <button type="button" className="btn claim-btn pass" onClick={() => act({ type: 'claim', seat, claim: { type: 'pass' } })}>
            <span className="cjk">{terms.pass}</span>
            <span className="en">Pass</span>
          </button>
        </span>
      </div>
    );
  }

  if (opts.canDiscard) {
    const riichiMode = mode.kind === 'riichi';
    return (
      <div className="action-bar turn">
        <span className="prompt">
          {riichiMode ? (
            <>
              <b>Riichi:</b> pick the discard that leaves you ready.
            </>
          ) : (
            <>
              <b>Your turn.</b> {opts.allowed?.length === 1 && h.riichi[seat] ? 'After riichi you throw the tile you drew.' : h.drawKind === 'claim' ? 'Discard a tile.' : 'Click a tile to discard it.'}
            </>
          )}
        </span>
        <span className="buttons">
          {opts.win && (
            <button type="button" className="btn claim-btn win" onClick={() => act({ type: 'win', seat })}>
              <span className="cjk">{terms.tsumo}</span>
              <span className="en">
                {s.config.variant === 'riichi' ? 'Tsumo' : s.config.variant === 'american' ? 'Mah Jongg!' : 'Win'} · {opts.win.value} {v.unit.en}
              </span>
            </button>
          )}
          {opts.riichi.length > 0 && (
            <button type="button" className={`btn claim-btn riichi ${riichiMode ? 'on' : ''}`} onClick={() => setMode(riichiMode ? { kind: 'normal' } : { kind: 'riichi' })}>
              <span className="cjk">{terms.riichi}</span>
              <span className="en">{riichiMode ? 'Cancel' : 'Riichi'}</span>
            </button>
          )}
          {opts.kongs.map((k) => (
            <button key={k} type="button" className="btn claim-btn kong" onClick={() => act({ type: 'kong', seat, kind: k })}>
              <span className="cjk">{terms.kong}</span>
              <span className="en">Kong</span>
              <TileRow kinds={[k]} className="mini" />
            </button>
          ))}
          {opts.swaps.slice(0, 3).map((x) => (
            <button key={`${x.tile}-${x.target.seat}-${x.target.order}`} type="button" className="btn claim-btn chi" onClick={() => act({ type: 'swap', seat, tile: x.tile, target: x.target })}>
              <span className="cjk">Swap</span>
              <span className="en">for {names[x.target.seat] === names[seat] ? 'your' : `${names[x.target.seat]}'s`} joker</span>
              <TileRow kinds={[kindOf(x.tile), JOKER]} className="mini" />
            </button>
          ))}
          {opts.abort && (
            <button type="button" className="btn claim-btn pass" onClick={() => act({ type: 'abort', seat })}>
              <span className="cjk">九種九牌</span>
              <span className="en">Abort hand</span>
            </button>
          )}
        </span>
      </div>
    );
  }

  const waitingOn = pendingSeats(s).filter((x) => x !== seat);
  const waits = hints ? waitInfo(s, seat) : [];
  const furiten = v.features.riichi && waits.length > 0 && isFuriten(s, seat);
  const near = v.features.american && hints ? nearestHands(s, seat, 2) : [];
  return (
    <div className="action-bar idle">
      <span className="prompt">
        {h.phase === 'claim' ? 'Waiting for calls…' : h.phase === 'charleston' ? 'Waiting for the others to pass…' : waitingOn.length > 0 ? `${names[waitingOn[0]!]} is thinking…` : ''}
      </span>
      {waits.length > 0 && (
        <span className="waits" title="Tiles that complete your hand (green: can win on a discard)">
          <span className="label">{furiten ? 'Furiten — waiting on' : 'Waiting on'}</span>
          {waits.map((w) => (
            <span key={w.kind} className={`wait ${w.ron !== null ? 'ok' : w.tsumo !== null ? 'tsumo' : 'dead'}`}>
              <Tile kind={w.kind} className="inline" />
              <small>{w.left} left</small>
            </span>
          ))}
        </span>
      )}
      {near.length > 0 && (
        <span className="near" title="The closest hands on the card">
          {near.map((n) => (
            <span key={n.form.hand.id} className="near-hand">
              <CardLine text={n.form.hand.text} />
              <small>{n.distance === 0 ? 'complete' : `${n.distance} away`}</small>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------ callouts

function Callouts({ s, view }: { s: MatchState; view: number }) {
  const [call, setCall] = useState<{ key: string; rel: number; text: string } | null>(null);
  const seen = useRef<string>('');
  const log = s.hand.log;
  const t = variantOf(s).terms;
  useEffect(() => {
    const key = `${s.handNo}:${log.length}`;
    if (seen.current === key) return;
    const first = seen.current === '';
    seen.current = key;
    const e = log[log.length - 1];
    if (first || !e || e.t === 'discard' || e.t === 'pass' || e.t === 'swap') return;
    if (e.t === 'bonus' && s.hand.phase !== 'act') return;
    const text: Record<string, string> = { chi: t.chi, pong: t.pong, kong: t.kong, expose: 'Call', bonus: '花', riichi: t.riichi ?? 'リーチ', exhausted: '流局', abort: '流局' };
    let label = text[e.t] ?? '';
    if (e.t === 'win') label = e.from === null ? t.tsumo : t.ron;
    const rel = 'seat' in e ? relOf(e.seat, view) : -1;
    setCall({ key, rel, text: label });
    const timer = setTimeout(() => setCall(null), 1400);
    return () => clearTimeout(timer);
  }, [log, s.handNo, s.hand.phase, view, t]);
  if (!call || !call.text) return null;
  return (
    <div key={call.key} className={`callout c${call.rel}`} aria-live="polite">
      <span className="cjk">{call.text}</span>
    </div>
  );
}
