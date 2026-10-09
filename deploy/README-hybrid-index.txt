LetMeCook local hybrid retrieval index
Verified implementation/model sources: 2026-10-08

Encoder and representation
--------------------------
The new path uses local Ollama qwen3-embedding:0.6b,1024 dimensions, normalized
float32 vectors. It is separate from all-MiniLM-L6-v2/SBERT384 cache files.
No Python GPU Torch/Transformers dependency or shared Ollama setting is changed.
The model is provisioned explicitly by the operator; imports never pull/build.

Actual installed digest verified by the root runtime probe:
ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d

HYBRID_EMBED_MODEL defaults to qwen3-embedding:0.6b. This schema version only
accepts that tested model family/tag and1024 dimensions. HYBRID_EMBED_DIGEST can
pin the actual full SHA-256 digest above. Every API embedding call checks the
actual installed full digest before and after; a changed/missing model fails.
HYBRID_EMBED_TIMEOUT_SECONDS defaults90, validated5..180 seconds; metadata has
at most10 seconds per request. OLLAMA_URL must be HTTP loopback, with no path,
credentials, query, fragment, proxy forwarding or redirected remote endpoint.

Queries use the versioned English task instruction:
Instruct: Given a recipe request, retrieve relevant cooking recipes that match the requested dish and ingredients.
Query:{query}

Recipe documents are plain source text, with title/description, all ingredient
names, cuisine/category/source diet labels and a bounded directions excerpt.
Known cooking time is included;0/null remains unknown. Fractional source minutes
and servings are preserved, including Postgres Decimal values. Counts require
whole finite nonnegative values. The model never establishes allergy safety.
The embedding API uses context4096, dimensions1024, truncate:false, keep_alive5m.
Inputs are bounded; an oversized recipe fails instead of dropping ingredients.

Storage, publication and resume
-------------------------------
HYBRID_INDEX_DIR defaults to RECOMMENDATION_MODEL_DIR/hybrid (model/hybrid, which
is /app/model/hybrid in the container). The existing recommendation model volume
holds the index. No source CSV, SBERT vectors/IDs, prompts or profile are changed.

hybrid/
  writer.lock
  building/<full source+encoder fingerprint>/
    recipe_ids.json, documents.json, embeddings.npy, progress.json
  generations/<32-character generation UUID>/
    recipe_ids.json, documents.json, embeddings.npy, manifest.json, progress.json
  CURRENT.json

One writer obtains a nonblocking flock. The sorted public UUID order, documents,
actual model digest/settings and dimensionality determine the checkpoint key.
Each batch is validated, flushed/fsynced and committed with a vector checksum in
an atomically replaced progress record. Matching retries validate already
committed ranges/checksums and resume at the next row. Source/model changes start
a distinct staging key; source fingerprints include source ranking counters too.
An interruption leaves the last committed batch and old CURRENT usable. Readers
never inspect building/. --no-resume explicitly creates a separate fresh build.

Only a complete index receives a manifest containing encoder/model/digest/query
instruction/dimension, dtype/normalization, ordered-ID hash, document fingerprint,
count and individual file hashes. It is validated from disk, marked read-only and
activated by an atomic CURRENT.json replacement plus directory fsync. Readers
retain one immutable snapshot and reload when the pointer changes. Matrix loading
uses numpy allow_pickle:false and read-only mapping; generations are never edited.
Completed generations are retained for existing readers/rollback. There is no
automatic deletion or automatic10k rebuild at startup/import.

Explicit maintenance
---------------------
Inside a recommendation container containing the current source:

python -m src.build_hybrid_index --limit 10000 --expected-count 10000 --batch-size 16 --expected-digest ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d --dry-run

python -m src.build_hybrid_index --limit 10000 --expected-count 10000 --batch-size 16 --expected-digest ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d

The CLI queries the current public/demo-approved catalog directly in a read-only,
repeatable-read Postgres transaction; no private user/profile/history is fetched.
It checks the required count before embedding. Batch size is1..32, row bound is
1..50000. Progress output is numeric, not recipe/user text. Unexpected DB/driver
errors produce a static report rather than exposing exception credentials/data.
Retry the same command for matching committed checkpoints. A corrupted or older
prototype checkpoint without the batch checksum ledger requires --no-resume.

Online embeddings use the existing worker inference queue, including its capacity
and waiting/rate budget. Explicit offline builds use one sequential batch lane;
their separate maintenance process does not coordinate with the worker's
process-local queue. Run bulk builds during a quiet window and monitor actual
Ollama residency/latency; no global concurrency/VRAM settings are changed.

Reader/ranker API
-----------------
get_hybrid_snapshot(directory=None) -> HybridSnapshot or None if unavailable.
load_snapshot(directory=None) -> HybridSnapshot, raising HybridIndexError on a
missing/invalid/incompatible snapshot. hybrid_status() returns numerical/index
metadata only; ready means validated index files, not model/GPU readiness.

Snapshot exposes recipe_ids tuple, immutable documents/id_to_row/manifest maps,
read-only normalized embeddings[N,1024], vector_for_id(id), and
dense_search(queryvector,allowed_ids,limit<=200) returning(id,score) pairs.
Dense retrieval masks the current allowed IDs before dot products and top-k.
get_default_runtime().embed_query(query,expected_digest=manifest.encoder.digest,
expected_dimension=1024) returns a normalized1024-vector under the online queue.

The index is a source snapshot, never an authorization source. Every request must
obtain current SQL public/demo visibility and current authenticated exclusions,
hard ingredient/diet/time constraints BEFORE retrieval/seed features. Seed
visibility may be broader than the eligible recommendation candidate set, but
must independently be freshly authorized. A public-to-private change or withdrawn
distribution approval must remove an ID immediately despite any cached vectors.
Canonical recipe/API data remains the source for displayed recipes and credits.
No query/user-result/profile cache is persisted by these modules.

Validation and limits
---------------------
Full integrated worker suite:155 tests passed in an isolated source copy using
existing container libraries.17 new runtime/index tests cover instructions,
digest drift, malformed vectors, no pull/remote redirect, public-only/read-only
fetch, Postgres Decimal values, immutable/order/checksum integrity, changed source,
single writer, interrupted resume/batch corruption and live permission masks.
Ranker tests include the real HybridSnapshot1024-dimensional contract.
These authored fixtures are engineering tests, not measured recipe relevance.
The separate real-model smoke probe is small; full catalog build, end-to-end
quality, throughput and deployment verification are reported by root separately.

Primary sources
---------------
https://ollama.com/library/qwen3-embedding:0.6b
  Confirms the official0.6b Ollama model and /api/embed usage.
https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
  Official Qwen0.6B model card:1024 dimensions, instruction-prefixed queries,
  plain retrieval documents, multilingual model and Apache2.0 model license.
https://docs.ollama.com/api/embed
  Array inputs, dimensions, truncate:false, keep_alive and runtime options.
https://docs.ollama.com/api/tags
  Actual installed model names and full digest metadata.

Model licensing does not establish rights to redistribute recipe/image content.
This local index adds no distribution permission, expert approval or pilot facts.
