import Alert from "../components/ui/Alert";
import Button from "../components/ui/Button";
import { aiRequest } from "../utils/aiControl";
import { useEffect, useRef, useState } from "react";
import RecipeList from "./../components/RecipeList";
import { useAuth } from "../context/AuthContext";
import { Link, Navigate } from "react-router-dom";
import { dislikeRecipe } from "../utils/accountMutations";


const RESULTS_PER_PAGE = 6;

function RecommendationsWorkspace({ user }) {
  const [loading, setLoading] = useState(true);
  const [currentPage, setPage] = useState(1);
  const [recommended, setRecommended] = useState([]);
  const [resultError, setResultError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const pending = useRef(new Map());
  const active = useRef(true);
  const totalElements = recommended.length;
  const totalPages = Math.max(1, Math.ceil(totalElements / RESULTS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);

  useEffect(() => {
    const requests = pending.current;
    active.current = true;
    return () => { active.current = false; requests.forEach(controller => controller.abort()); requests.clear(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true); setResultError(""); setRecommended([]); setPage(1);
    aiRequest('/recipes/recommend', { signal: controller.signal, auth: 'required', actorId: user.id, timeoutMs: 30000, service: 'Recommendations' })
      .then(data => {
        if (!current || controller.signal.aborted) return;
        const items = Array.isArray(data.content) ? data.content.map((r) => ({...r, cookingTime: r.time ?? r.cookingTime})) : [];
        setRecommended(items);
      }).catch((error) => { if (current && !controller.signal.aborted) setResultError(error.message); })
      .finally(() => { if (current && !controller.signal.aborted) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [user.id, retry]);

  const handleDislike = async (recipeId) => {
    if (!active.current || pending.current.has(recipeId)) return;
    const controller = new AbortController();
    pending.current.set(recipeId, controller); setPendingCount(value => value + 1); setResultError('');
    try {
      await dislikeRecipe(recipeId,user.id,controller.signal);
      if (controller.signal.aborted || !active.current) return;

      // remove the disliked recipe from view
      setRecommended(previous => previous.filter((r) => r.id !== recipeId));
    } catch {
      if (!controller.signal.aborted && active.current) setResultError("Could not update your recommendations. Please try again.");
    } finally {
      if (pending.current.get(recipeId) === controller) {
        pending.current.delete(recipeId);
        if (active.current) setPendingCount(value => value - 1);
      }
    }
  };

  return (
    <section className="recommended-section">
      <div className="all-recipes-bg" />
      <div className="layout-wrapper">
        <div className="recommended-header">
          <h3>Recommended for you</h3>
        </div>

        {resultError && <Alert as="p" className="product-status">{resultError} <Button type="button" disabled={pendingCount > 0} onClick={() => { if (!pending.current.size) setRetry((value) => value + 1); }}>Retry</Button></Alert>}
        {pendingCount > 0 && <p role="status">Updating your recommendations…</p>}
        {loading ? (
          <div className="loading-message" role="status">Loading recommendations…</div>
        ) : (
          <>
            {recommended.length > 0 && <RecipeList
              recipes={recommended.slice(
                (page - 1) * RESULTS_PER_PAGE,
                page * RESULTS_PER_PAGE
              )}
              onDislike={handleDislike}
            />}
            {!resultError && recommended.length === 0 && <div className="library-empty"><p>No recommendations yet.</p><Link to="/recipes" className="lmc-button lmc-button--secondary">Explore recipes</Link></div>}

            {recommended.length > 0 && (
              <div className="pagination-wrapper-recommended">
                <div className="pagination-meta">
                  <span>
                    <b>
                      {(page - 1) * RESULTS_PER_PAGE + 1} -{" "}
                      {Math.min(page * RESULTS_PER_PAGE, totalElements)}
                    </b>{" "}
                    of <b>{totalElements}</b> recipes
                  </span>
                </div>

                <div className="pagination-numbers">
                  <Button type="button" aria-label="Previous recommendation page" disabled={page <= 1}
                    className={`page-prev ${page === 1 ? "disabled" : ""}`}
                    onClick={() => page > 1 && setPage(page - 1)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="8"
                      height="14"
                    >
                      <path d="M0 7L8 14L8 0L0 7Z" fill="#1E1E1E" />
                    </svg>
                  </Button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => {
                      if (totalPages <= 7) return true;
                      if (p === 1 || p === totalPages) return true;
                      if (Math.abs(p - page) <= 1) return true;
                      if (page <= 3 && p <= 3) return true;
                      if (page >= totalPages - 2 && p >= totalPages - 2)
                        return true;
                      return false;
                    })
                    .map((p, idx, arr) => {
                      const prev = arr[idx - 1];
                      const showDots = prev && p - prev > 1;

                      return (
                        <span key={p} className="pagination-item">
                          {showDots && <span className="ellipsis">...</span>}
                          <Button type="button" aria-label={`Recommendation page ${p}`} aria-current={p === page ? "page" : undefined}
                            className={`page-number ${
                              p === page ? "current" : ""
                            }`}
                            onClick={() => setPage(p)}
                          >
                            {p}
                          </Button>
                        </span>
                      );
                    })}

                  <Button type="button" aria-label="Next recommendation page" disabled={page >= totalPages}
                    className={`page-next ${
                      page === totalPages ? "disabled" : ""
                    }`}
                    onClick={() => page < totalPages && setPage(page + 1)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="8"
                      height="14"
                    >
                      <path d="M8 7L0 14L0 0L8 7Z" fill="#1E1E1E" />
                    </svg>
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default function MyRecommended() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking your account…</p>;
  if (!user) return <Navigate to="/unauthorized" replace/>;
  return <RecommendationsWorkspace key={user.id} user={user}/>;
}
