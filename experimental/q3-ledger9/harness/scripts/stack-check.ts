// yarn stack:check — fails if any pinned package resolves to the wrong version
// or from outside this workspace.
import { compiler, imageDigests, packages } from '../src/stack.js';

let ok = true;
for (const p of packages()) {
  const good = p.resolved === p.expected && p.local;
  ok &&= good;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${p.name}@${p.resolved}${p.expected !== p.resolved ? ` (expected ${p.expected})` : ''}${p.local ? '' : ' (resolved OUTSIDE this workspace)'}`);
}
console.log(`compiler: ${compiler()}`);
for (const [image, digest] of Object.entries(imageDigests())) console.log(`image: ${image} -> ${digest}`);
process.exit(ok ? 0 : 1);
