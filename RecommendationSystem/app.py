# app.py (Updated version with cache integration)
from flask import Flask, request, jsonify, g
import atexit
import logging
import os
import signal
import sys
import math
import uuid
from sqlalchemy.exc import SQLAlchemyError

from src.runtime_threads import configure_cpu_threads

CPU_THREADS = configure_cpu_threads()

from src.recommend import recommend_by_id, recommend_for_user, get_recommendation_stats
from src.cache_manager import get_cache, shutdown_cache

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
logger.info("CPU inference threads: intra-op=%s, inter-op=%s", CPU_THREADS["intraop_threads"],
            CPU_THREADS["interop_threads"])

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 7_100_000

from src import local_ai, meal_planner, pantry, cook_assistant, local_voice, inference_queue
from src import readiness,legacy_cache_store
from src import request_context


@app.before_request
def bounded_request():
    if request.path in ('/', '/health/live') or request.path.startswith('/health/') or request.path.startswith('/ai/requests/') and request.path.endswith('/cancel'):
        return
    try:
        timeout = int(request.headers.get('X-Local-AI-Timeout-Ms', '150000'))
    except ValueError:
        raise local_ai.AIError('Request deadline must be a bounded integer.')
    scope = request_context.request_scope(timeout, request.headers.get('X-Local-AI-Request-Id'),
                                          request.headers.get('X-Local-AI-Cancel-Token'))
    g.ai_scope = scope
    g.ai_request = scope.__enter__()
    # CPU ranking, deterministic planning and speech use the same bounded
    # admission lane as model work. Nested model calls retain this slot.
    if (request.method == 'POST' and (request.path.startswith('/ai/') or request.path == '/recommend/user')
            and not request.path.endswith('/cancel')) or request.path in ('/recommend/id', '/recommend/user'):
        kind = 'cook' if '/cook/' in request.path else 'voice' if '/voice/' in request.path else 'plan' if '/meal-plan/' in request.path else 'text'
        slot = inference_queue.queue.slot(kind, rate_limit=False, reentrant=True)
        g.ai_slot = slot
        try: slot.__enter__()
        except inference_queue.QueueBusy as error:
            g.ai_slot = None
            raise local_ai.AIError(str(error), 429) from error


@app.after_request
def request_identity(response):
    value = getattr(g, 'ai_request', None)
    if value is not None:
        try:value.check()
        except request_context.RequestStopped as error:
            response=jsonify({'message':str(error),'code':error.code})
            response.status_code=error.status
        response.headers['X-Local-AI-Request-Id'] = value.request_id
    return response


@app.teardown_request
def release_request(error):
    # Do not replace a prepared response in teardown. Request phases themselves
    # checkpoint before returning; finally always frees admission and registry.
    for name in ('ai_slot', 'ai_scope'):
        scope = getattr(g, name, None)
        if scope is not None:
            try: scope.__exit__(type(error) if error else Exception, error, None)
            except Exception: pass


@app.route('/ai/requests/<request_id>/cancel', methods=['POST'])
def cancel_request(request_id):
    return jsonify(request_context.cancel(request_id, ai_body().get('cancelToken')))


def ai_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise local_ai.AIError("The request must be a JSON object.")
    if body.get('contractVersion','local-ai.v2')!='local-ai.v2':
        raise local_ai.AIError('Unsupported local AI contract version.')
    return body


@app.errorhandler(local_ai.AIError)
def ai_error(error):
    return jsonify({"message": str(error), **({'code': error.code} if hasattr(error, 'code') else {})}), error.status, ({"Retry-After": "10"} if error.status == 429 else {})


@app.errorhandler(legacy_cache_store.CacheBusy)
def cache_busy(error):
    return jsonify({'message':'Legacy cache publisher is busy. Please retry shortly.'}),429,{'Retry-After':'10'}


@app.errorhandler(legacy_cache_store.CacheInvalid)
@app.errorhandler(legacy_cache_store.ModelUnavailable)
def cache_unavailable(error):
    return jsonify({'message':'Local legacy cache or pinned model is unavailable. An explicit migration or provisioning is required.'}),503


@app.errorhandler(SQLAlchemyError)
def catalog_unavailable(error):
    return jsonify({'message':'The local recipe catalog is unavailable or its query deadline expired. Please retry shortly.'}),503


@app.errorhandler(413)
def payload_too_large(error):
    return jsonify({"message": "Request is too large. Photos and recordings must be at most 5 MB."}), 413


@app.route("/ai/status", methods=["GET"])
def ai_status():
    return jsonify(readiness.status())


@app.route("/ai/parse", methods=["POST"])
def ai_parse():
    body = ai_body()
    return jsonify(local_ai.parse_intent(body.get("prompt")))


@app.route("/ai/vision", methods=["POST"])
def ai_vision():
    body = ai_body()
    return jsonify(local_ai.vision(body.get("imageBase64")))


@app.route("/ai/search", methods=["POST"])
def ai_search():
    body = ai_body()
    prompt = body.get("prompt", "")
    if not isinstance(prompt, str) or len(prompt) > 2000:
        raise local_ai.AIError("Recipe request must contain at most 2000 characters.")
    return jsonify(local_ai.search(prompt, body.get("confirmedIngredients"),
                   body.get('clarificationContext'), body.get('clarificationAnswers')))


@app.route("/ai/meal-plan/generate", methods=["POST"])
def meal_plan_generate():
    with inference_queue.task("plan"):
        return jsonify(meal_planner.generate(ai_body()))


@app.route("/ai/meal-plan/recalculate", methods=["POST"])
def meal_plan_recalculate():
    return jsonify(meal_planner.recalculate(ai_body()))


@app.route("/ai/meal-plan/what-if", methods=["POST"])
def meal_plan_what_if():
    return jsonify(meal_planner.what_if(ai_body()))


@app.route("/ai/meal-plan/refresh-prices", methods=["POST"])
def meal_plan_refresh_prices():
    return jsonify(meal_planner.refresh_prices(ai_body()))


@app.route("/ai/cook/ask", methods=["POST"])
def cook_ask():
    return jsonify(cook_assistant.ask(ai_body()))


@app.route("/ai/voice/status", methods=["GET"])
def voice_status():
    return jsonify(local_voice.status())


@app.route("/ai/voice/transcribe", methods=["POST"])
def voice_transcribe():
    return jsonify(local_voice.transcribe(ai_body()))


@app.route("/ai/voice/speak", methods=["POST"])
def voice_speak():
    return jsonify(local_voice.speak(ai_body()))

@app.route("/ai/pantry/coverage", methods=["POST"])
def pantry_coverage():
    return jsonify(pantry.coverage(ai_body()))


@app.route("/ai/pantry/suggest", methods=["POST"])
def pantry_suggestions():
    return jsonify(pantry.suggest(ai_body()))


@app.route("/ai/pantry/substitute", methods=["POST"])
def pantry_substitution():
    return jsonify(pantry.substitute(ai_body()))


# Initialize cache on startup
logger.info("🚀 Initializing recipe recommendation cache...")
cache = get_cache()
logger.info("✅ Cache initialized successfully")


def cleanup():
    """Cleanup function for graceful shutdown"""
    logger.info("🛑 Shutting down application...")
    shutdown_cache()


# Register cleanup functions
atexit.register(cleanup)


def signal_handler(sig, frame):
    """Handle shutdown signals"""
    cleanup()
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)



@app.route("/", methods=["GET"])
@app.route('/health/live',methods=['GET'])
def health_check():
    """Process liveness: no DB, model calls, filesystem validation or clones."""
    return jsonify({'status':'alive','local':True}),200


@app.route('/health/ready',methods=['GET'])
def readiness_check():
    capability=request.args.get('capability','recommendation')
    if capability not in readiness.CAPABILITIES:
        return jsonify({'message':'Unknown readiness capability.'}),400
    result=readiness.ready(capability)
    return jsonify(result),200 if result['status']=='ready' else 503


@app.route("/recommend/id", methods=["GET"])
def recommend_by_recipe():
    """Get recommendations based on a recipe ID"""
    recipe_id = request.args.get("recipeId")
    try:
        recipe_id = str(uuid.UUID(recipe_id))
        top_k = int(request.args.get("topK", 10))
    except (ValueError, TypeError, AttributeError):
        raise local_ai.AIError("Recipe ID or recommendation limit is invalid.")

    if not recipe_id:
        return jsonify({"error": "Missing recipeId parameter"}), 400

    if top_k <= 0 or top_k > 100:
        return jsonify({"error": "topK must be between 1 and 100"}), 400

    try:
        logger.info(f"Getting recommendations for recipe {recipe_id} (top_k={top_k})")
        results = recommend_by_id(recipe_id, top_k)

        return jsonify({
            "recommendations": results,
            "count": len(results),
            "recipe_id": recipe_id
        }), 200

    except (legacy_cache_store.CacheBusy,legacy_cache_store.CacheInvalid,legacy_cache_store.ModelUnavailable,SQLAlchemyError):
        raise
    except ValueError as e:
        logger.warning(f"Recipe not found: {e}")
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"Error in recommend_by_recipe: {e}")
        return jsonify({"error": "Internal server error"}), 500


def recommendation_ids(value, name, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise local_ai.AIError(f"{name} must be an ID list with at most {maximum} entries.")
    result = []
    for item in value:
        if not isinstance(item, str):
            raise local_ai.AIError(f"{name} contains an invalid recipe ID.")
        try:
            result.append(str(uuid.UUID(item)))
        except ValueError as exc:
            raise local_ai.AIError(f"{name} contains an invalid recipe ID.") from exc
    return list(dict.fromkeys(result))


@app.route("/recommend/user", methods=["POST"])
def recommend_for_trusted_context():
    """Loopback server contract: fresh eligibility precedes all hybrid ranking."""
    body = ai_body()
    required = {"favorites", "history", "eligibleIds", "excludedIds", "dietaryPreferences", "topK"}
    if not required<=set(body) or set(body)-required-{'tasteFeedback','tasteSignals','contractVersion'}:
        raise local_ai.AIError("Recommendation context is incomplete or contains unsupported fields.")
    if body.get('contractVersion','local-ai.v2')!='local-ai.v2':
        raise local_ai.AIError('Unsupported recommendation contract version.')
    favorites = recommendation_ids(body["favorites"], "favorites", 100)
    history = recommendation_ids(body["history"], "history", 100)
    eligible = recommendation_ids(body["eligibleIds"], "eligibleIds", 20000)
    excluded = recommendation_ids(body["excludedIds"], "excludedIds", 20000)
    top_k = body["topK"]
    if type(top_k) is not int or not 1 <= top_k <= 100:
        raise local_ai.AIError("topK must be between 1 and 100.")
    diets = body["dietaryPreferences"]
    if (not isinstance(diets, list) or len(diets) > 20
            or any(not isinstance(value, str) or not value.strip() or len(value) > 60 for value in diets)):
        raise local_ai.AIError("Dietary preferences are invalid.")
    from src.ai_contracts import TasteContext
    taste=TasteContext.from_mapping(body).to_preferences()
    results = recommend_for_user(favorites, history, top_k=top_k, eligible_ids=eligible,
                                excluded_ids=excluded, preferences={"dietaryPreferences": diets,**taste})
    return jsonify({"recommendations": results, "count": len(results)}), 200


@app.route("/recommend/user", methods=["GET"])
def recommend_for_user_route():
    """Get recommendations for a user based on favorites and history"""
    favorites = request.args.get("favorites", "")
    history = request.args.get("history", "")
    try:
        top_k = int(request.args.get("topK", 10))
        fav_weight = float(request.args.get("favWeight", 2.0))
        hist_weight = float(request.args.get("histWeight", 1.0))
    except (ValueError, TypeError):
        raise local_ai.AIError("Recommendation limits and weights are invalid.")
    if any(not math.isfinite(value) or not 0 < value <= 10 for value in (fav_weight, hist_weight)):
        raise local_ai.AIError("Recommendation weights must be greater than zero and at most 10.")

    # Parse comma-separated IDs
    favorites = recommendation_ids([f.strip() for f in favorites.split(",") if f.strip()], "favorites", 100)
    history = recommendation_ids([h.strip() for h in history.split(",") if h.strip()], "history", 100)

    if not favorites and not history:
        return jsonify({"error": "Must provide either favorites or history"}), 400

    if top_k <= 0 or top_k > 100:
        return jsonify({"error": "topK must be between 1 and 100"}), 400

    try:
        logger.info(
            f"Getting user recommendations (favorites: {len(favorites)}, history: {len(history)}, top_k: {top_k})")
        results = recommend_for_user(favorites, history, fav_weight, hist_weight, top_k)

        return jsonify({"recommendations": results, "count": len(results)}), 200

    except (legacy_cache_store.CacheBusy,legacy_cache_store.CacheInvalid,legacy_cache_store.ModelUnavailable,SQLAlchemyError):
        raise
    except Exception as e:
        logger.error(f"Error in recommend_for_user: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/cache/info", methods=["GET"])
def get_cache_info():
    """Get cache information and statistics"""
    try:
        stats = readiness.cache_diagnostics(cache)
        return jsonify(stats), 200
    except Exception as e:
        logger.error(f"Error getting cache info: {e}")
        return jsonify({"error": "Cache diagnostics are unavailable."}),503


@app.route("/cache/reload", methods=["POST"])
def force_cache_reload():
    """Force cache reload"""
    try:
        logger.info("🔄 Force reloading cache...")
        started = cache.force_reload()
        return jsonify({
            "status": "success",
            "message": "Cache reload initiated" if started else "Cache reload already running",
            "started": started,
            "pipeline": cache.get_rebuild_status()
        }), 202
    except Exception as e:
        logger.error(f"Error forcing cache reload: {e}")
        return jsonify({"error": "Could not start a cache rebuild."}),503


@app.route("/pipeline/run", methods=["POST"])
def run_pipeline():
    """Run the full pipeline in background"""
    try:
        logger.info("🚀 Starting background pipeline...")
        started = cache.force_reload()
        return jsonify({
            "status": "success",
            "message": "⏳ Pipeline started in background" if started else "⏳ Pipeline already running",
            "started": started,
            "pipeline": cache.get_rebuild_status()
        }), 202
    except Exception as e:
        logger.error(f"Failed to start pipeline: {e}")
        return jsonify({
            "error": "Failed to start pipeline",
            "details": "The local publisher is unavailable."
        }), 500


@app.route("/pipeline/status", methods=["GET"])
def check_pipeline_status():
    """Report persistent status for the shared pipeline/reload job."""
    state = cache.get_rebuild_status()
    messages = {"idle": "ℹ️ No pipeline started yet.", "queued": "⏳ Pipeline queued...",
                "running": "⏳ Pipeline running...", "complete": "✅ Pipeline finished successfully.",
                "failed": "❌ Pipeline failed: " + str(state.get("error", "Unknown error"))}
    return jsonify({"status": messages.get(state.get("status"), "Unknown pipeline status"), "pipeline": state}), 200


@app.route("/embedding/add", methods=["POST"])
def add_embedding():
    """Add embedding for a new recipe"""
    data = request.get_json()
    recipe_id = data.get("id") if isinstance(data,dict) else None

    if not recipe_id:
        return jsonify({"error": "Missing recipe ID"}), 400
    try:recipe_id=str(uuid.UUID(recipe_id))
    except (ValueError,TypeError,AttributeError):return jsonify({'message':'Recipe ID is invalid.'}),400

    try:
        logger.info(f"Adding embedding for recipe {recipe_id}")
        cache.add_recipe_to_cache(recipe_id)
        return jsonify({
            "message": f"✅ Embedding added for recipe: {recipe_id}",
            "recipe_id": recipe_id
        }), 200
    except (legacy_cache_store.CacheBusy,legacy_cache_store.CacheInvalid,legacy_cache_store.ModelUnavailable,SQLAlchemyError):
        raise
    except ValueError as e:
        logger.warning(f"Recipe not found: {e}")
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"Error adding embedding: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.route("/embedding/remove", methods=["POST"])
def remove_embeddings():
    """Remove embeddings for recipes"""
    data = request.get_json()
    ids = data.get("ids", []) if isinstance(data,dict) else []

    if not ids:
        return jsonify({"error": "Missing recipe IDs"}), 400

    ids=recommendation_ids(ids,'ids',5000)

    try:
        logger.info(f"Removing embeddings for {len(ids)} recipes")
        cache.remove_recipes_from_cache(ids)
        return jsonify({
            "message": f"🧹 Removed {len(ids)} embeddings",
            "removed_ids": ids
        }), 200
    except (legacy_cache_store.CacheBusy,legacy_cache_store.CacheInvalid,legacy_cache_store.ModelUnavailable,SQLAlchemyError):
        raise
    except Exception as e:
        logger.error(f"Error removing embeddings: {e}")
        return jsonify({"error": "Internal server error"}), 500


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    try:
        logger.info("🌟 Starting Recipe Recommendation API server...")
        app.run(host=os.getenv("RECOMMENDATION_HOST", "127.0.0.1"), port=int(os.getenv("RECOMMENDATION_PORT", "9501")), debug=False)
    except KeyboardInterrupt:
        logger.info("👋 Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
    finally:
        cleanup()
