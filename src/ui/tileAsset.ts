import type { Tile } from '@core/tiles/Tile';
import { Suit } from '@core/tiles/SuitTile';
import { Wind, Dragon } from '@core/tiles/HonorTile';

/**
 * Resolve a Tile to the public-served SVG asset URL.
 *
 * Filenames follow FluffyStuff's convention (see CREDITS.md):
 *   - Suit:   Man1..Man9 (萬), Pin1..Pin9 (筒), Sou1..Sou9 (索)
 *   - Wind:   Ton (東), Nan (南), Shaa (西), Pei (北)
 *   - Dragon: Chun (中), Hatsu (發), Haku (白)
 *   - Back:   the face-down tile (for opponent hands)
 *
 * Bonus tiles (花/季) have no SVG yet; callers should render a text fallback.
 */

const SUIT_PREFIX: Record<Suit, string> = {
  [Suit.Character]: 'Man',
  [Suit.Circle]: 'Pin',
  [Suit.Bamboo]: 'Sou',
};

const HONOR_FILE: Record<string, string> = {
  [Wind.East]: 'Ton',
  [Wind.South]: 'Nan',
  [Wind.West]: 'Shaa',
  [Wind.North]: 'Pei',
  [Dragon.Red]: 'Chun',
  [Dragon.Green]: 'Hatsu',
  [Dragon.White]: 'Haku',
};

function url(name: string): string {
  return `${import.meta.env.BASE_URL}tiles/${name}.svg`;
}

/** Public URL for the SVG of `tile`, or `null` for bonus tiles (no asset). */
export function tileAssetUrl(tile: Tile): string | null {
  if (tile.isSuit()) return url(`${SUIT_PREFIX[tile.suit]}${tile.rank}`);
  if (tile.isHonor()) return url(HONOR_FILE[tile.honor]!);
  return null;
}

/** Public URL for the face-down tile back. */
export function tileBackUrl(): string {
  return url('Back');
}
