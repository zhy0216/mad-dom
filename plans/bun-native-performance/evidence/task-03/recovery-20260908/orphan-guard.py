import fcntl,pathlib,json,datetime,os,time
root=pathlib.Path(__file__).parent
pid=2280568
proc=pathlib.Path('/proc')/str(pid)
def identity():
 try:return (proc/'stat').read_text().split()[21]
 except OSError:return None
original=identity()
with (root/'admission.lock').open('a') as admission,(root/'activity.lock').open('a') as activity:
 fcntl.flock(admission,fcntl.LOCK_EX)
 fcntl.flock(activity,fcntl.LOCK_EX)
 record={'started':datetime.datetime.now(datetime.timezone.utc).isoformat(),'guardPid':os.getpid(),'orphanPid':pid,'orphanStartTicks':original,'reason':'Original agent and gate wrapper exited; existing formal campaign survived. Protect unchanged running process; retain original lock gap and interruption records.'}
 (root/'orphan-guard.json').write_text(json.dumps(record,indent=2)+'\n')
 print(json.dumps(record),flush=True)
 while original is not None and identity()==original:
  if (proc/'stat').read_text().split()[2]=='Z':break
  time.sleep(5)
 record['ended']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 (root/'orphan-guard.json').write_text(json.dumps(record,indent=2)+'\n')
 print(json.dumps(record),flush=True)
