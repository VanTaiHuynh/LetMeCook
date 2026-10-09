# LetMeCook technical demo replay

Use this script for an operator-led local demonstration. Label all demonstration accounts, prices, pantry entries and actions as technical fixtures. They are not household recruitment, real purchases, customer testimonials or pilot results. The audience sees the working product; preparation must not manufacture traction.

## Before the demonstration

1. Build the final checkout, run the local release checks in [release-2026-10-08.md](release-2026-10-08.md), and inspect the overall result. Confirm text/vision/speech models and the persistent planner key are available. Warm-up may change latency; record warm-up separately.
2. Open `http://localhost:9401`. Keep the app on loopback for a private technical review. Do not expose Supabase Studio, Mailpit, the worker or Ollama to the public internet.
3. For any public-facing demo, obtain actual recipe and original-photo rights first, document them, record the approved declarations as a trusted admin, and enable `publicDemo`. Verify guest catalog search, direct recipe/image reads and planner/recommendation responses exclude unapproved content. A permission flag is not a substitute for obtaining rights.
4. Select at least three genuinely approved dinner recipes with known positive source servings, numeric compatible ingredient amounts, usable instructions and source/photo attribution. Test their real hard filters. Do not claim that every imported recipe has complete quantity data.
5. Prepare an explicitly labelled technical account. Choose its personal pantry or an accepted household scope. Never show its password, JWT, `.env.local`, auth administration data or other users' records during a recording.
6. For a must-use/budget demonstration, enter confirmed actual fixture quantities with known units and dates covering the selected dinner dates. Enter a clearly labelled fixture price quote for every ingredient that is missing: pack quantity, pack price, currency, area, provenance/source and observation date. Fixture quotes demonstrate arithmetic; they are not current market-price claims.
7. Keep consent off unless demonstrating consent mechanics. If enabled for a fixture, show that the resulting events are technical QA activity and remove/revoke them afterward. Do not mix demo actions with a recruited pilot cohort.
8. For an owner-only pilot replay, keep the independent collaboration flag off. Enroll a genuinely recruited household in a named cohort only with explicit owner confirmation and current consent; the server records its actual enrollment time. A technical fixture enrollment is not recruitment and cannot stand in for a matured 28-day observation.

## Three-minute product replay

| Time | Action | Evidence to show |
| --- | --- | --- |
| 0:00–0:25 | Open Sunny. Enter an English or Vietnamese dinner request with a time limit and excluded ingredient. Optionally upload a photo and correct its ingredient list before confirmation. | Parsed explicit requirements, a real matching recipe, original local photo and source link. Explain that recognition does not establish amounts or allergy safety. |
| 0:25–0:50 | Open Pantry. Select the prepared scope and show one confirmed lot, known unit/date and a deliberate unknown amount. | Editable stock, visible unknowns and actual revision/ledger behavior. Unknown stock is not counted as measured available quantity. |
| 0:50–1:25 | Open Meal Planner. Choose three dinners, servings/time, measured must-use scope and an affordable fully priced fixture budget; press Generate explicitly. | Real chosen meals, match reasons, partial/unknown warnings if present, stock allocation and missing shopping quantities. Show pack rounding and quote provenance; do not hide incomplete price coverage. |
| 1:25–1:45 | Choose a tighter time and request a What-if preview. Review the new dinners/quantities/cost and click Apply explicitly. | Actual before/after choices under the original exclusions/must-use/budget and pinned prices. A partial/empty preview is honest; the current draft remains intact until Apply. |
| 1:45–2:15 | Save the plan, open one recipe's cook-along and ask about an explicitly stated duration/amount. Ask a second question whose exact temperature is absent. | Saved source steps/current position, a verbatim supporting citation for the supported answer and an explicit unsupported response for the absent value. |
| 2:15–2:35 | If voice is ready, explicitly start a short recording; review/correct the local transcript, then send it. Request local spoken playback of a source step. | Local STT/TTS model status and editable text. State that eSpeak is robotic and the diagnostic does not establish human Vietnamese accuracy. Keep typed input available. |
| 2:35–3:00 | Confirm completion only for the fixture action and reviewed consumption quantities; then open Evidence. | Stock decreases once, ledger changes and a linked meal completion. Retrying the same operation does not double-consume. Show consent and the named cohort's actual fixed observation window; not-mature means no measured rate, with no invented retention, savings or revenue. |

If the approved catalog or data cannot meet a strict setting, preserve and demonstrate the honest partial/empty state. Do not switch off filters or approve unrelated rights-reserved recipes to force a successful-looking demo.

## Replayable API boundaries

Generate is `POST /api/meal-plans/generate`. A guest may use the public catalog without stock. `usePantry: true`, must-use and budgets require an authenticated account and the gateway-derived accessible pantry. Supported meal counts are 1, 3 and 7; the default is 7.

Recalculate is `POST /api/meal-plans/recalculate` with the plan settings, exact returned `intent`, `meals: [{dayIndex, recipeId}]` and checkmark keys. Save is `POST /api/meal-plans` with the same canonical selections and `version: 0` for a new saved plan. Save/load rebuilds actual recipe/shopping data and checks current public visibility, hard requirements and authoritative profile/stock. Do not send fabricated recipe snapshots as evidence.

An invalid owned saved week returns `{plan: null, invalidSavedPlan: {id, version, weekStart, invalid: true, message}}`. This is metadata only. Generate a valid replacement under current conditions, then save using the returned existing version; `version: 0` cannot overwrite that week. A busy or unavailable worker still returns its actual error rather than recovery metadata.

Signed `_parsed`, `_requirements`, `_pricing` and `_signature` must be retained. Servings/date changes and recipe swaps are allowed if they still satisfy the original conditions; a tighter constraint may be added. To remove must-use, change its original per-meal requirement to plan-only, raise an original budget or relax the original time/exclusions, generate a new plan. Same-selection recalculation does not secretly add/reorder dinners or invoke the language model again.

What-if is `POST /api/meal-plans/what-if` with the same serialized plan and target tighter time/servings. It returns a plain canonical new plan for a preview; the UI compares actual recipes/shopping/cost and only Apply changes the draft. It uses the verified original intent and deterministic candidate selection, with no language-model rerun or silent relaxation. Saving is a separate explicit action.

Pinned price selections remain unchanged during stock refresh, recalculation, saving/loading and What-if. Use authenticated `POST /api/meal-plans/refresh-prices` with the same serialized plan to deliberately choose current observations. Missing/changed used pins require this explicit review; a refresh that exceeds the original budget is rejected. Newly entered quotes are not silently substituted, and a refreshed preview still does not save itself.

Pantry coverage is `POST /api/kitchen/coverage` with the canonical serialized plan and its original accessible `householdId`; the gateway refetches records and returns signed-plan canonical coverage, retaining pinned prices. Selecting a different personal/household scope is rejected. A stock revision that changes during the calculation also produces conflict instead of a falsely current snapshot. A household invitation grants access only after acceptance. Owner/editor/viewer permissions remain enforced at the API, regardless of visible UI controls.

Start a cooking session with `POST /api/kitchen/sessions` and `{recipeId, servings, mealSlot: {planId, dayIndex}}` when cooking a saved dinner; omit `mealSlot` for standalone cooking. The server validates ownership, selected kitchen and current recipe, then persists the binding with its own plan version. `GET /api/kitchen/sessions/{id}` returns it on resume, including when opened from Household without a meal-slot URL. Session questions use `POST /api/kitchen/sessions/{id}/ask` and `{question}`. The browser never supplies a replacement source snapshot. Saved steps/history are bounded and the worker refuses unsupported additions.

Local audio gateways are `POST /api/kitchen/voice/transcribe` with `{audioBase64, mimeType}` and `POST /api/kitchen/voice/speak` with `{text}`. Supported recordings are real WAV/WebM/Ogg/MP4 audio, at most 5 MB and 60 seconds; spoken text is at most 2,000 characters. Recording requires an explicit browser microphone action and permission. No cloud browser speech engine is used.

Completion is `POST /api/kitchen/sessions/{id}/complete`. Use the current session version and aggregate revision, a unique operation key, explicit confirmation and reviewed `{lotId, quantity, version}` entries. A bound session derives its saved slot even when completion omits `mealSlot`; a different supplied binding is rejected. The server refetches the owned saved plan and rejects an edited recipe or already completed slot. Preserve the exact same payload/key when retrying a timed-out action; receipt replay returns the completed result once without another decrement. A reused key with a changed payload or a stale new operation produces conflict; reload rather than silently overwriting.

Substitution rules enter pending review, and previews require an administrator-approved persisted rule. Approval records its note and source URL, without claiming a verified expert credential. Explicit source/profile diets and allergies still apply to the resulting listed ingredients. Ratios apply to reviewed aliases as well as the canonical name; the returned adapted quantity must agree with the change summary.

## Negative checks worth showing

- Remove a required measured lot or change its unit to an incompatible unit: must-use cannot succeed through a name match alone.
- Remove a needed price, its area/source/date or use a different currency: no verified complete budget appears; missing prices are not zero.
- Give a vegetarian/vegan request a source-labelled recipe with known contradictory listed ingredients, such as Parma ham: it must be excluded. An explicit plant alternative does not exempt another clause containing real ham, dairy or egg. Source labels and these lexical checks still cannot establish hidden ingredients or allergy safety.
- Ask for an oven temperature absent from the immutable recipe: the assistant marks it unsupported rather than inventing a temperature.
- Attempt the same stock completion twice with the same key/payload: the prior result is returned without another decrement. Try a changed payload under that key: conflict.
- Open a household as a non-member, or write as a viewer: access is rejected. Do not include real personal data in the recording.
- With public demo enabled, request an unapproved recipe or its original image directly: the public gate still applies.

These are software checks, not independent rights verification, food-safety certification or a field-study result.

## Evidence and cleanup

Save the evaluation report with its model digests, release revision, UTC timestamp, cold/warm distinction, source case IDs and statuses. Retain failed checks as well as successes. The built-in inference harness uses labelled synthetic source-step cases and concurrency bursts; it does not measure representative customer accuracy or weeks of retention.

The recorded planner replay passed 13 live API checks using a real source recipe and original local image. Its 30 CAD pinned-cost and explicit 21 CAD refreshed-cost observations used labelled disposable prices, all subsequently deleted. The guest preview changed three real dinner IDs within 15 minutes and retained the original dairy/peanut exclusions. Use this as software regression evidence; it is not a licensed public-demo catalog, real shopping expenditure or participant outcome.

Remove temporary demo pantry/price entries and accounts through the authorized fixture cleanup procedure. Revoke/delete fixture evidence if it was enabled. Keep required licensed recipe data separate from temporary stock/activity. Never publish backups, runtime environments, JWTs, raw private uploads, contact records or account identifiers in a demo pack.

Human interviews, recruitment, a rights-reviewed 100-recipe pilot catalog, participant consent and assigned-task observation remain human work. Any four-week outcome requires a full observation window and documented cohort, including failures and dropouts. A public demo and technical test pass do not complete those acceptance gates.
