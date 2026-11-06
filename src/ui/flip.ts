// Tile-move animation (FLIP). Every tile element on the board carries its
// physical id (`data-tid`). After each render, a tile that was somewhere else
// before (the wall → a hand, a hand → the pond, the pond → a meld, one hand →
// another in the Charleston) is animated from its old screen rect to the new
// one. Seat layers are rotated, so the screen delta is turned into the tile's
// own frame, and the tile turns from its old seat's angle to the new one.
// Nothing animates when the scene changes (a new hand), under reduced motion,
// or where the Web Animations API is missing (tests).

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Box {
  x: number;
  y: number;
  area: number;
  rot: number;
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The rotation (degrees) of the seat layer a tile sits in. */
function layerRotation(el: HTMLElement): number {
  const side = el.closest<HTMLElement>('[data-rot]');
  return side ? Number(side.dataset.rot) : 0;
}

export function useTileFlip(root: RefObject<HTMLElement | null>, scene: string, enabled = true): void {
  const prev = useRef(new Map<string, Box>());
  const prevScene = useRef(scene);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const fresh = prevScene.current !== scene;
    prevScene.current = scene;
    const next = new Map<string, Box>();
    const nodes = el.querySelectorAll<HTMLElement>('[data-tid]');
    const animate = enabled && !fresh && !reduced() && typeof Element !== 'undefined' && 'animate' in Element.prototype;
    nodes.forEach((n) => {
      const id = n.dataset.tid!;
      const r = n.getBoundingClientRect();
      const box: Box = { x: r.left + r.width / 2, y: r.top + r.height / 2, area: r.width * r.height, rot: layerRotation(n) };
      next.set(id, box);
      const old = prev.current.get(id);
      if (!animate || !old) return;
      const dx = old.x - box.x;
      const dy = old.y - box.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      const a = (-box.rot * Math.PI) / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      let turn = old.rot - box.rot;
      if (turn > 180) turn -= 360;
      if (turn < -180) turn += 360;
      const scale = box.area > 0 ? Math.sqrt(old.area / box.area) : 1;
      n.animate(
        [{ transform: `translate(${lx}px, ${ly}px) rotate(${turn}deg) scale(${scale})`, zIndex: 20 }, { transform: 'none', zIndex: 20 }],
        { duration: 340, easing: 'cubic-bezier(.2,.75,.25,1)' },
      );
    });
    prev.current = next;
  });
}
