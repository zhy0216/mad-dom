import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const manifest=JSON.parse(readFileSync(join(import.meta.dir,'../baseline/reference-manifest.json')));
const commands=[['latest','campaign.mjs','after','latest'],['baseline','campaign.mjs','concurrency','baseline'],
 ['latest','campaign.mjs','concurrency','latest'],['baseline','audit.mjs','baseline'],['latest','audit.mjs','latest']];
const ledger=[];
for(const [lane,script,...args] of commands) {
 const command=[manifest.runtimes[lane].path,join(import.meta.dir,script),...args];
 const start=new Date().toISOString();const result=spawnSync(command[0],command.slice(1),{env:process.env,encoding:'utf8',maxBuffer:128*1024*1024});
 console.log(command.join(' '),result.status);console.log(result.stdout);console.error(result.stderr);
 ledger.push({command,start,end:new Date().toISOString(),exitCode:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr});
 writeFileSync(join(import.meta.dir,'remaining-sampling.json'),JSON.stringify(ledger,null,2)+'\n');
}
const analysisCommand=['python3',join(import.meta.dir,'analyze.py')];
const analysis=spawnSync(analysisCommand[0],analysisCommand.slice(1),{encoding:'utf8'});
ledger.push({command:analysisCommand,exitCode:analysis.status,stdout:analysis.stdout,stderr:analysis.stderr});
writeFileSync(join(import.meta.dir,'remaining-sampling.json'),JSON.stringify(ledger,null,2)+'\n');
console.log(analysis.stdout);console.error(analysis.stderr);
if(ledger.some(r=>r.exitCode!==0))process.exitCode=1;
