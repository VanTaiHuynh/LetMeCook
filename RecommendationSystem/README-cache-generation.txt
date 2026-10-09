Legacy SBERT cache: immutable, explicit local provisioning

The active GPU hybrid index is independent of this compatibility cache. Its
model/hybrid/CURRENT.json, 1024-dimensional generations and Ollama weights are never
rewritten by a legacy migration, rebuild, add or removal.

Legacy cache layout
  model/legacy-sbert/CURRENT               atomic generation pointer
  model/legacy-sbert/<generation>/ids.json  exact ordered recipe IDs
  model/legacy-sbert/<generation>/embeddings.pt
  model/legacy-sbert/<generation>/manifest.json
  model/legacy-sbert/.writer.lock          shared publisher flock
  model/legacy-sbert/rebuild.lock          shared background-job single flight

Every generation binds count/order, float32/384 dimensions, full file SHA256
checksums and the exact encoder revision. Published files are read-only to the
service owner. Readers reject corrupt, incomplete or mismatched generations;
they never pair flat IDs and vectors from separate publications. Interrupted
publication leaves CURRENT on the previous complete generation.

All production publishers share the same filesystem lock. The complete rebuild
holds it BEFORE reading the public catalog; later add/remove operations apply to
the completed generation. Source edits replace an existing vector without
duplicating its ID. Readers retain the old generation while a rebuild runs.
Failed rebuilds record a safe error type and preserve the usable old generation.
The lock wait is bounded (LEGACY_CACHE_LOCK_WAIT_SECONDS, default30, range0..120).

Explicit migration of the original flat cache
  python -m src.embed_with_sbert --migrate-legacy --expected-count 10000

Run this in the freshly built recommendation image with the existing model
volume mounted writable and the normal local database environment. Migration
uses no encoder/model download. It validates the restricted primitive-string
pickle and finite384-dimensional tensor, rechecks the current anonymous public
catalog/demo policy, and drops IDs that are no longer public. The expected count
is checked BEFORE publication. Existing generations are not overwritten by a
second migration. Original recipe_ids.pkl and recipe_embeddings.pt remain
untouched; they are historical operator inputs, never implicitly served.

REBUILD_CACHE_ON_START=false and CACHE_AUTO_REBUILD=false are the defaults.
An explicit operator request to /pipeline/run or /cache/reload queues one
volume-wide background job and returns202. Duplicate job requests return the
existing job response. The synchronous CLI is python -m src.pipeline.
Startup must validate/provision BEFORE waiting for semantic service readiness:
  python -m src.cache_bootstrap --check --expected-count 10000
The default check is read-only, never imports a scheduler and never downloads or
rebuilds anything. Exit0 means a valid existing generation was reused. Exit3
means an operator must choose an explicit bootstrap action. For an existing flat
cache, choose --migrate-legacy --expected-count 10000. For an empty model volume,
first explicitly provision weights, then choose --build-legacy or --build-hybrid
with --expected-count 10000. These are operator maintenance choices; application
startup and ordinary requests do not make them automatically. Hybrid build uses
the local installed/pinned Ollama embedding model and resumable publication.

Pinned SBERT provisioning, only when an operator explicitly chooses downloading:
  python -c "from huggingface_hub import snapshot_download; snapshot_download('sentence-transformers/all-MiniLM-L6-v2', revision='1110a243fdf4706b3f48f1d95db1a4f5529b4d41', cache_dir='/app/model/huggingface/hub', allow_patterns=['*.json','*.txt','*.safetensors','README.md','LICENSE'])"
Run the command in the recommendation image with its model volume. It acquires
model files for later local inference; it is never called by runtime code or the
default cache check. Using an existing provisioned snapshot requires no network.
Deployment should build the recommendation image, run the selected explicit
bootstrap/check one-shot against the same model volume, then start --wait. Do not
wait for an empty recommendation cache and only afterward POST /cache/reload.

The pipeline uses temporary public-only source CSVs and deletes them after
success/failure. A standalone export is an explicit historical local artifact,
not an authorization cache. All export and add SQL uses the current public/demo
catalog gate. Adds recheck permission after encoding; reads invalidate revoked
IDs in the CURRENT generation before returning eligible vectors. Retired
immutable generations are private operator artifacts; their IDs never authorize
recipe exposure. Fresh authoritative public IDs and server hard filters still
gate both legacy and hybrid recommendations.

Pinned local SBERT
  model: sentence-transformers/all-MiniLM-L6-v2
  revision:1110a243fdf4706b3f48f1d95db1a4f5529b4d41
  dimension:384, CPU, batch default32
  expected cached snapshot:
    HF_HOME/hub/models--sentence-transformers--all-MiniLM-L6-v2/snapshots/<revision>
  SBERT_LOCAL_MODEL_PATH may identify that exact snapshot directory.

SentenceTransformer receives the local snapshot path with local_files_only=True.
Missing or incompatible weights return unavailable; requests and pipeline code
never silently download models. Provisioning/downloading is a separate explicit
operator action. Changing the model/revision requires a reviewed release and
rebuild rather than mixing old/new vector dimensions or encoders. Runtime CPU
threads remain the measured16/intra-op and1/inter-op configuration. Dependency
versions are captured in the completion report; deployment owns the lockfile.

Availability contract
  GET /health/live (also GET /):200 alive; no DB/model checks or matrix clones.
  GET /health/ready?capability=recommendation (default):200 ready or503;
    a validated selected index plus bounded current database access is required.
  capability=catalog: bounded local DB probe.
  capability=text or vision: independently installed local Ollama model.
  capability=voice: provisioned local Whisper dependency/files.
  capability=speech: the configured pinned Piper English voice or local eSpeak;
    Vietnamese fallback availability is explicitly reported.
  capability=planner: signing key, pinned text, validated index and current DB.
  Unknown capability:400. /ai/status retains aggregate status and adds independent
  capabilities; readiness means provisioned dependencies, not a quality benchmark.
  DB probes allow at most2s connect plus2s statement execution. Model inventory
  probes use2s each. /cache/info reports metadata without cloning vector matrices.
  Busy inference/publisher:429, Retry-After10. Invalid legacy generation or missing
  pinned model:503. Existing local queue/model HTTP deadlines remain bounded.
  Normal DB connections: default15s connect,30s statement timeout,5 connections,
  no overflow and5s pool wait. Bounded RECOMMENDATION_DB_* settings may override
  these values. Database failures return a static503 message without query data.

Exactly one inference process is required because admission/rate/priority state
is process-local. run_gunicorn.sh rejects RECOMMENDATION_WORKERS other than1.
gunicorn.conf.py on_starting rejects a configured worker count other than1.
Deploy with the wrapper or gunicorn -c /app/gunicorn.conf.py. Threads default8;
an operator may choose RECOMMENDATION_THREADS without increasing process count.

Tests run in a disposable image using read-only source, no network, no live
model/data volumes. They include checksums, revision/dimension/order rejection,
interrupted publication, competing rebuild/add/remove, cross-process locking,
shared background-job single flight, privacy invalidation, local-only loading,
failure recovery, independent readiness, status propagation and one-process
enforcement. Real deployment/migration is a separate explicit operator step.
