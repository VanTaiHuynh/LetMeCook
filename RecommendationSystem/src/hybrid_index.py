"""Immutable, checksummed public recipe snapshots, separate from SBERT caches."""
from dataclasses import dataclass
from decimal import Decimal
from datetime import datetime, timezone
from functools import lru_cache
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
from types import MappingProxyType
from uuid import UUID, uuid4

import numpy as np

from src.embedding_runtime import DIMENSION, MODEL, QUERY_INSTRUCTION, canonical_digest, EmbeddingRuntimeError

SCHEMA_VERSION = 1
MAX_RECIPES = 50000
FILES = ("recipe_ids.json", "documents.json", "embeddings.npy")


class HybridIndexError(RuntimeError):
    pass


def index_directory():
    return Path(os.getenv("HYBRID_INDEX_DIR", str(Path(os.getenv("RECOMMENDATION_MODEL_DIR", "model")) / "hybrid")))


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _hash_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_bytes(path, value):
    with path.open("xb") as handle:
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _replace_json(path, value):
    temporary = path.with_name("." + path.name + "-" + uuid4().hex)
    try:
        _write_bytes(temporary, _json_bytes(value))
        temporary.replace(path)
        _fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    return value


def _uuid(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as error:
        raise HybridIndexError("Recipe IDs must be UUIDs") from error


def prepare_documents(rows):
    """Whitelist public recipe fields; never serialize profiles, prompts or history."""
    documents = []
    for row in rows:
        if len(documents) >= MAX_RECIPES:
            raise HybridIndexError("Public index exceeds its 50000-recipe bound")
        if row.get("is_public") is not True:
            raise HybridIndexError("Only explicitly public recipe records can be indexed")
        document = {"id": _uuid(row.get("id"))}
        for key in ("title", "description", "directions"):
            value = row.get(key) or ""
            if not isinstance(value, str) or len(value) > 60000:
                raise HybridIndexError("Recipe text is invalid or exceeds its bound")
            document[key] = value
        if not document["title"].strip():
            raise HybridIndexError("Public recipe title is required")
        for key in ("ingredients", "cuisines", "categories", "dietaryPreferences"):
            values = row.get(key) or []
            if not isinstance(values, (list, tuple)) or len(values) > 200:
                raise HybridIndexError("Recipe source lists are invalid or too long")
            if any(not isinstance(value, str) or not value.strip() or len(value) > 300 for value in values):
                raise HybridIndexError("Recipe source list values are invalid")
            document[key] = list(dict.fromkeys(value.strip() for value in values))
        for key in ("cookingTime", "servings", "viewCount", "ratingCount"):
            value = row.get(key)
            value = 0 if value is None else value
            if isinstance(value, bool) or not isinstance(value, (int, float, Decimal, np.integer, np.floating)):
                raise HybridIndexError("Recipe numeric fields are invalid")
            number = float(value)
            if not np.isfinite(number) or not 0 <= number <= 2147483647:
                raise HybridIndexError("Recipe numeric fields are invalid")
            if key in {"viewCount", "ratingCount"} and not number.is_integer():
                raise HybridIndexError("Recipe counters must be whole numbers")
            document[key] = int(number) if number.is_integer() else number
        rating_value = row.get("ratingAverage")
        rating_value = 0 if rating_value is None else rating_value
        if isinstance(rating_value, bool) or not isinstance(rating_value, (int, float, Decimal, np.integer, np.floating)):
            raise HybridIndexError("Recipe rating average is invalid")
        rating = float(rating_value)
        if not np.isfinite(rating) or not 0 <= rating <= 5:
            raise HybridIndexError("Recipe rating average is invalid")
        document["ratingAverage"] = rating
        # Soft retrieval representation: all listed ingredient names, bounded
        # description/direction excerpts. Hard filters always use fresh SQL.
        ingredients = "; ".join(document["ingredients"])
        parts = [document["title"], "Description: " + document["description"][:1200],
                 "Ingredients: " + ingredients,
                 "Cuisines: " + ", ".join(document["cuisines"]),
                 "Meal categories: " + ", ".join(document["categories"]),
                 "Source dietary labels: " + ", ".join(document["dietaryPreferences"]),
                 "Directions excerpt: " + document["directions"][:1800]]
        if document["cookingTime"] > 0:
            parts.append(f"Cooking time: {document['cookingTime']} minutes")
        document["text"] = "\n".join(parts)
        if len(document["text"]) > 12000:
            raise HybridIndexError("Recipe embedding text exceeds its bound; do not silently truncate ingredients")
        documents.append(document)
    documents.sort(key=lambda item: item["id"])
    if len({item["id"] for item in documents}) != len(documents):
        raise HybridIndexError("Duplicate public recipe IDs")
    if not documents:
        raise HybridIndexError("Cannot publish an empty public recipe index")
    return documents


@dataclass(frozen=True)
class HybridSnapshot:
    manifest: object
    recipe_ids: tuple
    documents: object
    embeddings: np.ndarray
    id_to_row: object

    def vector_for_id(self, recipe_id):
        index = self.id_to_row.get(str(recipe_id))
        return None if index is None else self.embeddings[index]

    def dense_search(self, queryvector, allowed_ids, limit=200):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
            raise HybridIndexError("Dense retrieval limit must be between 1 and 200")
        vector = np.asarray(queryvector, dtype=np.float32)
        if vector.shape != (DIMENSION,) or not np.isfinite(vector).all():
            raise HybridIndexError("Dense query vector has an incompatible dimension or invalid numbers")
        norm = np.linalg.norm(vector.astype(np.float64))
        if not np.isfinite(norm) or norm <= 1e-12:
            raise HybridIndexError("Dense query vector is empty")
        # Permission intersection happens BEFORE scoring and candidate truncation.
        ids = sorted(set(map(str, allowed_ids)) & self.id_to_row.keys())
        if not ids:
            return []
        positions = [self.id_to_row[recipe_id] for recipe_id in ids]
        scores = self.embeddings[positions] @ (vector / norm)
        order = np.argsort(-scores, kind="stable")[:limit]
        return [(ids[int(index)], float(scores[index])) for index in order]


def build_index(rows, runtime, directory=None, batch_size=16, expected_digest=None, progress=None, resume=True):
    """Build beside the live generation; only the final atomic pointer activates it."""
    if isinstance(batch_size, bool) or not isinstance(batch_size, int) or not 1 <= batch_size <= 32:
        raise HybridIndexError("Index embedding batch size must be between 1 and 32")
    directory = Path(directory) if directory is not None else index_directory()
    directory.mkdir(parents=True, exist_ok=True)
    generations = directory / "generations"
    generations.mkdir(exist_ok=True)
    pending = directory / "building"
    pending.mkdir(exist_ok=True)
    with (directory / "writer.lock").open("a+b") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise HybridIndexError("Another hybrid index build is already active") from error
        pointer_temporary = None
        try:
            documents = prepare_documents(rows)
            encoder = runtime.metadata(expected_digest)
            if (encoder.get("model") != MODEL or encoder.get("dimension") != DIMENSION or
                    encoder.get("queryInstruction") != QUERY_INSTRUCTION):
                raise HybridIndexError("Encoder contract cannot be mixed with this index version")
            encoder["digest"] = canonical_digest(encoder.get("digest"))
            ids = [document["id"] for document in documents]
            ids_hash = hashlib.sha256(_json_bytes(ids)).hexdigest()
            fingerprint = hashlib.sha256(_json_bytes(documents)).hexdigest()
            resume_key = hashlib.sha256(_json_bytes({"schemaVersion": SCHEMA_VERSION,
                "encoder": encoder, "documentFingerprint": fingerprint, "idsSha256": ids_hash})).hexdigest()
            staging = pending / (resume_key if resume else resume_key + "-" + uuid4().hex)
            if staging.is_symlink():
                raise HybridIndexError("Hybrid checkpoint cannot be a symlink")
            if staging.exists():
                try:
                    checkpoint = json.loads((staging / "progress.json").read_text(encoding="utf-8"))
                    generation, completed = checkpoint["generation"], checkpoint["completed"]
                    if (checkpoint.get("resumeKey") != resume_key or checkpoint.get("count") != len(ids) or
                            not re.fullmatch(r"[0-9a-f]{32}", generation) or isinstance(completed, bool) or
                            not isinstance(completed, int) or not 0 <= completed <= len(ids) or
                            _hash_file(staging / "recipe_ids.json") != ids_hash or
                            _hash_file(staging / "documents.json") != fingerprint):
                        raise HybridIndexError("Hybrid checkpoint source/IDs/progress mismatch")
                    vectors = np.load(staging / "embeddings.npy", mmap_mode="r+", allow_pickle=False)
                    if vectors.dtype != np.float32 or vectors.shape != (len(ids), DIMENSION):
                        raise HybridIndexError("Hybrid checkpoint matrix is incompatible")
                    committed = vectors[:completed]
                    if (not np.isfinite(committed).all() or not np.allclose(
                            np.linalg.norm(committed.astype(np.float64), axis=1), 1, atol=1e-4)):
                        raise HybridIndexError("Hybrid checkpoint committed vectors failed validation")
                    position = 0
                    batches = checkpoint.get("batches", [])
                    if not isinstance(batches, list) or len(batches) > len(ids):
                        raise HybridIndexError("Hybrid checkpoint batch ledger is invalid")
                    for batch in batches:
                        end = batch.get("end")
                        if (batch.get("start") != position or isinstance(end, bool) or not isinstance(end, int)
                                or not position < end <= completed or
                                batch.get("sha256") != hashlib.sha256(
                                    np.ascontiguousarray(vectors[position:end]).tobytes()).hexdigest()):
                            raise HybridIndexError("Hybrid checkpoint committed batch checksum failed")
                        position = end
                    if position != completed:
                        raise HybridIndexError("Hybrid checkpoint committed batch ranges do not match progress")
                except (OSError, ValueError, KeyError, TypeError) as error:
                    raise HybridIndexError("Hybrid checkpoint is invalid; use an explicit fresh build") from error
            else:
                generation, completed = uuid4().hex, 0
                staging.mkdir()
                _write_bytes(staging / "recipe_ids.json", _json_bytes(ids))
                _write_bytes(staging / "documents.json", _json_bytes(documents))
                vectors = np.lib.format.open_memmap(staging / "embeddings.npy", mode="w+", dtype=np.float32,
                                                    shape=(len(documents), DIMENSION))
                vectors.flush()
                with (staging / "embeddings.npy").open("rb") as handle:
                    os.fsync(handle.fileno())
                checkpoint = {"generation": generation, "resumeKey": resume_key,
                              "count": len(ids), "completed": 0, "batches": []}
                _replace_json(staging / "progress.json", checkpoint)
                _fsync_directory(pending)
            if progress and completed:
                progress(completed, len(documents))
            for offset in range(completed, len(documents), batch_size):
                batch = documents[offset:offset + batch_size]
                encoded = runtime.embed_documents([document["text"] for document in batch],
                                                    expected_digest=encoder["digest"], online=False)
                if encoded.shape != (len(batch), DIMENSION) or not np.isfinite(encoded).all():
                    raise HybridIndexError("Index batch returned an incompatible embedding matrix")
                norms = np.linalg.norm(encoded.astype(np.float64), axis=1)
                if np.any(norms <= 1e-12) or not np.allclose(norms, 1, atol=1e-4):
                    raise HybridIndexError("Index batch embeddings must be normalized nonzero vectors")
                vectors[offset:offset + len(batch)] = encoded
                vectors.flush()
                with (staging / "embeddings.npy").open("rb") as handle:
                    os.fsync(handle.fileno())
                checkpoint["completed"] = offset + len(batch)
                checkpoint["batches"].append({"start": offset, "end": offset + len(batch),
                    "sha256": hashlib.sha256(np.ascontiguousarray(vectors[offset:offset + len(batch)]).tobytes()).hexdigest()})
                _replace_json(staging / "progress.json", checkpoint)
                if progress:
                    progress(min(offset + len(batch), len(documents)), len(documents))
            vectors.flush()
            del vectors
            with (staging / "embeddings.npy").open("rb") as handle:
                os.fsync(handle.fileno())
            # Verify the actual model did not change while the snapshot was built.
            runtime.metadata(encoder["digest"])
            manifest = {"schemaVersion": SCHEMA_VERSION, "generation": generation,
                "createdAt": datetime.now(timezone.utc).isoformat(), "encoder": encoder,
                "catalog": {"count": len(ids), "idOrder": "uuid-ascending",
                    "idsSha256": ids_hash, "documentFingerprint": fingerprint,
                    "publicSnapshotOnly": True, "permissionsMustBeRechecked": True},
                "files": {name: _hash_file(staging / name) for name in FILES}}
            from src.artifact_lineage import hybrid_lineage
            manifest['lineage']=hybrid_lineage(documents)
            manifest_bytes = _json_bytes(manifest)
            _replace_json(staging / "manifest.json", manifest)
            _fsync_directory(staging)
            final = generations / generation
            staging.rename(final)
            _fsync_directory(generations)
            _fsync_directory(pending)
            # Validate from the on-disk files BEFORE activation; a failed build
            # leaves both the current hybrid pointer and legacy SBERT untouched.
            snapshot = _load_generation(str(directory.resolve()), generation,
                                        hashlib.sha256(manifest_bytes).hexdigest())
            for path in final.iterdir():
                path.chmod(0o444)
            final.chmod(0o555)
            pointer_temporary = directory / (".CURRENT-" + generation)
            _write_bytes(pointer_temporary, _json_bytes({"generation": generation,
                         "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest()}))
            pointer_temporary.replace(directory / "CURRENT.json")
            pointer_temporary = None
            _fsync_directory(directory)
            return snapshot
        finally:
            # Interrupted/failed batches retain their committed checkpoint. A
            # later matching explicit build resumes; readers ignore building/.
            if pointer_temporary is not None:
                pointer_temporary.unlink(missing_ok=True)
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


@lru_cache(maxsize=2)
def _load_generation(directory, generation, manifest_hash):
    if not re.fullmatch(r"[0-9a-f]{32}", generation) or not re.fullmatch(r"[0-9a-f]{64}", manifest_hash):
        raise HybridIndexError("Hybrid pointer contains an invalid generation or checksum")
    root = Path(directory) / "generations" / generation
    if root.is_symlink():
        raise HybridIndexError("Hybrid generation cannot be a symlink")
    for name in (*FILES, "manifest.json"):
        if not (root / name).is_file() or (root / name).is_symlink():
            raise HybridIndexError("Hybrid snapshot files are missing or unsafe")
    if _hash_file(root / "manifest.json") != manifest_hash:
        raise HybridIndexError("Hybrid manifest checksum failed")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    encoder, catalog = manifest.get("encoder", {}), manifest.get("catalog", {})
    if (manifest.get("schemaVersion") != SCHEMA_VERSION or manifest.get("generation") != generation or
            encoder.get("provider") != "ollama" or encoder.get("numCtx") != 4096 or
            encoder.get("model") != MODEL or encoder.get("dimension") != DIMENSION or
            encoder.get("queryInstruction") != QUERY_INSTRUCTION or encoder.get("documentFormatVersion") != 1 or
            encoder.get("dtype") != "float32" or encoder.get("normalized") is not True or
            catalog.get("publicSnapshotOnly") is not True or catalog.get("permissionsMustBeRechecked") is not True):
        raise HybridIndexError("Hybrid snapshot encoder/schema/public-catalog contract failed")
    canonical_digest(encoder.get("digest"))
    if any(_hash_file(root / name) != manifest.get("files", {}).get(name) for name in FILES):
        raise HybridIndexError("Hybrid snapshot file checksum failed")
    ids = json.loads((root / "recipe_ids.json").read_text(encoding="utf-8"))
    documents = json.loads((root / "documents.json").read_text(encoding="utf-8"))
    if (not isinstance(ids, list) or not 1 <= len(ids) <= MAX_RECIPES or
            ids != sorted(set(ids)) or any(_uuid(recipe_id) != recipe_id for recipe_id in ids) or
            not isinstance(documents, list) or [document.get("id") for document in documents] != ids or
            catalog.get("count") != len(ids) or
            catalog.get("idsSha256") != hashlib.sha256(_json_bytes(ids)).hexdigest() or
            catalog.get("documentFingerprint") != hashlib.sha256(_json_bytes(documents)).hexdigest()):
        raise HybridIndexError("Hybrid snapshot IDs/order/catalog fingerprint failed")
    vectors = np.load(root / "embeddings.npy", mmap_mode="r", allow_pickle=False)
    if vectors.dtype != np.float32 or vectors.shape != (len(ids), DIMENSION) or not np.isfinite(vectors).all():
        raise HybridIndexError("Hybrid vector dtype/dimension/row count/finite-value validation failed")
    if not np.allclose(np.linalg.norm(vectors.astype(np.float64), axis=1), 1, atol=1e-4):
        raise HybridIndexError("Hybrid vectors are not normalized")
    vectors.flags.writeable = False
    return HybridSnapshot(_freeze(manifest), tuple(ids),
                          _freeze({document["id"]: document for document in documents}), vectors,
                          _freeze({recipe_id: index for index, recipe_id in enumerate(ids)}))


def load_snapshot(directory=None):
    directory = Path(directory) if directory is not None else index_directory()
    try:
        pointer_path = directory / "CURRENT.json"
        if pointer_path.is_symlink() or pointer_path.stat().st_size > 4096:
            raise HybridIndexError("Hybrid pointer is unsafe or oversized")
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        snapshot = _load_generation(str(directory.resolve()), pointer["generation"], pointer["manifestSha256"])
        configured_model = os.getenv("HYBRID_EMBED_MODEL", MODEL)
        configured_pin = os.getenv("HYBRID_EMBED_DIGEST")
        if snapshot.manifest["encoder"]["model"] != configured_model:
            raise HybridIndexError("Published index model does not match configured encoder")
        if configured_pin and snapshot.manifest["encoder"]["digest"] != canonical_digest(configured_pin):
            raise HybridIndexError("Published index digest does not match configured pin")
        return snapshot
    except (OSError, ValueError, KeyError, TypeError, AttributeError, EmbeddingRuntimeError) as error:
        raise HybridIndexError("Hybrid index is unavailable or invalid") from error


def get_hybrid_snapshot(directory=None):
    try:
        return load_snapshot(directory)
    except HybridIndexError:
        return None


def hybrid_status(directory=None):
    snapshot = get_hybrid_snapshot(directory)
    if snapshot is None:
        return {"state": "unavailable", "count": 0, "model": MODEL, "dimension": DIMENSION}
    encoder, catalog = snapshot.manifest["encoder"], snapshot.manifest["catalog"]
    return {"state": "ready", "count": catalog["count"], "model": encoder["model"],
            "dimension": encoder["dimension"], "digest": encoder["digest"],
            "generation": snapshot.manifest["generation"], "fingerprint": catalog["documentFingerprint"]}
