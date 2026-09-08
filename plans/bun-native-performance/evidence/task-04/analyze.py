import pathlib,json,statistics,math
root=pathlib.Path(__file__).resolve().parent
median=statistics.median
def stats(xs):
 return dict(median=median(xs),p90=sorted(xs)[math.ceil(len(xs)*.9)-1],mad=median(abs(x-median(xs)) for x in xs))
rows=[];tables=['# Task 04 complete checksum results\n','Positive change = B/A - 1. Before: A=fallback, B=Bun. After: A=frozen reference, B=one-scan candidate. Concurrency: A=one-scan sequential, B=measurement-only bounded prototype. Separate runtime and timing windows; no data omitted.\n']
for campaign in sorted(p for p in root.iterdir() if p.is_dir() and p.name.startswith(('before-','after-','concurrency-'))):
 m=json.loads((campaign/'manifest.json').read_text())
 if 'finished' not in m: continue
 for comp in m['comparisons']:
  attempts=[json.loads((campaign/a['file']).read_text()) for a in m['attempts'] if a['file'].startswith(comp['id']+'-')]
  assert all(a.get('error') is None and a['exitCode']==0 for a in attempts)
  tables += [f'\n## {campaign.name}: {comp["id"]}\n','| Workload / window | A median / p90 / MAD ms | B median / p90 / MAD ms | Change | All ABBA group changes |\n|---|---:|---:|---:|---|']
  for id in attempts[0]['report']['results']:
   for window in ['internal','process']:
    def samples(a):
     r=a['report']['results'][id];return r['internal']['samples'] if window=='internal' else r['processSamples']
    def values(aa):return [s['elapsedMs'] for a in aa for s in samples(a) if not s['warmup']]
    sides={side:[a for a in attempts if a['side']==side] for side in ['A','B']}
    groups=[]
    for batch in sorted(set(a['batch'] for a in attempts)):
     for group in [0,1]:
      g={s:median(values([a for a in aa if a['batch']==batch and a['group']==group])) for s,aa in sides.items()}
      groups.append((g['B']/g['A']-1)*100)
    st={s:stats(values(aa)) for s,aa in sides.items()};change=(st['B']['median']/st['A']['median']-1)*100
    memory={}
    for s,aa in sides.items():
     ss=[x for a in aa for x in a['report']['results'][id]['internal']['samples']]
     memory[s]={key:stats([x[key] if key=='maxRssBytes' else x['after'][key] for x in ss]) for key in ['maxRssBytes','rssBytes','heapUsedBytes']}
    row=dict(campaign=campaign.name,comparison=comp['id'],id=id,window=window,statistics=st,changePercent=change,groups=groups,memory=memory,processMedians={s:[median(values([a])) for a in aa] for s,aa in sides.items()},sampleCounts={s:len(values(aa)) for s,aa in sides.items()});rows.append(row)
    cell=lambda s:' / '.join(f'{st[s][k]:.4f}' for k in ['median','p90','mad'])
    tables.append(f'| {id} / {window} | {cell("A")} | {cell("B")} | {change:+.1f}% | '+', '.join(f'{g:+.1f}%' for g in groups)+' |')
(root/'combined.json').write_text(json.dumps(rows,indent=2)+'\n');(root/'tables.md').write_text('\n'.join(tables)+'\n')
for r in rows:
 if r['window']=='process':print(r['campaign'],r['comparison'],r['id'],round(r['changePercent'],1),[round(g,1) for g in r['groups']])
