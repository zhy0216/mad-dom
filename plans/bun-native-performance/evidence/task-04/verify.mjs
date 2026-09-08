// Command sequence under the outer build-test reservation; no detached children.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const lane = process.argv[2];
const suffix = process.argv[3] ?? "";
const commands = [
 ['run','check'], ['run','report:runtime'],
 ['test','tests/bun/bun-host-io.test.js'],
 ['run','bench:bun-io:selftest'],
 ['test','tests/bun/native-loader.test.js','tests/bun/ffi-fast-path.test.js','tests/bun/ffi-memory.test.js'],
 ['run','bench:bun-native:selftest'],
 ['test','benchmark/dom-bench/report.test.js','benchmark/dom-bench/testing-worker.test.js'],
 ['run','compat:hdunit:rewrite'], ['run','validate'],
];
const toolchain=spawnSync('rustc',['--version'],{env:process.env,encoding:'utf8'});
writeFileSync(join(import.meta.dir,`toolchain-${lane}${suffix}.json`),JSON.stringify({command:['rustc','--version'],exitCode:toolchain.status,stdout:toolchain.stdout,stderr:toolchain.stderr},null,2)+'\n');
if(toolchain.status!==0 || !toolchain.stdout.startsWith('rustc 1.93.1 ')) throw new Error('unexpected Rust toolchain');
const results=[];
for (const [i,args] of commands.entries()) {
 const start=new Date().toISOString();
 const child=spawnSync(process.execPath,args,{env:process.env,encoding:'utf8',maxBuffer:128*1024*1024});
 const name=`verify-${lane}${suffix}-${i}`;
 writeFileSync(join(import.meta.dir,'commands',`${name}.stdout.log`),child.stdout);
 writeFileSync(join(import.meta.dir,'commands',`${name}.stderr.log`),child.stderr);
 results.push({runtime:{version:Bun.version,revision:Bun.revision},cwd:process.cwd(),env:{PATH:process.env.PATH,MAD_DOM_NATIVE_PATH:process.env.MAD_DOM_NATIVE_PATH,MAD_DOM_FFI_PATH:process.env.MAD_DOM_FFI_PATH,CARGO_TARGET_DIR:process.env.CARGO_TARGET_DIR},start,end:new Date().toISOString(),command:[process.execPath,...args],exitCode:child.status,signal:child.signal,stdout:`${name}.stdout.log`,stderr:`${name}.stderr.log`});
 writeFileSync(join(import.meta.dir,`validation-${lane}${suffix}.json`),JSON.stringify(results,null,2)+'\n');
 console.log(name,child.status);
 // Retain all failures and continue independent checks.
}
if(results.some(r=>r.exitCode!==0))process.exitCode=1;
if(lane==='baseline' && suffix==='') {
 const latest='/tmp/mad-dom-bun-performance-01/runtimes/latest/bun-linux-x64/bun';
 const command=[latest,import.meta.path,'latest'];
 const child=spawnSync(command[0],command.slice(1),{env:{...process.env,PATH:dirname(latest)+':'+process.env.PATH},encoding:'utf8',maxBuffer:128*1024*1024});
 writeFileSync(join(import.meta.dir,'validation-latest-launch.json'),JSON.stringify({command,exitCode:child.status,stdout:child.stdout,stderr:child.stderr},null,2)+'\n');
 console.log(child.stdout);console.error(child.stderr);
 if(child.status!==0)process.exitCode=1;
}

if(lane==='latest' && suffix==='') {
 const command=[process.execPath,join(import.meta.dir,'integrity.mjs')];
 const child=spawnSync(command[0],command.slice(1),{env:process.env,encoding:'utf8',maxBuffer:128*1024*1024});
 writeFileSync(join(import.meta.dir,'integrity-command.json'),JSON.stringify({command,exitCode:child.status,stdout:child.stdout,stderr:child.stderr},null,2)+'\n');
 console.log(child.stdout);console.error(child.stderr);
 if(child.status!==0)process.exitCode=1;
}
