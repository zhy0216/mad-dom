// Runs inside the EXACT process executing the original DOM worker or hotspot worker.
// No counters or profiling hooks are installed in formal timing processes.
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { fileIdentity, sourceManifest } from "./provenance.mjs";

export const config = JSON.parse(process.env.MAD_DOM_PERFORMANCE_CONFIG ?? "null");
if (!config) throw new Error("missing benchmark config");
const { root, image, ffi, bun } = config;
assert.equal(realpathSync(process.execPath), bun.path, "unexpected Bun executable");
assert.equal(process.env.MAD_DOM_NATIVE_PATH, image.path);
assert.equal(process.env.MAD_DOM_FFI_PATH, image.path);
assert.equal(process.env.MAD_DOM_FFI_DISABLED, ffi === "on" ? "0" : "1");
assert.equal(fileIdentity(image.path).sha256, image.sha256, "native artifact changed");
assert.equal(fileIdentity(bun.path).sha256, bun.sha256, "Bun executable changed");
export const fromRoot = p => import(pathToFileURL(join(root, p)).href);
export const loader = await fromRoot("js/native-loader.js");
export const native = loader.loadNative();
const { runtimeObservation } = await fromRoot("js/runtime-metadata.js");
const runtime = runtimeObservation();
assert.equal(runtime.nodeApi.status, "available");
assert.equal(realpathSync(runtime.nodeApi.path), image.path, "unexpected npm/other-worktree native fallback");
assert.equal(runtime.nodeApi.abiVersion, 1);
assert.ok(runtime.bunVersion && runtime.bunRevision && runtime.platform.platform && runtime.platform.arch);
assert.equal(runtime.bunVersion, bun.version);
assert.equal(runtime.bunRevision, bun.revision);
assert.equal(runtime.ffi.status, ffi === "on" ? "available" : "disabled", "unexpected FFI fallback");
const document = native.createDocument();
try {
  const binding = loader.ffiForDocument(document);
  if (ffi === "on") {
    assert.equal(runtime.ffi.abiVersion, 1);
    assert.equal(runtime.ffi.capabilities, 31);
    assert.equal(realpathSync(runtime.ffi.path), image.path);
    assert.ok(binding, "same-image document binding failed");
    for (const method of ["querySnapshot", "childSnapshot", "preorderSnapshot", "serialize", "createElements", "readBatch"]) {
      assert.equal(typeof binding.adapter[method], "function", `missing FFI ${method}`);
    }
    const rootToken = document.createElementToken("section");
    const handle = document.materializeNodeToken(rootToken);
    handle.setInnerHTML('<span>你好 🦀</span>');
    const query = binding.adapter.querySnapshot(binding.context, rootToken, "span");
    assert.equal(query.length, 3);
    assert.equal(new TextDecoder().decode(binding.adapter.serialize(binding.context, rootToken, 1)), handle.innerHTML());
  } else assert.equal(binding, null);
} finally { document.destroy(); }
const source = sourceManifest(root);
assert.equal(source.productionSha256, config.source.productionSha256, "source changed during run");
const metadata = { runtime, executable: fileIdentity(process.execPath), source: {
  root, sourceSha: source.sourceSha, productionSha256: source.productionSha256,
  domWorkloadSha256: source.domWorkloadSha256, lockSha256: source.lockSha256 },
  artifact: fileIdentity(runtime.nodeApi.path), overrides: {
    MAD_DOM_NATIVE_PATH: process.env.MAD_DOM_NATIVE_PATH, MAD_DOM_FFI_PATH: process.env.MAD_DOM_FFI_PATH,
    MAD_DOM_FFI_DISABLED: process.env.MAD_DOM_FFI_DISABLED },
  libc: process.report?.getReport?.().header?.glibcVersionRuntime ?? null,
  rustToolchain: readFileSync(join(root, "rust-toolchain.toml"), "utf8").trim(),
  handshake: "passed real document query + full UTF-8 serialization; same Node-API/FFI image" };
writeFileSync(config.metadataPath, JSON.stringify(metadata, null, 2) + "\n");
