// One tile. Faces are the FluffyStuff CC0 SVGs for suits, winds, 發 and 中;
// 白板 (an HK-style blue frame) and the eight flowers / seasons are drawn here.
// The tile body, its edge and the back are CSS (styles.css, `.tile`). Size
// comes from the `--tw` custom property of the surrounding zone.

import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import { BONUS0, BONUS_ZH, WHITE, isBonus, isSuit, isWind, kindName, kindNameZh, rankOf, suitOf, type Kind } from '@/core/tiles';

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

export function TileFace({ kind }: { kind: Kind }) {
  if (kind === WHITE) return <WhiteDragon />;
  if (isBonus(kind)) return <BonusFace kind={kind} />;
  const file = faceFile(kind);
  return file ? <img className="face" src={`${import.meta.env.BASE_URL}tiles/${file}.svg`} alt="" draggable={false} /> : null;
}

export interface TileProps {
  /** null = face down. */
  kind: Kind | null;
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

export function Tile({ kind, className = '', style, onClick, onPointerDown, title, interactive, disabled }: TileProps) {
  const cls = `tile ${kind === null ? 'back' : ''} ${className}`;
  const label = kind === null ? 'face-down tile' : tileLabel(kind);
  if (interactive) {
    return (
      <button type="button" className={cls} style={style} onClick={onClick} onPointerDown={onPointerDown} title={title ?? label} aria-label={label} disabled={disabled}>
        {kind !== null && <TileFace kind={kind} />}
      </button>
    );
  }
  return (
    <span className={cls} style={style} title={title ?? (kind === null ? undefined : label)} role="img" aria-label={label}>
      {kind !== null && <TileFace kind={kind} />}
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
