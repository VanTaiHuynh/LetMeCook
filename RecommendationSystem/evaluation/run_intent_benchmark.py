"""Measure an authored corpus against an already provisioned LOCAL worker.

No weights, recipes or settings are changed. The report describes this labelled
engineering corpus only; it is not user research or a food-safety certification.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

GATES={'hardExclusionRecall':1.0,'sourceDietRecall':1.0,'explicitTimePreserved':1.0,
       'clarificationAccuracy':1.0,'fullIntentExact':0.85}


def loopback(value):
    parsed=urllib.parse.urlparse(value)
    if parsed.scheme!='http' or parsed.hostname not in {'127.0.0.1','localhost','::1'} or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
        raise ValueError('Evaluation requires a plain HTTP loopback worker origin')
    return value.rstrip('/')


def request(origin,path,body=None):
    raw=None if body is None else json.dumps(body,ensure_ascii=False).encode()
    req=urllib.request.Request(origin+path,data=raw,headers={'Content-Type':'application/json','X-Local-AI-Timeout-Ms':'150000'})
    try:
        with urllib.request.urlopen(req,timeout=180) as response:
            return response.status,json.loads(response.read(3000000))
    except urllib.error.HTTPError as error:
        return error.code,json.loads(error.read(3000000))
    except (urllib.error.URLError,TimeoutError,OSError,ValueError):
        return 503,{'message':'Local evaluation request failed.'}


def score_case(case,http_status,response):
    expected=case['expectedIntent'];actual=response.get('intent') or {}
    status=response.get('status','error')
    if http_status==422 and response.get('code')=='unsupported_diet':status='unsupported_diet'
    exclusions=set(expected['allergies']);diets=set(expected['dietaryPreferences'])
    actual_exclusions=set(actual.get('allergies',[]));actual_diets=set(actual.get('dietaryPreferences',[]))
    wanted=expected['maxCookingTime'];found=actual.get('maxCookingTime')
    time_kept=wanted is None or type(found) is int and 0<found<=wanted
    exact=all((set(actual.get(key,[]))==set(value) if isinstance(value,list) else actual.get(key)==value)
              for key,value in expected.items())
    if case['expectedStatus']=='unsupported_diet':exact=status=='unsupported_diet'
    return {'id':case['id'],'language':case['language'],'httpStatus':http_status,'status':status,
            'expectedStatus':case['expectedStatus'],'statusCorrect':status==case['expectedStatus'],
            'expectedExclusions':len(exclusions),'preservedExclusions':len(exclusions&actual_exclusions),
            'expectedDiets':len(diets),'preservedDiets':len(diets&actual_diets),
            'explicitTimeRequested':wanted is not None,'explicitTimePreserved':time_kept,
            'fullIntentExact':exact,'actualIntent':actual,'questionCount':len(response.get('clarification',{}).get('questions',[]))}


def aggregate(rows):
    def recall(numerator,denominator):
        total=sum(item[denominator] for item in rows)
        return sum(item[numerator] for item in rows)/total if total else 1.0
    timed=[item for item in rows if item['explicitTimeRequested']]
    clarification=[item for item in rows if item['expectedStatus']=='needs_clarification']
    return {'cases':len(rows),'hardExclusionRecall':recall('preservedExclusions','expectedExclusions'),
            'sourceDietRecall':recall('preservedDiets','expectedDiets'),
            'explicitTimePreserved':sum(item['explicitTimePreserved'] for item in timed)/len(timed) if timed else 1.0,
            'clarificationAccuracy':sum(item['statusCorrect'] and item['questionCount']<=2 for item in clarification)/len(clarification) if clarification else 1.0,
            'statusAccuracy':sum(item['statusCorrect'] for item in rows)/len(rows) if rows else 0,
            'fullIntentExact':sum(item['fullIntentExact'] for item in rows)/len(rows) if rows else 0}


def regression_gates(metrics,baseline=None):
    failures=[key for key,minimum in GATES.items() if metrics.get(key,0)<minimum]
    if baseline:
        failures += [key+'_regression' for key in GATES if metrics.get(key,0)+1e-9<baseline.get(key,0)]
    return {'passed':not failures,'thresholds':GATES,'failures':failures}


def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--worker-url',default='http://127.0.0.1:9501')
    parser.add_argument('--corpus',type=Path,default=Path(__file__).with_name('intent-en-vi.json'))
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--baseline',type=Path)
    parser.add_argument('--case-limit',type=int)
    parser.add_argument('--pause-seconds',type=float,default=2.1)
    args=parser.parse_args(argv)
    origin=loopback(args.worker_url)
    if not 0<=args.pause_seconds<=10:raise ValueError('Pause must be0..10 seconds')
    raw=args.corpus.read_bytes();corpus=json.loads(raw)
    cases=corpus['cases']
    if args.case_limit is not None:
        if not 1<=args.case_limit<=len(cases):raise ValueError('Case limit is invalid')
        cases=cases[:args.case_limit]
    status_code,metadata=request(origin,'/ai/status')
    text=metadata.get('capabilities',{}).get('text',{})
    if status_code!=200 or text.get('status')!='ready' or not text.get('digest'):
        raise RuntimeError('Pinned local text capability is not ready; provision it explicitly before evaluation')
    rows=[]
    for index,case in enumerate(cases):
        started=time.monotonic();code,response=request(origin,'/ai/search',{'prompt':case['prompt']})
        retries=0
        while code==429 and retries<2:
            time.sleep(10);retries+=1;code,response=request(origin,'/ai/search',{'prompt':case['prompt']})
        row=score_case(case,code,response);row['elapsedMs']=round((time.monotonic()-started)*1000)
        rows.append(row)
        if index+1<len(cases):time.sleep(args.pause_seconds)
    metrics=aggregate(rows)
    baseline=json.loads(args.baseline.read_text()).get('metrics') if args.baseline else None
    report={'schemaVersion':1,'corpusVersion':corpus['corpusVersion'],'corpusSha256':hashlib.sha256(raw).hexdigest(),
            'provenance':corpus['provenance'],'model':text['model'],'modelDigest':text['digest'],
            'contractVersion':metadata.get('contractVersion'),'promptVersion':metadata.get('promptVersion'),
            'metrics':metrics,'regressionGates':regression_gates(metrics,baseline),'cases':rows,
            'limitations':['Authored cases are not representative participant research.','This test measures constraint interpretation, not clinical allergy safety or recipe quality.'],
            'recipeWrites':0,'modelDownloads':0}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'gatesPassed':report['regressionGates']['passed'],'output':str(args.output)}))
    return 0 if report['regressionGates']['passed'] else 2


if __name__=='__main__':raise SystemExit(main())
