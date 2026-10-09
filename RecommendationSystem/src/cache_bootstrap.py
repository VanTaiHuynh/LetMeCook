"""Explicit pre-start cache validation/provisioning choice; default performs no writes."""
import argparse
import json
import os
from src.hybrid_index import get_hybrid_snapshot
from src import legacy_cache_store as store


def inspect_cache(expected_count=None):
    if os.getenv('RECOMMENDATION_ENGINE','hybrid-v2')!='legacy':
        snapshot=get_hybrid_snapshot()
        if snapshot is not None and (expected_count is None or len(snapshot.recipe_ids)==expected_count):
            return {'status':'ready','engine':'hybrid-v2','count':len(snapshot.recipe_ids),'dimension':snapshot.embeddings.shape[1]}
    try:
        ids,matrix=store.load()
        if ids and (expected_count is None or len(ids)==expected_count):
            return {'status':'ready','engine':'legacy-sbert','count':len(ids),'dimension':matrix.shape[1]}
    except (store.CacheInvalid,store.ModelUnavailable):pass
    return {'status':'needs_explicit_bootstrap','message':'No valid matching generation. Explicitly provision local weights, then choose migration or a build; requests never download models.'}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--check',action='store_true')
    modes.add_argument('--migrate-legacy',action='store_true')
    modes.add_argument('--build-legacy',action='store_true')
    modes.add_argument('--build-hybrid',action='store_true')
    parser.add_argument('--expected-count',type=int)
    parser.add_argument('--batch-size',type=int,default=16)
    args=parser.parse_args(argv)
    if args.expected_count is not None and not 1<=args.expected_count<=50000:
        parser.error('Expected count must be1..50000')
    if not 1<=args.batch_size<=32:parser.error('Batch size must be1..32')
    try:
        if args.migrate_legacy:
            from src.embed_with_sbert import migrate_legacy
            migrate_legacy(args.expected_count)
        elif args.build_legacy:
            from src.embed_with_sbert import get_model
            get_model() # Fail before exporting if the pinned local weights are absent.
            from src.pipeline import run_pipeline
            run_pipeline(expected_count=args.expected_count)
        elif args.build_hybrid:
            from src.embedding_runtime import OllamaEmbeddingRuntime
            from src.build_hybrid_index import fetch_public_documents
            from src.hybrid_index import build_index
            runtime=OllamaEmbeddingRuntime()
            encoder=runtime.metadata()
            rows=fetch_public_documents(args.expected_count or 10000)
            if args.expected_count is not None and len(rows)!=args.expected_count:
                raise ValueError('Current public catalog does not match expected count')
            build_index(rows,runtime,batch_size=args.batch_size,expected_digest=encoder['digest'])
        result=inspect_cache(args.expected_count)
        print(json.dumps(result))
        return 0 if result['status']=='ready' else 3
    except Exception as error:
        # Avoid outputting driver errors, environment contents or source records.
        print(json.dumps({'status':'needs_explicit_bootstrap','failureType':type(error).__name__,
                          'message':'Bootstrap failed; check provisioned local models, the public catalog and chosen explicit mode.'}))
        return 3


if __name__=='__main__':
    from src.runtime_threads import configure_cpu_threads
    configure_cpu_threads()
    raise SystemExit(main())
