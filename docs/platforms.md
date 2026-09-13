# Platforms and troubleshooting

MAD DOM ships native binaries as optional platform packages. A supported
installation needs Bun and the matching binary; it does not need a Rust compiler.

## Install

```sh
bun add -d mad-dom@next
```

`next` selects the alpha/beta channel. Keep optional dependencies enabled and
commit `bun.lock` for reproducible installs. CI uses `bun install --frozen-lockfile`.
The main package pins its platform dependencies to exactly the same version.

## Support matrix

The release configuration includes these targets:

| OS | CPU | Platform package | Release stage |
| --- | --- | --- | --- |
| macOS | arm64 | `@mad-dom/platform-darwin-arm64` | Alpha |
| macOS | x64 | `@mad-dom/platform-darwin-x64` | Alpha |
| Linux, glibc | x64 | `@mad-dom/platform-linux-x64-gnu` | Alpha |
| Linux, glibc | arm64 | `@mad-dom/platform-linux-arm64-gnu` | Alpha |
| Windows | x64 | `@mad-dom/platform-win32-x64` | Planned for beta |
| Linux, musl | x64 | `@mad-dom/platform-linux-x64-musl` | Planned for beta |
| Linux, musl | arm64 | `@mad-dom/platform-linux-arm64-musl` | Planned for beta |

A target appearing in `optionalDependencies` does not mean its binary ships in
an alpha release. Optional-package 404 warnings can refer to targets deferred
to beta. What matters is that your own platform's package loads successfully.

## Requirements

- **Bun >= 1.4.0.** Bun is the supported runtime; using a Node-API binding does
  not itself establish Node.js runtime support.
- **Linux glibc builds:** the measured first-release baseline is **glibc 2.39**.
  Older glibc versions have not been established as compatible.
- Match the process architecture to the binary. Avoid copying native
  `node_modules` between operating systems or CPU architectures; install on the
  target machine instead.

The [release manual](/release#measured-verification-points) records the Linux
build environment and the remaining Bun libc-selection verification.

## How the native loader selects a binary

The loader tries these candidates in order:

1. `MAD_DOM_NATIVE_PATH`, if set. Relative paths resolve from the process's
   current working directory.
2. The matching `@mad-dom/platform-*` package. On Linux, the detected libc
   variant is tried first, followed by the other variant as a fallback.
3. `build/mad-dom.node` in a source checkout.

The loaded module must pass the native ABI probe. There is no JavaScript DOM
fallback when loading fails. Native load results are cached within the process;
restart it after correcting the installation or environment.

On Bun, the loader then performs a separate FFI probe against that same native
file. The platform package's `madDomFfi` metadata points at its `main` image;
it is intentionally not a second copied library because the FFI document
registry is owned by the Node-API image. `MAD_DOM_FFI_DISABLED=1` forces the
Node-API path. Missing FFI, an ABI mismatch, and a partial capability bitset
are reported as capability data and fall back per operation without changing
the public facade or wrapper identity. The metadata field is a build
observation; runtime probing of the same Node-API image remains authoritative.
A Node-API-only package can omit `madDomFfi` and still load successfully.

An installed npm package does not contain the development build artifact.
For local source comparisons, select the freshly built artifact explicitly so
an installed platform package cannot take precedence.

## Build from source

From a repository checkout, use the latest stable Bun (`bun upgrade`), Rust
`1.93.1`, and native build tools for your host. `.bun-version` (`1.4.0`) is
reserved for baseline verification and historical reproduction; the latest
CI lane resolves current stable Bun independently:

```sh
bun install --frozen-lockfile
bun run dev:build
MAD_DOM_NATIVE_PATH="$PWD/build/mad-dom.node" bun examples/wiki-getting-started.mad-dom.mjs
```

The source build creates `build/mad-dom.node`. Platform-package assembly and
cross-target requirements are described in the [release manual](/release#build).

## `MAD_DOM_UNSUPPORTED_PLATFORM`

Read the rest of the error message to distinguish three cases:

| Message indicates | Action |
| --- | --- |
| Platform is not in the supported matrix | Use a supported OS/CPU combination |
| Matching platform package is missing | Reinstall with optional dependencies enabled; check that the chosen release includes your target |
| Package exists but cannot load | Check CPU architecture, libc compatibility, and the loader's underlying dynamic-library error |

Remove installation flags such as `--no-optional`, then reinstall the chosen
version. Do not solve a missing alpha binary by mixing a different platform
package version into the installation.

## `MAD_DOM_ABI_MISMATCH`

The binding's ABI probe differs from what the JavaScript package expects.
Check `MAD_DOM_NATIVE_PATH` first: it may point to an old development build.
For a source checkout, rebuild and select the new artifact. For a package
installation, reinstall a matching main/platform pair:

```sh
bun add -d mad-dom@next
```

An ABI match is necessary for loading; use matching package versions as well.

## `MAD_DOM_NATIVE_NOT_FOUND`

In a source checkout, neither a development artifact nor a platform package
could be found. Run `bun run dev:build` and select `build/mad-dom.node` as shown
above. Some existing error text still says `npm run dev:build`; this repository
uses **`bun run dev:build`**.

## Test setup and behavior problems

| Symptom | Check |
| --- | --- |
| `document is not defined` | Pass an explicit Window/document, or install the [minimal preload](/testing#modules-that-expect-dom-globals) before imports |
| The DOM is still loading after a wait | Await the actual operation; [completion scopes](/async#what-completion-means-today) differ |
| A test never finishes | Clear active intervals and finish/abort outstanding requests; timer-limit settings are currently unused |
| Scripts in a downloaded page did not run | Browser navigation is HTML-only; see [script entry points](/async#script-execution) |
| Logs are missing from the terminal | Read the [virtual console](/window#console-output) or pass `{ console }` |
| An element's width is zero | MAD DOM does not compute visual layout |

When reporting a problem, include the mad-dom version, Bun version, OS/CPU/libc,
full error, whether `MAD_DOM_NATIVE_PATH` is set, and a small runnable
reproduction. For a compatibility difference, include the expected output from
the pinned happy-dom baseline.

## Bun capability diagnostics

| Result | Meaning and action |
| --- | --- |
| FFI `available` / `partial` | Independent FFI ABI passed; use only the reported operations. Missing operations retain Node-API behavior. |
| FFI `disabled` | `MAD_DOM_FFI_DISABLED=1` explicitly selected Node-API. This is an intentional setting. |
| FFI `unavailable` | Experimental `bun:ffi`, its symbols, or an FFI artifact cannot load. Node-API remains usable if its binary loads. A latest Bun capability loss appears here with its reason. |
| FFI `mismatch` / `MAD_DOM_FFI_ABI_MISMATCH` | Optional FFI ABI differs; affected operations fall back. Check the main/platform pair and explicit FFI path. |
| `MAD_DOM_ABI_MISMATCH` | Required Node-API object ABI differs. DOM construction fails until the matching native binary is installed. |
| `MAD_DOM_UNSUPPORTED_PLATFORM` | The required platform binary is missing, unsupported, or cannot load. Disabling FFI cannot supply that binary. |
| `MAD_DOM_METADATA_MISMATCH` in release/smoke | Package versions, ABI declarations, capability level, or image layout disagree. Rebuild a matching pair before release. |

For source diagnostics, run `bun run report:runtime`; it records actual Bun
version/revision, platform/libc, both ABIs, loader capability results, and the
public API capability matrix even after a native load failure. Installed
packages include the same observation helper:

```js
import { runtimeObservation } from './node_modules/mad-dom/js/runtime-metadata.js';
console.log(JSON.stringify(runtimeObservation(), null, 2));
```

Include this report with failures on latest Bun. `api-present-unverified`
for the external ArrayBuffer deallocator means the API exists; it does not
claim that callback lifetime or ownership safety was exercised. Default
buffers are caller-owned; memory/GC verification is recorded separately.
