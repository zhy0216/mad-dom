#!/usr/bin/env bun
// hdunit (T03) runner entry for the rewritten happy-dom suite.
//
// `compat:hdunit:test` runs the T02-produced tests (`tests/happy-dom/rewritten`)
// under `bun test` with the T03 adapter preload and the upstream-matching
// 500ms test timeout. The hand-written smoke sample
// (`./tests/happy-dom/adapter/smoke.sample.ts`) is always included: it proves
// the adapter wiring even before T02 is integrated (rewritten missing/empty),
// in which case the sample alone is run.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REWRITTEN = join(REPO_ROOT, 'tests', 'happy-dom', 'rewritten');
const PRELOAD = join(REPO_ROOT, 'tests', 'happy-dom', 'adapter', 'preload.ts');
// Leading `./` — bun resolves a relative `--preload`/entry without a `./`
// prefix differently and would report "preload not found".
const SMOKE_SAMPLE = './tests/happy-dom/adapter/smoke.sample.ts';

function findTestFiles(dir) {
	const entries = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			entries.push(...findTestFiles(full));
		} else if (entry.endsWith('.test.ts') || entry.endsWith('.test.js')) {
			entries.push(full);
		}
	}
	return entries;
}

const hasRewrittenTests =
	existsSync(REWRITTEN) &&
	statSync(REWRITTEN).isDirectory() &&
	findTestFiles(REWRITTEN).length > 0;

const testArgs = ['test'];
if (hasRewrittenTests) {
	testArgs.push('tests/happy-dom/rewritten', SMOKE_SAMPLE);
} else {
	testArgs.push(SMOKE_SAMPLE);
}
testArgs.push('--preload', PRELOAD, '--timeout', '500');

const { spawnSync } = await import('node:child_process');
const result = spawnSync('bun', testArgs, { stdio: 'inherit', cwd: REPO_ROOT });

if (result.error) {
	console.error(`compat:hdunit:test: failed to spawn bun: ${result.error.message}`);
	process.exit(1);
}
process.exit(result.status ?? 1);
