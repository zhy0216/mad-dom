import { readFileSync, realpathSync, statSync, readdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fingerprint, sha256 } from "./protocol.mjs";

function git(root, args) {
  const p = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (p.status !== 0) throw new Error(`git read failed: ${p.stderr}`);
  return p.stdout.trim();
}
export function fileIdentity(path) {
  if (!isAbsolute(path)) throw new Error(`absolute path required: ${path}`);
  const actual = realpathSync(path);
  const s = statSync(actual);
  if (!s.isFile() || s.size === 0) throw new Error(`missing/empty file: ${path}`);
  return { path: actual, sha256: sha256(readFileSync(actual)), bytes: s.size, dev: s.dev, inode: s.ino };
}
export function sourceManifest(root) {
  root = realpathSync(root);
  const inputs = ["index.js", "index.d.ts", "js", "crates", "scripts", "benchmark/dom-bench",
    "package.json", "bun.lock", "Cargo.lock", "Cargo.toml", "rust-toolchain.toml", ".bun-version"];
  const list = flags => git(root, ["ls-files", "-z", ...flags, "--", ...inputs]).split("\0").filter(Boolean);
  // Hash current bytes, including a candidate's new helpers before git add.
  // Tracked deletions/read failures deliberately fail instead of disappearing.
  const untrackedProductionFiles = list(["--others", "--exclude-standard"]).sort();
  const paths = [...new Set([...list(["--cached"]), ...untrackedProductionFiles])].sort();
  const files = Object.fromEntries(paths.map(path => [path, sha256(readFileSync(join(root, path)))]));
  return { root, sourceSha: git(root, ["rev-parse", "HEAD"]), productionSha256: fingerprint(files), files,
    inventoryVersion: 2, productionInputs: inputs, untrackedProductionFiles,
    sourceShaMeaning: "Git HEAD anchor; it does not assert that current production files match that commit",
    productionSha256Meaning: "Digest of the sorted path-to-current-file-SHA256 map; tracked plus nonignored untracked production inputs",
    lockSha256: files["bun.lock"], domWorkloadSha256: fingerprint(Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("benchmark/dom-bench/")))) };
}
export function harnessManifest() {
  const files = Object.fromEntries(readdirSync(import.meta.dir).filter(p => p.endsWith(".mjs") || p.endsWith(".js"))
    .sort().map(p => [p, sha256(readFileSync(join(import.meta.dir, p)))]));
  return { root: import.meta.dir, sha256: fingerprint(files), files };
}
export function systemLoad() {
  const safe = p => { try { return readFileSync(p, "utf8").trim(); } catch { return null; } };
  const processes = spawnSync("ps", ["-eo", "pid,ppid,comm,pcpu,pmem", "--sort=-pcpu"], { encoding: "utf8" });
  return { at: new Date().toISOString(), loadavg: os.loadavg(), cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model, freeMemory: os.freemem(), totalMemory: os.totalmem(), kernel: os.release(),
    cpuPressure: safe("/proc/pressure/cpu"), memoryPressure: safe("/proc/pressure/memory"),
    cpuStat: safe("/proc/stat")?.split("\n").slice(0, 1),
    competingProcesses: processes.stdout?.split("\n").slice(0, 16) ?? [] };
}
