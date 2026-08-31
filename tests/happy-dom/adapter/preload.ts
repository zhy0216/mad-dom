/**
 * hdunit (T03) bun adapter — preload entry.
 *
 * Loaded before every test file via
 * `bun test --preload tests/happy-dom/adapter/preload.ts` (see the
 * `compat:hdunit:test` npm script). Injects the globals the rewritten tests use
 * without an import:
 *
 *   - `globalThis.vi`               -> adapter `vi` compat object
 *   - `globalThis.mockModule`       -> from `./setup.ts` (upstream parity)
 *   - `globalThis.resetMockedModules`-> from `./setup.ts` (upstream parity)
 *   - `globalThis.restoreAllMocks`  -> adapter registry restore
 *
 * Importing `./setup.ts` also registers the child_process/http/https module
 * mocks and pins `process.env.TZ` before any test module is evaluated.
 */

import { vi, restoreAllMocks } from './index';
import './setup';

(globalThis as Record<string, unknown>)['vi'] = vi;
(globalThis as Record<string, unknown>)['restoreAllMocks'] = restoreAllMocks;
