// Direct children only; the coordinator-authorized outer activity gate owns
// the complete baseline/latest integration validation window.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileIdentity, sourceManifest } from '../../../../benchmark/bun-performance/provenance.mjs';

const evidence=import.meta.dir, root=resolve(evidence,'../../../..');
const selected=JSON.parse(readFileSync(join(evidence,'runtime-selection.json')));
const measured=JSON.parse(readFileSync(join(evidence,'after-latest/manifest.json')));
assert.equal(process.env.MAD_DOM_COORDINATOR_GATE_HELD,'1');
const before={source:sourceManifest(root),image:fileIdentity(join(root,'build/mad-dom.node'))};
assert.equal(before.source.productionSha256,measured.after.candidate.productionSha256);
assert.equal(before.image.sha256,measured.after.candidateImage.sha256);
const report={started:new Date().toISOString(),before,commands:[]};
const save=()=>writeFileSync(join(evidence,'rebase-validation.json'),JSON.stringify(report,null,2)+'\n');
save();
for(const lane of ['baseline','latest']) {
  const runtime=selected.runtimes[lane], bun=runtime.path;
  assert.equal(fileIdentity(bun).sha256,runtime.sha256);
  const env={...process.env,PATH:dirname(bun)+':'+process.env.PATH,
    MAD_DOM_NATIVE_PATH:before.image.path,MAD_DOM_FFI_PATH:before.image.path,
    CARGO_TARGET_DIR:join(root,'target')};
  for(const [label,args] of [['host-io',['test','tests/bun/bun-host-io.test.js']],['check',['run','check']]]) {
    const start=new Date().toISOString(), command=[bun,...args];
    const child=spawnSync(command[0],command.slice(1),{cwd:root,env,encoding:'utf8',maxBuffer:64*1024*1024});
    const name=`rebase-${lane}-${label}`;
    writeFileSync(join(evidence,'commands',`${name}.stdout.log`),child.stdout??'');
    writeFileSync(join(evidence,'commands',`${name}.stderr.log`),child.stderr??'');
    const record={lane,runtime,command,cwd:root,start,end:new Date().toISOString(),
      env:{PATH:env.PATH,MAD_DOM_NATIVE_PATH:env.MAD_DOM_NATIVE_PATH,MAD_DOM_FFI_PATH:env.MAD_DOM_FFI_PATH,CARGO_TARGET_DIR:env.CARGO_TARGET_DIR},
      exitCode:child.status,signal:child.signal,error:child.error?String(child.error):null,
      stdout:`commands/${name}.stdout.log`,stderr:`commands/${name}.stderr.log`};
    report.commands.push(record);save();
    console.log(name,child.status);
    if(label==='host-io') {
      record.noSkip=/0 fail/.test(child.stderr)&&!/\d+ skip/.test(child.stderr);
      record.expectedCount=/44 pass/.test(child.stderr)&&/513 expect\(\) calls/.test(child.stderr);
    }
    save();
  }
}
report.after={source:sourceManifest(root),image:fileIdentity(join(root,'build/mad-dom.node'))};
report.finished=new Date().toISOString();save();
assert.deepEqual(report.before,report.after);
assert.ok(report.commands.every(r=>r.exitCode===0&&!r.error&&r.noSkip!==false&&r.expectedCount!==false));
console.log('baseline/latest host IO and check passed; measured production source and image unchanged');
