// Parse every first-party JS file so CI catches syntax errors without needing
// a full lint toolchain. Requires --experimental-vm-modules (see the npm
// "lint" script) because renderer files are ES modules.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = ['main.js', 'preload.js'];
for (const dir of ['lib', 'renderer', 'test', 'scripts']) {
  for (const entry of await readdir(path.join(root, dir))) {
    if (entry.endsWith('.js') || entry.endsWith('.mjs')) targets.push(path.join(dir, entry));
  }
}

let failed = false;
for (const target of targets) {
  const source = await readFile(path.join(root, target), 'utf8');
  try {
    // CommonJS sources are also syntactically valid modules, so one parser
    // covers both module systems.
    new vm.SourceTextModule(source, { identifier: target });
  } catch (error) {
    failed = true;
    console.error(`${target}: ${error.message}`);
  }
}

if (failed) process.exit(1);
console.log(`Syntax OK for ${targets.length} files.`);
