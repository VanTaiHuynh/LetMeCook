"""Semantic input lineage for new publications, without inventing old history."""
import hashlib
import json
from pathlib import Path

PREPROCESSING_VERSION='sbert-recipe-html-normalize.v2'
HYBRID_PREPROCESSING_VERSION='hybrid-public-recipe-representation.v1'


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()


def input_lineage(ids,texts):
    if len(ids)!=len(texts):raise ValueError('Input lineage requires aligned IDs and semantic texts')
    entries=[{'id':identifier,'textSha256':hashlib.sha256(text.encode()).hexdigest()} for identifier,text in zip(ids,texts)]
    module=Path(__file__).with_name('clean_data.py')
    return {'version':1,'historicalInputsKnown':True,
            'preprocessing':{'version':PREPROCESSING_VERSION,'moduleSha256':hashlib.sha256(module.read_bytes()).hexdigest()},
            'dataset':{'count':len(ids),'idOrderSha256':canonical_hash(list(ids)),
                       'semanticInputSha256':canonical_hash(entries),'inputs':entries,
                       'scope':'fresh-authorized-public-recipes'}}


def unknown_lineage(ids,reason='Historical embedding input and preprocessing were not recorded'):
    return {'version':1,'historicalInputsKnown':False,'reason':reason,
            'dataset':{'count':len(ids),'idOrderSha256':canonical_hash(list(ids))}}


def hybrid_lineage(documents):
    return {'version':1,'historicalInputsKnown':True,
            'preprocessing':{'version':HYBRID_PREPROCESSING_VERSION,
                'moduleSha256':hashlib.sha256(Path(__file__).with_name('hybrid_index.py').read_bytes()).hexdigest(),
                'descriptionExcerptChars':1200,'directionsExcerptChars':1800,'ingredientsTruncated':False},
            'dataset':{'count':len(documents),'semanticInputSha256':canonical_hash(documents),
                       'scope':'explicit-public-recipe-fields-before-embedding'}}


def incremental_lineage(previous,ids,new_texts=None):
    old=(previous or {}).get('dataset',{})
    known={item['id']:item for item in old.get('inputs',old.get('knownInputs',[]))}
    current_preprocessing={'version':PREPROCESSING_VERSION,'moduleSha256':hashlib.sha256(Path(__file__).with_name('clean_data.py').read_bytes()).hexdigest()}
    for identifier,item in known.items():
        known[identifier]={**item,'preprocessing':item.get('preprocessing',(previous or {}).get('preprocessing',{'version':'unknown'}))}
    for identifier,text in (new_texts or {}).items():
        known[identifier]={'id':identifier,'textSha256':hashlib.sha256(text.encode()).hexdigest(),'preprocessing':current_preprocessing}
    entries=[known[key] for key in ids if key in known]
    complete=len(entries)==len(ids)
    result=unknown_lineage(ids,'Some original embedding inputs were not recorded; incremental known inputs are preserved explicitly')
    result['historicalInputsKnown']=complete
    result['preprocessing']={'mode':'per-input-record','current':current_preprocessing}
    result['dataset'].update({'semanticInputSha256':canonical_hash(entries),
                              'inputs' if complete else 'knownInputs':entries})
    return result
