import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { sourceManifest, fileIdentity } from '../../../../benchmark/bun-performance/provenance.mjs';
const evidence=import.meta.dir,root=resolve(evidence,'../../../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const frozen=JSON.parse(readFileSync(join(evidence,'../baseline/reference-manifest.json')));
const tracked=JSON.parse(readFileSync(join(evidence,'../baseline/reference-source-files.json')));
const actual=Object.fromEntries(Object.keys(tracked.files).sort().map(path=>[path,hash(readFileSync(join(tracked.root,path)))]));
assert.deepEqual(actual,tracked.files);assert.equal(hash(JSON.stringify(actual)),tracked.sha256);
const current=sourceManifest(root),reference=sourceManifest(frozen.source.root);
assert.equal(reference.productionSha256,frozen.source.productionSha256);
assert.equal(fileIdentity(frozen.artifact.path).sha256,frozen.artifact.sha256);
const campaignChecks=[];
for(const name of ['before-baseline','before-latest','after-baseline','after-latest','concurrency-baseline','concurrency-latest']) {
 const manifest=JSON.parse(readFileSync(join(evidence,name,'manifest.json')));
 assert.ok(manifest.finished);assert.equal(manifest.failed,false);assert.deepEqual(manifest.before,manifest.after);
 if(name.startsWith('after-')||name.startsWith('concurrency-')) assert.equal(manifest.after.candidate.productionSha256,current.productionSha256);
 for(const attempt of manifest.attempts) {assert.equal(attempt.exitCode,0);assert.ok(!attempt.error);}
 campaignChecks.push({name,attempts:manifest.attempts.length,unchanged:true});
}
for(const lane of ['baseline','latest']) {
 const commands=JSON.parse(readFileSync(join(evidence,`validation-${lane}.json`)));
 assert.equal(commands.length,9);assert.ok(commands.every(c=>c.exitCode===0));
 const runtime=JSON.parse(readFileSync(join(evidence,'commands',`verify-${lane}-1.stdout.log`)));
 // Keep the complete runtime report, including project ABI and observed paths.
 assert.equal(runtime.nodeApi.status,'available');assert.equal(runtime.ffi.status,'available');
 assert.equal(runtime.nodeApi.path,join(root,'build/mad-dom.node'));assert.equal(runtime.ffi.path,runtime.nodeApi.path);
 assert.equal(runtime.nodeApi.abiVersion,1);assert.equal(runtime.ffi.abiVersion,1);assert.equal(runtime.ffi.capabilities,31);
 assert.equal(runtime.bunVersion,frozen.runtimes[lane].version);assert.equal(runtime.bunRevision,frozen.runtimes[lane].revision);
 const specialized=readFileSync(join(evidence,'commands',`verify-${lane}-4.stderr.log`),'utf8');
 assert.ok(!/\d+ skip/.test(specialized));assert.match(specialized,/0 fail/);
 const host=readFileSync(join(evidence,'commands',`verify-${lane}-2.stderr.log`),'utf8');
 assert.ok(!/\d+ skip/.test(host));assert.match(host,/0 fail/);
}
const activity=readFileSync('/tmp/mad-dom-bun-native-performance-efaa64b/activity.jsonl','utf8');
writeFileSync(join(evidence,'activity.jsonl'),activity);
const commands=spawnSync('git',['status','--short'],{cwd:root,encoding:'utf8'});
const files={};
function inventory(dir) {for(const entry of readdirSync(dir,{withFileTypes:true})) {
 const path=join(dir,entry.name);if(entry.name==='build'||entry.name==='integrity.json'||entry.name==='file-hashes.json')continue;
 if(entry.isDirectory())inventory(path);else if(entry.isFile())files[path.slice(evidence.length+1)]=hash(readFileSync(path));
}}
inventory(evidence);writeFileSync(join(evidence,'file-hashes.json'),JSON.stringify(files,null,2)+'\n');
writeFileSync(join(evidence,'integrity.json'),JSON.stringify({checkedAt:new Date().toISOString(),referenceTrackedFiles:Object.keys(actual).length,
 referenceTrackedSha256:tracked.sha256,referenceProductionSha256:reference.productionSha256,currentProductionSha256:current.productionSha256,
 referenceImage:fileIdentity(frozen.artifact.path),candidateImage:fileIdentity(join(root,'build/mad-dom.node')),campaignChecks,gitStatus:commands.stdout},null,2)+'\n');
console.log('reference tracked files, production/images, campaign integrity and both validation lanes passed');
