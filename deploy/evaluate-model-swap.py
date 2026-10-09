#!/usr/bin/env python3
"""Loopback-only technical text/vision switching benchmark, no product writes.
Original recipe photo is inspected locally; no photo/data sent to cloud.
Only fixture hashes, bounded timing, response schema and model placement recorded.
"""
import argparse,base64,datetime,hashlib,json,time,struct,zlib
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
p=argparse.ArgumentParser();p.add_argument('--image',required=True);p.add_argument('--output',required=True);args=p.parse_args()
photo=Path(args.image).read_bytes()
assert len(photo)<=5*1024*1024

def call(origin,path,body=None):
 start=time.monotonic()
 try:
  with urlopen(Request(origin+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'}),timeout=180) as response:
   return response.status,json.load(response),round(time.monotonic()-start,3)
 except HTTPError as error:
  try:result=json.loads(error.read())
  except ValueError:result={}
  return error.code,result,round(time.monotonic()-start,3)
 except (URLError,TimeoutError):return 0,{},round(time.monotonic()-start,3)
worker='http://127.0.0.1:9501';ollama='http://127.0.0.1:11434'
def state():
 return {'queue':call(worker,'/ai/status')[1].get('inferenceQueue'), 'placement':call(ollama,'/api/ps')[1]}
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
white=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',32,32,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff'*96)*32))+chunk(b'IEND',b'')
text={'steps':['Bake for 20 minutes.'],'stepIndex':0,'history':[],'question':'How long should I bake?'}
sequence=[('text-initial','/ai/cook/ask',text),('vision-original-photo','/ai/vision',{'imageBase64':base64.b64encode(photo).decode()}),('vision-warm-original-photo','/ai/vision',{'imageBase64':base64.b64encode(photo).decode()}),('vision-holdout-no-food','/ai/vision',{'imageBase64':base64.b64encode(white).decode()}),('text-after-vision','/ai/cook/ask',text)]
report={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'label':'Technical sequential benchmark; no human visual accuracy or pilot claim','originalPhotoSha256':hashlib.sha256(photo).hexdigest(),'holdoutBlankSha256':hashlib.sha256(white).hexdigest(),'initial':state(),'sequence':[]}
for identifier,path,body in sequence:
 before=state();code,result,seconds=call(worker,path,body);after=state()
 if '/vision' in path:
  observations=result.get('observations');schema=isinstance(observations,list) and result.get('requiresConfirmation') is True and result.get('local') is True and all(set(item)=={'name','confidence'} and item['confidence'] in {'high','medium','low'} for item in observations)
  correct=(observations==[]) if identifier=='vision-holdout-no-food' else None
 else:schema=result.get('supported') is True and bool(result.get('citations'));correct=None
 report['sequence'].append({'case':identifier,'status':code,'error':result.get('error') if code!=200 else None,'seconds':seconds,'schemaValid':schema,'noFoodHoldoutPassed':correct,'before':before,'after':after,'passed':code==200 and schema and correct is not False})
report['passed']=all(row['passed'] for row in report['sequence']);out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print('Text/vision technical benchmark passed='+str(report['passed']));raise SystemExit(0 if report['passed'] else 1)
