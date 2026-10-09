"""Bounded independent readiness probes. Liveness must never call this module."""
import os
from sqlalchemy import create_engine,text
from sqlalchemy.pool import NullPool

from src import local_ai
from src.database import get_engine

CAPABILITIES={'recommendation','text','vision','voice','speech','catalog','planner'}


def catalog_probe(count=False):
    # Reuse the configured URL, but do not inherit the regular15s connection
    # timeout. This pool-free probe spends <=2s connecting plus<=2s querying.
    engine=None
    try:
        source=get_engine()
        try:url=source.url
        finally:source.dispose()
        engine=create_engine(url,connect_args={'timeout':2},poolclass=NullPool)
        with engine.begin() as connection:
            connection.execute(text("SET LOCAL statement_timeout = '2000ms'"))
            statement='SELECT count(*) FROM public.recipe r WHERE '+local_ai.public_catalog_clause() if count else 'SELECT 1'
            value=connection.execute(text(statement)).scalar()
            return {'status':'ready',**({'count':int(value)} if count else {})}
    except Exception:
        return {'status':'unavailable','reason':'catalog_unavailable'}
    finally:
        if engine is not None:engine.dispose()


def models_probe():
    try:
        from src.ai_transport import model_pin
        metadata=local_ai._ollama('/api/tags',timeout=2)
        result={}
        for name,model in [('text',local_ai.TEXT_MODEL),('vision',local_ai.VISION_MODEL)]:
            try:result[name]={'status':'ready',**model_pin(model,metadata)}
            except Exception:result[name]={'status':'unavailable','model':model,'reason':'model_pin_unavailable_or_mismatch'}
        return result
    except Exception:
        return {name:{'status':'unavailable','reason':'local_model_service_unavailable'} for name in ('text','vision')}


def recommendation_probe():
    from src.hybrid_index import hybrid_status
    from src.cache_manager import get_cache
    from src import legacy_cache_store
    hybrid=hybrid_status()
    if os.getenv('RECOMMENDATION_ENGINE','hybrid-v2')!='legacy' and hybrid.get('state')=='ready':
        return {'status':'ready','engine':'hybrid-v2','count':hybrid['count'],'dimension':hybrid['dimension']}
    try:
        cache=get_cache()
        if legacy_cache_store.generation_name()!=cache._generation:cache._load_cache()
        info=cache.get_cache_info()
        if info['recipe_count'] and not info['generation_error']:
            return {'status':'ready','engine':'legacy-sbert','count':info['recipe_count'],'dimension':384}
    except Exception:pass
    return {'status':'unavailable','reason':'recommendation_index_unavailable'}


def cache_diagnostics(cache):
    """Snapshot metadata only; never clone matrices or query author profiles."""
    from src.hybrid_index import hybrid_status
    info=cache.get_cache_info()
    hybrid=hybrid_status()
    use_hybrid=hybrid.get('state')=='ready' and os.getenv('RECOMMENDATION_ENGINE','hybrid-v2')!='legacy'
    usable_legacy=bool(info.get('recipe_count')) and not info.get('generation_error')
    return {'cache_info':info,'embedding_shape':[info['recipe_count'],384] if info['recipe_count'] else [0],
            'system_status':'healthy' if use_hybrid or usable_legacy else 'unavailable',
            'recommendation_engine':'hybrid-v2' if use_hybrid else 'legacy-fallback',
            'hybrid_index':hybrid}


def voice_probe():
    from src.local_voice import status
    value=status()
    return {'voice':value['stt'],'speech':value['tts']}


def planner_probe():
    if len(os.getenv('MEAL_PLANNER_SIGNING_KEY',''))<32:
        return {'status':'unavailable','reason':'planner_signing_key_unavailable'}
    if models_probe()['text']['status']!='ready':
        return {'status':'unavailable','reason':'planner_text_model_unavailable'}
    if recommendation_probe()['status']!='ready' or catalog_probe()['status']!='ready':
        return {'status':'unavailable','reason':'planner_catalog_or_index_unavailable'}
    return {'status':'ready','contractVersion':'local-ai.v2','candidateLimit':300,'measuredCandidateLimit':60}


def ready(capability='recommendation'):
    if capability not in CAPABILITIES:raise ValueError('Unknown readiness capability')
    if capability=='recommendation':
        value=recommendation_probe()
        database=catalog_probe()
        if database['status']!='ready':value={'status':'unavailable','reason':'catalog_unavailable'}
    elif capability=='catalog':value=catalog_probe()
    elif capability in ('text','vision'):value=models_probe()[capability]
    elif capability=='planner':value=planner_probe()
    else:value=voice_probe()[capability]
    return {'local':True,'capability':capability,**value}


def status():
    from src.inference_queue import queue
    capabilities=models_probe()
    database=catalog_probe(count=True)
    capabilities['catalog']=database
    capabilities['recommendation']=recommendation_probe()
    capabilities['planner']=planner_probe()
    voice=voice_probe()
    capabilities.update(voice)
    gpu=[]
    try:
        gpu=[{'name':m['name'],'vramBytes':m.get('size_vram',0),'totalBytes':m.get('size',0)}
             for m in local_ai._ollama('/api/ps',timeout=2).get('models',[])]
    except Exception:pass
    from src.ai_config import CONTRACT_VERSION,PROMPT_VERSION
    return {'local':True,'contractVersion':CONTRACT_VERSION,'promptVersion':PROMPT_VERSION,'models':{'text':local_ai.TEXT_MODEL,'vision':local_ai.VISION_MODEL},
            'status':'ready' if all(v['status']=='ready' for v in capabilities.values()) else 'partial',
            'capabilities':capabilities,'catalogSize':database.get('count'),
            'voice':{'local':True,'stt':voice['voice'],'tts':voice['speech']},
            'gpu':gpu,'inferenceQueue':queue.status()}
