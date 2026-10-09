"""CPU sentence embeddings, including safe startup with an empty database."""
import os
from pathlib import Path
import pickle
from functools import lru_cache
import argparse

if __name__ == "__main__":
    # The offline rebuild runs in a fresh interpreter, separately from the web
    # worker. Configure its thread pools before importing Torch or loading data.
    from src.runtime_threads import configure_cpu_threads
    configure_cpu_threads()

import pandas as pd
import torch
from src import legacy_cache_store as store


def model_dir():
    path = Path(os.getenv("RECOMMENDATION_MODEL_DIR", "model"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_data(path=None):
    path = path or Path(os.getenv("RECOMMENDATION_DATA_DIR", "data")) / "recipes_cleaned.csv"
    df = pd.read_csv(path)
    return df["id"].astype(str).tolist(), df["combined_text"].fillna("").tolist()


@lru_cache(maxsize=1)
def get_model():
    # Exact already-provisioned snapshot. Online/offline requests never download.
    from sentence_transformers import SentenceTransformer
    snapshot = local_model_snapshot()
    if not all((snapshot/name).is_file() for name in ('config.json','modules.json')) or not any(
        (snapshot/name).is_file() for name in ('model.safetensors','pytorch_model.bin')):
        raise store.ModelUnavailable('Pinned local SBERT weights are not provisioned.')
    try:
        return SentenceTransformer(str(snapshot),device='cpu',local_files_only=True)
    except Exception as error:
        raise store.ModelUnavailable('Pinned local SBERT weights could not be loaded.') from error


def local_model_snapshot():
    revision=store.revision()
    override=os.getenv('SBERT_LOCAL_MODEL_PATH')
    if override:
        path=Path(override)
        if path.name!=revision:raise store.ModelUnavailable('Local SBERT path must identify the pinned revision.')
        return path
    hub=Path(os.getenv('HF_HUB_CACHE',str(Path(os.getenv('HF_HOME',str(model_dir()/'huggingface')))/'hub')))
    return hub/'models--sentence-transformers--all-MiniLM-L6-v2'/'snapshots'/revision


def public_ids():
    from src.local_ai import public_catalog_ids
    return public_catalog_ids()


def embed_texts(texts):
    if not texts:
        return torch.empty((0, 384))
    batch_size = max(1, int(os.getenv("SBERT_BATCH_SIZE", "32")))
    return get_model().encode(texts, batch_size=batch_size, convert_to_tensor=True,
                              device="cpu", show_progress_bar=True).detach().cpu()


def save_embeddings(embeddings, ids, lineage=None):
    """Low-level trusted publisher; adapters below authorize source IDs first."""
    return store.publish(embeddings,ids,lineage)


def load_embeddings():
    return store.load()


def _authorized(ids,vectors,allowed):
    positions=[i for i,key in enumerate(ids) if key in allowed]
    return [ids[i] for i in positions], vectors[positions] if positions else torch.empty((0,store.DIMENSION))


def append_embedding(new_id, new_text):
    with store.writer_lock():
        allowed=public_ids()
        if new_id not in allowed:raise ValueError('Recipe is not available in the public catalog')
        ids,old_vecs=_authorized(*load_embeddings(),allowed)
        new_vec=embed_texts([new_text])[0]
        # Permission can change while the CPU encoder runs; recheck before publish.
        allowed=public_ids()
        if new_id not in allowed:raise ValueError('Recipe is no longer available in the public catalog')
        ids,old_vecs=_authorized(ids,old_vecs,allowed)
        if new_id in ids:
            new_vecs=old_vecs.clone();new_vecs[ids.index(new_id)]=new_vec
            updated_ids=ids
        else:
            new_vecs=new_vec.unsqueeze(0) if not ids else torch.cat([old_vecs,new_vec.unsqueeze(0)],dim=0)
            updated_ids=ids+[new_id]
        from src.artifact_lineage import incremental_lineage
        save_embeddings(new_vecs,updated_ids,incremental_lineage(store.current_lineage(),updated_ids,{new_id:new_text}))
        return new_vec


def remove_embeddings(removed_ids):
    with store.writer_lock():
        ids,embeddings=load_embeddings()
        keep_ids,new_vectors=_authorized(ids,embeddings,set(ids)-set(removed_ids))
        if keep_ids!=ids:
            from src.artifact_lineage import incremental_lineage
            save_embeddings(new_vectors,keep_ids,incremental_lineage(store.current_lineage(),keep_ids))


class _PrimitiveUnpickler(pickle.Unpickler):
    def find_class(self,module,name):
        raise store.CacheInvalid('Legacy IDs must contain only primitive strings, without executable pickle objects')


def migrate_legacy(expected_count=None):
    """Explicit, public-validated import; original flat files remain untouched."""
    with store.writer_lock():
        if store.generation_name() is not None:raise store.CacheInvalid('A generation is already published; migration will not overwrite it')
        root=model_dir()
        with (root/'recipe_ids.pkl').open('rb') as handle:ids=_PrimitiveUnpickler(handle).load()
        vectors=torch.load(root/'recipe_embeddings.pt',map_location='cpu',weights_only=True)
        store.validate(vectors,ids)
        ids,vectors=_authorized(ids,vectors,public_ids())
        if expected_count is not None and (not 0 <= expected_count <=50000 or len(ids)!=expected_count):
            raise store.CacheInvalid('Public legacy count does not match the explicit migration expectation')
        return {'generation':save_embeddings(vectors,ids),'count':len(ids),'dimension':store.DIMENSION}


def main():
    with store.writer_lock():
        ids,texts=load_data()
        # Do not trust a historical CSV after public/private or demo transitions.
        allowed=public_ids() if ids else set()
        pairs=[(i,t) for i,t in zip(ids,texts) if i in allowed]
        ids,texts=([p[0] for p in pairs],[p[1] for p in pairs])
        embeddings=embed_texts(texts)
        ids,embeddings=_authorized(ids,embeddings,public_ids() if ids else set())
        from src.artifact_lineage import input_lineage
        # Reconstruct exactly the authorized texts in their published order.
        texts_by_id=dict(pairs)
        save_embeddings(embeddings,ids,input_lineage(ids,[texts_by_id[key] for key in ids]))
        print(f"Saved public SBERT generation with {len(ids)} recipes")


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument('--migrate-legacy',action='store_true')
    parser.add_argument('--expected-count',type=int)
    args=parser.parse_args()
    if args.migrate_legacy:
        result=migrate_legacy(args.expected_count)
        print(f"Migrated {result['count']} currently public recipes, dimension {result['dimension']}")
    else:main()
