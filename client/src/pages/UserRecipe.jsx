import { paginationPages } from "../utils/pagination";
import Alert from "../components/ui/Alert";
import { accountRecipes } from "../utils/accountApi";
import Button from "../components/ui/Button";
import { useEffect, useRef, useState } from "react";
import RecipeList from "./../components/RecipeList";
import Modal from "../components/Modal";
import { deleteOwnRecipe } from "../utils/accountMutations";
import { useAuth } from "../context/AuthContext";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { FaEdit } from "react-icons/fa";


const RESULTS_PER_PAGE = 24;
function UserRecipeContent({ user }) {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);
  const [userRecipes, setUserRecipes] = useState([]);
  const navigate = useNavigate();
  const [editMode, setEditMode] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const activeRef = useRef(true);
  const pendingRef = useRef(new Map());
  useEffect(() => { const requests = pendingRef.current; activeRef.current = true; return () => { activeRef.current = false; requests.forEach(controller => controller.abort()); requests.clear(); }; }, []);



  useEffect(() => {
    if (!user?.id) return;

    const controller = new AbortController();
    let active = true;
    async function fetchRecipe() {
      setLoading(true);
      setError("");
      try {
      const data = await accountRecipes('recipes', page - 1, { signal: controller.signal, actorId: user.id });
      if (!active || controller.signal.aborted) return;
      setUserRecipes(data.content);
      const pages = Math.max(1, data.totalPages); setTotalElements(data.totalElements); setTotalPages(pages);
      if (page > pages) setPage(pages);
      } catch {
        if (active) {
          setError('Could not load your recipes. Please try again.');
          setUserRecipes([]);
          setTotalElements(0);
          setTotalPages(1);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchRecipe();
    return () => { active = false; controller.abort(); };
  }, [user.id, page, refreshVersion]);


  const handleRemove = async (recipeId) => {
    if (!user?.id || !activeRef.current || pendingRef.current.size) return;
    const controller = new AbortController(); pendingRef.current.set(recipeId, controller); setDeletingId(recipeId); setError("");

    try {
    await deleteOwnRecipe(recipeId,user.id,controller.signal);
    if (!activeRef.current || controller.signal.aborted) return;

    if (userRecipes.length === 1 && page > 1) setPage(page - 1);
    else setRefreshVersion((version) => version + 1);
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) setError(error.message || 'Could not delete the recipe. Please try again.');
    } finally { if (pendingRef.current.get(recipeId) === controller) { pendingRef.current.delete(recipeId); if (activeRef.current && !controller.signal.aborted) setDeletingId(null); } }
  };

  return (
    <main className="product-page product-library-page all-recipes-section">
      <div className="all-recipes-bg" />
      <div className="layout-wrapper">
        <header className="catalog-page-header lmc-page-header"><div>
          <h1 className="product-page-title">My recipes</h1><p className="product-page-intro">Keep your best recipes in one place.</p></div><div className="catalog-page-actions lmc-page-actions"><Button type="button" onClick={() => navigate("/create-recipe")} className="lmc-button lmc-button--primary">Create recipe</Button>
          <Button type="button" className={`product-edit-toggle ${editMode ? "active" : ""}`} aria-pressed={editMode} disabled={loading || !totalElements} onClick={() => setEditMode(!editMode)}>
            <FaEdit size={18} aria-hidden="true" />
            {editMode ? "Done managing" : "Manage recipes"}
          </Button>
        </div></header>
        {editMode && <p className="library-manage-note">Choose a recipe to delete.</p>}


        <>



          {deletingId && <p className="product-status" role="status">Deleting recipe…</p>}
          {error && <div className="product-status"><Alert as="p">{error}</Alert><Button type="button" className="product-edit-toggle" onClick={() => setRefreshVersion((version) => version + 1)}>Try again</Button></div>}
          {!loading && !error && totalElements === 0 && <div className="library-empty"><h2>No recipes yet</h2><Link to="/create-recipe" className="lmc-button lmc-button--primary">Create recipe</Link></div>}
          {loading ? <RecipeList loading recipes={[]} /> : !error && totalElements > 0 && <RecipeList
            recipes={userRecipes}
            editMode={editMode}
            onRemove={recipeId => { if (!pendingRef.current.size) setDeleteCandidate(userRecipes.find(recipe => recipe.id === recipeId)); }}
            removeLabel="Delete recipe"
          />}

          {!loading && !error && totalElements > 0 && (
            <div className="pagination-wrapper catalog-pagination">
              <div className="pagination-meta">
                <span>
                  <b>
                    {totalElements ? (page - 1) * RESULTS_PER_PAGE + 1 : 0} -{" "}
                    {Math.min(page * RESULTS_PER_PAGE, totalElements)}
                  </b>{" "}
                  of <b>{totalElements}</b> recipes
                </span>
              </div>

              <div className="pagination-numbers">
                <Button
                  type="button"
                  aria-label="Previous page"
                  disabled={page === 1}
                  className={`page-prev ${page === 1 ? "disabled" : ""}`}
                  onClick={() => page > 1 && setPage(page - 1)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="8"
                    height="14"
                    viewBox="0 0 8 14"
                    fill="none"
                  >
                    <path d="M0 7L8 14L8 0L0 7Z" fill="#1E1E1E" />
                  </svg>
                </Button>

                {paginationPages(page, totalPages)
                  .map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showDots = prev && p - prev > 1;

                    return (
                      <span key={p} className={`pagination-item${p === page ? " is-current" : ""}`}>
                        {showDots && <span className="ellipsis">...</span>}
                        <Button
                          type="button"
                          aria-current={p === page ? "page" : undefined}
                          aria-label={`Page ${p}`}
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

                <Button
                  type="button"
                  aria-label="Next page"
                  disabled={page === totalPages}
                  className={`page-next ${
                    page === totalPages ? "disabled" : ""
                  }`}
                  onClick={() => page < totalPages && setPage(page + 1)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="8"
                    height="14"
                    viewBox="0 0 8 14"
                    fill="none"
                  >
                    <path d="M8 7L0 14L0 0L8 7Z" fill="#1E1E1E" />
                  </svg>
                </Button>
              </div>
            </div>
          )}
        </>
      </div>
      <Modal isOpen={Boolean(deleteCandidate)} title="Delete recipe?" message={`Permanently delete “${deleteCandidate?.title || 'this recipe'}”? This cannot be undone.`} showConfirmButtons confirmLabel="Delete recipe" confirmVariant="danger" onClose={() => setDeleteCandidate(null)} onConfirm={() => { const recipeId = deleteCandidate?.id; setDeleteCandidate(null); if (recipeId) handleRemove(recipeId); }} />
    </main>
  );
}

export default function UserRecipe() {
  const { user, loading } = useAuth();
  if (loading) return <main className="product-page layout-wrapper"><h1 className="product-page-title">My recipes</h1><p role="status">Checking your account…</p></main>;
  if (!user) return <Navigate to="/login" state={{ from: { pathname: '/user-recipe' } }} replace/>;
  return <UserRecipeContent key={user.id} user={user}/>;
}
