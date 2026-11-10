// Point every `resolved` URL in package-lock.json at the public npm registry.
//
// Kyle's machine installs through a corporate Artifactory mirror (the global
// npm registry setting), so `npm install` records mirror URLs in the lockfile.
// GitHub Actions can't reach the mirror, so a lockfile carrying them breaks the
// deploy. The mirror serves byte-identical tarballs under the same paths, so
// swapping the host keeps every `integrity` hash valid. Locally npm still
// installs through the mirror: it rewrites registry.npmjs.org URLs to the
// configured registry (`replace-registry-host`, default "npmjs").
//
// Run after any install that changes the lockfile: `npm run fix-lock`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = 'https://registry.npmjs.org/';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'package-lock.json');

const text = readFileSync(file, 'utf8');
// Any non-public registry base: everything up to the package path, which
// starts at the scope (`@x/`) or the package name followed by `/-/`.
const mirror = /"resolved": "(https?:\/\/(?!registry\.npmjs\.org)[^"]*?\/api\/npm\/[^/"]+\/)/g;
let count = 0;
const fixed = text.replace(mirror, () => {
  count++;
  return `"resolved": "${PUBLIC}`;
});
const leftovers = [...fixed.matchAll(/"resolved": "(https?:\/\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith(PUBLIC));
if (leftovers.length > 0) {
  console.error(`fix-lockfile: ${leftovers.length} URL(s) still not on ${PUBLIC}, e.g. ${leftovers[0]}`);
  process.exit(1);
}
if (count > 0) writeFileSync(file, fixed);
console.log(`fix-lockfile: ${count} URL(s) rewritten; every resolved URL is on ${PUBLIC}`);
