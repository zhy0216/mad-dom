#!/usr/bin/env python3
"""Workflow-only shared build/test and exclusive measurement reservation."""
import argparse, datetime, fcntl, json, os, pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parent
p=argparse.ArgumentParser()
p.add_argument("--task",required=True)
p.add_argument("--kind",choices=["build-test","sampling"],required=True)
p.add_argument("--priority-integration",action="store_true",help="Coordinator only: queue one complete integration validation directly on the exclusive activity lock")
p.add_argument("command",nargs=argparse.REMAINDER)
a=p.parse_args()
cmd=a.command[1:] if a.command[:1]==["--"] else a.command
if not cmd: p.error("command required")
if a.priority_integration and a.kind != "sampling": p.error("integration validation requires an exclusive reservation")
def record(event, **extra):
    entry=dict(time=datetime.datetime.now(datetime.timezone.utc).isoformat(),task=a.task,kind=a.kind,event=event,pid=os.getpid(),cwd=os.getcwd(),command=cmd,load=os.getloadavg(),priorityIntegration=a.priority_integration,**extra)
    with open(root/"activity.jsonl","a") as out:
        fcntl.flock(out,fcntl.LOCK_EX)
        out.write(json.dumps(entry)+"\n")
        out.flush()
record("requested")
with open(root/"admission.lock","a") as admission, open(root/"activity.lock","a") as activity:
    # Integration joins the activity queue directly. The exclusive lock still
    # excludes every shared build/test and sampling holder. Existing campaigns
    # are never interrupted; new regular requests retain the turnstile.
    if not a.priority_integration: fcntl.flock(admission,fcntl.LOCK_EX)
    fcntl.flock(activity,fcntl.LOCK_EX if a.kind=="sampling" else fcntl.LOCK_SH)
    if a.kind=="build-test": fcntl.flock(admission,fcntl.LOCK_UN)
    record("granted")
    try:
        env = dict(os.environ)
        if a.priority_integration: env["MAD_DOM_COORDINATOR_GATE_HELD"]="1"
        r=subprocess.run(cmd,env=env)
        code=r.returncode
        record("released",exitCode=code)
    except BaseException as e:
        record("failed",error=str(e))
        raise
sys.exit(code if code>=0 else 128-code)
