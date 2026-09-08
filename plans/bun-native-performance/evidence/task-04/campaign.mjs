import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileIdentity, sourceManifest, systemLoad } from '../../../../benchmark/bun-performance/provenance.mjs';
const evidence = import.meta.dir, root = resolve(evidence, '../../../..');
const frozen = JSON.parse(readFileSync(join(evidence, '../baseline/reference-manifest.json')));
const [phase, lane] = process.argv.slice(2);
const out = join(evidence, `${phase}-${lane}`);
mkdirSync(out); // append-only; never overwrite an existing campaign
const bun = frozen.runtimes[lane].path;
assert.equal(fileIdentity(bun).sha256, frozen.runtimes[lane].sha256);
assert.equal(readFileSync(join(root,'.bun-version'),'utf8').trim(),frozen.runtimes.baseline.version);
const before = { reference: sourceManifest(frozen.source.root), candidate: sourceManifest(root),
  referenceImage: fileIdentity(frozen.artifact.path), candidateImage: fileIdentity(join(root,'build/mad-dom.node')), executable: fileIdentity(bun) };
assert.equal(before.reference.productionSha256, frozen.source.productionSha256);
assert.equal(before.referenceImage.sha256, frozen.artifact.sha256);
assert.notEqual(before.referenceImage.inode,before.candidateImage.inode);
if(phase==='before') assert.equal(before.candidate.files['scripts/checksums.mjs'],frozen.source.files['scripts/checksums.mjs']);
const prototype = join(evidence,'prototype');
if(phase==='concurrency') before.prototype = {source: fileIdentity(join(prototype,'scripts/checksums.mjs')),gate: fileIdentity(join(prototype,'js/facade/bun-host-io.js'))};
const comparisons = phase==='before' ? [{id:'io',A:{sourceRoot:frozen.source.root,mode:'fallback'},B:{sourceRoot:frozen.source.root,mode:'bun'}}]
 : ['bun','fallback'].map(mode=>({id:mode,A:{sourceRoot:phase==='concurrency'?root:frozen.source.root,mode},B:{sourceRoot:phase==='concurrency'?prototype:root,mode}}));
const manifest={phase,lane,started:new Date().toISOString(),before,comparisons,method:readFileSync(join(evidence,'method.md'),'utf8'),order:'ABBAABBA',runs:9,warmup:2,attempts:[]};
const save=()=>writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n'); save();
const med=xs=>{const s=xs.toSorted((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
const stats=xs=>({median:med(xs),p90:xs.toSorted((a,b)=>a-b)[Math.ceil(xs.length*.9)-1],mad:med(xs.map(x=>Math.abs(x-med(xs))))});
function summarize(attempts) {
 const rows=[];
 for(const id of Object.keys(attempts[0].report.results)) for(const window of ['internal','process']) {
  const values=a=>(window==='internal'?a.report.results[id].internal.samples:a.report.results[id].processSamples).filter(s=>!s.warmup).map(s=>s.elapsedMs);
  const sides=Object.fromEntries(['A','B'].map(side=>{const runs=attempts.filter(a=>a.side===side);const s=stats(runs.flatMap(values));return[side,{...s,processMedians:runs.map(a=>med(values(a))),processMedianStats:stats(runs.map(a=>med(values(a))))}];}));
  const groups=[0,1].map(group=>{const m=side=>med(attempts.filter(a=>a.group===group&&a.side===side).flatMap(values));return(m('B')/m('A')-1)*100;});
  const noise=Object.values(sides).some(s=>s.mad/s.median>.2||s.processMedianStats.mad/s.processMedianStats.median>.1)||(Math.min(...groups)<-5&&Math.max(...groups)>5);
  rows.push({id,window,...sides,changePercent:(sides.B.median/sides.A.median-1)*100,groups,noise,repeatRegression:groups.every(x=>x>5)});
 } return rows;
}
let failed=false;
for(const comparison of comparisons) {
 for(let batch=0;batch<2;batch++) {
  const attempts=[];
  for(const [index,side] of [...'ABBAABBA'].entries()) {
   const config={...comparison[side],bunExecutable:bun,runs:9,warmup:2};
   const command=[bun,join(root,'scripts/bench-bun-io.mjs'),'--checksum-worker',JSON.stringify(config)];
   const attempt={comparison:comparison.id,batch,index,side,group:Math.floor(index/4),config,command,before:systemLoad()};
   const child=spawnSync(command[0],command.slice(1),{cwd:root,env:{...process.env,MAD_DOM_NATIVE_PATH:join(config.sourceRoot,'build/mad-dom.node'),MAD_DOM_FFI_PATH:join(config.sourceRoot,'build/mad-dom.node')},encoding:'utf8',maxBuffer:128*1024*1024});
   Object.assign(attempt,{exitCode:child.status,signal:child.signal,stderr:child.stderr,after:systemLoad()});
   try {
    attempt.report=JSON.parse(child.stdout);
    assert.equal(child.status,0);assert.equal(attempt.report.runs,9);assert.equal(attempt.report.warmup,2);
    assert.equal(Object.keys(attempt.report.results).length,6);
    for(const result of Object.values(attempt.report.results)) {
     assert.equal(result.status,'measured');assert.equal(result.internal.runtime.executable,bun);
     assert.equal(result.internal.runtime.version,frozen.runtimes[lane].version);
     assert.equal(result.internal.runtime.revision,frozen.runtimes[lane].revision);
     assert.equal(result.internal.sourceRoot,config.sourceRoot);
     assert.deepEqual(Object.values(result.internal.capabilities),[config.mode==='bun',config.mode==='bun',config.mode==='bun']);
     for(const samples of [result.internal.samples,result.processSamples]) {
      assert.equal(samples.length,11);
      for(const [i,s] of samples.entries()) {assert.equal(s.round,i);assert.equal(s.warmup,i<2);assert.ok(Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0);assert.equal(s.validation.passed,true);assert.equal(s.validation.fingerprint,result.fixture.fingerprint);assert.equal(s.validation.checkedFiles,result.scenario.count);}
     }
    }
    if(attempts.length) for(const id of Object.keys(attempt.report.results)) assert.equal(attempt.report.results[id].fixture.fingerprint,attempts[0].report.results[id].fixture.fingerprint);
   }catch(error){attempt.error=String(error);attempt.stdout=child.stdout;failed=true;}
   const file=`${comparison.id}-${batch}-${index}-${side}.json`;writeFileSync(join(out,file),JSON.stringify(attempt)+'\n');manifest.attempts.push({file,exitCode:child.status,error:attempt.error});save();attempts.push(attempt);
   console.log(phase,lane,comparison.id,batch,index,side,child.status);
  }
  if(attempts.some(a=>a.error))break;
  const summary=summarize(attempts);writeFileSync(join(out,`${comparison.id}-${batch}-summary.json`),JSON.stringify(summary,null,2)+'\n');
  if(batch===0&&!summary.some(r=>r.noise||(phase!=='before'&&r.repeatRegression)))break;
 }
}
const after={reference:sourceManifest(frozen.source.root),candidate:sourceManifest(root),referenceImage:fileIdentity(frozen.artifact.path),candidateImage:fileIdentity(join(root,'build/mad-dom.node')),executable:fileIdentity(bun)};
if(phase==='concurrency') after.prototype = {source: fileIdentity(join(prototype,'scripts/checksums.mjs')),gate: fileIdentity(join(prototype,'js/facade/bun-host-io.js'))};
assert.deepEqual(after,before);manifest.after=after;manifest.finished=new Date().toISOString();manifest.failed=failed;save();if(failed)process.exitCode=1;
