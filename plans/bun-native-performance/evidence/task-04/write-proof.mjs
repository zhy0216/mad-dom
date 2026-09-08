import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareChecksumFixture, validateChecksumFixture } from '../../../../scripts/bench-bun-io.mjs';
import { fileIdentity, sourceManifest } from '../../../../benchmark/bun-performance/provenance.mjs';
const root=resolve(import.meta.dir,'../../../..');
const frozen=JSON.parse(readFileSync(join(import.meta.dir,'../baseline/reference-manifest.json')));
const records=[];
for(const lane of ['baseline','latest']) for(const [label,sourceRoot] of [['reference',frozen.source.root],['candidate',root]]) {
 const bun=frozen.runtimes[lane].path, before=sourceManifest(sourceRoot);
 assert.equal(fileIdentity(bun).sha256,frozen.runtimes[lane].sha256);
 for(const mode of ['bun','fallback']) for(const state of ['missing','poisoned']) {
  const fixture=await prepareChecksumFixture({id:'write-proof',count:4,fileSizeBytes:4096});
  try {
   const noop=join(fixture.dir,'noop.mjs');
   const expected=`checksums: wrote 4 entry(ies) to ${fixture.manifest}\n`;
   writeFileSync(noop,`console.log(${JSON.stringify(expected.trimEnd())});\n`);
   const env={...process.env,PATH:dirname(bun)+':'+process.env.PATH,MAD_DOM_BUN_IO_DISABLED:mode==='bun'?'0':'1',MAD_DOM_NATIVE_PATH:join(sourceRoot,'build/mad-dom.node'),MAD_DOM_FFI_PATH:join(sourceRoot,'build/mad-dom.node')};
   for(const [implementation,script] of [['actual',join(sourceRoot,'scripts/checksums.mjs')],['noop',noop]]) {
    if(state==='missing')rmSync(fixture.manifest,{force:true});else writeFileSync(fixture.manifest,'incorrect manifest\n');
    const command=[bun,script,'generate',fixture.dir,'--out',fixture.manifest];
    const child=spawnSync(command[0],command.slice(1),{env,encoding:'utf8'});
    const record={lane,label,mode,state,implementation,command,exitCode:child.status,signal:child.signal,error:child.error?String(child.error):null,stdout:child.stdout,stderr:child.stderr,fixture,source:before,executable:fileIdentity(bun),nativeImage:fileIdentity(join(sourceRoot,'build/mad-dom.node')),timed:false};
    records.push(record);writeFileSync(join(import.meta.dir,'write-proof.json'),JSON.stringify(records,null,2)+'\n');
    assert.equal(child.status,0);assert.equal(child.stderr,'');assert.equal(child.stdout,expected);
    try {record.validation=await validateChecksumFixture(fixture);record.accepted=true;}catch(error){record.accepted=false;record.rejection=String(error);}
    writeFileSync(join(import.meta.dir,'write-proof.json'),JSON.stringify(records,null,2)+'\n');
    assert.equal(record.accepted,implementation==='actual');
   }
  } finally {rmSync(fixture.dir,{recursive:true,force:true});}
 }
 assert.deepEqual(sourceManifest(sourceRoot),before);
 console.log(lane,label,'missing/poisoned manifests: actual CLI accepted, no-op rejected in both modes');
}

// Run the new regression test on both selected runtimes under this same gate.
const tests=[];
for(const lane of ['baseline','latest']) {
 const bun=frozen.runtimes[lane].path;
 const command=[bun,'test','tests/bun/bun-host-io.test.js'];
 const env={...process.env,PATH:dirname(bun)+':'+process.env.PATH,MAD_DOM_NATIVE_PATH:join(root,'build/mad-dom.node'),MAD_DOM_FFI_PATH:join(root,'build/mad-dom.node')};
 const start=new Date().toISOString();
 const child=spawnSync(command[0],command.slice(1),{cwd:root,env,encoding:'utf8',maxBuffer:32*1024*1024});
 const name=`write-proof-${lane}-tests`;
 writeFileSync(join(import.meta.dir,'commands',`${name}.stdout.log`),child.stdout);
 writeFileSync(join(import.meta.dir,'commands',`${name}.stderr.log`),child.stderr);
 tests.push({lane,command,cwd:root,env:{PATH:env.PATH,MAD_DOM_NATIVE_PATH:env.MAD_DOM_NATIVE_PATH,MAD_DOM_FFI_PATH:env.MAD_DOM_FFI_PATH,CARGO_TARGET_DIR:env.CARGO_TARGET_DIR},start,end:new Date().toISOString(),exitCode:child.status,signal:child.signal,stdout:`commands/${name}.stdout.log`,stderr:`commands/${name}.stderr.log`,executable:fileIdentity(bun)});
 writeFileSync(join(import.meta.dir,'write-proof-tests.json'),JSON.stringify(tests,null,2)+'\n');
 console.log(name,child.status);
 assert.equal(child.status,0);assert.match(child.stderr,/0 fail/);assert.doesNotMatch(child.stderr,/\d+ skip/);
}
const command=[process.execPath,join(import.meta.dir,'integrity.mjs')];
const integrity=spawnSync(command[0],command.slice(1),{cwd:root,env:process.env,encoding:'utf8',maxBuffer:32*1024*1024});
writeFileSync(join(import.meta.dir,'integrity-command-write-proof.json'),JSON.stringify({command,exitCode:integrity.status,stdout:integrity.stdout,stderr:integrity.stderr},null,2)+'\n');
console.log(integrity.stdout);assert.equal(integrity.status,0);
