# Platforms

## Install

```sh
bun add -d mad-dom
```

The native binaries ship as optional npm packages (`@mad-dom/platform-*`) that
match your OS and CPU architecture, so `bun add` just works — nothing to
compile, no Rust toolchain required.

## Support matrix

| Status | Platforms |
| --- | --- |
| Available now (alpha) | macOS arm64, macOS x64, Linux x64 (glibc), Linux arm64 (glibc) |
| Coming in beta | Windows x64, Linux x64 (musl), Linux arm64 (musl) |

## Requirements

- **Bun** >= 1.4.0
- **Linux (glibc builds):** glibc >= 2.39 — the floor measured on the first
  Linux CI release build. On older glibc, use a musl build once available.

## Troubleshooting

### `MAD_DOM_UNSUPPORTED_PLATFORM`

Your current platform isn't in the support matrix above, or the matching
platform package didn't get installed. If you install with `--no-optional` or
npm's `omit=optional` configured, optional dependencies are skipped and the
platform binary is missing — reinstall without those flags.

### `MAD_DOM_ABI_MISMATCH`

The native binary and the `mad-dom` package disagree on versions, usually from
a mixed-version install (a stale platform package left behind). Reinstalling
`mad-dom` pulls a matching pair:

```sh
bun add -d mad-dom@latest
```
