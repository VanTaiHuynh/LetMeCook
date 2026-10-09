import os
import tempfile
from pathlib import Path


def run_pipeline(expected_count=None):
    from src.legacy_cache_store import writer_lock
    from src.download_from_supabase import export_recipes
    from src.clean_data import clean_and_export
    from src.embed_with_sbert import embed_texts,load_data,public_ids,save_embeddings,_authorized
    # The lock starts BEFORE reading the catalog. An add/remove waiting on a
    # rebuild applies to its completed generation rather than getting overwritten.
    with writer_lock(),tempfile.TemporaryDirectory(prefix='letmecook-public-export-') as folder:
        raw=Path(folder)/'recipes.csv';clean=Path(folder)/'recipes_cleaned.csv'
        exported=export_recipes(raw)
        if expected_count is not None and exported!=expected_count:
            raise ValueError('Public export count does not match explicit build expectation')
        clean_and_export(raw,clean)
        ids,texts=load_data(clean)
        vectors=embed_texts(texts)
        ids,vectors=_authorized(ids,vectors,public_ids() if ids else set())
        if expected_count is not None and len(ids)!=expected_count:
            raise ValueError('Public catalog changed before publication; expected count no longer matches')
        from src.artifact_lineage import input_lineage
        texts_by_id=dict(zip(*load_data(clean)))
        save_embeddings(vectors,ids,input_lineage(ids,[texts_by_id[key] for key in ids]))
    print('Public-only legacy generation published; temporary source text removed')


if __name__ == "__main__":
    from src.runtime_threads import configure_cpu_threads
    configure_cpu_threads()
    run_pipeline()
