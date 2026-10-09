Local worker v2: explicit, versioned, bounded

The HTTP compatibility facade src/local_ai.py delegates to ai_transport,
ai_intent, ai_catalog and ai_vision. Immutable validated SearchIntent,
VisionObservation and TasteContext objects form the domain boundaries; the
existing wire mappings remain compatible. Public search adds local-ai.v2 and
status=results. No module downloads models during startup or ordinary requests.

Provisioned text and vision identity
LOCAL_AI_TEXT_MODEL and LOCAL_AI_VISION_MODEL identify dedicated operator
aliases. LOCAL_AI_TEXT_DIGEST and LOCAL_AI_VISION_DIGEST must contain the exact
64-character installed Ollama digest. Each chat verifies the alias against
/api/tags before inference; missing/mismatched identity yields503. Model names
and hashes are operator configuration, not guesses based on a mutable tag.
Readiness exposes these identities. Local Ollama transport remains HTTP
loopback only, keep_alive=5m, temperature0 and bounded structured streaming.
Dependency lockfile, provisioning and actual model tests belong to deployment.

Deadline and cancellation
The gateway may supply X-Local-AI-Timeout-Ms (1000..180000, default150000),
X-Local-AI-Request-Id (UUID), and X-Local-AI-Cancel-Token (random URL-safe32..128
characters, with the UUID). POST /ai/requests/{UUID}/cancel accepts cancelToken.
Only its SHA256 is held in memory; the registry is removed when work finishes.
Cancellation returns499/request_cancelled; elapsed deadline returns504/
deadline_exceeded. Busy admission returns429/Retry-After10. The separate cancel
route never joins its target queue or registers a duplicate request UUID.
Queue waits, DB statements, streamed reads, speech subprocesses and bounded
planning loops honor the request context. Native in-process tensor/decoder
operations are cooperatively checked at their boundaries; instant preemption
of those native calls is not promised. An expired HTTP response cannot claim200.
Exactly one Gunicorn worker process remains required for shared queue/registry.

Clarification preserves restrictions
Search may return needs_clarification with at most two signed questions and no
catalog results. Resubmit the unchanged original prompt, full signed
clarificationContext and clarificationAnswers keyed by question id. One round,
15-minute validity, answer length1..200, original prompt<=2000 and internal
combined text<=2500. The existing MEAL_PLANNER_SIGNING_KEY signs the original
constraints. Original exclusions, source diets, time, cuisine and meal type
cannot be erased by answers; nonconflicting positive ingredients persist.
Remaining contradictions return422 rather than cycling or relaxing filters.
The deterministic EN/VI guards cover explicit negation, supported diet labels
and numeric limits, not arbitrary natural-language meaning or allergy safety.

Trusted growth context
Java supplies only the current actor's tasteFeedback/tasteSignals and explicitly
consented household signals. Preferences and real1..5 ratings softly rerank
before diversity selection; they never become hard allergies. Hard current
eligible IDs, dislikes, public permissions and explicit source diet restrictions
remain authoritative. useHouseholdPreferences=false and useLeftovers=false are
defaults. Explicit householdRestrictions are enforced independently of solo
useProfile. Trusted confirmedLeftovers require identity/version, actual
confirmed portions and user-entered cooking/use-by dates. Undated expiry is
not invented. Canonical reuse references current leftovers/version; their
prepared portions do not create duplicate raw ingredient shopping demand.
The worker only previews allocations. Java owns explicit atomic confirmation,
authorization, current quantity/version checks and debit. Raw must-use rules
cannot be satisfied by prepared leftovers.

Bounded ranking and planning
Legacy readers use an immutable snapshot rather than cloning the full tensor.
Candidate scores/top-k operate on eligible positions. Planner hard SQL filters
precede a300-row deterministic candidate bound; current selections and up to100
eligible leftover recipe IDs can be fetched separately. Measured cost/pantry
selection and alternatives inspect at most60 candidates. Coverage memoization
is request-local and includes canonical plan/context fields, never user-global.
The bounded search is explicitly a heuristic, not a global optimality claim.

Audio policy
LOCAL_TTS_ENGINE=piper selects the explicitly provisioned English neural voice;
Vietnamese uses an identified eSpeak fallback. No on-request voice download.
Generic speech<=2000 characters remains ephemeral. Authenticated immutable
session steps or independently verified public source steps allow<=3000, with
the same synthesis/deadline,180-second and12-MiB WAV bounds. Source cache keys
bind exact text, recipe, language, voice, engine version and model digest.
Fresh anonymous catalog permission and exact current source-step text are
rechecked before every hit. Only those public source steps persist in the
private local audio volume; generic questions/private recipe text do not.
The cache is bounded to256 files/128MiB and is not an HTTP static directory.
Response retains WAV base64 plus cached/cachePolicy/voice/model/duration facts.
Timers and step completion remain explicit client/session actions; speech does
not invent cooking durations or assert a food is ready or safe.

Artifact lineage
New legacy and hybrid publications bind actual semantic dataset fingerprints
and preprocessing source/version. Incremental publications retain per-input
known history; existing migrated files explicitly report historical inputs
unknown. Adding lineage does not retroactively certify old preprocessing and
does not automatically rebuild or mutate a published generation. Refer to
README-cache-generation.txt for explicit operator bootstrap and migration.

Authored evaluation, not participant research
evaluation/intent-en-vi.json contains30 labelled engineering cases,15 per
language, covering exclusions, explicit diets/time, ambiguity, contradictions,
unsupported labels and instruction injection. To measure already provisioned
local models after deployment:
  python -m evaluation.run_intent_benchmark --worker-url http://127.0.0.1:9501 --output /absolute/evaluation/intent-benchmark-live.json
The runner records actual model digest/prompt/corpus versions, latency, returned
intent and strict recall/regression gates; it downloads/writes no model or
recipe data. A failing gate is a release finding, not a fabricated pass. Human
language usability, recipe quality and dietary safety need separate empirical
assessment. The deterministic offline unit suite is not a substitute for this
real model run.
