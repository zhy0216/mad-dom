import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runChecksumBenchmark } from '../../../../scripts/bench-bun-io.mjs';
import { sourceManifest, fileIdentity, systemLoad } from '../../../../benchmark/bun-performance/provenance.mjs';
const lane=process.argv[2], root=resolve(import.meta.dir,'../../../..');
const frozen=JSON.parse(readFileSync(join(import.meta.dir,'../baseline/reference-manifest.json')));
const results=[];
for(const [label,sourceRoot] of [['reference',frozen.source.root],['candidate',root],['prototype',join(import.meta.dir,'prototype')]]) for(const mode of ['bun','fallback']) {
 const before=systemLoad();
 const report=await runChecksumBenchmark({sourceRoot,mode,diagnostic:true,runs:1,warmup:0});
 results.push({label,sourceRoot,mode,before,after:systemLoad(),report,
  source:label==='prototype'?{checksum:fileIdentity(join(sourceRoot,'scripts/checksums.mjs')),gate:fileIdentity(join(sourceRoot,'js/facade/bun-host-io.js'))}:sourceManifest(sourceRoot),
  nativeImage:fileIdentity(join(sourceRoot,'build/mad-dom.node'))});
 writeFileSync(join(import.meta.dir,`audit-${lane}.json`),JSON.stringify(results,null,2)+'\n');
 for(const [id,r] of Object.entries(report.results)) {
  assert.equal(r.status,'measured');const c=r.internal.counts;
  assert.equal(c.scans,id.endsWith('verify')&&label==='reference'?r.scenario.count:1);
  assert.equal(c.inFlightFiles,0);assert.equal(c.inFlightBytes,0);
  assert.ok(c.maxInFlightFiles<=(label==='prototype'?2:1));
  assert.ok(c.maxInFlightBytes<=(label==='prototype'?8*1024*1024:r.scenario.fileSizeBytes));
  assert.equal(c.bunHashes,mode==='bun'?r.scenario.count:0);assert.equal(c.nodeHashes,mode==='fallback'?r.scenario.count:0);
 }
 console.log(label,mode,'audit passed');
}
