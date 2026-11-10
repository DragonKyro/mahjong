// Copies the HK networks the game ships from a training run into public/policies/hk.
//
//   npm run ship-policies                       # the levels below, from training/runs/hk1
//   npm run ship-policies -- --run <run> --easy 300 --normal 1500 --hard 4500
//
// Chosen from the checkpoint ladder (paired seeds, 512 matches each; points per
// match against the final network): update 200 −78, 1000 −34, 5000 0 — even
// steps of 35–45 points, each well outside the ±8 noise. See training/README.md.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const run = args.run ?? 'hk1';
const updates = { easy: Number(args.easy ?? 200), normal: Number(args.normal ?? 1000), hard: Number(args.hard ?? 5000) };

mkdirSync(join(root, 'public/policies/hk'), { recursive: true });
for (const [level, update] of Object.entries(updates)) {
  const from = join(root, 'training/runs', run, 'policies', `update_${String(update).padStart(5, '0')}.hknet`);
  if (!existsSync(from)) throw new Error(`${from} doesn't exist`);
  copyFileSync(from, join(root, 'public/policies/hk', `${level}.hknet`));
  console.log(`${level.padEnd(6)} ← ${run} update ${update}`);
}
