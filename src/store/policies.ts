// Loads the trained networks that play the neural variants (HK today). Each
// level is a ~1.9 MB file under public/policies/<variant>/<level>.hknet, fetched
// on first use and registered with the core AI (src/core/ai/neural.ts). The
// network runtime itself is a separate chunk, so heuristic variants never
// download it.

import { neuralPlayer, registerNeural } from '@/core/ai/neural';
import type { AiLevel } from '@/core/engine';
import type { VariantId } from '@/core/variants';

const FILES: Partial<Record<VariantId, Record<AiLevel, string>>> = {
  hk: { easy: 'policies/hk/easy.hknet', normal: 'policies/hk/normal.hknet', hard: 'policies/hk/hard.hknet' },
};

const inflight = new Map<string, Promise<void>>();

/** Fetch and register the network for (variant, level); resolves at once if it's already there. */
export function loadPolicy(variant: VariantId, level: AiLevel): Promise<void> {
  if (neuralPlayer(variant, level)) return Promise.resolve();
  const file = FILES[variant]?.[level];
  if (!file) return Promise.reject(new Error(`no ${variant} network for level ${level}`));
  const key = `${variant}:${level}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const url = `${import.meta.env.BASE_URL}${file}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const { loadHkPlayer } = await import('@/core/nn/hkPlayer');
      registerNeural(variant, level, loadHkPlayer(bytes));
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
