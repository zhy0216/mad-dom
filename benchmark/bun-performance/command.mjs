// Serial command ledger. Full stdout/stderr are retained, including failures.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export function recordedCommand(directory, label, command, cwd, overrides = {}) {
  mkdirSync(directory, { recursive: true });
  const ledgerPath = join(directory, "commands.json");
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : [];
  const prefix = `${String(ledger.length + 1).padStart(3, "0")}-${label}`;
  const started = new Date().toISOString();
  const child = spawnSync(command[0], command.slice(1), {
    cwd, env: { ...process.env, ...overrides }, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const files = {};
  for (const stream of ["stdout", "stderr"]) {
    const content = child[stream] ?? "";
    const file = `${prefix}.${stream}.log`;
    writeFileSync(join(directory, file), content);
    files[stream] = { file, sha256: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content) };
  }
  const record = { label, command, cwd, overrides, started, ended: new Date().toISOString(),
    exitCode: child.status, signal: child.signal, error: child.error?.message ?? null, ...files };
  ledger.push(record);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  console.error(JSON.stringify(record));
  return record;
}

if (import.meta.main) {
  const [directory, label, cwd, executable, ...args] = process.argv.slice(2);
  if (!directory || !label || !cwd || !executable) throw new Error("command.mjs LOG_DIR LABEL CWD EXECUTABLE [ARGS...]");
  const image = join(resolve(cwd), "build/mad-dom.node");
  const record = recordedCommand(resolve(directory), label, [executable, ...args], resolve(cwd), {
    MAD_DOM_NATIVE_PATH: image, MAD_DOM_FFI_PATH: image, MAD_DOM_FFI_DISABLED: "0",
    PATH: `${dirname(executable)}:${process.env.PATH}`, RUSTUP_TOOLCHAIN: "1.93.1",
  });
  process.exitCode = record.exitCode === 0 && !record.signal && !record.error ? 0 : 1;
}
