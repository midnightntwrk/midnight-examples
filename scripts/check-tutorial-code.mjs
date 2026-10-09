#!/usr/bin/env node
// Checks that every titled code block in examples/*/tutorials/*.mdx quotes
// its file verbatim, so tutorials can't drift from the code they walk through.
//
// A block like
//
//   ```compact title="contract/battleship.compact"
//   ...
//   ```
//
// passes if its lines appear, contiguously and unchanged, in
// examples/<name>/contract/battleship.compact. Trailing whitespace is ignored on
// both sides, so an editor that trims on save can't break the match. Untitled
// blocks (commands, sample output) are not checked. See docs/tutorials.md.
//
//   node scripts/check-tutorial-code.mjs [<name> ...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(REPO_ROOT, 'examples');
const BLOCK = /^```\w*[^\n]*?\btitle="([^"]+)"[^\n]*\n([\s\S]*?)\n```/gm;

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(EXAMPLES).filter((n) => fs.existsSync(path.join(EXAMPLES, n, 'tutorials')));

const trimEnd = (line) => line.replace(/\s+$/, '');

const containsRun = (haystack, needle) => {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((line, j) => haystack[i + j] === line)) return true;
  }
  return false;
};

let checked = 0;
const problems = [];
for (const name of names) {
  const dir = path.join(EXAMPLES, name, 'tutorials');
  for (const page of fs.readdirSync(dir).filter((f) => f.endsWith('.mdx')).sort()) {
    const text = fs.readFileSync(path.join(dir, page), 'utf8');
    for (const [, title, body] of text.matchAll(BLOCK)) {
      checked++;
      const where = `examples/${name}/tutorials/${page}`;
      const src = path.join(EXAMPLES, name, title);
      if (!fs.existsSync(src)) {
        problems.push(`${where}: title="${title}" names a file that doesn't exist`);
        continue;
      }
      const lines = body.split('\n').map(trimEnd);
      if (!containsRun(fs.readFileSync(src, 'utf8').split('\n').map(trimEnd), lines)) {
        problems.push(`${where}: block titled "${title}" starting ${JSON.stringify(lines[0])} doesn't match the file`);
      }
    }
  }
}

for (const p of problems) console.error(`error: ${p}`);
console.log(`${checked} titled code block(s) checked, ${problems.length} mismatch(es)`);
process.exit(problems.length ? 1 : 0);
