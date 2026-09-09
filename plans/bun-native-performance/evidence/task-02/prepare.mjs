import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { root, evidence, reference, run, save, digest } from "./command.mjs";
import { sourceManifest, fileIdentity, harnessManifest } from "../../../../benchmark/bun-performance/provenance.mjs";
import { strict as assert } from "node:assert";

const baselineVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
assert.equal(baselineVersion, reference.runtimes.baseline.version);
const baseline = reference.runtimes.baseline.path;
assert.equal(fileIdentity(baseline).sha256, reference.runtimes.baseline.sha256);
const response = await fetch("https://api.github.com/repos/oven-sh/bun/releases/latest");
assert.equal(response.status, 200);
const release = await response.json();
save("latest-release.json", release);
const selected = release.assets.find(x => x.name === "bun-linux-x64.zip");
assert.ok(selected);
const directory = "/tmp/mad-dom-bun-performance-02/runtimes/latest";
mkdirSync(directory, { recursive: true });
const archive = join(directory, "bun-linux-x64.zip");
const download = await fetch(selected.browser_download_url);
assert.equal(download.status, 200);
const bytes = Buffer.from(await download.arrayBuffer());
if (selected.digest) assert.equal(`sha256:${digest(bytes)}`, selected.digest);
writeFileSync(archive, bytes);
assert.equal(run("latest-extract", ["unzip", "-o", archive, "-d", directory]).exitCode, 0);
const latest = join(directory, "bun-linux-x64/bun");
chmodSync(latest, 0o755);
const runtimes = {};
for (const [lane, path] of Object.entries({ baseline, latest })) {
  const result = run(`${lane}-identity`, [path, "-e", "console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,nodeApiRuntimeVersion:process.versions.napi}))"]);
  assert.equal(result.exitCode, 0);
  runtimes[lane] = { ...fileIdentity(path), ...JSON.parse(result.stdoutText) };
}
assert.equal(runtimes.baseline.version, baselineVersion);
assert.equal(`bun-v${runtimes.latest.version}`, release.tag_name);
save("runtimes.json", { queriedAt: new Date().toISOString(), endpoint: response.url, release: release.tag_name,
  publishedAt: release.published_at, archive: fileIdentity(archive), selectedUrl: selected.browser_download_url, baselineVersion, runtimes });
assert.equal(fileIdentity(reference.artifact.path).sha256, reference.artifact.sha256);
assert.equal(sourceManifest(reference.source.root).productionSha256, reference.source.productionSha256);
save("before.json", { at: new Date().toISOString(), candidate: sourceManifest(root), reference: sourceManifest(reference.source.root),
  referenceImage: fileIdentity(reference.artifact.path), harness: harnessManifest(),
  baselineEvidence: "../baseline/{method.md,findings.md,tables.md,combined.json,profiles.json}",
  note: "Production bytes captured before task-02 implementation; frozen reference is the before endpoint for every formal source comparison." });
for (const [label, args] of [["install", ["install", "--frozen-lockfile"]], ["before-build", ["run", "dev:build"]]]) {
  assert.equal(run(label, [baseline, ...args]).exitCode, 0);
}
save("before-image.json", fileIdentity(join(root, "build/mad-dom.node")));
