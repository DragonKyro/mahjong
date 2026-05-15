import type { Tile } from '@core/tiles/Tile';
import { tileAssetUrl, tileBackUrl } from '../tileAsset';

interface TileImageProps {
  tile: Tile;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<TileImageProps['size']>, string> = {
  sm: 'w-8 h-10',
  md: 'w-12 h-16',
  lg: 'w-16 h-20',
};

/** Render a single tile. Falls back to a text glyph for bonus tiles that have no SVG. */
export function TileImage({ tile, faceDown = false, size = 'md' }: TileImageProps) {
  const className = `${SIZE_CLASS[size]} rounded-sm bg-stone-100 border border-stone-300 select-none flex-shrink-0`;
  if (faceDown) {
    return <img src={tileBackUrl()} alt="face-down tile" className={className} />;
  }
  const url = tileAssetUrl(tile);
  if (url === null) {
    // Bonus tile fallback
    return (
      <div
        className={`${className} flex items-center justify-center font-cjk text-rose-600 font-bold`}
        title={tile.toString()}
      >
        <span className="text-xl">{tile.toUnicode()}</span>
      </div>
    );
  }
  return <img src={url} alt={tile.toString()} title={tile.toString()} className={className} />;
}
