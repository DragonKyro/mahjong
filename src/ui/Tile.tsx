// One tile. Faces are the FluffyStuff CC0 SVGs for suits, winds, 發 and 中;
// 白板 (an HK-style blue frame) and the eight flowers / seasons are drawn here.
// The tile body, its edge and the back are CSS (styles.css, `.tile`). Size
// comes from the `--tw` custom property of the surrounding zone.

import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import type { MatchState } from '@/core/engine';
import { BONUS0, BONUS_ZH, JOKER, WHITE, isBonus, isSuit, isWind, kindName, kindNameZh, kindOf, rankOf, suitOf, type Kind, type TileId } from '@/core/tiles';
import { isRedFive, type RiichiRules } from '@/core/variants/riichi';

const SUIT_FILE = ['Man', 'Pin', 'Sou'];
const WIND_FILE = ['Ton', 'Nan', 'Shaa', 'Pei'];

function faceFile(k: Kind): string | null {
  if (isSuit(k)) return `${SUIT_FILE[suitOf(k)]}${rankOf(k)}`;
  if (isWind(k)) return WIND_FILE[k - 27]!;
  if (k === 32) return 'Hatsu';
  if (k === 33) return 'Chun';
  return null;
}

const FLOWER_INK = ['#c0392b', '#2e7d4f', '#b7791f', '#2e7d4f'];
const SEASON_INK = '#2456b3';

function BonusFace({ kind }: { kind: Kind }) {
  const i = kind - BONUS0;
  const season = i >= 4;
  const ink = season ? SEASON_INK : FLOWER_INK[i]!;
  return (
    <svg className="face" viewBox="0 0 30 40" aria-hidden>
      <text x="4.5" y="10.5" fontSize="8.5" fontWeight="700" fill={ink} fontFamily="Georgia, serif">
        {(i % 4) + 1}
      </text>
      {/* A small blossom / sun motif in the corner. */}
      {season ? (
        <g fill="none" stroke={ink} strokeWidth="1.1">
          <circle cx="23" cy="7.5" r="2.6" />
          <path d="M23 2.8v1.2M23 11v1.2M18.3 7.5h1.2M26.5 7.5h1.2" />
        </g>
      ) : (
        <g fill={ink} opacity="0.85">
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={23 + 2.1 * Math.cos((a * Math.PI) / 180)} cy={7.5 + 2.1 * Math.sin((a * Math.PI) / 180)} r="1.35" />
          ))}
          <circle cx="23" cy="7.5" r="0.9" fill="#f4d35e" />
        </g>
      )}
      <text x="15" y="31" fontSize="17" textAnchor="middle" fill={ink} fontWeight="700" className="cjk">
        {BONUS_ZH[i]}
      </text>
      <path d="M8 35.5h14" stroke={ink} strokeWidth="0.8" opacity="0.5" />
    </svg>
  );
}

function WhiteDragon() {
  return (
    <svg className="face" viewBox="0 0 30 40" aria-hidden>
      <rect x="5.5" y="6.5" width="19" height="27" rx="2.5" fill="none" stroke="#2f62c9" strokeWidth="2.4" />
      <rect x="9" y="10" width="12" height="20" rx="1.4" fill="none" stroke="#2f62c9" strokeWidth="0.9" />
    </svg>
  );
}

function JokerFace() {
  return (
    <svg className="face" viewBox="0 0 30 40" aria-hidden>
      <path d="M15 5.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1L15 17.3l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill="#e2b04a" stroke="#9a6b12" strokeWidth="0.6" />
      <text x="15" y="29" fontSize="7.4" textAnchor="middle" fontWeight="800" fill="#b3261e" fontFamily="Georgia, serif" letterSpacing="0.3">
        JOKER
      </text>
      <path d="M7 33.5h16" stroke="#2456b3" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function TileFace({ kind, red }: { kind: Kind; red?: boolean }) {
  if (kind === WHITE) return <WhiteDragon />;
  if (kind === JOKER) return <JokerFace />;
  if (isBonus(kind)) return <BonusFace kind={kind} />;
  let file = faceFile(kind);
  if (red && file && rankOf(kind) === 5 && isSuit(kind)) file += '-Dora';
  return file ? <img className="face" src={`${import.meta.env.BASE_URL}tiles/${file}.svg`} alt="" draggable={false} /> : null;
}

export interface TileProps {
  /** null = face down. */
  kind: Kind | null;
  /** A red five (Riichi aka dora). */
  red?: boolean;
  /** Lying sideways (a riichi declaration discard). */
  sideways?: boolean;
  /** Physical tile id: lets the move animation follow this tile around the table. */
  tid?: number;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  title?: string;
  /** Rendered as a button (keyboard focusable) when clickable. */
  interactive?: boolean;
  disabled?: boolean;
}

export function tileLabel(kind: Kind): string {
  return `${kindNameZh(kind)} ${kindName(kind)}`;
}

export function Tile({ kind, red, sideways, tid, className = '', style, onClick, onPointerDown, title, interactive, disabled }: TileProps) {
  const cls = `tile ${kind === null ? 'back' : ''} ${sideways ? 'sideways' : ''} ${red ? 'red' : ''} ${className}`;
  const label = kind === null ? 'face-down tile' : `${red ? 'red ' : ''}${tileLabel(kind)}`;
  const data = tid === undefined ? {} : { 'data-tid': tid };
  if (interactive) {
    return (
      <button type="button" className={cls} style={style} onClick={onClick} onPointerDown={onPointerDown} title={title ?? label} aria-label={label} disabled={disabled} {...data}>
        {kind !== null && <TileFace kind={kind} red={red} />}
      </button>
    );
  }
  return (
    <span className={cls} style={style} title={title ?? (kind === null ? undefined : label)} role="img" aria-label={label} {...data}>
      {kind !== null && <TileFace kind={kind} red={red} />}
    </span>
  );
}

/** A row of small tiles (score breakdowns, chat, hints). */
export function TileRow({ kinds, className = '' }: { kinds: readonly Kind[]; className?: string }) {
  return (
    <span className={`tile-row ${className}`}>
      {kinds.map((k, i) => (
        <Tile key={i} kind={k} />
      ))}
    </span>
  );
}

/** Face props for a tile id in this match (red fives in Riichi; the id for the move animation). */
export function useFace(s: MatchState) {
  const red = s.config.variant === 'riichi' && (s.config.rules as RiichiRules).akaDora;
  return (t: TileId) => ({ kind: kindOf(t), red: red && isRedFive(t), tid: t });
}
