#!/usr/bin/env python3
"""Replay frozen synthetic quantity fixtures inside the existing local worker.
No live product database writes, user records, raw photos or pilot events.
"""
import argparse,hashlib,json,subprocess,datetime
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
corpus=Path(__file__).with_name('evaluation-corpus-v1.json');raw=corpus.read_bytes()
program='''import json,sys,time
from src.pantry import coverage
corpus=json.load(sys.stdin);results=[]
for case in corpus['coverage']:
 start=time.monotonic()
 try:
  actual=coverage(case['input']);failures=[]
  for path,expected in case['expected'].items():
   value=actual
   for part in path.split('.'):
    value=value[int(part)] if part.isdigit() else value[part]
   if value!=expected:failures.append({'path':path,'expected':expected,'actual':value})
  results.append({'case':case['id'],'split':case['split'],'passed':not failures,'failures':failures,'seconds':round(time.monotonic()-start,3)})
 except Exception as error:results.append({'case':case['id'],'split':case['split'],'passed':False,'error':type(error).__name__})
print(json.dumps(results))
'''
process=subprocess.run(['docker','exec','-i','letmecook-recommendation','python','-c',program],input=raw,capture_output=True)
if process.returncode:raise RuntimeError('Local corpus worker failed; inspect private local container diagnostics')
results=json.loads(process.stdout);report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'label':'Frozen authored technical quantity fixtures; not human baseline','corpusVersion':1,'corpusSha256':hashlib.sha256(raw).hexdigest(),'results':results,'passed':all(r['passed'] for r in results),'manualBaseline':None}
p=Path(args.output);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(report,indent=2)+'\n');print('Corpus replay passed='+str(report['passed']));raise SystemExit(0 if report['passed'] else 1)
