import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const root = resolve(import.meta.dir, "../../../..");
export const evidence = import.meta.dir;
export const reference = JSON.parse(readFileSync(join(evidence, "../baseline/reference-manifest.json"), "utf8"));
const commandDir = join(evidence, "commands");
mkdirSync(commandDir, { recursive: true });
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const save = (name, data) => writeFileSync(join(evidence, name), JSON.stringify(data, null, 2) + "\n");

// Invoke this recorder inside activity.py, so all descendants keep the same
// reservation until their synchronous parent exits. There are no detached jobs.
export function run(label, command, overrides = {}) {
  const ledgerPath = join(commandDir, "commands.json");
  let ledger;
  try { ledger = JSON.parse(readFileSync(ledgerPath, "utf8")); } catch { ledger = []; }
  const id = `${String(ledger.length + 1).padStart(3, "0")}-${label}`;
  const env = { ...process.env, RUSTUP_TOOLCHAIN: "1.93.1", CARGO_TARGET_DIR: join(root, "target"),
    MAD_DOM_NATIVE_PATH: join(root, "build/mad-dom.node"), MAD_DOM_FFI_PATH: join(root, "build/mad-dom.node"),
    MAD_DOM_FFI_DISABLED: "0", ...overrides };
  if (command[0].endsWith("/bun")) env.PATH = `${dirname(command[0])}:${process.env.PATH}`;
  const record = { id, label, command, cwd: root, started: new Date().toISOString(),
    env: Object.fromEntries(["PATH", "RUSTUP_TOOLCHAIN", "CARGO_TARGET_DIR", "MAD_DOM_NATIVE_PATH", "MAD_DOM_FFI_PATH", "MAD_DOM_FFI_DISABLED"].map(k => [k, env[k]])) };
  ledger.push(record);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`START ${id}: ${command.join(" ")}`);
  const stdoutFile = join(commandDir, `${id}.stdout.log`);
  const stderrFile = join(commandDir, `${id}.stderr.log`);
  const stdoutFd = openSync(stdoutFile, "wx"), stderrFd = openSync(stderrFile, "wx");
  let p;
  try {
    p = spawnSync(command[0], command.slice(1), { cwd: root, env, stdio: ["ignore", stdoutFd, stderrFd] });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  p.stdout = readFileSync(stdoutFile, "utf8");
  p.stderr = readFileSync(stderrFile, "utf8");
  for (const stream of ["stdout", "stderr"]) {
    const bytes = p[stream] ?? "";
    record[stream] = { file: `commands/${id}.${stream}.log`, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) };
  }
  Object.assign(record, { ended: new Date().toISOString(), exitCode: p.status, signal: p.signal, error: p.error?.message ?? null });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  console.log(`END ${id}: exit ${p.status}`);
  return { ...record, stdoutText: p.stdout, stderrText: p.stderr };
}

if (import.meta.main) {
  const [label, ...command] = process.argv.slice(2);
  const result = run(label, command);
  process.exit(result.exitCode ?? 1);
}
