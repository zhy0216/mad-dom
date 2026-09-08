import datetime, json, os, pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parent
lane,kind,label,*args=sys.argv[1:]
bin=f'/tmp/mad-dom-bun-performance-01/runtimes/{lane}/bun-linux-x64/bun'
env=dict(os.environ, PATH=str(pathlib.Path(bin).parent)+':'+os.environ['PATH'], MAD_DOM_NATIVE_PATH=str(pathlib.Path.cwd()/'build/mad-dom.node'), MAD_DOM_FFI_PATH=str(pathlib.Path.cwd()/'build/mad-dom.node'), CARGO_TARGET_DIR=str(pathlib.Path.cwd()/'target'))
cmd=['python3','/tmp/mad-dom-bun-native-performance-efaa64b/activity.py','--task','04','--kind',kind,'--',bin,*args]
record=dict(start=datetime.datetime.now(datetime.timezone.utc).isoformat(),command=cmd,cwd=str(pathlib.Path.cwd()),env={k:env[k] for k in ['PATH','MAD_DOM_NATIVE_PATH','MAD_DOM_FFI_PATH','CARGO_TARGET_DIR']})
out=root/'commands'; out.mkdir(exist_ok=True); n=len(list(out.glob('*.json')))+1; prefix=f'{n:03}-{lane}-{label}'
with (out/(prefix+'.stdout.log')).open('w') as so,(out/(prefix+'.stderr.log')).open('w') as se:
 r=subprocess.run(cmd,env=env,stdout=so,stderr=se)
record.update(end=datetime.datetime.now(datetime.timezone.utc).isoformat(),exitCode=r.returncode,stdout=prefix+'.stdout.log',stderr=prefix+'.stderr.log'); (out/(prefix+'.json')).write_text(json.dumps(record,indent=2)+'\n'); print(prefix,r.returncode,flush=True); sys.exit(r.returncode)
