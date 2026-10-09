#!/usr/bin/env python3
"""Local release evidence, no product records or pilot results are synthesized.

Default checks are read-only. --inference runs labelled synthetic source-step
cases and bursts1/3/5 against the loopback worker. No prompt/audio is stored in
analytics; this test report includes only case IDs/outcomes/timings/model info.
"""
import argparse,concurrent.futures,datetime,json,statistics,time,re,unicodedata,hashlib
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
parser=argparse.ArgumentParser();parser.add_argument('--inference',action='store_true');parser.add_argument('--output',required=True);args=parser.parse_args()
def call(origin,path,body=None):
 start=time.monotonic();code=200
 try:
  with urlopen(Request(origin+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=150) as r:code=r.status;value=json.load(r)
 except HTTPError as e:
  code=e.code
  try:value=json.loads(e.read())
  except ValueError:value={}
 except (URLError,TimeoutError):code=0;value={'error':'Local endpoint unavailable or timed out'}
 return code,value,round(time.monotonic()-start,3)
worker='http://127.0.0.1:9501';web='http://127.0.0.1:9401';ollama='http://127.0.0.1:11434'
status=call(worker,'/ai/status');tags=call(ollama,'/api/tags')[1]
report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'label':'Technical synthetic evaluation; not user research or pilot evidence','runtime':status[1],'modelVersions':[{'name':m['name'],'digest':m.get('digest'),'size':m.get('size'),'quantization':m.get('details',{}).get('quantization_level')} for m in tags.get('models',[])],'readiness':[],'golden':[],'bursts':[]}
for name,origin,path in [('platform',web,'/api/platform/config'),('bounded catalog',web,'/api/recipes?page=0&size=2'),('speech',worker,'/ai/voice/status')]:
 code,value,seconds=call(origin,path);report['readiness'].append({'check':name,'status':code,'seconds':seconds,'passed':code==200})
if args.inference:
 corpusPath=Path(__file__).with_name('evaluation-corpus-v1.json');corpusRaw=corpusPath.read_bytes();corpus=json.loads(corpusRaw)
 report['corpusSha256']=hashlib.sha256(corpusRaw).hexdigest()
 cases=[(c['id'],c['split'],c['steps'],c['question'],c['supported']) for c in corpus['cook']]
 for identifier,split,steps,question,supported in cases:
  code,value,seconds=call(worker,'/ai/cook/ask',{'steps':steps,'stepIndex':0,'history':[],'question':question})
  citations=value.get('citations',[]);grounded=all(type(c.get('stepIndex'))is int and 0<=c['stepIndex']<len(steps) and c['text']==steps[c['stepIndex']] for c in citations)
  normalize=lambda text:re.sub(r'\s+',' ',unicodedata.normalize('NFKC',str(text)).casefold()).strip()
  extractive=bool(normalize(value.get('answer',''))) and any(normalize(value.get('answer','')) in normalize(c.get('text','')) for c in citations)
  passed=code==200 and value.get('supported')==supported and grounded and ((bool(citations) and extractive) if supported else not citations)
  report['golden'].append({'case':identifier,'split':split,'status':code,'seconds':seconds,'expectedSupported':supported,'actualSupported':value.get('supported'),'citationValid':grounded,'sourcePassageValid':extractive if supported else None,'passed':passed})
 # Same synthetic source request; measure admission and timed rejection, never fake user events.
 for size in [1,3,5]:
  body={'steps':['Bake for 20 minutes.'],'stepIndex':0,'history':[],'question':'How long should I bake?'}
  with concurrent.futures.ThreadPoolExecutor(max_workers=size) as executor:answers=list(executor.map(lambda _:call(worker,'/ai/cook/ask',body),range(size)))
  durations=[a[2] for a in answers];report['bursts'].append({'concurrency':size,'statuses':[a[0] for a in answers],'medianSeconds':round(statistics.median(durations),3),'maxSeconds':max(durations),'bounded':all(a[0] in [200,429] for a in answers)})
 report['runtimeAfter']=call(worker,'/ai/status')[1]
 report['loadedModelsAfter']=call(ollama,'/api/ps')[1]
report['passed']=all(item['passed'] for item in report['readiness']+report['golden']) and all(item['bounded'] for item in report['bursts'])
path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(report,indent=2)+'\n')
print('Local technical evaluation saved; passed='+str(report['passed']))
raise SystemExit(0 if report['passed'] else 1)
