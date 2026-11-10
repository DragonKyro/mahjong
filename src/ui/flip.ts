// Tile-move animation (FLIP). Every tile element on the board carries its
// physical id (`data-tid`). After each render, a tile that was somewhere else
// before (the wall → a hand, a hand → the pond, the pond → a meld, one hand →
// another in the Charleston) is animated from where it was on screen to its
// new place. Seat layers are rotated, so the screen delta is turned into the
// tile's own frame, and the tile turns from its old seat's angle to the new one.
// Nothing animates when the scene changes (a new hand), under reduced motion,
// or where the Web Animations API is missing (tests).
//
// Positions are layout positions: a tile's own transform (a move still in
// flight, a hover lift) is taken out of the measurement. The table re-renders
// all the time while tiles fly (whose turn it is, timers), and measuring the
// in-flight position read as a new move — the tile was sent back the other
// way, overshot off the board and made the page scroll bar flicker on and off,
// which jerked the whole table sideways. Now an unmoved tile keeps its move,
// and a tile that moves again mid-flight starts the new move from where it is.

import { useLayoutEffect, useRef, type RefObject } from 'react';

const DURATION = 340;
const EASING = 'cubic-bezier(.2,.75,.25,1)';

/** A tile's center on screen, its side length, and the rotation of its seat layer (degrees). */
interface Box {
  x: number;
  y: number;
  size: number;
  rot: number;
}

/** A tile's element, its layout position, and the move it is making there (if any). */
interface Track {
  el: HTMLElement;
  at: Box;
  move: { from: Box; anim: Animation } | null;
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const canAnimate = () => typeof Element !== 'undefined' && 'animate' in Element.prototype && !reduced();

/** The rotation (degrees) of the seat layer a tile sits in. */
function layerRotation(el: HTMLElement): number {
  const side = el.closest<HTMLElement>('[data-rot]');
  return side ? Number(side.dataset.rot) : 0;
}

/** Where a tile's layout puts it, leaving out the tile's own transform. */
function measure(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  const rot = layerRotation(el);
  let x = r.left + r.width / 2;
  let y = r.top + r.height / 2;
  // The transform turns and scales the tile about its center, so the center
  // is only moved by the translation — given in the seat layer's frame.
  const m = getComputedStyle(el).transform;
  if (m && m !== 'none') {
    const v = m.slice(m.indexOf('(') + 1, -1).split(',').map(Number);
    const e = (v.length === 16 ? v[12] : v[4]) ?? 0;
    const f = (v.length === 16 ? v[13] : v[5]) ?? 0;
    const a = (rot * Math.PI) / 180;
    x -= e * Math.cos(a) - f * Math.sin(a);
    y -= e * Math.sin(a) + f * Math.cos(a);
  }
  return { x, y, size: Math.sqrt(el.offsetWidth * el.offsetHeight), rot };
}

/** Where a tracked tile is on screen right now, partway through its move. */
function onScreen(t: Track): Box {
  if (!t.move) return t.at;
  const p = t.move.anim.effect?.getComputedTiming().progress;
  const q = p === null || p === undefined ? 0 : 1 - p; // 1 at the start of the move, 0 once done
  const { at } = t;
  const { from } = t.move;
  const mix = (a: number, b: number) => a + (b - a) * q;
  return { x: mix(at.x, from.x), y: mix(at.y, from.y), size: mix(at.size, from.size), rot: mix(at.rot, from.rot) };
}

const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.size - b.size) < 0.5 && a.rot === b.rot;

export function useTileFlip(root: RefObject<HTMLElement | null>, scene: string, enabled = true): void {
  const tracks = useRef(new Map<string, Track>());
  const prevScene = useRef(scene);
  useLayoutEffect(() => {
    const el = root.current;
    const fresh = prevScene.current !== scene;
    prevScene.current = scene;
    const before = tracks.current;
    if (!el || !enabled || !canAnimate()) {
      tracks.current = new Map();
      return;
    }
    const next = new Map<string, Track>();
    // Measure everything first, then start the moves (a cancel or a new
    // animation between two measurements would force another style pass).
    const moves: { track: Track; from: Box }[] = [];
    el.querySelectorAll<HTMLElement>('[data-tid]').forEach((n) => {
      const id = n.dataset.tid!;
      const at = measure(n);
      const old = before.get(id);
      // Same element in the same place: leave its move (if any) running.
      if (old && old.el === n && same(old.at, at)) {
        next.set(id, old);
        return;
      }
      const track: Track = { el: n, at, move: null };
      next.set(id, track);
      if (old && !fresh) moves.push({ track, from: onScreen(old) });
    });
    // Moves that were interrupted, and tiles that left the board, stop.
    before.forEach((t, id) => {
      if (t.move && next.get(id) !== t) t.move.anim.cancel();
    });
    for (const { track, from } of moves) {
      const { el: n, at } = track;
      const dx = from.x - at.x;
      const dy = from.y - at.y;
      let turn = from.rot - at.rot;
      while (turn > 180) turn -= 360;
      while (turn < -180) turn += 360;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(turn) < 1) continue;
      const a = (-at.rot * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const scale = at.size > 0 ? from.size / at.size : 1;
      const anim = n.animate(
        [{ transform: `translate(${lx}px, ${ly}px) rotate(${turn}deg) scale(${scale})`, zIndex: 20 }, { transform: 'none', zIndex: 20 }],
        { duration: DURATION, easing: EASING },
      );
      track.move = { from: { ...from, rot: at.rot + turn }, anim };
    }
    tracks.current = next;
  });
}
