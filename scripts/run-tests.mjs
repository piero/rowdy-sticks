// Bundle the headless test entry with esbuild and run it in Node.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'stickman-tests-')), 'tests.mjs');
await build({ entryPoints: ['tests/model.test.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning' });
await import(pathToFileURL(out).href);
