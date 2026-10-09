import { paginationPages } from "../utils/pagination";
import Alert from "../components/ui/Alert";
import { accountRecipes } from "../utils/accountApi";
import Button from "../components/ui/Button";
import { useEffect, useRef, useState } from "react";
import RecipeList from "./../components/RecipeList";
import { favoriteMutation } from "../utils/accountMutations";
import { useAuth } from "../context/AuthContext";
import { FaEdit } from "react-icons/fa";
import { Link, Navigate } from "react-router-dom";


const RESULTS_PER_PAGE = 24;
function FavouritesContent({ user }) {
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [favRecipes, setFavRecipes] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const visibleRecipes = favRecipes;


  const editBtnRef = useRef(null);
  const activeRef = useRef(true);
  const pendingRef = useRef(new Map());
  useEffect(() => { const requests = pendingRef.current; activeRef.current = true; return () => { activeRef.current = false; requests.forEach(controller => controller.abort()); requests.clear(); }; }, []);

  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);



  const handleRemove = async (recipeId) => {
    if (!user?.id || !activeRef.current || pendingRef.current.has(recipeId)) return;
    const controller = new AbortController(); pendingRef.current.set(recipeId, controller);

    setError('');
    try {
    await favoriteMutation(recipeId,user.id,{remove:true,signal:controller.signal});
    if (!activeRef.current || controller.signal.aborted) return;
    if (favRecipes.length === 1 && page > 1) setPage(value => value - 1);
    else setRefreshVersion(value => value + 1);
    } catch (error) {
      if (activeRef.current && !controller.signal.aborted) setError(error.message || 'Could not remove this favorite. Please try again.');
    } finally { if (pendingRef.current.get(recipeId) === controller) pendingRef.current.delete(recipeId); }
  };

  useEffect(() => {
    if (!user?.id) return;
    const controller = new AbortController();
    let active = true;

    async function fetchFav() {
      setLoading(true);
      setError('');
      try {

      const data = await accountRecipes('favorites', page - 1, { signal: controller.signal, actorId: user.id });
      if (!active || controller.signal.aborted) return;
      setFavRecipes(data.content); setTotalElements(data.totalElements); setTotalPages(Math.max(1, data.totalPages));
      } catch (error) {
        if (active) {
          setError(error.message || 'Could not load your favorites. Please try again.');
          setFavRecipes([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchFav();
    return () => { active = false; controller.abort(); };
  }, [user.id, page, refreshVersion]);


  return (
    <main className="product-page product-favourites-page all-recipes-section">
      <div className="all-recipes-bg" />
      <div className="layout-wrapper">
        <header className="catalog-page-header lmc-page-header"><div>
          <h1 className="product-page-title">Favorites</h1><p className="product-page-intro">The meals you want to make again.</p></div><div className="catalog-page-actions lmc-page-actions">
          <Button type="button" className={`product-edit-toggle ${editMode ? "active" : ""}`} aria-pressed={editMode} disabled={loading || !totalElements} onClick={() => setEditMode(!editMode)} ref={editBtnRef}>
            <FaEdit size={18} aria-hidden="true" />
            {editMode ? "Done managing" : "Manage favorites"}
          </Button>
        </div></header>
        {editMode && <p className="library-manage-note">Choose a recipe to remove.</p>}

        <>
          {loading && <RecipeList loading recipes={[]} />}
          {error && <div className="product-status"><Alert as="p">{error}</Alert><Button type="button" className="product-edit-toggle" onClick={() => setRefreshVersion((version) => version + 1)}>Try again</Button></div>}
          {!loading && !error && totalElements === 0 && <div className="library-empty"><h2>No favorites yet</h2><p>Save recipes from the collection.</p><Link to="/recipes" className="lmc-button lmc-button--primary">Explore recipes</Link></div>}
          {!loading && !error && totalElements > 0 && <RecipeList
            recipes={visibleRecipes}
            editMode={editMode}
            onRemove={handleRemove}
            onExitEditMode={() => setEditMode(false)}
            ignoreClickRefs={[editBtnRef]}
          />}



          {!loading && !error && totalElements > 0 && (
            <div className="pagination-wrapper catalog-pagination">
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
                <Button type="button" aria-label="Previous page" disabled={page <= 1}
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
                        <Button type="button" aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}
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

                <span className="catalog-page-total">of {totalPages}</span>
                <Button type="button" aria-label="Next page" disabled={page >= totalPages}
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
    </main>
  );
}

export default function Favourites() {
  const { user, loading } = useAuth();
  if (loading) return <main className="product-page layout-wrapper"><h1 className="product-page-title">Favorites</h1><p role="status">Checking your account…</p></main>;
  if (!user) return <Navigate to="/login" state={{ from: { pathname: '/favourites' } }} replace/>;
  return <FavouritesContent key={user.id} user={user}/>;
}
